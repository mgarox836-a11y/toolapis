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
   * small lime accents, never by a bright ambient wash.
   * NOTE: the page background is CSS, so exposure can only ever DARKEN the
   * props — it can never lift the black of the page. That is why the
   * per-section dim is applied to the materials (emissive / rim) and not to
   * the canvas, and why `near` and `far` stay close together. */
  exposure: {
    near: 0.85,   // hero
    far:  0.66,   // clarity
  },
  lights: {
    key:  0.75,   // soft white directional
    lime: 9.0,    // accent point light
    kick: 4.5,    // opposite-side accent kicker
    hemi: 0.10,   // shadow-side fill — anything higher greys out the blacks
  },
  env: { enabled: true, intensity: 0.20 },

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

  /* ==== Bloom ====
   * DISABLED BY DEFAULT, ON PURPOSE. UnrealBloomPass composites additively
   * over the whole frame; on a canvas whose clear alpha is 0 that lifts the
   * transparent black to a uniform grey haze and the page stops being
   * #0B0F12 (the "butek" cast). The emissive glow that bloom was only
   * exaggerating is already carried by the Fresnel rim + the lime materials +
   * the additive ground sprite, so nothing is lost visually.
   *
   * To bring it back: set enabled = true AND keep threshold >= 0.9, so only
   * the lime emissive parts pass the high-pass. A lower threshold lifts the
   * blacks no matter what. */
  bloom: {
    enabled: false,
    strength: 0.42,
    radius: 0.62,
    threshold: 0.90,
  },

  /* ==== Background props (js/objects.js -> createBackgroundProps) ====
   * These live BEHIND every section, so every one of them is a direct
   * contributor to the page's apparent colour. All of them are therefore
   * near-invisible by construction: they may only add a whisper of lime at
   * the very bottom edge, never a full-screen wash. */
  background: {
    /* wireframe icosahedron + two orbit rings */
    wire: {
      opacity: 0.055, radius: 5.2, z: -20, tube: 0.016,
    },
    ring: {
      opacity: 0.05, radiusA: 7.4, radiusB: 9.2, tube: 0.012, z: -19,
    },
    /* additive ground glow: small, low, and at most 0.12 of the frame */
    groundGlow: {
      opacity: 0.12, sizeX: 24, sizeZ: 11, y: -5.4, z: -2.5,
      core: 0.55, mid: 0.16, edge: 0.0,   /* canvas gradient stops */
    },
  },

  /* ==== Float / spin ==== */
  float: { amp: 0.16, speed: 0.42, spin: 0.11 },

  /* ==== Mouse parallax ==== */
  parallax: { strength: 0.50, damping: 4.5 },

  /* ==== Scroll ==== */
  scroll: {
    damping: 5.0,
    /* When a prop's damped anchor has drifted more than `lagCapPx` (screen
       pixels) from its freshly solved target — a fast scroll, or a free band
       moving — it chases harder so it cannot sit visibly behind the copy it
       was placed beside. `lagFastDamping` is the recovery rate. */
    lagCapPx:       120,
    lagFastDamping: 16,
  },

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

  /* ==== Particles: 3 depth layers in one draw call ====
   * Additive, so every point is a little lime added to the page. Kept faint
   * on purpose: the field should read as dust in a black room, never as a
   * uniform lift. */
  particles: {
    count:        900,
    countTablet:  420,
    countMobile:  200,
    size:        0.050,
    opacity:     0.40,
    layers: 3,
    /* per-layer z band centre + radius, and drift multiplier */
    layerZ:  [-2.0, 3.0, 9.0],
    layerSpread: [7.0, 11.0, 17.0],
    layerDrift: [1.0, 0.62, 0.34],
    twinkle: 0.55,
  },

  /* ==== Obstacle measurement + candidate search (phase (a)) ====
   *
   * An obstacle is the REAL extent of something the visitor reads: the line
   * boxes of a heading or a paragraph (Range.getClientRects), the box of a
   * card, pill or icon. Never the full-width section container, which used to
   * measure as a wall from margin to margin and left no gutter at all.
   * Every rect is grown by `rectPadPx` at measure time, so "clear" already
   * means "clear with air around it".
   *
   * `gutters` holds the MEASUREMENT and the SEARCH parameters; `props` (below)
   * holds the SIZE and EDGE rules a designer is most likely to touch.
   */
  gutters: {
    rectPadPx:     24,   // every measured obstacle is grown by this on all sides
    marginPx:      18,   // breathing room between prop and a rect edge
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
    baseDistance:   6.0,   // prop distance from the camera before anchor.z
    /* Vertical band search: candidate heights are the CENTRES of the free
       bands found at the prop's own x-range, plus the authored anchor. That
       is what puts a prop in the empty gap between two sections instead of on
       top of the copy that surrounds it. */
    bandStepVh:   0.16,   // fallback ladder step, in viewport heights
    bandLadder:      6,   // how many ladder steps either way, as a last resort
    /* NDC x candidates, |x|. The preferred side is tried first, so a prop
       keeps its authored side whenever anything works on it. */
    candidateX: [0.86, 0.70, 0.54, 0.36, 0.18, 0.0],
    /* A dim a prop takes when it has to sit behind a translucent card. */
    softDim:      0.62,
    /* Minimum NDC gap between two props' boxes, so they never intersect. */
    minSeparation: 0.14,
  },

  /* ==== Per-prop size + edge rules ====
   * The clearance solve runs per frame, and an unbounded "fill the band" rule
   * is how a prop ends up covering the copy it was meant to sit beside. These
   * make the size absolute and, just as importantly, make it a FLOOR:
   *
   *   maxScreenFraction  never wider than 30% of the viewport width
   *   minScreenFraction  a prop sizes to at LEAST 16% of the viewport width...
   *   minScreenPx        ...and never below 150px on the desktop tier. That
   *                      absolute floor is the one the edge-docking rule below
   *                      is allowed to fall back to, which is what guarantees
   *                      "a prop is always visible in every section" even
   *                      where a full-width card row leaves no gutter.
   *   minOpacity         a prop is never dimmed below this
   *   edgePadPx          breathing room between a prop and the viewport edge
   *   edgeCropMax        last resort: a prop may dock flush against a LEFT or
   *                      RIGHT edge with up to this much of its width cropped
   *                      by the screen (side edges only, never top/bottom,
   *                      and never over copy)
   * The gap between two props is `gutters.minSeparation` — one number, one
   * place, so it can never disagree with itself.
   */
  props: {
    maxScreenFraction: 0.30,
    minScreenFraction: 0.16,
    minScreenPx:    150,
    minOpacity:    0.75,
    edgePadPx:      32,
    edgeCropMax:   0.35,
    /* The vertical MIDDLE BAND. A prop stays inside it by construction: its
       centre is clamped between `bandTop` and `bandBottom` (viewport
       fractions), its box is REJECTED the moment it crosses `bandBottom`, and
       the candidate scoring pulls its centre toward `preferredCenter`. That
       is the guarantee behind "always visible in the middle of the page" —
       before this, a low authored anchor was free to sit a prop in the bottom
       40% of the viewport, behind a card row or a footer border. */
    bandTop:          0.18,  // centre never sits higher than this viewport fraction
    bandBottom:       0.80,  // the box is rejected as soon as it crosses this
    preferredCenter:  0.48,  // scoring pulls the centre toward this fraction
    centerWeight:     3.0,   // how hard that pull is, relative to all the others
    /* Smooth falloff before the band edge: a prop whose box approaches
       `bandBottom` (the footer / last section) dissolves over this distance
       instead of being sliced by a hard line. Fades combine with the band,
       never hard cuts. */
    footerFadePx:   180,
    /* A single stop may cap one prop further via `anchors.<key>.sizeCap` (a
       multiplier on maxScreenFraction) — used to hold the Flow HD frame at
       ~22% of the viewport instead of the full 30% cap. */
    hd:      { fit: 3.2, maxWorldScale: 2.2 },
    /* `cableOutward` yaws the whole plug so its long axis (and the cable)
       points AWAY from the text column, and the cable geometry itself is
       short, so in the hero it curls out of frame instead of across the
       headline. */
    usb:     { fit: 2.4, maxWorldScale: 2.2, cableOutward: true, yaw: 1.05 },
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
    /* HERO COMPOSITION (issue 3)
     * The copy column is centred, so both gutters are real: the headline's
     * measured text extent is narrower than its `max-w-3xl` box, which is what
     * leaves room for three props at full size.
     *   usb     left gutter, well clear of the headline; its cable yaws
     *           OUTWARD (see props.usb.cableOutward) so it curls away from
     *           the text instead of across it
     *   hd      right gutter, sized by the solver to 22-28% of the viewport
     *   network upper right, ABOVE the HD frame with gutters.minSeparation
     *           between the two boxes (the solver rejects any anchor whose
     *           box would touch an already-placed prop) */
    anchors: {
      hd:      { side: 'right', x:  0.76, y: -0.10, z:  0.0, scale: 0.94, dim: 1.00 },
      usb:     { side: 'left',  x: -0.78, y: -0.34, z: -0.4, scale: 0.96, dim: 0.95 },
      network: { side: 'right', x:  0.68, y:  0.66, z: -1.8, scale: 0.42, dim: 0.85 },
    },
  },
  {
    id: 'overview',
    cam: [0.5, -0.4, 9.2], look: [0, 0.30, 0], fov: 44, yaw: 0.28,
    /* USB left, HD right, constellation upper right — one prop per gutter
       position, never on the cards. */
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
    /* One focal object per card: each prop takes the HEIGHT of the card that
       describes it and then finds a free column (or the free band above /
       below the grid) beside it, so the 3D mirrors the copy being read. */
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
    /* The diagonal lineup stays, but it is lifted out of the step row: the
       props ride the EMPTY strip between the heading/paragraph and the three
       steps (30%-65% of the viewport), never the steps themselves. The HD
       frame is size-capped here so it can no longer sprawl over "You're
       done" — it reads as a prop, not as the tower it used to be. */
    focal: 0, lineup: 1, converge: 0,
    flow: 1,
    anchors: {
      hd:      { side: 'right', x:  0.74, y:  0.22, z: -0.6, scale: 1.00, dim: 0.90, sizeCap: 0.74 },
      usb:     { side: 'left',  x: -0.76, y: -0.22, z:  0.0, scale: 1.00, dim: 1.00 },
      network: { side: 'right', x:  0.70, y:  0.42, z: -0.8, scale: 1.00, dim: 0.92 },
    },
  },
  {
    id: 'clarity',
    cam: [0, 0.6, 11.4], look: [0, 0.1, 0], fov: 45, yaw: 0.00,
    /* Calm convergence: the mirrored pair flanking the CTA card at its own
       vertical centre. The third is no longer parked low and centred behind
       the card — the solver rejects anything whose box crosses the bottom of
       the middle band, so nothing trails into the footer border below the
       panel. */
    focal: 0, lineup: 0, converge: 1,
    flow: 0,
    anchors: {
      hd:      { side: 'left',  x: -0.80, y:  0.06, z: -1.0, scale: 0.88, dim: 0.78 },
      usb:     { side: 'right', x:  0.80, y:  0.06, z: -1.0, scale: 0.88, dim: 0.78 },
      network: { side: 'right', x:  0.50, y: -0.10, z: -1.6, scale: 0.80, dim: 0.72 },
    },
  },
];

/* ---------------------------------------------------------------------------
 * Composition targets the weights above blend toward (NDC).
 * -------------------------------------------------------------------------*/

/** Flow: three props on a RISING diagonal (low left -> high right), riding the
 *  free strip between the heading/paragraph and the step row — never the
 *  steps, whose real extents the solver treats as walls. These are all inside
 *  the preferred vertical band, so the solver keeps them at their authored
 *  heights instead of hunting for a gutter at the bottom of the viewport. */
export const LINEUP = {
  usb:     { x: -0.72, y: -0.22 },
  hd:      { x:  0.74, y:  0.22 },
  network: { x:  0.70, y:  0.42 },
};

/**
 * Clarity: a calm, symmetric frame around the CTA card — a mirrored pair
 * flanking the panel at its own vertical centre, the third settling into the
 * free band the solver finds (it is deliberately not parked below the card,
 * where the footer border used to cut it).
 */
export const CONVERGE = {
  hd:      { x: -0.80, y:  0.06 },
  usb:     { x:  0.80, y:  0.06 },
  network: { x:  0.00, y: -0.10 },
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
