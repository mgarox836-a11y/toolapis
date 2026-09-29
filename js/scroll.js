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

/* Content that a prop must never sit on top of. */
const CONTENT_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'blockquote',
  'img', 'svg', 'video', 'iframe', '.btn', '.glass-panel', '.spot-card',
].join(',');

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);

export function createScrollEngine() {
  /** @type {number[]} scrollY at which each section is vertically centred */
  let anchors = SECTION_IDS.map(() => 0);
  /** @type {Record<string, {x0:number,x1:number,y0:number,y1:number}[]>} page-space rects */
  let content = {};
  /** @type {{centerX:number, pageTop:number, h:number}[]} Features cards, page space */
  let focalCards = [];
  let measured = false;

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
    const pad = 6;
    content = {};
    for (const id of SECTION_IDS) {
      const section = document.getElementById(id);
      if (!section) continue;
      const rects = [];
      for (const el of section.querySelectorAll(CONTENT_SELECTOR)) {
        if (el.closest('[aria-hidden="true"]')) continue;
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
      content[id] = rects;
    }
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

  /* ---------------------------------------------------------------------
   * Clearance solver
   * ------------------------------------------------------------------ */

  /**
   * Merges the x-intervals of every measured rect whose y-range overlaps the
   * query band, returning a sorted list of occupied [x0, x1] pairs in px.
   */
  function occupiedIn(sectionId, y0, y1) {
    const rects = content[sectionId];
    if (!rects || !rects.length) return [];
    const spans = [];
    for (const r of rects) {
      if (r.y1 < y0 || r.y0 > y1) continue;
      spans.push([r.x0, r.x1]);
    }
    if (!spans.length) return [];
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [spans[0].slice()];
    for (let i = 1; i < spans.length; i++) {
      const last = merged[merged.length - 1];
      if (spans[i][0] <= last[1]) last[1] = Math.max(last[1], spans[i][1]);
      else merged.push(spans[i].slice());
    }
    return merged;
  }

  const _camSpace = new THREE.Vector3();
  const _world = new THREE.Vector3();

  /**
   * Resolves a screen-space anchor to a world position AND the scale that
   * makes the prop fill, but never exceed, its free band.
   *
   * @param {object} anchor  sampled anchor {side,x,y,z}
   * @param {object} opts    { sectionId, camera, scrollY, halfW, halfH, fitMax, out }
   * @returns {{x,y,z,scale,safe}} NDC-free world placement
   */
  function resolve(anchor, opts) {
    const G = TUNING.gutters;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { camera, sectionId, scrollY, out: target } = opts;

    /* --- 1. Find the free band at this height, and the viewport-safe edges --- */
    const bandHalf = vh * G.bandVh * 0.5;
    const yPage = (1 - anchor.y) * 0.5 * vh + scrollY;
    const spans = measured ? occupiedIn(sectionId, yPage - bandHalf, yPage + bandHalf) : [];

    const padX = (G.edgePadPx * 2) / vw;          /* px -> NDC */
    const padY = (G.edgePadPx * 2) / vh;
    const outerR = 1 - padX;
    const outerL = -1 + padX;
    const outerT = 1 - padY;
    const outerB = -1 + padY;

    let innerR = outerR;   /* inner edge of the free band (text side) */
    let innerL = outerL;
    if (spans.length) {
      innerR = clamp((spans[spans.length - 1][1] + G.marginPx) / vw * 2 - 1, outerL, outerR);
      innerL = clamp((spans[0][0] - G.marginPx) / vw * 2 - 1, outerL, outerR);
    }

    const wantRight = anchor.side === 'right';
    const freePx = wantRight ? (outerR - innerR) * 0.5 * vw : (innerL - outerL) * 0.5 * vw;
    const safe = freePx < G.minFreePx;

    /* --- 2. Clamp the preferred x into its own gutter --- */
    let xNdc;
    if (wantRight) {
      xNdc = safe ? outerR : clamp(anchor.x, innerR, outerR);
    } else {
      xNdc = safe ? outerL : clamp(anchor.x, outerL, innerL);
    }

    /* --- 3. Unproject to world space, anchored to the camera --- */
    const dist = camera.position.z + G.baseDistance + anchor.z + (safe ? G.safeDepth : 0);
    const halfViewH = Math.tan((camera.fov * Math.PI) / 360) * dist;
    const halfViewW = halfViewH * camera.aspect;
    _camSpace.set(xNdc * halfViewW, anchor.y * halfViewH, -dist).applyQuaternion(camera.quaternion);
    _world.copy(camera.position).add(_camSpace);

    /* --- 4. Fit: the scale at which the prop fills its band, no more ---
     * The prop is centred in the band, so the authored x only nudges it. This
     * is what keeps it whole inside the gutter on any aspect ratio. */
    const halfW = Math.max(opts.halfW || 0.001, 0.001);
    const halfH = Math.max(opts.halfH || 0.001, 0.001);
    const halfWNdc = halfW / halfViewW;
    const halfHNdc = halfH / halfViewH;
    const bandW = wantRight ? (outerR - innerR) : (innerL - outerL);
    const fit = safe
      ? G.safeScale
      : Math.min(
          opts.fitMax ?? Infinity,
          (bandW * G.fill) / (2 * halfWNdc),
          ((outerT - outerB) * G.fill) / (2 * halfHNdc)
        );

    if (!safe) {
      const centre = wantRight ? (innerR + outerR) * 0.5 : (outerL + innerL) * 0.5;
      const nudged = wantRight
        ? clamp(anchor.x, innerR, outerR)
        : clamp(anchor.x, outerL, innerL);
      xNdc = lerp(centre, nudged, 0.30);
      _camSpace.set(xNdc * halfViewW, anchor.y * halfViewH, -dist).applyQuaternion(camera.quaternion);
      _world.copy(camera.position).add(_camSpace);
    }

    target.x = _world.x;
    target.y = _world.y;
    target.z = _world.z;
    target.scale = fit;
    target.safe = safe;
    return target;
  }

  return {
    out,
    sample,
    computeProgress,
    resolve,
    remeasure,
    measureAnchors,
    measureContent,
    measureFocalCards,
    focalY,
    get anchors() { return anchors; },
    get measured() { return measured; },
    get focalCards() { return focalCards; },
  };
}
