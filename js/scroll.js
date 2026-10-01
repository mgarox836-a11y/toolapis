/* ============================================================================
 * scroll.js — TOOLAPIS · scroll choreography + authored layout validator
 * ----------------------------------------------------------------------------
 * Three jobs:
 *
 *  1. Turn scrollY into a normalised progress value across the section stops and
 *     blend the two active stops (camera pose, exposure, per-prop depth, dim,
 *     authored placement).
 *
 *  2. Blend the AUTHORED composition in TUNING.layout: every section says where
 *     each prop sits, in viewport fractions, per breakpoint. Blending the two
 *     stops in view cross-fades the composition with the camera, so a prop
 *     drifts from its hero spot to its overview spot instead of jumping.
 *
 *  3. VALIDATE that authored decision against the real page, and rescue it.
 *
 *     Placement is AUTHORED, not searched. The validator:
 *
 *       a. Measures the real obstacles — the line extents of headings and
 *          paragraphs (Range.getClientRects, merged per line), the boxes of
 *          cards, pill buttons, icons and media, the painted leaf elements,
 *          the reserved sticky-header band and the footer band. Never a
 *          full-width wrapper: an element wider than
 *          `layout.obstacle.maxWidthFrac` of the viewport is dropped unless it
 *          actually paints, so a transparent full-bleed container can never
 *          become a wall that erases the gutters it was meant to protect.
 *
 *       b. Projects the prop's REAL local box — all 8 corners, through the live
 *          camera, at the scale it is about to be drawn at, with the prop's own
 *          current rotation — so the box it validates is the box the mesh
 *          draws. js/objects.js centres each prop on that box, so the projected
 *          centre and the anchor are the same point to a fraction of a pixel.
 *
 *       c. Tests the authored position, then the authored `alt`, then nudges
 *          along the eight nearest directions in steps of at most
 *          `layout.nudge.maxFrac` of the viewport. Sizes are NEVER shrunk to
 *          make room: the floor is `props.minScreenFraction` / `minScreenPx`,
 *          and the size it commits to is checked against that floor.
 *
 *       d. If nothing is free inside the band, the prop's opacity goes to 0 for
 *          that stretch of scroll — damped, at FULL size, never a hard cut.
 *
 *     The solve runs per frame over a small pre-measured list; DOM reads happen
 *     on resize and once webfonts have settled, never per frame.
 * ==========================================================================*/

import * as THREE from 'three';
import {
  TUNING, STOPS, SECTION_IDS, OBJ_KEYS,
  exposureFor, layoutVariant, authoredAnchor,
} from './config.js';

/* Text blocks: measured by their REAL text extent, one merged rect per line. A
 * centred two-line headline inside a `max-w-3xl` box must measure as two
 * narrow bands, not as one box as wide as the container. */
const TEXT_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'blockquote',
].join(',');

/* Boxes: measured by their own element rect. A pill button, an icon or a media
 * box is a visible object, not a line of text — the padding around the label is
 * part of what the visitor sees. */
const BOX_SELECTOR = ['img', 'svg', 'video', 'iframe', '.btn'].join(',');

/* Cards are HARD obstacles, exactly like text: the 3D layer sits behind the
 * page, so a prop read through a translucent panel passes for a rendering bug
 * rather than for depth. They also drive the "behind a card" dim, and they are
 * EXEMPT from the full-width cap: a full-bleed card is real content. */
const CARD_SELECTOR = '.glass-panel, .spot-card';

/* Painted leaf elements: a chip, an icon well, a stat pill. Real content the
 * visitor reads as a solid object. Skipped inside a card (the card already
 * blocks) and skipped when the element is a layout wrapper. */
const CHIP_SELECTOR = 'div, span, a, button, i, ul';

/* Layout wrappers are never obstacles, however they are decorated. A section,
 * a container, a grid or a row measures as a box as wide as the page, and one
 * of those in the bank erases the gutter it was supposed to protect. */
const WRAPPER_SELECTOR = [
  'section', 'header', 'footer', 'main', 'nav', '[role="main"]',
  '.container', '.container-inner', '.grid', '.row', '.row-inner', '.cols',
  '.col', '.reveal-group', '.reveal',
  '[class*="container"]', '[class*="wrapper"]', '[class*="grid"]',
  '[class*="row"]', '[class*="layout"]', '[class*="section"]',
].join(',');

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);

const byTop = (a, b) => a.y0 - b.y0;

/* The NDC box is allowed to drift this far from the authored anchor. Anything
 * bigger is a bug in the projection, not a design decision. */
/*
 * How far the prop's LIVE anchor may sit from the box the solver validated.
 * Exported rather than repeated: the number the overlay turns red on and the
 * number the solver is held to must be the same one.
 */
export const CENTER_TOLERANCE_PX = 2;

const identityQuat = new THREE.Quaternion();

export function createScrollEngine() {
  /** @type {number[]} scrollY at which each section is vertically centred */
  let anchors = SECTION_IDS.map(() => 0);
  /** @type {Record<string, Rect[]>} page-space HARD obstacles: text extents,
   *  boxes, cards and painted chips, all padded by rectPadPx */
  let content = {};
  /** @type {Record<string, Rect[]>} page-space card boxes (the dim source) */
  let soft = {};
  /** @type {Record<string, Rect[]>} page-space text INSIDE a card. Hard for the
   *  flow links only: a pulse tube must never be drawn over a card's copy. */
  let cardText = {};
  /** @type {{centerX:number, pageTop:number, h:number, w:number}[]} Features cards */
  let measured = false;
  /** px reserved at the top of the viewport for the sticky header. */
  let headerPx = 0;
  /** The header only reserves that band while it is opaque (`nav-solid`). */
  let headerSolid = false;
  /** @type {Record<string, {y0:number,y1:number}>} each section's page-space span */
  let sectionSpan = {};
  /** What the last measure kept and dropped, for ?scene3d=debug. */
  let stats = {
    text: 0, box: 0, chip: 0, card: 0, wrapper: 0, wide: 0, chrome: 0,
  };

  /** Last solve, for the ?scene3d=debug overlay. Never read by the frame path. */
  const debugData = {
    ids: [],
    obstacles: [],
    bandPx: 0,
    bandTopPx: 0,
    bandBottomPx: 0,
    headerPx: 0,
    variant: 'desktop',
    sectionId: STOPS[0].id,
    fromId: STOPS[0].id,
    toId: STOPS[0].id,
    authored: {},
    chosen: {},
    stats,
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

  /** A layout wrapper: full-bleed by construction, never real content. */
  function isWrapper(el) {
    try { return el.matches(WRAPPER_SELECTOR); } catch (err) { return false; }
  }

  const ZERO_ALPHA = /^(transparent|rgba\(\s*0[,\s]\s*0[,\s]\s*0[,\s]\s*0\s*\)|hsla\(\s*0[,\s]*0[,\s]*0[,\s]*0\s*\))$/;

  /** Does this element actually paint? A background, a border or a shadow. */
  function paintsSomething(el, style) {
    const st = style || window.getComputedStyle(el);
    if (st.backgroundColor && !ZERO_ALPHA.test(st.backgroundColor)) return true;
    if ((parseFloat(st.borderTopWidth) || 0) > 0.5
      && st.borderTopColor && !ZERO_ALPHA.test(st.borderTopColor)) return true;
    if (st.boxShadow && st.boxShadow !== 'none') return true;
    return false;
  }

  /**
   * The client rects of an element's actual text, merged so one LINE is one
   * rect. This is the difference between "the headline's text" and "the
   * headline's container", and the whole reason the side gutters exist at all.
   * An element with no text rects contributes NOTHING — falling back to its
   * element box is exactly how a `max-w-3xl` paragraph used to become a wall.
   */
  function textUnion(el) {
    const lines = [];
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const list = range.getClientRects();
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (r.width < 2 || r.height < 2) continue;
        /* Inline elements inside a block return one rect per fragment of the
           SAME line; merge them by vertical overlap. */
        let merged = false;
        for (let j = 0; j < lines.length; j++) {
          const l = lines[j];
          const overlap = Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top);
          if (overlap > Math.min(l.height, r.height) * 0.5) {
            l.left = Math.min(l.left, r.left);
            l.right = Math.max(l.right, r.right);
            l.top = Math.min(l.top, r.top);
            l.bottom = Math.max(l.bottom, r.bottom);
            merged = true;
            break;
          }
        }
        if (!merged) {
          lines.push({
            left: r.left, right: r.right, top: r.top, bottom: r.bottom,
            width: r.width, height: r.height,
          });
        }
      }
      if (range.detach) range.detach();
    } catch (err) { return []; }
    lines.sort(byTop);
    return lines;
  }

  /**
   * Snapshots the obstacle rectangles of every section in PAGE coordinates (so
   * they stay valid across scrolling). Called on resize and once webfonts have
   * settled, never per frame.
   */
  function measureContentNow() {
    const scrollY = window.scrollY;
    const vw = window.innerWidth || 1;
    /* Every obstacle is grown on all four sides before the validator ever sees
       it, so "clear of the copy" means clear with room to breathe. */
    const pad = TUNING.gutters.rectPadPx;
    const maxW = vw * TUNING.layout.obstacle.maxWidthFrac;
    content = {};
    soft = {};
    cardText = {};
    sectionSpan = {};
    stats = { text: 0, box: 0, chip: 0, card: 0, wrapper: 0, wide: 0, chrome: 0 };

    const push = (into, id, r) => {
      const rect = {
        x0: r.left !== undefined ? r.left - pad : r.x0 - pad,
        x1: r.right !== undefined ? r.right + pad : r.x1 + pad,
        y0: r.top !== undefined ? r.top + scrollY - pad : r.y0 - pad,
        y1: r.bottom !== undefined ? r.bottom + scrollY + pad : r.y1 + pad,
      };
      const list = into[id] || (into[id] = []);
      list.push(rect);
      return rect;
    };

    for (const id of SECTION_IDS) {
      const section = document.getElementById(id);
      if (!section) continue;
      const sr = section.getBoundingClientRect();
      sectionSpan[id] = { y0: sr.top + scrollY, y1: sr.bottom + scrollY };

      /* 1. real text extents, line by line */
      for (const el of section.querySelectorAll(TEXT_SELECTOR)) {
        if (isSkippable(el)) continue;
        const lines = textUnion(el);
        if (!lines.length) continue;
        const inCard = !!el.closest(CARD_SELECTOR);
        for (const r of lines) {
          push(content, id, r);
          stats.text++;
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
        stats.box++;
      }

      /* 3. cards: translucent glass panels — a SOFT dim source, never a hard
          collision. The prop reads as depth behind the glass. Exempt from the
          full-width cap — a full-bleed card is real content. */
      for (const el of section.querySelectorAll(CARD_SELECTOR)) {
        if (isSkippable(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        push(soft, id, r);
        stats.card++;
      }

      /* 4. painted leaf elements: chips, icon wells, stat pills. A wrapper is
         never one, and anything wider than the cap is chrome, not content. */
      for (const el of section.querySelectorAll(CHIP_SELECTOR)) {
        if (isSkippable(el)) continue;
        if (el.closest(CARD_SELECTOR) || el.matches(BOX_SELECTOR)) continue;
        if (isWrapper(el)) { stats.wrapper++; continue; }
        if (el.childElementCount > 1) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        if (r.width > maxW) { stats.wide++; continue; }
        if (!paintsSomething(el)) continue;
        push(content, id, r);
        stats.chip++;
      }
    }

    /* The footer: one deliberate full-width band, so a prop can never sit on
       the footer border or the footer copy however the page is built. */
    const footer = document.querySelector(TUNING.layout.obstacle.footer);
    if (footer && !isSkippable(footer)) {
      const r = footer.getBoundingClientRect();
      if (r.width >= 4 && r.height >= 4) {
        push(content, 'chrome', r);
        stats.chrome++;
      }
    }

    /* Every bank is sorted TOP TO BOTTOM, including the chrome band, so the
       overlay and the validator read them in visual order. */
    for (const bank of [content, soft, cardText]) {
      for (const id of Object.keys(bank)) {
        const list = bank[id];
        if (list && list.length > 1) list.sort(byTop);
      }
    }
    debugData.stats = stats;

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
   * The same pass, with the scroll reveal's entrance transforms switched off
   * for its duration (css/reveal.css -> `html.rv-measuring`).
   *
   * WHY. Every entrance in the reveal system is a TRANSFORM, precisely so it
   * does not move the box: the hidden state is drawn 28px low and 12px soft,
   * and the final state is the normal flow position. `getBoundingClientRect`
   * reports the transformed box, so a block that has not arrived yet would be
   * measured 28px below where it will actually land, and a prop could be
   * validated against a rectangle of copy that has already moved on.
   *
   * Reading layout with the class on forces the style recalc that applies it,
   * so the first rect read below is already the neutralized one. The class is
   * removed in a `finally`, and a second forced recalc restores the real
   * entrance state, so nothing is ever left with its animation suppressed.
   */
  function measureContent() {
    const d = document.documentElement;
    d.classList.add('rv-measuring');
    try {
      measureContentNow();
    } finally {
      d.classList.remove('rv-measuring');
      try { void d.offsetWidth; } catch (e) { /* the next frame cleans up anyway */ }
    }
  }

  function remeasure() {
    measureAnchors();
    measureContent();
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

  /* ---------------------------------------------------------------------
   * Stop blending
   * ------------------------------------------------------------------ */

  function makeOut() {
    const anchorOut = {};
    for (const key of OBJ_KEYS) {
      anchorOut[key] = {
        x: 0.5, y: 0.5, size: 0.12, opacity: 0,
        side: 'right', z: 0, scale: 1, dim: 1, sizeCap: 1,
      };
    }
    return {
      cam: new THREE.Vector3(),
      look: new THREE.Vector3(),
      fov: TUNING.fov,
      yaw: 0,
      exposure: 1,
      converge: 0,
      /* The signature story: the display's sharpness (0 = pixelated), the USB
       * dock weight and the constellation's orbit weight — all blended. */
      screen: 0,
      dock: 0,
      orbit: 0,
      index: 0,
      sectionId: STOPS[0].id,
      /* The two stops being blended. Placement must clear BOTH. */
      fromId: STOPS[0].id,
      toId: STOPS[0].id,
      /* Which authored breakpoint variant the viewport is using. */
      variant: 'desktop',
      anchors: anchorOut,
    };
  }

  const out = makeOut();

  /**
   * Blend the two stops in view. Everything the section table owns is lerped;
   * the authored placement is looked up per variant and lerped in VIEWPORT
   * FRACTIONS, so a prop's path between two sections is a straight line in
   * screen space rather than a jump at the halfway point.
   */
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
    out.variant = layoutVariant(window.innerWidth || 1);
    out.cam.set(lerp(A.cam[0], B.cam[0], t), lerp(A.cam[1], B.cam[1], t), lerp(A.cam[2], B.cam[2], t));
    out.look.set(lerp(A.look[0], B.look[0], t), lerp(A.look[1], B.look[1], t), lerp(A.look[2], B.look[2], t));
    out.fov = lerp(A.fov, B.fov, t);
    out.yaw = lerp(A.yaw, B.yaw, t);
    out.exposure = lerp(exposureFor(A.id), exposureFor(B.id), t);
    out.converge = lerp(A.converge || 0, B.converge || 0, t);
    out.screen = lerp(A.screen ?? 0, B.screen ?? 0, t);
    out.dock = lerp(A.dock || 0, B.dock || 0, t);
    out.orbit = lerp(A.orbit || 0, B.orbit || 0, t);

    for (const key of OBJ_KEYS) {
      const a = A.anchors[key], b = B.anchors[key];
      const o = out.anchors[key];

      /* Depth, glow and the size ceiling stay in the section table. */
      o.z = lerp(a.z, b.z, t);
      o.dim = lerp(a.dim, b.dim, t);
      o.sizeCap = lerp(a.sizeCap ?? 1, b.sizeCap ?? 1, t);
      o.scale = 1;

      /* Placement is authored: TUNING.layout, per breakpoint variant. */
      const pa = authoredAnchor(A.id, key, out.variant);
      const pb = authoredAnchor(B.id, key, out.variant);
      o.ax = pa.x; o.ay = pa.y; o.aSize = pa.size; o.aOpacity = pa.opacity;
      o.bx = pb.x; o.by = pb.y; o.bSize = pb.size; o.bOpacity = pb.opacity;

      o.x = lerp(pa.x, pb.x, t);
      o.y = lerp(pa.y, pb.y, t);
      o.size = lerp(pa.size, pb.size, t);
      o.opacity = lerp(pa.opacity, pb.opacity, t);
      o.side = o.x >= 0.5 ? 'right' : 'left';

      /* The legibility floor override is NOT interpolated: it is a px floor,
       * and lerping two px floors produces a value neither section asked for.
       * Take the stricter (larger) one while both stops are on screen, so the
       * prop never shrinks below a floor either end of the blend. */
      const fa = pa.minPx, fb = pb.minPx;
      o.minPx = fa != null && fb != null ? Math.max(fa, fb)
        : (t < 0.5 ? (fa != null ? fa : fb) : (fb != null ? fb : fa));
      if (o.minPx == null) delete o.minPx;
    }
    return out;
  }

  /* ---------------------------------------------------------------------
   * Geometry helpers over the pre-measured obstacle banks
   * ------------------------------------------------------------------ */

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

  /** Checks if a screen-space box overlaps any obstacle in the given banks. */
  function boxHits(bank, ids, x0, x1, y0, y1) {
    for (const id of ids) {
      const rects = bank[id];
      if (!rects) continue;
      for (const r of rects) {
        if (x1 > r.x0 && x0 < r.x1 && y1 > r.y0 && y0 < r.y1) return true;
      }
    }
    return false;
  }

  /* ---------------------------------------------------------------------
   * The projected box
   *
   * The box the validator tests is the box the mesh draws: the prop's own local
   * AABB, scaled, spun by the rotation the prop carries RIGHT NOW, and put at
   * the distance the section table asks for. All 8 corners go through the live
   * camera's projection matrix — not an aspect-ratio approximation of the
   * height, which is what put the debug box a whole prop-height off its anchor.
   * ------------------------------------------------------------------ */

  const CORNER_X = [-1, 1, -1, 1, -1, 1, -1, 1];
  const CORNER_Y = [1, 1, -1, -1, 1, 1, -1, -1];
  const CORNER_Z = [-1, -1, -1, -1, 1, 1, 1, 1];
  const _corner = new THREE.Vector3();
  const _camSpace = new THREE.Vector3();

  /** World half-height / half-width of the camera's view plane at `dist`. */
  function viewHalf(camera, dist, out) {
    const h = Math.tan((camera.fov * Math.PI) / 360) * dist;
    out.h = h;
    out.w = h * (camera.aspect || 1);
    return out;
  }
  const _half = { h: 1, w: 1 };

  /**
   * Projects the prop's local box to a viewport-pixel box CENTRED ON THE PROP'S
   * OWN ORIGIN, which is what the mesh is drawn around and what the anchor
   * projects to.
   *
   * The 8 corners go through the live camera's matrices — not an aspect-ratio
   * approximation of the height, which is what put the old debug box a whole
   * prop-height off its anchor. The corners give the box its true extent, and
   * the origin's own projection gives it its centre; the two are not the same
   * point under perspective (a box with depth projects to an AABB whose
   * midpoint is offset from the projection of its centre, by an amount that
   * grows with the box's depth), so the box is grown symmetrically about the
   * origin until it covers every corner. That keeps the validator's box
   * centred on the prop AND a superset of the drawn silhouette.
   *
   * @param {object} out scratch: {x0,y0,x1,y1,w,h,cx,cy,ndcX,ndcY,asymPx}
   */
  function projectBox(camera, b, ndcX, ndcY, dist, scale, vw, vh, out) {
    viewHalf(camera, dist, _half);
    /* `half` is what js/objects.js measured; `halfW`/`halfH`/`halfD` are the
       flattened copies some callers carry. Read the measured one first so the
       box can never silently fall back to a unit cube. */
    const h3 = b.half || b;
    const hw = Math.max(0.05, h3.w || b.halfW || 0.05) * scale;
    const hh = Math.max(0.05, h3.h || b.halfH || 0.05) * scale;
    const hd = Math.max(0.05, h3.d || b.halfD || h3.h || b.halfH || 0.05) * scale;
    const q = b.quat || identityQuat;
    const ndcCx = clamp(ndcX, -0.995, 0.995);
    const ndcCy = clamp(ndcY, -0.995, 0.995);

    /* The origin's world position for this NDC pair. Unprojecting is exact, so
       committing this point back IS what puts the mesh's centre on the
       authored anchor. */
    _camSpace.set(ndcCx * _half.w, ndcCy * _half.h, -dist).applyQuaternion(camera.quaternion);
    const ox = camera.position.x + _camSpace.x;
    const oy = camera.position.y + _camSpace.y;
    const oz = camera.position.z + _camSpace.z;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let c = 0; c < 8; c++) {
      _corner.set(CORNER_X[c] * hw, CORNER_Y[c] * hh, CORNER_Z[c] * hd).applyQuaternion(q);
      _corner.set(ox + _corner.x, oy + _corner.y, oz + _corner.z).project(camera);
      if (_corner.x < minX) minX = _corner.x;
      if (_corner.x > maxX) maxX = _corner.x;
      if (_corner.y < minY) minY = _corner.y;
      if (_corner.y > maxY) maxY = _corner.y;
    }

    /* The marker: the prop's own origin, in px. The box is centred here. */
    const cxPx = (ndcCx * 0.5 + 0.5) * vw;
    const cyPx = (1 - ndcCy * 0.5) * 0.5 * vh;
    const halfPxW = Math.max(ndcCx - minX, maxX - ndcCx) * 0.5 * vw;
    const halfPxH = Math.max(ndcCy - minY, maxY - ndcCy) * 0.5 * vh;

    out.ndcX = ndcCx;
    out.ndcY = ndcCy;
    out.cx = cxPx;
    out.cy = cyPx;
    out.x0 = cxPx - halfPxW;
    out.x1 = cxPx + halfPxW;
    out.y0 = cyPx - halfPxH;
    out.y1 = cyPx + halfPxH;
    out.w = halfPxW * 2;
    out.h = halfPxH * 2;
    /* How far the TIGHT AABB's own midpoint would sit from the marker. Reported
       for the overlay, never used: the box above is the one that gets drawn
       and the one that gets validated. */
    out.asymPx = Math.hypot(
      ((minX + maxX) * 0.5 - ndcCx) * 0.5 * vw,
      ((minY + maxY) * 0.5 - ndcCy) * 0.5 * vh
    );
    return out;
  }

  const _rect = {
    x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0, cx: 0, cy: 0,
    ndcX: 0, ndcY: 0, asymPx: 0,
  };

  /* ---------------------------------------------------------------------
   * Placement: the authored decision, validated
   * ------------------------------------------------------------------ */

  /** One record per prop, allocated once. The frame loop writes these. */
  const placement = {};
  for (const key of OBJ_KEYS) {
    placement[key] = {
      key,
      /* World position for the prop's anchor. */
      x: 0, y: 0, z: 0, scale: 1,
      /* NDC centre: what the flow links and the overlay read. */
      cx: 0, cy: 0,
      /* Which gutter it committed to: the USB plug yaws its cable out of the
         text column from here, and it is read by the prop that owns the yaw. */
      side: 'right',
      /* The projected box, in viewport px. */
      x0: 0, y0: 0, x1: 0, y1: 0, wPx: 0, hPx: 0, cxPx: 0, cyPx: 0,
      /* The authored anchor it was validated against, in px. `cxPx`/`cyPx` IS
         the prop's own origin on screen — the box is centred there by
         construction, so there is no box-vs-anchor offset left to report
         here; the tolerance that matters is the prop's LIVE anchor against
         the box, which js/scene3d.js measures off the scene itself. */
      authX: 0, authY: 0,
      /* How far the TIGHT AABB's midpoint sits from the origin's projection.
         Informational: a box with depth cannot have both, and the validator
         uses the origin-centred box, not the tight one. */
      asymPx: 0,
      /* Size bookkeeping: what was authored, what the floor is, what it got. */
      authoredPx: 0, floorPx: 0, committedPx: 0,
      /* Crop support (struct only): how far the box pokes past the band's pads
         (0 while edgeCropMax === 0), and how far its centre sits from the
         centre of the nearest other prop. */
      croppedPx: 0, nearestPx: 0,
      /* Damped, then handed to js/scene3d.js. */
      opacity: 1, fade: 1,
      state: 'authored',
      /* WHY the committed opacity is what it is — 'visible-authored',
       * 'collides-text', 'outside-band', 'band-fade-top', 'band-fade-bottom'
       * or 'authored-hidden'. Set every solve, so it is never stale. */
      reason: 'visible-authored',
      collided: false, nudged: false, clamped: false, behind: false,
    };
  }

  /**
   * Validates the authored placement of every prop against the measured page
   * and commits the result.
   *
   * @param {object} s     the sampled stop (see sample())
   * @param {number} scrollY
   * @param {object} camera the LIVE camera: fov, aspect, quaternion, position
   * @param {Record<string,object>} bounds per prop: `half` half extents in local
   *   units, plus the rotation (`quat`) and screen offset (`offX`/`offY`) the
   *   prop group carried last frame, so the box follows the drawn mesh
   * @returns {Record<string,object>} one placement record per prop
   */
  function layout(s, scrollY, camera, bounds) {
    const P = TUNING.props;
    const G = TUNING.gutters;
    const L = TUNING.layout;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;

    /* Every section that can put copy on screen right now, plus the two being
       blended (they may be off screen but still own the props' placement) and
       the footer band, which is always in the way. */
    const ids = measured ? sectionsOnScreen(scrollY, vh) : [];
    if (ids.indexOf(s.fromId || s.sectionId) < 0) ids.push(s.fromId || s.sectionId);
    if (ids.indexOf(s.toId || s.sectionId) < 0) ids.push(s.toId || s.sectionId);
    if (measured && content.chrome && ids.indexOf('chrome') < 0) ids.push('chrome');

    /* The band a box has to live inside: below the reserved sticky-header band,
       above the footer band, inside the side pads. */
    const bandPx = headerSolid ? headerPx : 0;
    const topLimitPx = bandPx + P.edgePadPx;
    const botLimitPx = Math.min(vh - P.edgePadPx, vh * L.band.bottom);

    for (let ki = 0; ki < OBJ_KEYS.length; ki++) {
      const key = OBJ_KEYS[ki];
      const a = s.anchors[key];
      const b = bounds[key] || {};
      const p = placement[key];
      const cap = P[key] || {};

      /* Local half extents, from js/objects.js, which centres the prop on them. */
      const half = b.half || {};
      const halfW = Math.max(0.05, half.w || b.halfW || 0.05);
      const halfH = Math.max(0.05, half.h || b.halfH || 0.05);
      const halfD = Math.max(0.05, half.d || b.halfD || halfH);
      b.half = { w: halfW, h: halfH, d: halfD };

      const dist = camera.position.z + G.baseDistance + a.z;
      viewHalf(camera, dist, _half);

      /* ---- size: the authored size, lifted to the floor, capped ----
       * `minPx` lets a region with genuinely no room opt out of the global
       * legibility floor. It exists because the floor is a floor in px: the
       * flow region's tallest free band is ~112px, so a 164px monitor can
       * only ever collide with the copy there, and "no prop in this section"
       * is the only alternative. Opting in is explicit and per-prop. */
      const floorPx = a.minPx != null ? Math.max(1, a.minPx)
        : Math.max(
          P.minScreenFraction * vw,
          key === 'usb' ? P.minScreenPxUsb : P.minScreenPx
        );
      const capPx = Math.max(clamp(a.sizeCap ?? 1, 0, 1) * P.maxScreenFraction * vw, floorPx);
      const hardCap = Math.max(1e-4, b.fitMax ?? Infinity);
      const softCap = Math.min(cap.maxWorldScale ?? Infinity, hardCap);
      const pxPerWorld = vw / (2 * _half.w);
      const worldW = Math.max(0.02, halfW * 2);

      const ndcX = clamp(a.x, -0.5, 1.5) * 2 - 1;
      const ndcY = 1 - clamp(a.y, -0.5, 1.5) * 2;
      const wantPx = clamp(a.size * vw, floorPx, capPx);
      let sc = clamp(wantPx / (worldW * pxPerWorld), 1e-4, softCap);
      projectBox(camera, b, ndcX, ndcY, dist, sc, vw, vh, _rect);
      /* The size that is actually DRAWN is the box's dominant dimension — the
         axis the authored size, the floor and the cap are all expressed in.
         One fix pass: lift an under-sized prop to the floor, trim an
         over-sized one to the cap, then re-project so the box is the mesh. */
      const drawn = Math.max(_rect.w, _rect.h);
      if (drawn > 0.5) {
        const fix = drawn < floorPx - 0.5
          ? floorPx / drawn
          : (drawn > capPx + 0.5 ? capPx / drawn : 1);
        if (fix !== 1) {
          sc = clamp(sc * fix, 1e-4, hardCap);
          projectBox(camera, b, ndcX, ndcY, dist, sc, vw, vh, _rect);
        }
      }

      /* ---- THE LIGHT VALIDATOR ----
       * The placement is AUTHORED; the validator only fades, it never moves or
       * shrinks. A box that would overlap a TEXT obstacle (headings, lines,
       * buttons, the footer band) or that leaves the band fades out for this
       * stretch of scroll — damped, at FULL size. A translucent card under the
       * box is a soft dim, not a collision: the prop reads as depth behind the
       * glass. Nothing is ever nudged, searched or cropped. */
      /* ---- THE LIGHT VALIDATOR ----
       * The placement is AUTHORED; the validator only fades, it never moves or
       * shrinks. `reason` records WHY the committed opacity is what it is, and
       * is always one of the strings below — so "the prop vanished" and "the
       * prop is authored hidden in this section" are never the same report, and
       * the debug overlay can say which happened. */
      const placed0 = a.opacity > 0;
      let state = placed0 ? 'authored' : 'hidden';
      let reason = placed0 ? 'visible-authored' : 'authored-hidden';
      if (placed0) {
        const inBand = _rect.x0 >= P.edgePadPx - 0.5 && _rect.x1 <= vw - P.edgePadPx + 0.5
          && _rect.y0 >= topLimitPx - 0.5 && _rect.y1 <= botLimitPx + 0.5;
        const hitText = boxHits(content, ids, _rect.x0, _rect.x1, _rect.y0 + scrollY, _rect.y1 + scrollY);
        if (hitText) { state = 'hidden'; reason = 'collides-text'; }
        else if (!inBand) { state = 'hidden'; reason = 'outside-band'; }
      }
      /* A band-edge fade is a PARTIAL hide and says so separately: a prop
         dissolving under the reserved header strip is doing exactly what it
         should, and reporting it as a collision would send a reader hunting
         for a text overlap that does not exist. */
      const headFadeNow = bandPx > 0
        ? clamp((_rect.y0 - (bandPx + P.edgePadPx)) / G.headerFadePx, 0, 1) : 1;
      const footFadeNow = clamp((botLimitPx - _rect.y1) / P.footerFadePx, 0, 1);
      if (state !== 'hidden' && headFadeNow * footFadeNow < 1) {
        reason = headFadeNow < footFadeNow ? 'band-fade-top' : 'band-fade-bottom';
      }
      p.reason = reason;

      /* ---- commit ---- */
      p.x0 = _rect.x0; p.y0 = _rect.y0; p.x1 = _rect.x1; p.y1 = _rect.y1;
      p.wPx = _rect.w; p.hPx = _rect.h;
      p.cxPx = _rect.cx; p.cyPx = _rect.cy;
      p.cx = _rect.ndcX; p.cy = _rect.ndcY;
      p.side = p.cx >= 0 ? 'right' : 'left';
      p.authX = clamp(a.x, -0.5, 1.5) * vw; p.authY = clamp(a.y, -0.5, 1.5) * vh;
      p.asymPx = _rect.asymPx;
      p.scale = sc;
      p.authoredPx = a.size * vw;
      p.floorPx = floorPx;
      p.committedPx = Math.max(p.wPx, p.hPx);
      p.croppedPx = 0;
      p.state = state;
      p.collided = placed0 && state === 'hidden';
      p.nudged = false;
      p.clamped = Math.abs(p.committedPx - p.authoredPx) > 0.5;
      /* A translucent card behind the prop is the dim source, not a collision. */
      p.behind = measured && state !== 'hidden'
        && boxHits(soft, ids, p.x0, p.x1, p.y0 + scrollY, p.y1 + scrollY);

      /* Fades, in px, over the two band edges. */
      const headFade = bandPx > 0
        ? clamp((p.y0 - (bandPx + P.edgePadPx)) / G.headerFadePx, 0, 1) : 1;
      const footFade = clamp((botLimitPx - p.y1) / P.footerFadePx, 0, 1);
      p.fade = headFade * footFade;
      p.opacity = (state !== 'hidden' ? a.opacity : 0) * p.fade;

      /* Unproject the box CENTRE, then take off the prop group's own screen
         offset: the scene damps `anchor.position` toward this, and the mesh
         centre — which is the group origin, by construction — lands on the
         projected centre. The whole WORLD position is committed, depth
         included, so the drawn prop matches the box it was validated against. */
      _camSpace.set(p.cx * _half.w, p.cy * _half.h, -dist).applyQuaternion(camera.quaternion);
      p.x = camera.position.x + _camSpace.x - (b.offX || 0);
      p.y = camera.position.y + _camSpace.y - (b.offY || 0);
      p.z = camera.position.z + _camSpace.z;
    }

    /* ---- ?scene3d=debug/probe: what was asked for, and what was committed ---- */
    if (TUNING.inspect) {
      const obstacles = [];
      for (let i = 0; i < ids.length; i++) {
        const rects = content[ids[i]];
        if (!rects) continue;
        for (let j = 0; j < rects.length; j++) obstacles.push(rects[j]);
      }
      debugData.ids = ids.slice();
      debugData.obstacles = obstacles;
      debugData.bandPx = bandPx;
      debugData.bandTopPx = topLimitPx;
      debugData.bandBottomPx = botLimitPx;
      debugData.headerPx = headerPx;
      debugData.variant = s.variant;
      debugData.sectionId = s.sectionId;
      debugData.fromId = s.fromId;
      debugData.toId = s.toId;
      debugData.stats = stats;
      for (let ki = 0; ki < OBJ_KEYS.length; ki++) {
        const key = OBJ_KEYS[ki];
        const p = placement[key];
        debugData.authored[key] = { x: p.authX, y: p.authY, size: p.authoredPx };
        debugData.chosen[key] = {
          x: p.cxPx, y: p.cyPx, w: p.wPx, h: p.hPx,
          x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1,
          state: p.state, reason: p.reason,
          collided: p.collided, nudged: p.nudged,
          clamped: p.clamped, behind: p.behind, asym: p.asymPx,
          opacity: p.opacity, fade: p.fade, scale: p.scale,
          floorPx: p.floorPx, authoredPx: p.authoredPx, committedPx: p.committedPx,
          section: s.sectionId, croppedPx: p.croppedPx, nearestPx: p.nearestPx,
        };
      }
    }
    return placement;
  }

  return {
    out,
    sample,
    computeProgress,
    layout,
    sectionsOnScreen,
    remeasure,
    measureAnchors,
    measureContent,
    debugData,
    /**
     * The sticky header only reserves the top band while it paints an opaque
     * strip (`#navbar.nav-solid`). js/scene3d.js watches that class so this is
     * a flag update, never a per-frame class read or layout.
     */
    setHeaderSolid(solid) { headerSolid = !!solid; },
    get anchors() { return anchors; },
    get measured() { return measured; },
    get headerPx() { return headerPx; },
  };
}
