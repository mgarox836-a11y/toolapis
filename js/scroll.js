/* ============================================================================
 * scroll.js — TOOLAPIS · scroll choreography + text-clearance solver
 * ----------------------------------------------------------------------------
 * Three jobs:
 *
 *  1. Turn scrollY into a normalised progress value across the section stops
 *     and blend the two active stops (camera pose, exposure, per-prop
 *     composition).
 *
 *  2. Blend the per-section COMPOSITION weights (focal / lineup / converge),
 *     so Overview, Features, Flow and Clarity each read differently and the
 *     transition between them is a cross-fade, never a snap.
 *
 *  3. Keep props out of the text, and keep them WHOLE. Object placement is
 *     screen-space: each prop has an NDC anchor, the real DOM rectangles of
 *     the active section are measured to find which horizontal band is
 *     actually free at that height, and the prop is then sized to fill that
 *     band without ever crossing the viewport edge. If no band is wide enough
 *     the prop drops into `safe` mode — pushed far back, shrunk and dimmed —
 *     instead of sitting on the copy.
 *
 * The clearance solve runs per frame but only walks a small pre-measured list
 * of rectangles; DOM reads happen on resize / font-load only.
 * ==========================================================================*/

import * as THREE from 'three';
import {
  TUNING, STOPS, SECTION_IDS, OBJ_KEYS,
  LINEUP, CONVERGE, FOCAL_CARDS, exposureFor,
} from './config.js';

/* HARD obstacles: a prop must never cover any of this. */
const CONTENT_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'blockquote',
  'img', 'svg', 'video', 'iframe', '.btn',
].join(',');

/* Cards are HARD obstacles too. The 3D layer sits behind the page, so a prop
 * read through the glass could pass for depth — but at the sizes the solver
 * was allowed before, it read as a prop covering the copy. A card is now
 * measured with the same padding as text and the prop must go around it; it
 * only still `dims` what ends up behind one (the card's inner copy, which is
 * not part of the prop's own box). */
const SOFT_SELECTOR = '.glass-panel, .spot-card';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);

export function createScrollEngine() {
  /** @type {number[]} scrollY at which each section is vertically centred */
  let anchors = SECTION_IDS.map(() => 0);
  /** @type {Record<string, {x0:number,x1:number,y0:number,y1:number}[]>} page-space rects */
  let content = {};
  /** @type {Record<string, {x0:number,x1:number,y0:number,y1:number}[]>} translucent cards */
  let soft = {};
  /** @type {Record<string, {x0:number,x1:number,y0:number,y1:number}[]>} text inside a card.
   *  Hard for the flow links (a link must never cross copy) and counted as
   *  "behind" for the props' dim, but not part of the prop's own clearance
   *  box: the CARD rect above already blocks the whole tile. */
  let cardText = {};
  /** @type {{centerX:number, pageTop:number, h:number}[]} Features cards, page space */
  let focalCards = [];
  let measured = false;
  /** px reserved at the top of the viewport for the sticky header. */
  let headerPx = 0;
  /** The header only reserves that band while it is opaque (`nav-solid`). */
  let headerSolid = false;
  /** @type {Record<string, {y0:number,y1:number}>} each section's page-space span */
  let sectionSpan = {};

  /* ---------------------------------------------------------------------
   * Measuring
   * ------------------------------------------------------------------ */

  function measureAnchors() {
    const vh = window.innerHeight;
    anchors = SECTION_IDS.map((id) => {
      const el = document.getElementById(id);
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return Math.max(0, r.top + window.scrollY + r.height / 2 - vh / 2);
    });
    // Monotonic, so a degenerate layout can never divide by zero.
    for (let i = 1; i < anchors.length; i++) {
      anchors[i] = Math.max(anchors[i], anchors[i - 1] + 1);
    }
  }

  /**
   * Snapshots the text/content rectangles of every section in PAGE coordinates
   * (so they stay valid across scrolling). Called on resize and once webfonts
   * have settled, never per frame.
   */
  function measureContent() {
    const scrollY = window.scrollY;
    /* Every obstacle is grown on all four sides before the solver ever sees
       it, so "clear of the copy" means clear with room to breathe. */
    const pad = TUNING.gutters.rectPadPx;
    content = {};
    soft = {};
    cardText = {};
    sectionSpan = {};

    const collect = (section, selector, into, skipInCard) => {
      const rects = [];
      for (const el of section.querySelectorAll(selector)) {
        if (el.closest('[aria-hidden="true"]')) continue;
        /* Text inside a translucent card is measured separately: hard for the
           links, and it flags a prop as "behind" for the dim. */
        if (skipInCard && el.closest(SOFT_SELECTOR)) continue;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        /* opacity:0 is deliberately NOT skipped — `script.js` reveals copy from
           opacity 0, and those blocks still occupy space a prop must avoid.
           Only genuinely unrendered elements are dropped. */
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        rects.push({
          x0: r.left - pad,
          x1: r.right + pad,
          y0: r.top + scrollY - pad,
          y1: r.bottom + scrollY + pad,
        });
      }
      into[section.id] = rects;
    };

    for (const id of SECTION_IDS) {
      const section = document.getElementById(id);
      if (!section) continue;
      const sr = section.getBoundingClientRect();
      sectionSpan[id] = { y0: sr.top + scrollY, y1: sr.bottom + scrollY };
      collect(section, CONTENT_SELECTOR, content, true);
      collect(section, CONTENT_SELECTOR, cardText, false);
      collect(section, SOFT_SELECTOR, soft);
      /* A card blocks its own rect for the props, exactly like a paragraph
         does. (It was soft before, which is what let the Overview props grow
         behind the tool cards.) */
      const cards = soft[id] || [];
      if (cards.length) {
        content[id] = (content[id] || []).concat(cards);
      }
    }

    /* The reserved top band. Measured here, not per frame: the navbar height
       only changes on resize, and its `nav-solid` state is watched by
       js/scene3d.js (a MutationObserver) and mirrored through setHeaderSolid. */
    const nav = document.getElementById('navbar');
    const navH = nav ? nav.getBoundingClientRect().height : 0;
    headerPx = Math.max(TUNING.gutters.headerReservePx, navH + TUNING.gutters.headerPadPx);
    if (nav) headerSolid = nav.classList.contains('nav-solid');

    measured = true;
  }

  /**
   * The Features cards, in DOM order. Their live screen position is derived
   * arithmetically from these page-space values, so following a card during
   * scroll costs no layout read.
   */
  function measureFocalCards() {
    const section = document.getElementById('features');
    focalCards = [];
    if (!section) return;
    const scrollY = window.scrollY;
    const cards = section.querySelectorAll('.spot-card');
    for (let i = 0; i < FOCAL_CARDS.length; i++) {
      const el = cards[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      focalCards.push({
        centerX: r.left + r.width / 2,
        pageTop: r.top + scrollY,
        h: r.height,
        w: r.width,
      });
    }
  }

  function remeasure() {
    measureAnchors();
    measureContent();
    measureFocalCards();
  }

  /* ---------------------------------------------------------------------
   * Progress
   * ------------------------------------------------------------------ */

  /** scrollY -> 0..1 across the stop list. */
  function computeProgress(scrollY) {
    const n = anchors.length;
    if (n < 2 || scrollY <= anchors[0]) return 0;
    if (scrollY >= anchors[n - 1]) return 1;
    for (let i = 0; i < n - 1; i++) {
      if (scrollY >= anchors[i] && scrollY <= anchors[i + 1]) {
        const span = Math.max(1, anchors[i + 1] - anchors[i]);
        return (i + (scrollY - anchors[i]) / span) / (n - 1);
      }
    }
    return 1;
  }

  /** Live NDC y of a Features card's vertical centre at the current scrollY. */
  function focalY(index, scrollY) {
    const card = focalCards[index];
    if (!card) return null;
    const vh = window.innerHeight;
    const centrePx = card.pageTop - scrollY + card.h / 2;
    return clamp(1 - (centrePx / vh) * 2, -0.94, 0.94);
  }

  /* ---------------------------------------------------------------------
   * Stop blending
   * ------------------------------------------------------------------ */

  function makeOut() {
    const anchorOut = {};
    for (const key of OBJ_KEYS) {
      anchorOut[key] = { side: 'right', x: 0, y: 0, z: 0, scale: 1, dim: 1 };
    }
    return {
      cam: new THREE.Vector3(),
      look: new THREE.Vector3(),
      fov: TUNING.fov,
      yaw: 0,
      exposure: 1,
      focal: 0,
      lineup: 0,
      converge: 0,
      flow: 0,
      sectionId: STOPS[0].id,
      /* The two stops being blended. Placement must clear BOTH. */
      fromId: STOPS[0].id,
      toId: STOPS[0].id,
      anchors: anchorOut,
    };
  }

  const out = makeOut();

  function sample(progress, scrollY) {
    const n = STOPS.length;
    const f = clamp(progress, 0, 1) * (n - 1);
    const i = Math.min(Math.floor(f), n - 2);
    const t = smoothstep(clamp(f - i, 0, 1));
    const A = STOPS[i], B = STOPS[i + 1];

    out.index = i;
    out.sectionId = t < 0.5 ? A.id : B.id;
    out.fromId = A.id;
    out.toId = B.id;
    out.cam.set(lerp(A.cam[0], B.cam[0], t), lerp(A.cam[1], B.cam[1], t), lerp(A.cam[2], B.cam[2], t));
    out.look.set(lerp(A.look[0], B.look[0], t), lerp(A.look[1], B.look[1], t), lerp(A.look[2], B.look[2], t));
    out.fov = lerp(A.fov, B.fov, t);
    out.yaw = lerp(A.yaw, B.yaw, t);
    out.exposure = lerp(exposureFor(A.id), exposureFor(B.id), t);

    out.focal = lerp(A.focal || 0, B.focal || 0, t);
    out.lineup = lerp(A.lineup || 0, B.lineup || 0, t);
    out.converge = lerp(A.converge || 0, B.converge || 0, t);
    out.flow = lerp(A.flow || 0, B.flow || 0, t);

    for (const key of OBJ_KEYS) {
      const a = A.anchors[key], b = B.anchors[key];
      const o = out.anchors[key];
      o.side = t < 0.5 ? a.side : b.side;
      o.x = lerp(a.x, b.x, t);
      o.y = lerp(a.y, b.y, t);
      o.z = lerp(a.z, b.z, t);
      o.scale = lerp(a.scale, b.scale, t);
      o.dim = lerp(a.dim, b.dim, t);

      const idx = OBJ_KEYS.indexOf(key);

      /* --- Flow: the rising diagonal --- */
      if (out.lineup > 0) {
        const L = LINEUP[key];
        o.x = lerp(o.x, L.x, out.lineup);
        o.y = lerp(o.y, L.y, out.lineup);
        o.side = o.x >= 0 ? 'right' : 'left';
      }

      /* --- Clarity: the calm, level, symmetric row --- */
      if (out.converge > 0) {
        const C = CONVERGE[key];
        o.x = lerp(o.x, C.x, out.converge);
        o.y = lerp(o.y, C.y, out.converge);
        o.side = o.x >= 0 ? 'right' : 'left';
      }

      /* --- Features: pair each prop with the card that describes it ---
       * Only Y is taken from the card. X still goes through the clearance
       * solver, so the prop lines up beside its card rather than hiding
       * behind the card's own text. */
      if (out.focal > 0) {
        const cy = focalY(idx, scrollY);
        if (cy !== null) o.y = lerp(o.y, cy, out.focal);
        o.z = lerp(o.z, o.z + 1.2, out.focal);
        o.dim = lerp(o.dim, o.dim * 1.15, out.focal);
      }
    }
    return out;
  }

  /**
   * Merges the x-intervals of every measured rect whose y-range overlaps the
   * query band, returning a sorted, merged list of occupied [x0, x1] pairs
   * in pixels.
   *
   * `ids` may be a single id or a LIST. It is always a list while the page is
   * between two sections: the stop blend switches `sectionId` at t = 0.5, so
   * reading only that one left every prop free to settle on the copy of the
   * section it was still travelling away from.
   */
  function occupiedIn(bank, ids, y0, y1) {
    const list = Array.isArray(ids) ? ids : [ids];
    let spans = null;
    for (const id of list) {
      const rects = bank[id];
      if (!rects || !rects.length) continue;
      for (const r of rects) {
        if (r.y1 < y0 || r.y0 > y1) continue;
        if (!spans) spans = [];
        spans.push([r.x0, r.x1]);
      }
    }
    if (!spans || !spans.length) return null;
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [spans[0].slice()];
    for (let i = 1; i < spans.length; i++) {
      const last = merged[merged.length - 1];
      if (spans[i][0] <= last[1]) last[1] = Math.max(last[1], spans[i][1]);
      else merged.push(spans[i].slice());
    }
    return merged;
  }

  /**
   * True when a screen-space box (px, page space on Y) touches ANY measured
   * rect of the given section(s). Rects are already grown by rectPadPx at
   * measure time, so this is "clear by at least 24px on every side".
   *
   * This is the test the old solver never ran: the band query is horizontal,
   * so a prop whose solved half-height was taller than the query band simply
   * spilled over whatever copy sat above and below it.
   */
  function boxHits(bank, ids, x0, x1, y0, y1) {
    const list = Array.isArray(ids) ? ids : [ids];
    for (const id of list) {
      const rects = bank[id];
      if (!rects || !rects.length) continue;
      for (const r of rects) {
        if (r.x1 <= x0 || r.x0 >= x1 || r.y1 <= y0 || r.y0 >= y1) continue;
        return true;
      }
    }
    return false;
  }

  /* Candidate heights for the vertical band search: 0 = the anchor, then
     +/- one step, +/- two steps, and so on. */
  const SEARCH_Y = [0, 1, 2, 3, 4, 5, 6];
  const SEARCH_MIN = 1;   /* accept the anchor's own band if it already fits */

  const _camSpace = new THREE.Vector3();
  const _world = new THREE.Vector3();

  /* NDC working slots, one per prop. */
  const slots = {};
  for (const key of OBJ_KEYS) {
    slots[key] = { key, cx: 0, cy: 0, hx: 0, hy: 0, dist: 0, scale: 1, safe: false, behind: false, fade: 1 };
  }
  /* The slot OBJECTS, not their keys — separate() mutates them directly. */
  const visible = OBJ_KEYS.map((k) => slots[k]).filter(Boolean);
  const placement = {};
  for (const key of OBJ_KEYS) {
    placement[key] = { x: 0, y: 0, z: 0, scale: 1, safe: false, behind: false, fade: 1, hxNdc: 0, hyNdc: 0 };
  }

  /**
   * The NDC x-span of the hard text column at a given page band, as
   * [left, right]. Used by the flow links so they can fade out exactly where
   * they would cross copy. Returns null when the band is completely free.
   */
  function textColumnAt(sectionId, y0, y1, out) {
    const hard = occupiedIn(content, sectionId, y0, y1);
    const inCard = occupiedIn(cardText, sectionId, y0, y1);
    const spans = hard && inCard ? hard.concat(inCard) : (hard || inCard);
    if (!spans) { out[0] = -1; out[1] = 1; return false; }
    const vw = window.innerWidth;
    out[0] = clamp((spans[0][0] / vw) * 2 - 1, -1, 1);
    out[1] = clamp((spans[spans.length - 1][1] / vw) * 2 - 1, -1, 1);
    return out[1] - out[0] > 0.02;
  }

  /** NDC x-span of the translucent cards at a given page band. */
  function softAt(ids, y0, y1) {
    return occupiedIn(soft, ids, y0, y1);
  }

  /**
   * The reserved-band fade. 1 once a prop is `headerFadePx` clear of the sticky
   * header, ramping smoothly to 0 at the band's edge, so a prop approaching the
   * opaque strip dissolves instead of being sliced by it. Returns 1 while the
   * header is still transparent, which leaves the hero untouched.
   *
   * Recomputed after separate() because that pass moves props.
   */
  function bandFade(o, vh) {
    if (!headerSolid || headerPx <= 0) return 1;
    const topPx = (1 - (o.cy - o.hy)) * 0.5 * vh;
    return clamp((topPx - headerPx) / TUNING.gutters.headerFadePx, 0, 1);
  }

  /**
   * Places every prop for the current scroll state.
   *
   * Runs in three passes so the result is always coherent:
   *   1. solve    — each prop finds its free band and the scale that fills it
   *   2. separate — relax the props apart so no two boxes intersect
   *   3. commit   — unproject the NDC centres to world positions
   *
   * @param {object} s          the sampled stop (see sample())
   * @param {number} scrollY
   * @param {object} camera
   * @param {Record<string,{halfW:number,halfH:number}>} bounds
   */
  /**
   * Every section whose page span can put copy on screen at this scrollY, with a
   * viewport of slack so a prop that hangs off the top or bottom is still judged
   * against what is just off screen.
   *
   * The blended pair alone was not enough: the stop blend switches `sectionId`
   * at t = 0.5, and at a section boundary a THIRD section's heading can already
   * be on screen. Placement is judged against all of them, so "never covers the
   * copy" holds at every scroll position, not only inside the active section.
   */
  function sectionsOnScreen(scrollY, vh) {
    const ids = [];
    const top = scrollY - vh * 0.2;
    const bottom = scrollY + vh * 1.2;
    for (const id of SECTION_IDS) {
      const span = sectionSpan[id];
      if (!span) continue;
      if (span.y1 < top || span.y0 > bottom) continue;
      ids.push(id);
    }
    return ids;
  }

  function layout(s, scrollY, camera, bounds) {
    const G = TUNING.gutters;
    const P = TUNING.props;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const padX = (G.edgePadPx * 2) / vw;
    const padY = (G.edgePadPx * 2) / vh;
    const minPxNdc = (G.minOnScreenPx * 2) / vw;
    /* Every section that can put copy on screen right now, plus the two being
       blended (they may be off screen but still own the props' anchors). */
    const ids = measured ? sectionsOnScreen(scrollY, vh) : [];
    if (ids.indexOf(s.fromId || s.sectionId) < 0) ids.push(s.fromId || s.sectionId);
    if (ids.indexOf(s.toId || s.sectionId) < 0) ids.push(s.toId || s.sectionId);
    /* The sticky header is a reserved band only while it paints an opaque
       strip; the hero's transparent header must not push the props around. */
    const bandPx = headerSolid ? headerPx : 0;
    const bandNdcY = -1 + (2 * bandPx) / vh;

    /** Keeps a prop's WHOLE box inside the viewport and below the header band. */
    const clampBox = (o) => {
      const limY = Math.max(padY, 1 - o.hy - padY);
      o.cy = clamp(o.cy, -limY, limY);
      if (bandPx > 0) {
        const top = bandNdcY + o.hy + padY;
        if (o.cy > top) o.cy = top;
      }
      const minCx = -1 + padX + o.hx;
      const maxCx = 1 - padX - o.hx;
      o.cx = minCx <= maxCx ? clamp(o.cx, minCx, maxCx) : 0;
    };

    /** True when the box clears every measured rect of `ids`, with padding. */
    const boxIsClear = (o, padPx) => {
      const x0 = ((o.cx - o.hx) * 0.5 + 0.5) * vw;
      const x1 = ((o.cx + o.hx) * 0.5 + 0.5) * vw;
      const halfPx = o.hy * 0.5 * vh + padPx;
      const yPage = (1 - o.cy) * 0.5 * vh + scrollY;
      return !boxHits(content, ids, x0, x1, yPage - halfPx, yPage + halfPx);
    };

    /**
     * Places `o` where it is guaranteed clear of the copy, or hides it.
     *
     * How much shrinking a given height would need, 1 = already clear,
     * Infinity = no size clears there. Leaves `o` untouched when it fails.
     */
    const shrinkNeeded = (o, cy, h0, y0) => {
      const s0 = o.scale, c0 = o.cy, hx0 = o.hx, hy0 = o.hy;
      let f = 1;
      for (let i = 0; i <= G.shrinkPasses; i++) {
        o.cy = cy; o.hx = h0 * f; o.hy = y0 * f;
        clampBox(o);
        if (boxIsClear(o, G.verticalClearPadPx)) { o.scale = s0 * f; return f; }
        f *= G.shrinkStep;
      }
      o.cy = c0; o.cx = o.cx; o.hx = hx0; o.hy = hy0; o.scale = s0;
      return Infinity;
    };

    /**
     * The full-box clearance pass.
     *
     * Instead of sampling heights, it computes the FREE VERTICAL BANDS for the
     * prop's current x-range — a single pass over the rects that cross that
     * range — and drops the prop into the one nearest its solved height, sized
     * to fit it exactly. A full-width row of cards leaves no free COLUMN at all
     * and can only be escaped vertically, which the horizontal band search can
     * never find; this does. Sizing is continuous in the free space, so a prop
     * eases smaller as the copy closes in instead of blinking out.
     */
    const solveClear = (o) => {
      const padPx = G.verticalClearPadPx;
      const x0 = ((o.cx - o.hx) * 0.5 + 0.5) * vw - padPx;
      const x1 = ((o.cx + o.hx) * 0.5 + 0.5) * vw + padPx;

      /* The vertical extents every rect that crosses this prop's x-range
         occupies, merged into the gaps between them. */
      const blockers = [];
      for (const id of ids) {
        for (const r of content[id] || []) {
          if (r.x1 <= x0 || r.x0 >= x1) continue;
          blockers.push([r.y0, r.y1]);
        }
      }
      const top = scrollY - padPx;
      const bot = scrollY + vh + padPx;
      const free = [];
      if (!blockers.length) {
        free.push([top, bot]);
      } else {
        blockers.sort((a, b) => a[0] - b[0]);
        let cursor = top;
        for (const [a, b] of blockers) {
          if (a > cursor) free.push([cursor, Math.min(a, bot)]);
          if (b > cursor) cursor = b;
          if (cursor >= bot) break;
        }
        if (cursor < bot) free.push([cursor, bot]);
      }

      /* The band that keeps the prop closest to where the solve put it, and
         the biggest box that fits inside it with its padding. */
      const cy0 = o.cy;
      const y0px = (1 - cy0) * 0.5 * vh + scrollY;
      let best = null;
      for (const [a, b] of free) {
        const lo = Math.max(a, top);
        const hi = Math.min(b, bot);
        const height = hi - lo - padPx * 2;
        if (height <= 4) continue;                 /* no room for a real box */
        const centre = (lo + hi) * 0.5;
        const cost = Math.abs(centre - y0px);
        if (!best || cost < best.cost) best = { centre, height, cost };
      }
      if (!best) return solveLadder(o);
      /* Size to the band, uniformly, so the prop keeps its shape. */
      const fitPx = best.height;
      const f = Math.min(1, (fitPx * 0.5) / Math.max(o.hy * 0.5 * vh, 0.001));
      o.scale *= f;
      o.hx *= f;
      o.hy = o.hy * f;
      o.cy = 1 - ((best.centre - scrollY) / vh) * 2;
      clampBox(o);
      /* clampBox can pull the box out of its band (viewport edge, header
         reserve), so the placement is verified before it is believed. */
      if (boxIsClear(o, padPx)) return;
      return solveLadder(o);
    };

    /**
     * Last resort: walk the band search's own height ladder, shrinking.
     *
     * If even that leaves the box over the copy, the prop goes to SAFE mode —
     * pushed back, shrunk and dimmed — which is the documented fallback. It is
     * never hidden: an empty canvas would read as a bug, and a small dim prop
     * behind the copy is the design's own answer for a page with no gutter.
     */
    const solveLadder = (o) => {
      const cy0 = o.cy, h0 = o.hx, y0 = o.hy, s0 = o.scale;
      let bestF = shrinkNeeded(o, cy0, h0, y0);
      let bestCy = cy0;
      for (const dir of [1, -1]) {
        for (let step = 1; step <= G.clearSearchSteps; step++) {
          const cy = clamp(cy0 + dir * step * G.searchStepVh, -1 + padY, 1 - padY);
          const f = shrinkNeeded(o, cy, h0, y0);
          if (f < bestF) { bestF = f; bestCy = cy; }
          if (bestF === 1) break;
        }
        if (bestF === 1) break;
      }
      if (bestF !== Infinity) {
        o.cy = bestCy; o.hx = h0 * bestF; o.hy = y0 * bestF; o.scale = s0 * bestF;
        clampBox(o);
        if (boxIsClear(o, G.verticalClearPadPx)) return;
      }
      /* Still no clear box: shrink as far as the passes allow and dim. */
      o.cy = cy0;
      o.scale = s0 * Math.pow(G.shrinkStep, G.shrinkPasses);
      o.hx = h0 * Math.pow(G.shrinkStep, G.shrinkPasses);
      o.hy = y0 * Math.pow(G.shrinkStep, G.shrinkPasses);
      o.safe = true;
      clampBox(o);
    };

    /* ---- the absolute size cap ----------------------------------------
     * NDC runs -1..1 across the WIDTH, so a box with half-width `h` covers
     * exactly `h` of the viewport width. Capping it at
     * `props.maxScreenFraction` therefore means "never wider than 32% of the
     * screen". The same box on the Y axis is capped by the same PHYSICAL
     * size, hence the vw/vh: the prop always fits inside a
     * maxScreenFraction x vw square, whatever the aspect ratio. */
    const screenHalf = Math.max(0.04, P.maxScreenFraction);

    for (const key of OBJ_KEYS) {
      const o = slots[key];
      const anchor = s.anchors[key];
      const b = bounds[key];

      /* --- 1. find the widest free band near this prop's own height ---
       * A prop only needs a free band at ITS height, not at the anchor's.
       * In Features and Flow the copy spans nearly the full column width, so
       * the authored anchor often lands on a text row and the band collapses
       * to nothing. Instead of falling straight into safe mode, walk a few
       * candidate heights and take the one with the most free space — which in
       * practice is the gap between text rows, or the row where the copy is
       * narrowest. */
      const bandHalf = vh * G.bandVh * 0.5;
      const outerR = 1 - padX;
      const outerL = -1 + padX;
      const wantRight = anchor.side === 'right';

      let best = null;
      /* The authored side is tried first at every height, so a prop keeps its
         side whenever that side works. The opposite side is only a fallback:
         a left-aligned copy block leaves a ~100px gutter on one side and a
         ~550px one on the other, and a prop squeezed into the sliver is worse
         than one that quietly crosses to the roomy side. */
      for (const tryRight of wantRight ? [true, false] : [false, true]) {
        for (let i = 0; i < SEARCH_Y.length; i++) {
          /* 0 = the anchor itself, then progressively further away. */
          const dy = (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * G.searchStepVh;
          const cyTry = clamp(anchor.y + dy, -1 + padY, 1 - padY);
          const yPage = (1 - cyTry) * 0.5 * vh + scrollY;
          const spans = measured
            ? occupiedIn(content, ids, yPage - bandHalf, yPage + bandHalf)
            : null;
          /* `inner*` is the text edge; the band runs from there out to the
             padded viewport edge. With NO text in the band the constraint is
             the midline, so the prop gets a whole half-viewport — defaulting
             to the viewport edge here made every band 0 wide, which is what
             pushed every prop into safe mode and shrank them to nothing. */
          let innerR;
          let innerL;
          if (spans) {
            innerR = Math.min(outerR, clamp((spans[spans.length - 1][1] + G.marginPx) / vw * 2 - 1, -1, 1));
            innerL = Math.max(outerL, clamp((spans[0][0] - G.marginPx) / vw * 2 - 1, -1, 1));
          } else {
            innerR = 0;
            innerL = 0;
          }
          const bandW = tryRight ? (outerR - innerR) : (innerL - outerL);
          const cand = { cy: cyTry, yPage, right: tryRight, innerR, innerL, bandW };
          if (!best || bandW > best.bandW) best = cand;
          /* Good enough — stop early and keep the prop near its authored spot. */
          if (bandW * 0.5 * vw >= G.minFreePx && i >= SEARCH_MIN) break;
        }
        /* The authored side worked; never consider flipping. */
        if (best.bandW * 0.5 * vw >= G.minFreePx) break;
      }

      const { cy, yPage, right, innerR, innerL, bandW } = best;
      const useRight = right;
      o.wantRight = useRight;
      const safe = bandW * 0.5 * vw < G.minFreePx;

      /* --- 2. centre + size --- */
      const centre = useRight ? (innerR + outerR) * 0.5 : (outerL + innerL) * 0.5;
      const nudged = useRight
        ? clamp(Math.abs(anchor.x), innerR, outerR)
        : clamp(Math.abs(anchor.x), outerL, innerL);
      o.cx = lerp(centre, nudged, 0.30);
      o.cy = cy;
      o.safe = safe;

      const dist = camera.position.z + G.baseDistance + anchor.z + (safe ? G.safeDepth : 0);
      o.dist = dist;
      const halfViewH = Math.tan((camera.fov * Math.PI) / 360) * dist;
      const halfViewW = halfViewH * camera.aspect;
      const halfWNdc = Math.max(b.halfW, 0.001) / halfViewW;
      const halfHNdc = Math.max(b.halfH, 0.001) / halfViewH;

      /* Half-width target in NDC.
         `maxHalf`     the free band itself — a prop never reaches the text
         `screenHalf`  the absolute cap — 32% of the viewport width
         `capHalf`     the TARGET inside both: `fill` of the free band
         `floorHalf`   never smaller than `minFill` of the band (and never
                       smaller than `minOnScreenPx` on screen) — but clipped
                       by the hard caps above, so the floor can never be the
                       thing that grows a prop over the copy.
         Everything is a MINIMUM except the two hard caps. */
      const maxHalf = Math.max(0.02, bandW * 0.5);
      const hardHalf = Math.min(maxHalf, screenHalf);
      const capHalf = bandW * 0.5 * G.fill;
      const floorHalf = Math.min(hardHalf, Math.max(bandW * G.minFill * 0.5, minPxNdc * 0.5));
      const wantHalf = Math.min(Math.max(capHalf, floorHalf), hardHalf);

      /* Same idea vertically, so a prop is never a sliver and never a wall. */
      const availY = 2 - 2 * padY;
      const maxHalfY = Math.max(0.02, availY * 0.5);
      const hardHalfY = Math.min(maxHalfY, screenHalf * (vw / vh));
      const capHalfY = availY * 0.5 * G.fill;
      const floorHalfY = Math.min(
        hardHalfY,
        Math.max(availY * G.minFill * 0.5, (G.minOnScreenPx * 2 / vh) * 0.5)
      );
      const wantHalfY = Math.min(Math.max(capHalfY, floorHalfY), hardHalfY);

      const cap = P[key] || {};
      let fit = Math.min(
        bounds[key].fitMax ?? Infinity,
        cap.maxWorldScale ?? Infinity,
        wantHalf / halfWNdc,
        wantHalfY / halfHNdc
      );
      /* No band, or a band too small to be worth using: push it back, shrink
         it and dim it. The caps above still apply, so a "safe" prop is never
         the giant one. */
      if (safe) fit = Math.min(fit, G.safeScale * 2.4);

      o.scale = fit;
      o.hx = halfWNdc * fit;
      o.hy = halfHNdc * fit;
      clampBox(o);

      /* --- 3. full-box clearance ------------------------------------------
       * The band solve above is HORIZONTAL only: it finds a free gap at the
       * prop's height, but never checks how TALL the solved prop is against
       * the copy above and below that gap. A prop can therefore be perfectly
       * centred in a free band and still spill straight over the text — which
       * is what put the network constellation across "You're done" and the HD
       * frame over the Flow headline.
       *
       * This pass walks the WHOLE box, with `verticalClearPadPx` of air on
       * every side, against every rect of the section the prop is in AND the
       * one it is travelling to. Overlap is never an option: the prop shrinks
       * until it is clear, moves to another height if shrinking is not
       * enough, and only dims when neither works. The size caps above are
       * untouched — this only ever makes a prop smaller. */
      if (measured) solveClear(o);

      /* --- 4. the reserved header band ------------------------------------
       * `#navbar` is fixed and paints an opaque strip over the canvas once it
       * is solid, so a prop reaching into it was cut by a hard straight
       * edge. The band is reserved — clampBox pushed the box below it — and a
       * prop near the band fades out over `headerFadePx` instead of ending in
       * a cut. Fully clear of the band means fully opaque. */
      o.fade = bandFade(o, vh);

      const yPageNow = (1 - o.cy) * 0.5 * vh + scrollY;
      /* Inside a card's own copy? The card rect is a hard obstacle already
         (see measureContent), so this is only the DIM: a prop that has to
         sit close to a card reads as behind it rather than in front of it. */
      o.behind = !!softAt(ids, yPageNow - bandHalf, yPageNow + bandHalf)
        || !!occupiedIn(cardText, ids, yPageNow - bandHalf, yPageNow + bandHalf);
    }

    /* --- 2. separation: no two props may overlap --- */
    /* `hitsCopy` is what makes this safe to run AFTER the clearance solve: a
       push-off that would drop a prop back onto the copy is refused, so
       separation can only ever make props sit closer together, never cover
       text. */
    separate((o) => (measured ? !boxIsClear(o, G.verticalClearPadPx) : false));

    /* Anything separation had to move is re-solved, so the boxes this function
       REPORTS are the boxes that were verified clear. A prop may end up a
       little closer to its neighbour than minSeparation in a crowded spot;
       covering the copy is never an option. */
    if (measured) {
      for (const key of OBJ_KEYS) {
        const o = slots[key];
        if (boxIsClear(o, G.verticalClearPadPx)) continue;
        solveClear(o);
      }
    }

    /* --- 3. unproject to world --- */
    for (const key of OBJ_KEYS) {
      const o = slots[key];
      const halfViewH = Math.tan((camera.fov * Math.PI) / 360) * o.dist;
      const halfViewW = halfViewH * camera.aspect;
      _camSpace.set(o.cx * halfViewW, o.cy * halfViewH, -o.dist).applyQuaternion(camera.quaternion);
      _world.copy(camera.position).add(_camSpace);
      const p = placement[key];
      p.x = _world.x;
      p.y = _world.y;
      p.z = _world.z;
      p.scale = o.scale;
      p.safe = o.safe;
      p.behind = o.behind;
      p.fade = bandFade(o, window.innerHeight);
      p.hxNdc = o.hx;
      p.hyNdc = o.hy;
    }
    return placement;
  }

  /**
   * Relaxation pass: push overlapping props apart along the shallower axis of
   * penetration, then clamp them back inside the viewport. Three iterations is
   * plenty for three boxes and keeps the cost off the frame budget.
   *
   * `hitsCopy(o)` reports that this prop's CURRENT box is over the copy. Any
   * push-off that would make that true is rolled back, so this pass can never
   * undo the clearance solve.
   */
  function separate(hitsCopy) {
    const G = TUNING.gutters;
    const vh = window.innerHeight;
    const padY = (G.edgePadPx * 2) / vh;
    const check = hitsCopy || (() => false);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
          const a = visible[i], b = visible[j];
          if (a.safe || b.safe) continue;
          const dx = b.cx - a.cx;
          const dy = b.cy - a.cy;
          const needX = a.hx + b.hx + G.minSeparation;
          const needY = a.hy + b.hy + G.minSeparation;
          const ox = needX - Math.abs(dx);
          const oy = needY - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          const ax = a.cx, ay = a.cy, bx = b.cx, by = b.cy;
          if (ox < oy) {
            const s = (dx >= 0 ? 1 : -1) * ox * 0.5;
            a.cx -= s; b.cx += s;
          } else {
            const s = (dy >= 0 ? 1 : -1) * oy * 0.5;
            a.cy -= s; b.cy += s;
          }
          if (check(a) || check(b)) { a.cx = ax; a.cy = ay; b.cx = bx; b.cy = by; }
        }
      }
    }
    /* Never let the push-off shove a prop off an edge: clamp by each
       prop's own box, not just its centre, on both axes. */
    const padX = (G.edgePadPx * 2) / window.innerWidth;
    const outerR = 1 - padX;
    const outerL = -1 + padX;
    /* The reserved header band applies here too, or a prop pushed upward to
       resolve a collision would land right in the opaque strip. */
    const bandPx = headerSolid ? headerPx : 0;
    const bandNdcY = -1 + (2 * bandPx) / vh;
    for (const o of visible) {
      const limY = Math.max(padY, 1 - o.hy - padY);
      o.cy = clamp(o.cy, -limY, limY);
      if (bandPx > 0) {
        const top = bandNdcY + o.hy + padY;
        if (o.cy > top) o.cy = top;
      }
      const minCx = outerL + o.hx;
      const maxCx = outerR - o.hx;
      o.cx = minCx <= maxCx ? clamp(o.cx, minCx, maxCx) : (outerL + outerR) * 0.5;
    }
  }

  return {
    out,
    sample,
    computeProgress,
    layout,
    textColumnAt,
    softAt,
    remeasure,
    measureAnchors,
    measureContent,
    measureFocalCards,
    focalY,
    /**
     * The sticky header only reserves the top band while it paints an opaque
     * strip (`#navbar.nav-solid`). js/scene3d.js watches that class so this is
     * a flag update, never a per-frame class read or layout.
     */
    setHeaderSolid(solid) { headerSolid = !!solid; },
    get anchors() { return anchors; },
    get measured() { return measured; },
    get focalCards() { return focalCards; },
    get headerPx() { return headerPx; },
  };
}
