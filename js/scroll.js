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
 *  3. Keep props out of the text — AND KEEP THEM VISIBLE.
 *
 *     Placement is screen-space, and it is a SEARCH, not a shrink:
 *
 *       a. Obstacles are the REAL extents of what the visitor reads — the line
 *          boxes of headings and paragraphs (Range.getClientRects), the boxes
 *          of cards, pill buttons, icons and media, and the sticky header as a
 *          reserved top band. Never a full-width section container, which
 *          measures as a wall from margin to margin and leaves no gutter at
 *          all. Every rect is grown by `gutters.rectPadPx` at measure time.
 *
 *       b. For each prop the solver builds a candidate list: the preferred side
 *          first, then the opposite one, and at each x the CENTRES of the free
 *          vertical bands in that column — which is what finds the empty gap
 *          between two sections when a full-width card row leaves no gutter.
 *
 *       c. Each candidate is tested from the largest size down to a floor
 *          (`props.minScreenFraction` of the viewport width, or the absolute
 *          `props.minScreenPx` on the desktop tier). The best-scoring candidate
 *          wins; the score prefers the authored side/position and a big size.
 *
 *       d. If NOTHING is free, the prop DOCKS against the left or right
 *          viewport edge with up to `props.edgeCropMax` of its width cropped
 *          by the screen (side edges only, never top/bottom, never over copy).
 *
 *     There is no "safe mode" any more: no push-back, no 0.55 scale, no 0.45
 *     dim. That ladder is exactly what used to make the props disappear in
 *     Features, Flow and Clarity. js/scene3d.js damps the solved position and
 *     scale, so a prop glides between candidates instead of popping.
 *
 * The clearance solve runs per frame but only walks a small pre-measured list
 * of rectangles; DOM reads happen on resize / font-load only.
 * ==========================================================================*/

import * as THREE from 'three';
import {
  TUNING, STOPS, SECTION_IDS, OBJ_KEYS,
  LINEUP, CONVERGE, FOCAL_CARDS, exposureFor,
} from './config.js';

/* Text blocks: measured by their REAL text extent, one rect per line. A
 * centred two-line headline inside a `max-w-3xl` box must measure as two
 * narrow bands, not as one box as wide as the container. */
const TEXT_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'blockquote',
].join(',');

/* Boxes: measured by their own element rect. A pill button, an icon or a
 * media box is a visible object, not a line of text — the padding around the
 * label is part of what the visitor sees. */
const BOX_SELECTOR = ['img', 'svg', 'video', 'iframe', '.btn'].join(',');

/* Cards are HARD obstacles, exactly like text: the 3D layer sits behind the
 * page, so a prop read through a translucent panel passes for a rendering
 * bug rather than for depth. They also drive the "behind a card" dim. */
const CARD_SELECTOR = '.glass-panel, .spot-card';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);

/* ---- fixed-size scratch: the frame loop must not allocate ---- */
const MAX_BANDS = 24;
const MAX_YS = 6;
const MAX_XS = 16;
const MAX_RECTS = 512;
const LADDER = 6;
const CROP_STEPS = [0.12, 0.22, 0.35];

const _bands = [];
for (let i = 0; i < MAX_BANDS; i++) _bands.push([0, 0]);
/* Rect references gathered for one column query, then sorted by top edge.
   `_rectMerge` is the ping-pong partner sortRectsByTop() writes into; the
   `let` is because the pair swaps roles every pass. */
const _rectScratch = [];
for (let i = 0; i < MAX_RECTS; i++) _rectScratch.push(null);
let _rectMerge = [];
for (let i = 0; i < MAX_RECTS; i++) _rectMerge.push(null);
const _ys = new Float64Array(MAX_YS);
const _xs = new Float64Array(MAX_XS);
const _ladder = new Float64Array(LADDER);
const _placed = [];
for (const key of OBJ_KEYS) _placed.push({ key, cx: 0, cy: 0, hx: 0, hy: 0, used: false });
const _fit = { scale: 0, w: 0, h: 0 };
/* A second fit target. `fitInto()` writes into the object it is handed, and the
   search nests its own fits (a candidate's size while computing that column's
   free bands), so a single shared result would be clobbered mid-use. */
const _fitBand = { scale: 0, w: 0, h: 0 };

/** Sort key for the obstacle banks: top edge, ascending. */
const byTop = (a, b) => a.y0 - b.y0;

/**
 * Sorts `buf[0..len)` by top edge, ascending, using a preallocated ping-pong
 * buffer. The sorted result is left in `buf` for a non-palindromic length.
 *
 * freeBands() runs inside the per-frame prop search, so it cannot afford the
 * `Array.prototype.sort` copy or a `.slice()` per column. Both buffers hold
 * rect REFERENCES, so the sort only moves pointers, and neither grows.
 *
 * Bottom-up merge rather than insertion: the cursor walk in freeBands() is only
 * correct on fully sorted input, so a sort with a "good enough" fallback (an
 * insertion sort that gives up on a pathological layout) could under-report
 * free space and park a prop on top of copy. This is O(n log n) in every case.
 */
function sortRectsByTop(buf, len) {
  if (len < 2) return;
  if (len === 2) {
    if (buf[1].y0 < buf[0].y0) { const t = buf[0]; buf[0] = buf[1]; buf[1] = t; }
    return;
  }
  let src = buf;
  let dst = _rectMerge;
  for (let width = 1; width < len; width *= 2) {
    for (let i = 0; i < len; i += width * 2) {
      const mid = Math.min(i + width, len);
      const end = Math.min(i + width * 2, len);
      let a = i;
      let b = mid;
      let k = i;
      while (a < mid && b < end) {
        dst[k++] = src[b].y0 < src[a].y0 ? src[b++] : src[a++];
      }
      while (a < mid) dst[k++] = src[a++];
      while (b < end) dst[k++] = src[b++];
    }
    const swap = src; src = dst; dst = swap;
  }
  /* An even power-of-two length ends in the scratch buffer; copy it back.
     Bounded by MAX_RECTS once per column query, and only when it happens. */
  if (src !== buf) {
    for (let i = 0; i < len; i++) buf[i] = src[i];
  }
  _rectMerge = dst;
}

export function createScrollEngine() {
  /** @type {number[]} scrollY at which each section is vertically centred */
  let anchors = SECTION_IDS.map(() => 0);
  /** @type {Record<string, Rect[]>} page-space HARD obstacles: text extents,
   *  boxes and cards, all padded by rectPadPx */
  let content = {};
  /** @type {Record<string, Rect[]>} page-space card boxes (the dim source) */
  let soft = {};
  /** @type {Record<string, Rect[]>} page-space text INSIDE a card. Hard for the
   *  flow links only: a pulse tube must never be drawn over a card's copy. */
  let cardText = {};
  /** @type {{centerX:number, pageTop:number, h:number, w:number}[]} Features cards */
  let focalCards = [];
  let measured = false;
  /** px reserved at the top of the viewport for the sticky header. */
  let headerPx = 0;
  /** The header only reserves that band while it is opaque (`nav-solid`). */
  let headerSolid = false;
  /** @type {Record<string, {y0:number,y1:number}>} each section's page-space span */
  let sectionSpan = {};

  /** Last solve, for the ?scene3d=debug overlay. Never read by the frame path. */
  const debugData = {
    ids: [],
    obstacles: [],
    bandPx: 0,
    headerPx: 0,
    candidates: [],
    chosen: {},
    sectionId: STOPS[0].id,
  };

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

  /** An element that is not rendered, or is only decoration. */
  function isSkippable(el) {
    if (el.closest('[aria-hidden="true"]')) return true;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return true;
    /* opacity:0 is deliberately NOT skipped — script.js reveals copy from
       opacity 0, and those blocks still occupy space a prop must avoid. */
    return false;
  }

  /**
   * The client rects of an element's actual text — one per line box. This is
   * the difference between "the headline's text" and "the headline's
   * container", and the whole reason the side gutters exist at all.
   */
  function textExtents(el) {
    const out = [];
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const list = range.getClientRects();
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (r.width >= 2 && r.height >= 2) out.push(r);
      }
      if (range.detach) range.detach();
    } catch (err) { /* fall back to the element's own box */ }
    return out;
  }

  /**
   * Snapshots the obstacle rectangles of every section in PAGE coordinates (so
   * they stay valid across scrolling). Called on resize and once webfonts have
   * settled, never per frame.
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

    const push = (into, id, r) => {
      const rect = {
        x0: r.left !== undefined ? r.left - pad : r.x0 - pad,
        x1: r.right !== undefined ? r.right + pad : r.x1 + pad,
        y0: r.top !== undefined ? r.top + scrollY - pad : r.y0 - pad,
        y1: r.bottom !== undefined ? r.bottom + scrollY + pad : r.y1 + pad,
      };
      const list = into[id] || (into[id] = []);
      list.push(rect);
    };

    for (const id of SECTION_IDS) {
      const section = document.getElementById(id);
      if (!section) continue;
      const sr = section.getBoundingClientRect();
      sectionSpan[id] = { y0: sr.top + scrollY, y1: sr.bottom + scrollY };

      /* 1. real text extents, line by line */
      for (const el of section.querySelectorAll(TEXT_SELECTOR)) {
        if (isSkippable(el)) continue;
        const box = el.getBoundingClientRect();
        if (box.width < 4 || box.height < 4) continue;
        const lines = textExtents(el);
        const rects = lines.length ? lines : [box];
        const inCard = !!el.closest(CARD_SELECTOR);
        for (const r of rects) {
          push(content, id, r);
          /* Text inside a card is an extra hard obstacle for the flow links. */
          if (inCard) push(cardText, id, r);
        }
      }

      /* 2. visible boxes: pill buttons, icons, media */
      for (const el of section.querySelectorAll(BOX_SELECTOR)) {
        if (isSkippable(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        push(content, id, r);
        push(cardText, id, r);
      }

      /* 3. cards: a solid object, so the whole box blocks */
      for (const el of section.querySelectorAll(CARD_SELECTOR)) {
        if (isSkippable(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        push(soft, id, r);
        push(content, id, r);
      }
    }

    /* Every bank is sorted TOP TO BOTTOM. freeBands() walks a list with a
       single cursor, which is only correct on sorted input — and the DOM order
       of headings, icon boxes and cards is not the visual order. Sorting once
       here keeps the per-frame band scan allocation-free. */
    for (const bank of [content, soft, cardText]) {
      for (const id of SECTION_IDS) {
        const list = bank[id];
        if (list && list.length > 1) list.sort(byTop);
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
       * Only Y is taken from the card. X still goes through the solver, so the
       * prop lines up beside its card — or in the free band above/below the
       * grid when the row is full width — rather than hiding behind the copy. */
      if (out.focal > 0) {
        const cy = focalY(idx, scrollY);
        if (cy !== null) o.y = lerp(o.y, cy, out.focal);
        o.z = lerp(o.z, o.z + 0.9, out.focal);
        o.dim = lerp(o.dim, o.dim * 1.15, out.focal);
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------------
   * Geometry helpers over the pre-measured obstacle banks
   * ------------------------------------------------------------------ */

  /**
   * The merged x-intervals of every measured rect whose y-range overlaps the
   * query band, as a sorted list of [x0, x1] pairs in pixels. `ids` may be a
   * single id or a LIST.
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

  /** True when a page-space box touches ANY measured rect of the given ids. */
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

  /**
   * The free vertical bands (page space) for a page x-range, clipped to the
   * viewport. Fills the shared `_bands` scratch and returns the count — this is
   * what finds the empty gap between two sections when a full-width card row
   * leaves no free column at all.
   */
  function freeBands(x0, x1, yTop, yBot) {
    const flat = _bands;
    let count = 0;

    /* Gather every rect that crosses this x-range into one scratch list and
       sort it by top edge. The obstacles come from five sections measured
       independently, so concatenating them is NOT globally sorted even though
       each section's own list is, and the single-cursor walk below is only
       correct on sorted input. */
    let n = 0;
    for (const id of SECTION_IDS) {
      const rects = content[id];
      if (!rects || !rects.length) continue;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.x1 <= x0 || r.x0 >= x1) continue;
        if (r.y1 <= yTop || r.y0 >= yBot) continue;
        if (n >= MAX_RECTS) break;
        _rectScratch[n++] = r;
      }
    }
    sortRectsByTop(_rectScratch, n);

    /* One cursor walk: every gap between consecutive rects is a free band. */
    let cursor = yTop;
    for (let i = 0; i < n; i++) {
      const r = _rectScratch[i];
      if (r.y0 > cursor) {
        const a = cursor;
        const b = Math.min(r.y0, yBot);
        if (b > a && count < MAX_BANDS) { flat[count][0] = a; flat[count][1] = b; count++; }
      }
      if (r.y1 > cursor) {
        cursor = Math.min(r.y1, yBot);
        if (cursor >= yBot) break;
      }
    }
    if (cursor < yBot && count < MAX_BANDS) {
      flat[count][0] = cursor;
      flat[count][1] = yBot;
      count++;
    }
    return count;
  }

  /**
   * The NDC x-span of the hard column occupied by copy inside a page-space
   * band, as [x0, x1]. Returns false (and leaves `out` at ±1) when the band is
   * completely free — which is the normal case for a flow link running between
   * two props that both sit in a free band.
   */
  function textColumnAt(ids, y0, y1, out) {
    const list = typeof ids === 'string' ? [ids] : (ids || []);
    const vw = window.innerWidth || 1;
    out[0] = -1;
    out[1] = 1;
    let lo = Infinity;
    let hi = -Infinity;
    for (const id of list) {
      const rects = content[id];
      if (!rects) continue;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.y1 < y0 || r.y0 > y1) continue;
        if (r.x0 < lo) lo = r.x0;
        if (r.x1 > hi) hi = r.x1;
      }
    }
    if (!isFinite(lo) || hi - lo <= vw * 0.02) return false;
    out[0] = clamp((lo / vw) * 2 - 1, -1, 1);
    out[1] = clamp((hi / vw) * 2 - 1, -1, 1);
    return true;
  }

  /** The text column of one flow link's own height, over every section that
   *  can be on screen. Used by the link shader to fade a tube out exactly
   *  where it would cross copy. */
  function linkColumn(y0, y1, out) {
    return textColumnAt(sectionsOnScreen(window.scrollY, window.innerHeight), y0, y1, out);
  }

  /** NDC x-span of the translucent cards at a given page band. */
  function softAt(ids, y0, y1) {
    return occupiedIn(soft, ids, y0, y1);
  }

  /**
   * Every section whose page span can put copy on screen at this scrollY, with a
   * viewport of slack so a prop that hangs off the top or bottom is still judged
   * against what is just off screen. The blended pair is added by the caller.
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

  /* ---------------------------------------------------------------------
   * Placement
   * ------------------------------------------------------------------ */

  /** NDC working slot, one per prop. */
  const slots = {};
  for (const key of OBJ_KEYS) {
    slots[key] = {
      key, cx: 0, cy: 0, hx: 0, hy: 0, dist: 0, scale: 1,
      docked: false, behind: false, fade: 1, wPx: 0, side: 'right', score: 0,
    };
  }
  const visible = OBJ_KEYS.map((k) => slots[k]).filter(Boolean);

  const placement = {};
  for (const key of OBJ_KEYS) {
    placement[key] = {
      x: 0, y: 0, z: 0, scale: 1, docked: false, behind: false, fade: 1,
      hxNdc: 0, hyNdc: 0, side: 'right', wPx: 0, hPx: 0, cx: 0, cy: 0,
    };
  }

  /**
   * The reserved-band fade. 1 once a prop is `headerFadePx` clear of the sticky
   * header, ramping smoothly to 0 at the band's edge, so a prop approaching the
   * opaque strip dissolves instead of being sliced by it. Returns 1 while the
   * header is still transparent, which leaves the hero untouched.
   */
  function bandFade(o, vh) {
    if (!headerSolid || headerPx <= 0) return 1;
    const topPx = (1 - (o.cy - o.hy)) * 0.5 * vh;
    return clamp((topPx - headerPx) / TUNING.gutters.headerFadePx, 0, 1);
  }

  /**
   * Places every prop for the current scroll state.
   *
   * @param {object} s          the sampled stop (see sample())
   * @param {number} scrollY
   * @param {object} camera
   * @param {Record<string,{halfW:number,halfH:number,fitMax:number}>} bounds
   */
  function layout(s, scrollY, camera, bounds) {
    const G = TUNING.gutters;
    const P = TUNING.props;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const desktop = vw >= TUNING.tabletBreakpoint;

    /* Every section that can put copy on screen right now, plus the two being
       blended (they may be off screen but still own the props' anchors). */
    const ids = measured ? sectionsOnScreen(scrollY, vh) : [];
    if (ids.indexOf(s.fromId || s.sectionId) < 0) ids.push(s.fromId || s.sectionId);
    if (ids.indexOf(s.toId || s.sectionId) < 0) ids.push(s.toId || s.sectionId);

    /* The sticky header is a reserved band only while it paints an opaque
       strip; the hero's transparent header must not push the props around. */
    const bandPx = headerSolid ? headerPx : 0;
    const topLimitPx = (bandPx > 0 ? bandPx : 0) + P.edgePadPx;

    /* THE FLOORS. `floorPx` is what a prop aims for; `hardFloorPx` is the
       absolute one the edge-docking rule may fall back to. Together they are
       the guarantee that a prop is always visible in every section. */
    const hardFloorPx = desktop ? P.minScreenPx : P.minScreenFraction * vw;
    const floorPx = Math.max(P.minScreenFraction * vw, hardFloorPx);
    const capPx = P.maxScreenFraction * vw;

    /* px <-> NDC, page-space helpers */
    const pxX = (cx) => (cx * 0.5 + 0.5) * vw;
    const ndcX = (px) => (px / vw) * 2 - 1;
    const pageY = (cy) => (1 - cy) * 0.5 * vh + scrollY;
    const ndcY = (py) => 1 - ((py - scrollY) / vh) * 2;
    const padY = (P.edgePadPx * 2) / vh;

    const hitsCopy = (x0, x1, y0, y1) => boxHits(content, ids, x0, x1, y0, y1);

    for (const p of _placed) p.used = false;
    for (const o of visible) o.unverified = false;

    /* ------------------------------------------------------------------
     * Box acceptance.
     *   mode  0  free: the WHOLE box inside the padded viewport
     *      -1  docked left  /  +1 docked right: the box may run off THAT side
     *           by up to `crop` of its own width, and never off the other
     *           one, never off the top or bottom, and never over copy.
     * ------------------------------------------------------------------ */
    const boxOk = (x0, x1, cy, hPx, wPx, crop, mode) => {
      if (mode === 0) {
        if (x0 < P.edgePadPx - 0.5) return false;
        if (x1 > vw - P.edgePadPx + 0.5) return false;
      } else if (mode < 0) {
        if (x0 < -crop * wPx - 0.5) return false;
        if (x1 > vw - P.edgePadPx + 0.5) return false;
      } else {
        if (x1 > vw + crop * wPx + 0.5) return false;
        if (x0 < P.edgePadPx - 0.5) return false;
      }
      const yTop = pageY(cy) - hPx * 0.5;
      const yBot = yTop + hPx;
      if (yTop < scrollY + topLimitPx - 0.5) return false;
      if (yBot > scrollY + vh - P.edgePadPx + 0.5) return false;
      return !hitsCopy(x0, x1, yTop, yBot);
    };

    /* Keeps a box inside the viewport + header band by moving its CENTRE. */
    const clampBox = (o) => {
      const limY = Math.max(padY, 1 - o.hy - padY);
      o.cy = clamp(o.cy, -limY, limY);
      if (bandPx > 0) {
        const top = -1 + (2 * (bandPx + P.edgePadPx)) / vh + o.hy;
        if (o.cy > top) o.cy = top;
      }
      const minCx = -1 + (P.edgePadPx * 2) / vw + o.hx;
      const maxCx = 1 - (P.edgePadPx * 2) / vw - o.hx;
      o.cx = minCx <= maxCx ? clamp(o.cx, minCx, maxCx) : 0;
    };

    /* ------------------------------------------------------------------
     * Candidate search for one prop.
     * ------------------------------------------------------------------ */
    const solveProp = (key, anchor, authorX, authorY) => {
      const o = slots[key];
      const b = bounds[key];
      const cap = P[key] || {};

      const dist = camera.position.z + G.baseDistance + anchor.z;
      o.dist = dist;
      const halfViewH = Math.tan((camera.fov * Math.PI) / 360) * dist;
      const halfViewW = halfViewH * (camera.aspect || 1);
      const hw = Math.max(b.halfW, 0.001);
      const hh = Math.max(b.halfH, 0.001);
      const aspectH = hh / hw;
      const worldCap = Math.min(cap.maxWorldScale ?? Infinity, b.fitMax ?? Infinity);

      /* Screen width in px for a given world scale, and back. Writes into the
         scratch it is given and returns it, so a caller holding the result
         across a nested fit is never overwritten. */
      const fitInto = (dst, wPx) => {
        let sc = (wPx / vw) * halfViewW / hw;
        if (sc > worldCap) sc = worldCap;
        dst.scale = sc;
        dst.w = (sc * hw / halfViewW) * vw;
        dst.h = dst.w * aspectH;
        return dst;
      };
      const fitOf = (wPx) => fitInto(_fit, wPx);

      /* Size ladder: cap -> floor -> absolute floor -> two last-resort steps. */
      let nLadder = 0;
      _ladder[nLadder++] = capPx;
      _ladder[nLadder++] = Math.max(floorPx, lerp(capPx, floorPx, 0.55));
      _ladder[nLadder++] = floorPx;
      _ladder[nLadder++] = hardFloorPx;
      _ladder[nLadder++] = hardFloorPx * 0.8;
      _ladder[nLadder++] = hardFloorPx * 0.62;

      const wantRight = anchor.side === 'right';
      const authX = clamp(authorX, -1, 1);
      const authY = clamp(authorY, -1, 1);

      /* x candidates: the authored x first, then the preferred side, then the
         opposite one. */
      let nx = 0;
      _xs[nx++] = authX;
      const mags = G.candidateX;
      for (const sgn of (wantRight ? [1, -1] : [-1, 1])) {
        for (let i = 0; i < mags.length && nx < MAX_XS - 1; i++) {
          const x = sgn * mags[i];
          let dup = false;
          for (let k = 0; k < nx; k++) if (Math.abs(_xs[k] - x) < 0.02) { dup = true; break; }
          if (!dup) _xs[nx++] = x;
        }
      }

      /* Separation from props already placed this frame. */
      const sepOf = (cx, cy, hx, hy, strict) => {
        for (const p of _placed) {
          if (!p.used) continue;
          const gap = strict ? G.minSeparation : G.minSeparation * 0.5;
          if (Math.abs(cx - p.cx) < hx + p.hx + gap &&
              Math.abs(cy - p.cy) < hy + p.hy + gap) return false;
        }
        return true;
      };

      /* Eight buckets, best-scoring candidate of each. Read in order at the
         end, so the first one that has an entry is the placement:
           0 free, strict sep, at/above the absolute floor   <-- the goal
           1 docked, strict sep, at/above the floor
           2 free, loose sep,   at/above the floor
           3 docked, loose sep, at/above the floor
           4 free, loose sep,   any size (crowded viewport)
           5 docked, loose sep, any size
         (6/7 unused, kept for symmetry of the stride arithmetic) */
      const best = _best;
      for (let i = 0; i < 8; i++) { best[i].ok = 0; best[i].score = Infinity; }

      const offer = (bucket, score, cx, cy, f, mode) => {
        if (score < best[bucket].score) {
          const bst = best[bucket];
          bst.ok = 1;
          bst.score = score;
          bst.cx = cx;
          bst.cy = cy;
          bst.scale = f.scale;
          bst.wPx = f.w;
          bst.hPx = f.h;
          bst.mode = mode;
          bst.side = cx >= 0 ? 'right' : 'left';
        }
        if (TUNING.debug) recordCandidate(cx, cy, f.w, f.h, mode, score, true);
      };

      /* Candidate y values for a page x-range: the authored height first, then
         the CENTRES of the free vertical bands in that column. */
      const fillYs = (x0, x1, wPx) => {
        let n = 0;
        /* Its own fit target: the caller's `f` must survive this call. */
        const probe = fitInto(_fitBand, wPx);
        _ys[n++] = authY;
        const cnt = freeBands(x0, x1, scrollY - 4, scrollY + vh + 4);
        for (let i = 0; i < cnt && n < MAX_YS; i++) {
          const a = _bands[i][0];
          const b = _bands[i][1];
          if (b - a < probe.h + 2 * P.edgePadPx) continue;
          const cy = ndcY((a + b) * 0.5);
          if (cy < -1.4 || cy > 1.4) continue;
          _ys[n++] = cy;
        }
        /* A short ladder either side of the authored height, so a prop can
           still hug its composition when the bands are unusable. */
        for (let k = 1; k <= G.bandLadder && n < MAX_YS; k++) {
          _ys[n++] = clamp(authY - k * G.bandStepVh, -1, 1);
          if (n < MAX_YS) _ys[n++] = clamp(authY + k * G.bandStepVh, -1, 1);
        }
        return n;
      };

      /* ---- pass over the free (fully visible) candidates ---- */
      for (let xi = 0; xi < nx; xi++) {
        const cx = _xs[xi];
        const flipped = wantRight ? cx < -0.05 : cx > 0.05;
        /* Probe the column at the ABSOLUTE floor: the narrowest box, so the
           free bands are the most generous the geometry allows. */
        const probeHard = fitOf(hardFloorPx);
        const probeX0 = pxX(cx) - probeHard.w * 0.5;
        const probeX1 = probeX0 + probeHard.w;
        const ny = fillYs(probeX0, probeX1, probeHard.w);
        for (let yi = 0; yi < ny; yi++) {
          const cy = _ys[yi];
          for (let li = 0; li < nLadder; li++) {
            const f = fitOf(_ladder[li]);
            if (f.w < 1) continue;
            const x0 = pxX(cx) - f.w * 0.5;
            const x1 = x0 + f.w;
            if (!boxOk(x0, x1, cy, f.h, f.w, 0, 0)) {
              if (TUNING.debug) recordCandidate(cx, cy, f.w, f.h, 0, 0, false);
              continue;
            }
            const hxNdc = f.w / vw;
            const hyNdc = f.h / vh;
            const strictOk = sepOf(cx, cy, hxNdc, hyNdc, true);
            const looseOk = sepOf(cx, cy, hxNdc, hyNdc, false);
            const sizeRatio = clamp(f.w / capPx, 0, 1);
            const shortfall = clamp((floorPx - f.w) / Math.max(floorPx, 1), 0, 1);
            const base =
              1.9 * Math.abs(cx - authX) +
              1.5 * Math.abs(cy - authY) +
              2.2 * (flipped ? 1 : 0) +
              2.4 * (1 - sizeRatio) +
              2.0 * shortfall;
            if (f.w >= hardFloorPx - 0.5) {
              if (strictOk) offer(0, base, cx, cy, f, 0);
              if (looseOk) offer(2, base, cx, cy, f, 0);
            } else {
              if (looseOk) offer(4, base + 2.0, cx, cy, f, 0);
            }
            /* Largest size that works here wins: no point going smaller. */
            break;
          }
          if (best[0].score < 0.30) break;
        }
        if (best[0].score < 0.30) break;
      }

      /* ---- fallback: dock against a SIDE edge, cropped by the screen ----
       * A docked prop's box is pushed PAST the padded edge by `crop` of its
       * own width, so the visible part is flush with the screen edge and only
       * the outer sliver is off it. The x-range handed to freeBands() is the
       * VISIBLE part, which is the part that has to be free of copy. */
      if (!best[0].ok && !best[2].ok && !best[4].ok) {
        for (let si = 0; si < 2; si++) {
          const mode = si === 0 ? -1 : 1;
          for (let li = 0; li < nLadder; li++) {
            const f = fitOf(_ladder[li]);
            if (f.w < 1) continue;
            const visW = Math.min(f.w, vw - P.edgePadPx);
            const visX0 = mode < 0 ? P.edgePadPx : vw - P.edgePadPx - visW;
            const visX1 = visX0 + visW;
            const ny = fillYs(visX0, visX1, visW);
            for (let yi = 0; yi < ny; yi++) {
              const cy = _ys[yi];
              for (let ci = 0; ci < CROP_STEPS.length; ci++) {
                const crop = Math.min(CROP_STEPS[ci], P.edgeCropMax);
                const x0 = mode < 0 ? -crop * f.w : vw + crop * f.w - f.w;
                const x1 = x0 + f.w;
                if (!boxOk(x0, x1, cy, f.h, f.w, crop, mode)) continue;
                const cx = ndcX((x0 + x1) * 0.5);
                const hxNdc = f.w / vw;
                const hyNdc = f.h / vh;
                const strictOk = sepOf(cx, cy, hxNdc, hyNdc, true);
                const looseOk = sepOf(cx, cy, hxNdc, hyNdc, false);
                const sizeRatio = clamp(f.w / capPx, 0, 1);
                const base =
                  1.9 * Math.abs(cx - authX) +
                  1.5 * Math.abs(cy - authY) +
                  2.2 * (wantRight ? (mode < 0 ? 1 : 0) : (mode > 0 ? 1 : 0)) +
                  2.6 /* docking is a deliberate last resort */ +
                  2.4 * (1 - sizeRatio) +
                  2.0 * clamp((floorPx - f.w) / Math.max(floorPx, 1), 0, 1);
                if (f.w >= hardFloorPx - 0.5) {
                  if (strictOk) offer(1, base, cx, cy, f, mode);
                  if (looseOk) offer(3, base, cx, cy, f, mode);
                } else if (looseOk) {
                  offer(5, base + 2.0, cx, cy, f, mode);
                }
                /* Smallest crop that clears wins: the prop stays as visible as
                   the geometry allows. A larger crop only pulls MORE of the
                   prop off screen, so there is nothing to gain by trying it. */
                break;
              }
            }
          }
        }
      }

      /* ---- commit the first bucket that has a placement ---- */
      let pick = null;
      for (let i = 0; i < 6; i++) {
        if (best[i].ok) { pick = best[i]; break; }
      }

      if (!pick) {
        /* Pathological viewport: no free box anywhere. Keep the prop visible
           at the authored anchor rather than hiding it. */
        const f = fitOf(hardFloorPx * 0.55);
        o.cx = clamp(authX, -1 + f.w / vw, 1 - f.w / vw);
        o.cy = authY;
        o.scale = f.scale;
        o.hx = f.w / vw;
        o.hy = f.h / vh;
        o.wPx = f.w;
        clampBox(o);
        o.docked = false;
        o.side = o.cx >= 0 ? 'right' : 'left';
        o.score = 9;
        o.unverified = false;
      } else {
        o.cx = pick.cx;
        o.cy = pick.cy;
        o.scale = pick.scale;
        o.hx = pick.wPx / vw;
        o.hy = pick.hPx / vh;
        o.wPx = pick.wPx;
        o.docked = pick.mode !== 0;
        o.side = pick.side;
        o.score = pick.score;
        /* Every candidate that reaches here has passed boxOk(), so the box it
           reports was verified against the copy at commit time. */
        o.unverified = false;
        if (o.docked) {
          /* A docked prop's CENTRE is off the padded edge, so it must not be
             clamped back in — clampBox only runs for the free case. */
          o.cy = clamp(o.cy, -1 + o.hy + padY, 1 - o.hy - padY);
          if (bandPx > 0) {
            const top = -1 + (2 * (bandPx + P.edgePadPx)) / vh + o.hy;
            if (o.cy > top) o.cy = top;
          }
        } else {
          clampBox(o);
        }
      }

      /* The reserved header band fade, and the "behind a card" dim. */
      o.fade = bandFade(o, vh);
      const yPageNow = pageY(o.cy);
      const bandHalf = Math.max(o.hy * 0.5 * vh, 24);
      o.behind = !!softAt(ids, yPageNow - bandHalf, yPageNow + bandHalf);

      /* Register for this frame's separation pass. */
      const pl = _placed.find((p) => p.key === key);
      if (pl) {
        pl.cx = o.cx; pl.cy = o.cy; pl.hx = o.hx; pl.hy = o.hy; pl.used = true;
      }

      if (TUNING.debug) {
        debugData.chosen[key] = {
          cx: o.cx, cy: o.cy, wPx: o.wPx, hPx: o.wPx * aspectH,
          side: o.side, docked: o.docked, score: o.score, mode: pick ? pick.mode : 0,
        };
      }
      return o;
    };

    /* ---- solve every prop, in a fixed order ---- */
    for (const key of OBJ_KEYS) {
      const anchor = s.anchors[key];
      solveProp(key, anchor, anchor.x, anchor.y);
    }

    /* ---- separation: no two props may overlap, never at the copy's expense --
     * The candidate search already rejects anchors that would touch a prop
     * placed earlier in the same frame, so this is only a safety net for the
     * clamping that follows. A push that would land on copy is refused. */
    separate((o) => {
      const x0 = pxX(o.cx) - o.hx * vw * 0.5;
      const y0 = pageY(o.cy) - o.hy * vh * 0.5;
      return hitsCopy(x0, x0 + o.hx * vw, y0, y0 + o.hy * vh);
    });

    /* Anything separation had to move is re-solved, so the boxes this function
       REPORTS are boxes that were verified clear of the copy. The separation
       registry is re-synced first, so a re-solve is judged against where the
       other props actually ended up and cannot land on top of one. */
    if (measured) {
      for (let i = 0; i < visible.length; i++) {
        const o = visible[i];
        const pl = _placed[i];
        pl.cx = o.cx; pl.cy = o.cy; pl.hx = o.hx; pl.hy = o.hy;
        pl.used = !o.docked && !o.unverified;
      }
      for (const key of OBJ_KEYS) {
        const o = slots[key];
        if (o.docked) continue;
        const x0 = pxX(o.cx) - o.hx * vw * 0.5;
        const y0 = pageY(o.cy) - o.hy * vh * 0.5;
        if (!o.unverified && !hitsCopy(x0, x0 + o.hx * vw, y0, y0 + o.hy * vh)) continue;
        const anchor = s.anchors[key];
        solveProp(key, anchor, anchor.x, anchor.y);
      }
    }

    /* ---- unproject to world ---- */
    for (const key of OBJ_KEYS) {
      const o = slots[key];
      const halfViewH = Math.tan((camera.fov * Math.PI) / 360) * o.dist;
      const halfViewW = halfViewH * (camera.aspect || 1);
      _camSpace.set(o.cx * halfViewW, o.cy * halfViewH, -o.dist).applyQuaternion(camera.quaternion);
      _world.copy(camera.position).add(_camSpace);
      const p = placement[key];
      p.x = _world.x;
      p.y = _world.y;
      p.z = _world.z;
      p.scale = o.scale;
      p.docked = o.docked;
      p.behind = o.behind;
      p.fade = bandFade(o, vh);
      p.hxNdc = o.hx;
      p.hyNdc = o.hy;
      p.side = o.side;
      p.wPx = o.wPx;
      p.hPx = o.hy * vh;
      p.cx = o.cx;
      p.cy = o.cy;
    }

    if (TUNING.debug) {
      debugData.ids = ids.slice();
      debugData.obstacles = [];
      for (const id of ids) for (const r of content[id] || []) debugData.obstacles.push(r);
      debugData.bandPx = bandPx;
      debugData.headerPx = headerPx;
      debugData.sectionId = s.sectionId;
      /* The candidate trail for this frame, accepted and refused alike. Taken
         (and reset) here, at the end of the frame, so the overlay shows one
         consistent solve rather than a partial one. */
      debugData.candidates = takeDebugCandidates();
    }
    return placement;
  }

  const _camSpace = new THREE.Vector3();
  const _world = new THREE.Vector3();

  /**
   * Relaxation pass: push overlapping props apart along the shallower axis of
   * penetration. `hitsCopy(o)` reports that this prop's CURRENT box is over the
   * copy; any push-off that would make that true is rolled back, so this pass
   * can never undo the clearance solve. Docked props are left alone — their box
   * is deliberately off the padded edge.
   */
  function separate(hitsCopy) {
    const G = TUNING.gutters;
    const P = TUNING.props;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pxX = (cx) => (cx * 0.5 + 0.5) * vw;
    const pageY = (cy) => (1 - cy) * 0.5 * vh + window.scrollY;
    const check = hitsCopy || (() => false);
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
          const a = visible[i], b = visible[j];
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
          else moved = true;
        }
      }
      if (!moved) break;
    }
    /* Never let a push-off shove a prop off the padded edge, or up into the
       opaque header strip. */
    const padX = (P.edgePadPx * 2) / vw;
    const padY = (P.edgePadPx * 2) / vh;
    const bandPx = headerSolid ? headerPx : 0;
    for (const o of visible) {
      if (o.docked) {
        const limY = Math.max(padY, 1 - o.hy - padY);
        o.cy = clamp(o.cy, -limY, limY);
        if (bandPx > 0) {
          const top = -1 + (2 * (bandPx + P.edgePadPx)) / vh + o.hy;
          if (o.cy > top) o.cy = top;
        }
        continue;
      }
      const limY = Math.max(padY, 1 - o.hy - padY);
      o.cy = clamp(o.cy, -limY, limY);
      if (bandPx > 0) {
        const top = -1 + (2 * (bandPx + P.edgePadPx)) / vh + o.hy;
        if (o.cy > top) o.cy = top;
      }
      const minCx = -1 + padX + o.hx;
      const maxCx = 1 - padX - o.hx;
      o.cx = minCx <= maxCx ? clamp(o.cx, minCx, maxCx) : 0;
      /* The solve verified a box at this position; a clamp that MOVED it has
         to be verified again, or the reported box is a lie. A box that ended
         up over the copy is flagged so the caller's re-solve pass picks it
         up — but it is NOT called "docked": it is not cropped, it is refused,
         and the search runs again for a candidate that is. */
      const x0 = pxX(o.cx) - o.hx * vw * 0.5;
      const y0 = pageY(o.cy) - o.hy * vh * 0.5;
      if (check(o)) o.unverified = true;
    }
  }

  return {
    out,
    sample,
    computeProgress,
    layout,
    textColumnAt,
    linkColumn,
    softAt,
    sectionsOnScreen,
    remeasure,
    measureAnchors,
    measureContent,
    measureFocalCards,
    focalY,
    debugData,
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

/* ---- the eight candidate buckets, allocated once ---- */
const _best = [];
for (let i = 0; i < 8; i++) {
  _best.push({ ok: 0, score: 0, cx: 0, cy: 0, scale: 0, wPx: 0, hPx: 0, mode: 0, side: 'right' });
}

/* ---- ?scene3d=debug: candidate/chosen anchors for the overlay ---- */
let _debugCands = null;
let _debugCount = 0;
function recordCandidate(cx, cy, wPx, hPx, mode, score, ok) {
  if (!_debugCands) {
    _debugCands = [];
    for (let i = 0; i < 128; i++) {
      _debugCands.push({ cx: 0, cy: 0, wPx: 0, hPx: 0, mode: 0, score: 0, ok: 0 });
    }
    _debugCount = 0;
  }
  if (_debugCount >= _debugCands.length) return;
  const c = _debugCands[_debugCount++];
  c.cx = cx; c.cy = cy; c.wPx = wPx; c.hPx = hPx;
  c.mode = mode; c.score = score; c.ok = ok ? 1 : 0;
}
function takeDebugCandidates() {
  if (!_debugCands) return [];
  const out = _debugCands.slice(0, _debugCount);
  _debugCount = 0;
  return out;
}
export { takeDebugCandidates };
