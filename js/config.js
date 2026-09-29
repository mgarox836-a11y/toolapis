/* ============================================================================
 * config.js — TOOLAPIS · 3D layer configuration
 * ----------------------------------------------------------------------------
 * The single tuning surface. Every "easy variable" the layer exposes lives
 * here; no other module hard-codes a number that a designer might want to
 * change. Imported by objects.js, scroll.js and scene3d.js.
 *
 * This module has NO imports: it must stay loadable even if three.js fails.
 * ==========================================================================*/

/* Total intro/loader duration in seconds (see js/intro.js, phase (d)). */
export const INTRO_DURATION = 5.0;

/* ---------------------------------------------------------------------------
 * Palette — read from the CSS custom properties when they exist, otherwise
 * mirrored from the tokens the site actually ships:
 *   style.css        -> html/body/.hero-bg background-color: #0B0F12
 *   script.js        -> tailwind.config theme.extend.colors.surface
 *   style.css        -> .btn-accent background: #A3E635
 * The surface value is the page background AND the fog colour; they must stay
 * identical or distant geometry stops dissolving into the page.
 * -------------------------------------------------------------------------*/

function readVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (err) {
    return fallback;
  }
}

/** '#rgb' | '#rrggbb' | 'rgb(a)' -> 0xRRGGBB */
function toHex(value, fallback) {
  const s = String(value || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    return parseInt(m[1].split('').map((c) => c + c).join(''), 16);
  }
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return parseInt(m[1], 16);
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) {
    const to = (n) => Math.round(Math.max(0, Math.min(255, parseFloat(n))));
    return (to(m[1]) << 16) | (to(m[2]) << 8) | to(m[3]);
  }
  return fallback;
}

export const PALETTE = {
  /* Page background + fog. Near-black; the blacks are the design. */
  bg:        toHex(readVar('--surface', '#0B0F12'), 0x0b0f12),
  /* The only accent. Emissive edges, pulses, packets, sweep. */
  accent:    toHex(readVar('--accent-mint', '#A3E635'), 0xa3e635),
  accentHi:  toHex(readVar('--accent-mint-hover', '#BEF264'), 0xbef264),
  /* Glass panel / border, for the darker props so they sit above the fog. */
  card:      toHex(readVar('--surface-card', '#13191D'), 0x13191d),
  border:    toHex(readVar('--surface-border', '#232D34'), 0x232d34),
  /* Slightly lighter than `card` for the USB metal shell. */
  metal:     0x2a3238,
  white:     0xffffff,
};

export const OBJ_KEYS = ['hd', 'usb', 'network'];

/* ---------------------------------------------------------------------------
 * TUNING
 * -------------------------------------------------------------------------*/

export const TUNING = {
  /* ==== Global object scale (multiplies every prop) ==== */
  objectScale: 1.0,

  /* ==== Lighting / exposure — keep the blacks BLACK ====
   * Exposure is deliberately low: props are lit by a single soft key plus two
   * small lime accents, never by a bright ambient wash. */
  exposure: {
    near: 0.82,   // hero
    far:  0.50,   // clarity
  },
  lights: {
    key:  0.75,   // soft white directional
    lime: 9.0,    // accent point light
    kick: 4.5,    // opposite-side accent kicker
    hemi: 0.10,   // shadow-side fill — anything higher greys out the blacks
  },
  env: { enabled: true, intensity: 0.30 },

  /* ==== Fog ====
   * FogExp2 densities, not linear near/far. The colour MUST equal
   * PALETTE.bg or distant geometry stops dissolving into the page. */
  fog: {
    color: PALETTE.bg,
    densityNear: 0.030,  // hero
    densityFar:  0.052,  // clarity
  },

  /* ==== Renderer ==== */
  fov: 42,
  near: 0.1,
  far: 120,
  maxPixelRatio: 1.5,          // desktop cap (Intel iGPU target)
  mobileMaxPixelRatio: 1.25,
  antialias: true,

  /* ==== Bloom — desktop tier only ==== */
  bloom: {
    enabled: true,
    strength: 0.42,
    radius: 0.62,
    threshold: 0.80,
  },

  /* ==== Float / spin ==== */
  float: { amp: 0.16, speed: 0.42, spin: 0.11 },

  /* ==== Mouse parallax ==== */
  parallax: { strength: 0.50, damping: 4.5 },

  /* ==== Scroll ==== */
  scroll: { damping: 5.0 },

  /* ==== Scroll velocity effects (phase (c)) ==== */
  velocity: {
    spin:  2.2,     // extra world-Y rotation per normalised velocity unit
    tilt:  0.20,    // extra rotation.z
    stretch: 0.10,  // extra scale along the scroll axis (scale.z)
    streak: 1.0,    // particle streak length at full velocity
    damping: 6.0,
    max:  2600,     // px/s that counts as "full" velocity
  },

  /* ==== Hover ==== */
  hover: { scale: 1.10, glow: 2.4, spinMul: 2.4, damping: 6.0 },

  /* ==== When a hero button/card is hovered, that prop is the FOCUS and the
   * other two step back, so the reaction reads as a spotlight. ==== */
  focus: { dimOthers: 0.55, damping: 7.0 },

  /* ==== Raycast / click-to-scroll ==== */
  pointer: {
    /* Skip the raycast when the pointer is over an interactive DOM element —
       those have their own hover reactions, and the canvas is behind them. */
    throttled: true,
    clickScroll: true,
  },

  /* ==== Particles: 3 depth layers in one draw call ==== */
  particles: {
    count:        900,
    countTablet:  420,
    countMobile:  200,
    size:  0.050,
    opacity: 0.50,
    layers: 3,
    /* per-layer z band centre + radius, and drift multiplier */
    layerZ:  [-2.0, 3.0, 9.0],
    layerSpread: [7.0, 11.0, 17.0],
    layerDrift: [1.0, 0.62, 0.34],
    twinkle: 0.55,
  },

  /* ==== Text / card clearance solver (phase (a)) ====
   * A prop may only sit in a horizontally free band at its own height, and it
   * may never cross a TEXT rect or a CARD rect. Every measured rect is grown
   * by `rectPadPx` on every side, so "clear" really means clear. Cards are
   * hard obstacles like text: a prop behind a translucent card reads as a
   * rendering bug, not as depth.
   *
   * If the band is narrower than `minFreePx` there is nowhere safe to put the
   * prop, so it drops into `safe` mode: pushed far back, shrunk and dimmed.
   *
   * The two SIZE caps are hard and always win, in this order:
   *   1. `props.maxScreenFraction` — the prop's box fits in a square of that
   *      fraction of the VIEWPORT WIDTH (0.32 -> never wider than a third of
   *      the screen, whatever the band or the aspect ratio).
   *   2. `props[key].maxWorldScale` — the per-prop ceiling in world units.
   * Below them sits the `fill` TARGET (0.55 of the free band), which is what
   * a prop sizes to when it has room, and `minOnScreenPx`, the floor below
   * which a prop is not worth drawing at all. */
  gutters: {
    minFreePx:     90,   // narrower than this -> safe mode
    marginPx:      26,   // breathing room between prop and a rect edge
    rectPadPx:     24,   // every measured obstacle is grown by this on all sides
    edgePadPx:     32,   // breathing room between prop and the viewport edge
    /* The sticky header is a RESERVED BAND, never a clip. `#navbar` is
       `position: fixed` and paints an opaque (0.8 alpha) strip over the
       canvas once it is solid, so a prop that reaches into it is cut by a
       hard straight edge. The band is measured from the real navbar height
       (floor: this value) and the solver keeps every box below it; a prop
       close to the band fades out over `headerFadePx` instead of ending
       abruptly, so there is never a cut. Only reserved while the navbar is
       actually solid (js/scene3d.js watches the `nav-solid` class). */
    headerReservePx:  88,
    headerPadPx:      16,  // extra breathing room under the measured navbar
    headerFadePx:    160,  // dim ramp over this distance below the band
    /* Full-box clearance. The band solve is horizontal, so a prop whose
       solved half-height is taller than the query band used to spill over the
       text above and below it. These govern the pass that walks the WHOLE box
       against every rect of the section the prop is in AND the one it is
       travelling to, shrinking it until it is clear. */
    verticalClearPadPx: 24,  // minimum gap, on every side, at every scroll pos
    shrinkStep:      0.88,   // per-pass shrink while the box still hits copy
    /* Deep enough for a prop to squeeze into a page gutter: 0.88^14 = 0.17, and
       the narrowest real gutter is ~104px, so a full-width card row no longer
       forces the prop to disappear — it shrinks and dims into the gutter, which
       is what `safe` mode already did. The ladder stops at the first clear size,
       so the common case costs one test. */
    shrinkPasses:    14,
    /* How far the clearance pass may walk from the solved height, in
       `searchStepVh` steps, up and down. Reaches past a full-width row of
       cards, which leaves no free column at all and can only be escaped
       vertically. 9 * 0.18 = 1.62 NDC, i.e. the whole viewport. */
    clearSearchSteps: 9,
    /* Props must stay FULLY inside the viewport, so there is no edge bleed.
       Set to 0 deliberately; `searchStepVh` below is what makes room instead. */
    edgeOverlapPx:   0,
    bandVh:      0.22,   // query band height, as a fraction of viewport h
    /* Vertical band search: when the authored anchor lands on a full-width
       text row the solver walks these steps away from it looking for the
       widest free band, so a prop lands in the gap between rows instead of
       collapsing into safe mode. */
    searchStepVh:  0.18,
    baseDistance:  6.0,  // prop distance from the camera before anchor.z
    /* Share of its free band a prop aims for. A TARGET, not a maximum: the
       size caps above it are absolute. */
    fill:         0.55,
    minFill:      0.40,
    minOnScreenPx: 150,   // floor for "a prop you can actually see"
    /* Soft cards dim a prop that sits behind them. */
    softDim:      0.55,
    safeScale:   0.55,
    safeDim:     0.45,
    safeDepth:  -3.2,    // extra world-Z push-back in safe mode
    /* Minimum NDC gap between two props' boxes, so they never intersect. */
    minSeparation: 0.16,
  },

  /* ==== Per-prop size caps ====
   * The clearance solve runs per frame, and an unbounded "fill the band"
   * rule is how a prop ends up covering the copy it was meant to sit beside.
   * These caps make the size absolute:
   *   maxScreenFraction  prop box <= 0.32 x viewport width (both axes, so the
   *                      box stays inside that square at any aspect ratio)
   *   maxWorldScale      per-prop ceiling in world units (the artistic cap)
   *   fill / edgePadPx   mirrored here from `gutters` so a designer can find
   *                      every placement number in one block */
  props: {
    maxScreenFraction: 0.32,
    fill:         0.55,   // share of the free band a prop aims for
    edgePadPx:    32,     // breathing room between prop and viewport edge
    minSeparation: 0.16,  // minimum NDC gap between two props
    hd:      { fit: 3.2, maxWorldScale: 2.2 },
    usb:     { fit: 2.4, maxWorldScale: 2.2 },
    network: { fit: 2.6, maxWorldScale: 2.2 },
  },

  /* ==== Objects hidden on the mobile tier (no side gutters exist there) ==== */
  hideOnMobile: ['hd', 'usb', 'network'],

  /* ==== Adaptive quality: one-way step-down, never oscillates ==== */
  adaptive: {
    sampleFrames: 90,
    fpsFloor:     40,   // below this -> step 1 (pixel ratio)
    fpsCritical:  26,   // below this -> step 2+3 (bloom off, particles cut)
    steps: ['pixelRatio', 'bloom', 'particles'],
  },

  /* ==== Tiers ==== */
  mobileBreakpoint:  768,
  tabletBreakpoint: 1024,
  TIER: {
    desktop: { posScale: 1.00, scaleMul: 1.00, camPush: 0.0, exposureMul: 1.00 },
    tablet:  { posScale: 0.85, scaleMul: 0.88, camPush: 0.6, exposureMul: 0.92 },
    mobile:  { posScale: 0.40, scaleMul: 0.72, camPush: 2.2, exposureMul: 0.80 },
  },

  /* ==== Accessibility / debug ==== */
  showStaticOnReducedMotion: true,
  debug: new URLSearchParams(location.search).get('scene3d') === 'debug',
};

/* ---------------------------------------------------------------------------
 * Per-section exposure. 1.0 = hero, lower = further back / quieter.
 * -------------------------------------------------------------------------*/

export const EXPOSURE_PER_SECTION = {
  hero:     1.00,
  overview: 0.92,
  features: 0.78,
  flow:     0.74,
  clarity:  0.62,
};

export const SECTION_IDS = ['hero', 'overview', 'features', 'flow', 'clarity'];

/* ---------------------------------------------------------------------------
 * Per-section composition.
 *
 * `anchors` are SCREEN-SPACE (normalised device coordinates, -1..1) rather than
 * world positions, so a prop keeps its place in the side gutter at any aspect
 * ratio. `x` is the preferred position on `side`; scroll.js measures the real
 * text rectangles and clamps x into whichever band is actually free.
 *
 *   side   'left' | 'right'   which gutter this prop prefers
 *   x      -1..1              preferred NDC x
 *   y      -1..1              NDC y (0 = vertical centre)
 *   z      world              depth offset from the prop's home position
 *   scale  multiplier on TUNING.objects[key].scale
 *   dim    extra multiplier on the glow (features pushes the others back)
 *
 * The three per-stop WEIGHTS give every section its own composition and are
 * blended together like everything else, so scrolling between sections
 * cross-fades between compositions rather than snapping:
 *
 *   focal    1 = snap each prop onto the Features card that describes it
 *   lineup   1 = the Flow "diagonal lineup": three props on a rising diagonal
 *   converge 1 = the Clarity "calm convergence": a symmetric, still row
 * ==========================================================================*/

export const STOPS = [
  {
    id: 'hero',
    cam: [0, 0.15, 8.4], look: [0, 0.05, 0], fov: 42, yaw: 0.00,
    focal: 0, lineup: 0, converge: 0,
    /* The network sits HIGH in the right gutter, well clear of the HD frame
       below it. Two props share this gutter, so the network carries a small
       scale and gutters.minSeparation guarantees the gap at any viewport. */
    anchors: {
      hd:      { side: 'right', x:  0.72, y: -0.16, z:  0.0, scale: 0.88, dim: 1.00 },
      usb:     { side: 'left',  x: -0.72, y: -0.30, z: -0.4, scale: 0.96, dim: 0.95 },
      network: { side: 'right', x:  0.66, y:  0.74, z: -1.8, scale: 0.40, dim: 0.85 },
    },
  },
  {
    id: 'overview',
    cam: [0.5, -0.4, 9.2], look: [0, 0.30, 0], fov: 44, yaw: 0.28,
    focal: 0, lineup: 0, converge: 0,
    anchors: {
      hd:      { side: 'right', x:  0.78, y:  0.26, z:  0.2, scale: 0.92, dim: 0.90 },
      usb:     { side: 'left',  x: -0.78, y: -0.30, z: -0.6, scale: 0.90, dim: 0.88 },
      network: { side: 'right', x:  0.66, y: -0.30, z: -2.0, scale: 0.86, dim: 0.80 },
    },
  },
  {
    id: 'features',
    cam: [1.8, 1.2, 10.0], look: [0, -0.20, 0], fov: 46, yaw: -0.42,
    /* One focal object per card: each prop is pulled onto the tile that
       describes it, so the 3D mirrors the copy the visitor is reading. */
    focal: 1, lineup: 0, converge: 0,
    anchors: {
      hd:      { side: 'right', x:  0.82, y:  0.44, z:  0.8, scale: 1.00, dim: 1.05 },
      usb:     { side: 'left',  x: -0.82, y: -0.40, z: -1.0, scale: 1.00, dim: 0.95 },
      network: { side: 'right', x:  0.74, y: -0.44, z: -2.2, scale: 1.00, dim: 0.85 },
    },
  },
  {
    id: 'flow',
    cam: [-2.0, -0.5, 10.4], look: [0, 0.45, 0], fov: 47, yaw: 0.62,
    /* Diagonal lineup, and the section where the flow links ignite. */
    focal: 0, lineup: 1, converge: 0,
    flow: 1,
    /* Rising diagonal: USB low-left, HD mid-right, network high-right.
       Only two props ever share a gutter, which is what the separation pass
       in the solver is sized for. */
    anchors: {
      hd:      { side: 'right', x:  0.80, y:  0.02, z: -0.6, scale: 1.00, dim: 0.90 },
      usb:     { side: 'left',  x: -0.78, y: -0.62, z:  0.0, scale: 1.00, dim: 1.00 },
      network: { side: 'right', x:  0.70, y:  0.68, z: -0.8, scale: 1.00, dim: 0.92 },
    },
  },
  {
    id: 'clarity',
    cam: [0, 0.6, 11.4], look: [0, 0.1, 0], fov: 45, yaw: 0.00,
    /* Calm convergence: one shared baseline, symmetric, almost still. */
    focal: 0, lineup: 0, converge: 1,
    flow: 0,
    /* Symmetric: HD and USB mirror each other at the same height, and the
       network sits calm and low in the centre, clear of the CTA card. */
    anchors: {
      hd:      { side: 'left',  x: -0.80, y:  0.34, z: -1.0, scale: 0.88, dim: 0.78 },
      usb:     { side: 'right', x:  0.80, y:  0.34, z: -1.0, scale: 0.88, dim: 0.78 },
      network: { side: 'right', x:  0.66, y: -0.52, z: -1.6, scale: 0.80, dim: 0.72 },
    },
  },
];

/* ---------------------------------------------------------------------------
 * Composition targets the weights above blend toward (NDC).
 * -------------------------------------------------------------------------*/

/** Flow: three props on a rising diagonal, so the links read as a pipeline. */
export const LINEUP = {
  hd:      { x: -0.70, y:  0.42 },
  usb:     { x:  0.02, y:  0.02 },
  network: { x:  0.70, y: -0.34 },
};

/**
 * Clarity: a calm, symmetric frame around the CTA card — a mirrored pair
 * flanking the panel, with the third resting high and quiet above them.
 */
export const CONVERGE = {
  hd:      { x: -0.74, y:  0.02 },
  network: { x:  0.74, y:  0.02 },
  usb:     { x:  0.00, y:  0.66 },
};

/**
 * Features card -> prop. Index is the DOM order of `.spot-card` inside
 * #features; the keys are the prop names. The third card ("Web-first") maps to
 * the network constellation: the whole site is the network, and the card is
 * the one that talks about shipping tools.
 */
export const FOCAL_CARDS = ['hd', 'usb', 'network'];

/** Prop -> the Features card it belongs to, used by click-to-scroll. */
export const FOCAL_TARGET = { hd: 'features', usb: 'features', network: 'features' };

/** exposure multiplier for a stop id, with a safe default. */
export function exposureFor(id) {
  return EXPOSURE_PER_SECTION[id] ?? 0.8;
}
