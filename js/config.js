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
    /* Faint COOL key (cyan): the shape is read by the rims and the warm fill,
       never by the key itself — the room stays the near-black the design owns.
       Painterly warmth arrives from below (kick) and from the mapped fill.
       The extra gloss the premium look needs comes from the studio env bake
       (`env`), so the real lights stay deliberately starved. */
    keyColor: 0xa8c8dd,
    key: 0.55,
    lime: 9.0,    // accent point light
    /* Low warm side kicker, oriented along X: the shadow side of a prop gets a
       quiet warm lift so the blacks stay black without reading dead. */
    kickColor: 0xe8a06a,
    kick: 4.0,
    hemi: 0.08,   // shadow-side fill — anything higher greys out the blacks
    /* The painterly 6200K the "dims" are mapped onto: used as the hemisphere
       SKY colour, so the fill every dark side of a prop sits under is warm and
       the fade bands read as a warm dissolve rather than a grey one. */
    mappedColor: 0xd9b98a,
    /* Scene-wide rim floor. Every material that ALREADY opts into a rim keeps
       its authored value unless it is below this, in which case it is lifted.
       Authored zero-rims (holes, plain plate) stay zero — the floor thickens
       the rims, it never invents one. 0 = unchanged. */
    rimFloor: 0.95,
  },

  /* ==== Custom studio environment (js/scene3d.js -> createEnvironment) ====
   * The premium gloss comes from a procedural dark-room bake, not from the
   * generic RoomEnvironment: a soft cool strip high/front, a dim warm kicker
   * low/back and a thin lime top strip, all rendered into a PMREM cube via a
   * throwaway scene. `intensity` is what every material multiplies its
   * envMapIntensity by (PALETTE.black multiplies nothing); `stripIntensity`
   * and `limeStrip` scale the two studio contributions inside the bake. */
  env: {
    enabled: true,
    intensity: 0.20,
    stripIntensity: 1.0,   // × the cool key strip in the bake
    limeStrip: 1.0,        // × the lime top strip in the bake
  },

  /* ==== Fresnel rims (js/objects.js -> addRim) ====
   * Multipliers on top of every authored rim. `thickness` scales the power
   * (>1 = sharper falloff = thinner, crisper edge), `intensity` scales the
   * strength/amount. Each is a plain × on the authored value: 1/1 is exactly
   * the authored rim, and the rim floor still lifts nothing below it. */
  rim: { thickness: 1.15, intensity: 1.1 },

  /* ==== Tone mapping ====
   * 'aces' (current) or 'agx' (also in the pinned r160 build). Both are
   * filmic; ACES stays the default because it is what the page has shipped. */
  toneMapping: 'aces',

  /* ==== Halo glow sprites (js/objects.js) ====
   * Additive radial sprites behind the key emissive parts, carrying the
   * "bloom without bloom" glow. `size` scales the sprite, `opacity` is the
   * base alpha the per-prop glow multiplies. */
  halo: { enabled: true, size: 1.0, opacity: 0.5 },

  /* ==== Per-prop material personality (js/objects.js) ====
   * The builders' defaults. `makeGlossy`/`makeMetal` use these when the
   * builder did not hand-tune a value, so one number here re-tunes a whole
   * prop. The USB anisotropy is the r160 brushed-metal highlight along X. */
  materials: {
    hd:      { roughness: 0.28, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 },
    usb:     { roughness: 0.32, metalness: 0.90, clearcoat: 0.35, clearcoatRoughness: 0.16,
               anisotropy: 0.55, anisotropyRotation: 0 },
    network: { roughness: 0.14, metalness: 0.50, clearcoat: 1, clearcoatRoughness: 0.06 },
    /* procedural micro-noise / brushed textures: on/off and their strengths */
    noise: { maps: true, uvScale: 6.0, brushUvScale: 2.0, strength: 0.55 },
  },

  /* ==== Emissive (the lime signal) ====
   * The bright element the bloom high-pass would catch. `color` is the signal
   * green every emissive material is drawn with — the warm lime the mission
   * pinned at rgb(.20/.92/.30) rather than the page accent, which is a UI
   * colour. The emissive reads as LIGHT the prop omits; the accent reads as
   * paint. */
  emissive: { color: 0x33EB4D },

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

  /* ==== Prop entrance (the intro's bottom-rise fly-in) =====================
   *
   * Everything the intro arrival does, in one place. The entrance is ADDITIVE:
   * it is applied AFTER the solver writes its anchor and after every damp, as
   * a screen-space offset converted to world units at the prop's own depth, so
   * the solver's committed pose is never touched and the authored anchors are
   * never altered. Each prop gets its own clock, so the stagger is exact and a
   * frame hitch can never drift the animation.
   *
   *   delay         ms after the curtain starts rising before the first prop moves
   *   duration      full 5s intro: ms per prop (curtain rises ~3.6s -> done ~5.1s)
   *   hashDuration  the short 1.5s intro (deep link / no WebGL): ms per prop
   *   stagger       ms between prop starts
   *   riseFraction  how far below its place each prop starts, as a fraction of
   *                 the viewport HEIGHT (0.006 ~= 0.6vh)
   *   overshoot     the easeOutBack back amount (small: read as a pop, not a wobble)
   *   startScale    props arrive at this scale and grow to 1
   *   startRotY     radians, ~25 degrees of world-Y added while arriving
   *
   * Reduced motion never runs this: the props sit in their final, correct pose
   * from the first frame. The independent 5.5s failsafe in <head> force-applies
   * the final pose through `html.reveal-all`, and `failAtMs` is the scene's own
   * backstop when that timer (or the intro) never arrives.
   * ----------------------------------------------------------------------- */
  entrance: {
    order: ['hd', 'usb', 'network'],
    delay: 120,
    duration: 1300,
    hashDuration: 900,
    stagger: 120,
    riseFraction: 0.006,
    overshoot: 0.16,
    startScale: 0.85,
    startRotY: 0.436,            /* radians ≈ 25° */
    failAtMs: 5200,
  },

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

  /* ==== Rotation clamps (scene truth: the props never leave their gutter) ====
   * The self-spin, the scroll-kick and the entrance yaw are all kept within
   * `maxYaw` (±28°) of the section's AUTHORED facing (`state.yaw`), so a prop
   * may be discovered from the side but can never wander off its column while
   * the solver is busy keeping it on screen. `maxTilt` (±8°) caps the bob and
   * the velocity kick on rotation.z, so a fast scroll can never lay a prop
   * back over the camera. Both in RADIANS — and applied AFTER the entrance
   * adds its own 25°, so the composed pose always lands inside the budget. */
  rotation: { maxYaw: 0.488, maxTilt: 0.14 },

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

  /* ==== Obstacle measurement (phase (a)) ====
   *
   * An obstacle is the REAL extent of something the visitor reads: the line
   * boxes of a heading or a paragraph (Range.getClientRects), the box of a
   * card, pill or icon. Never the full-width section container, which used to
   * measure as a wall from margin to margin and left no gutter at all.
   * Every rect is grown by `rectPadPx` at measure time, so "clear" already
   * means "clear with air around it" — and that same 24px is the padding the
   * authored-anchor validator (see `layout.nudge`) checks against.
   *
   * `gutters` holds the MEASUREMENT parameters; `layout` (below) holds the
   * AUTHORED PLACEMENT they validate; `props` (below) holds the SIZE and EDGE
   * rules a designer is most likely to touch.
   */
  gutters: {
    rectPadPx:     24,   // every measured obstacle is grown by this on all sides
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
    baseDistance:   6.0,   // how far in front of the camera the props sit; the
                           // per-section depth adds to that DISTANCE, and the
                           // solver unprojects to it (never to a remembered z)
    /* A dim a prop takes when it has to sit behind a translucent card. */
    softDim:      0.62,
    /* Minimum GAP in screen px between two props' boxes, so they never
     * intersect. One number, one place, so it can never disagree with itself. */
    minSeparationPx: 28,
    /* The centre-distance rule (the validator's own): two props whose boxes
       share a horizontal BAND must keep their CENTRES at least
       `minSeparationRatio * (sizeA + sizeB)` apart — a ratio on the sizes the
       props actually draw, not on their shared gutters. The edge-gap rule
       above only applies between props sharing the SAME SIDE, so a left prop
       and a right prop may sit on adjacent rows without a 28px moat between
       them, while same-column neighbours keep a hard gap. */
    minSeparationRatio: 0.6,
  },

  /* ==== Per-prop size + edge rules ====
   * The authored size (TUNING.layout) is a starting point; these make it
   * absolute, and just as importantly make it a FLOOR:
   *
   *   maxScreenFraction  never wider than 30% of the viewport width
   *   minScreenFraction  never narrower than 12% of the viewport width...
   *   minScreenPx        ...and never smaller than 150px. The USB plug is a
   *                      small object, so it may sit at minScreenPxUsb.
   *   minOpacity         a prop is never DIMMED below this. An authored
   *                      `opacity: 0` still wins — that is a placement
   *                      decision, not a dim.
   *   edgePadPx          breathing room between a prop and the viewport edge
   *   footerFadePx       a prop whose box approaches the bottom of the visible
   *                      band dissolves over this distance instead of being
   *                      sliced by a hard line. Fades combine with the band,
   *                      never hard cuts.
   * A prop is never made smaller to make it fit: an authored rect that cannot
   * be placed is NUDGED, and if the nudge fails the prop FADES OUT at full
   * size (see TUNING.layout.nudge). These are the FLOORS; the world-scale caps
   * below are the CEILINGS.
   */
  props: {
    maxScreenFraction: 0.30,
    minScreenFraction: 0.12,
    minScreenPx:      150,
    minScreenPxUsb:   130,   // the plug is small; it may sit lower than the rest
    minOpacity:      0.75,
    edgePadPx:        32,
    footerFadePx:    180,
    /* Crop support — STRUCTURE ONLY, and kept dead on purpose.
     * `edgeCropMax` is how much of a prop's box may sit PAST the viewport
     * edge (beyond `edgePadPx`) and still pass the validator's rect check —
     * a prop drawn cropped off the side instead of faded or nudged. It is 0,
     * so NO prop is ever cropped: the validator still demands the whole box
     * inside the band, and the solver still measures `croppedPx` on every
     * candidate so the debug overlay can always show the crop a nonzero value
     * would have allowed. The guard is the screen's vertical centre line: a
     * prop may only crop the edge on the SIDE its centre already sits on, so
     * cropping can never drag a right-side prop half off the left edge. */
    edgeCropMax:      0,
    /* `maxWorldScale` is SOFT — it keeps the authored size in check, and the
       size floor below outranks it, so a floor is always reachable. `fit` is
       the hard ceiling: it comes from the measured box. */
    hd:      { fit: 3.2, maxWorldScale: 2.2 },
    /* `cableOutward` yaws the whole plug so its long axis (and the cable)
       points AWAY from the text column, and the cable geometry itself is
       short, so in the hero it curls out of frame instead of across the
       headline. */
    usb:     { fit: 2.4, maxWorldScale: 2.2, cableOutward: true, yaw: 1.05 },
    network: { fit: 2.6, maxWorldScale: 2.2 },
  },

  /* ==== AUTHORED LAYOUT + VALIDATOR ====
   *
   * Placement is AUTHORED, not searched. Every section says where each prop
   * sits, in VIEWPORT FRACTIONS, and the solver's only job is to check that
   * decision and rescue it when the page underneath disagrees:
   *
   *   x      0..1   centre of the prop, as a fraction of the viewport width
   *   y      0..1   centre of the prop, as a fraction of the viewport HEIGHT
   *                 (0 = the top edge, 1 = the bottom edge)
   *   size   0..1   how big the prop reads, as a fraction of the viewport
   *                 width: the DOMINANT dimension of its projected box, so a
   *                 tall prop and a wide one are both sized by what you see
   *                 (and a prop mid-spin cannot slip under the size floor)
   *   opacity 0..1   0 = authored HIDDEN in this section. It is still
   *                 validated, and it is damped, so it fades rather than cuts.
   *   alt    { x, y, size }  a second authored position, tried when the first
   *                 one collides — how a prop moves from the right gutter to
   *                 the left one without a search
   *
   * Three breakpoint variants per entry (`layoutVariant()` picks one):
   *
   *   desktop  >= breakpoints.desktop (1100px) — the authored composition
   *   tablet   >= breakpoints.tablet  ( 700px)  — at most one prop per
   *                                               section, in a corner
   *   mobile   <   700px                        — authored hidden: the page
   *                                               is a single full-bleed column
   *
   * THE VALIDATOR (js/scroll.js). The prop's projected screen box is compared
   * against the measured obstacles (already padded by gutters.rectPadPx, 24px)
   * and against the props placed before it. On a collision it nudges along the
   * nearest free direction, at most `nudge.maxFrac` of the viewport, trying
   * `alt` first. If nothing inside that budget is free, the prop's opacity
   * goes to 0 for this section: a damped fade at FULL size, never a shrink,
   * never a hard cut.
   *
   * `band` is the vertical band a prop's box must stay inside — from below the
   * reserved sticky-header band down to `band.bottom`, the footer band. A prop
   * fades out over `props.footerFadePx` before either edge, and the footer is
   * ALSO a measured obstacle, so nothing is ever sliced by it.
   */
  layout: {
    breakpoints: { desktop: 1100, tablet: 700 },
    band: { top: 0.06, bottom: 0.93 },
    nudge: {
      maxFrac: 0.15,                                   // of the viewport
      steps: [0.04, 0.08, 0.12, 0.15],                  // fractions of the viewport
      dirs: [[0, -1], [0, 1], [-1, 0], [1, 0],
             [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]],
    },
    /* Obstacle collection rules (js/scroll.js -> measureContent). */
    obstacle: {
      /* Anything wider than this is a WRAPPER, not content: a full-width
       * section, container, grid or row is DROPPED. The one exception is a
       * visible card — a real background or border is content. */
      maxWidthFrac: 0.90,
      /* The footer band. Always an obstacle, in every section, so a prop can
       * never sit on the footer border or on the footer copy. */
      footer: 'footer',
    },

    /* ------------------------------------------------------------------
     * The composition. The desktop values are the authored design; each one
     * carries a comment saying WHY it is there.
     * ------------------------------------------------------------------ */
    sections: {
      /* HERO. The copy column is centred and narrower than the page, so both
       * gutters are real: the plug in the left one with its cable yawed
       * OUTWARD (props.usb.cableOutward) sits lower and smaller, the
       * constellation is higher upper-right, the HD frame sits right and just
       * below it — a tight diagonal across the top-right corner. */
      hero: {
        usb: {
          desktop: { x: 0.09, y: 0.63, size: 0.11 },
          tablet:  { x: 0.12, y: 0.74, size: 0.12 },
          mobile:  { x: 0.14, y: 0.80, size: 0.11, opacity: 0 },
        },
        network: {
          desktop: { x: 0.87, y: 0.20, size: 0.10 },
          tablet:  { x: 0.88, y: 0.20, size: 0.11, opacity: 0 },
          mobile:  { x: 0.90, y: 0.18, size: 0.10, opacity: 0 },
        },
        hd: {
          desktop: { x: 0.88, y: 0.55, size: 0.15 },
          tablet:  { x: 0.86, y: 0.32, size: 0.20 },
          mobile:  { x: 0.88, y: 0.30, size: 0.18, opacity: 0 },
        },
      },

      /* OVERVIEW — the three tool cards. That row spans the full content width
       * at every breakpoint, so there is no side gutter to compose in: the
       * props step into the free strips above and below the row instead, and
       * the validator still fades out whatever the page leaves no room for. */
      overview: {
        hd: {
          desktop: { x: 0.50, y: 0.10, size: 0.13 },
          tablet:  { x: 0.50, y: 0.09, size: 0.14, opacity: 0 },
          mobile:  { x: 0.50, y: 0.09, size: 0.14, opacity: 0 },
        },
        usb: {
          desktop: { x: 0.10, y: 0.90, size: 0.11 },
          tablet:  { x: 0.10, y: 0.92, size: 0.12, opacity: 0 },
          mobile:  { x: 0.10, y: 0.92, size: 0.12, opacity: 0 },
        },
        network: {
          desktop: { x: 0.90, y: 0.90, size: 0.10 },
          tablet:  { x: 0.90, y: 0.92, size: 0.11, opacity: 0 },
          mobile:  { x: 0.90, y: 0.92, size: 0.11, opacity: 0 },
        },
      },

      /* FEATURES — per scroll, the row that is in view. "Small hub"s heading and
       * paragraph sit at the top-left, so the HD frame steps INWARD to the
       * space right of that copy (0.78, higher), the constellation sits just
       * below it inside the same free column, and the plug takes the right
       * gutter between the rows with the LEFT gutter as its authored `alt`
       * when the right one is taken. */
      features: {
        hd: {
          desktop: { x: 0.78, y: 0.24, size: 0.14 },
          tablet:  { x: 0.50, y: 0.12, size: 0.16, opacity: 0 },
          mobile:  { x: 0.50, y: 0.12, size: 0.16, opacity: 0 },
        },
        usb: {
          desktop: { x: 0.90, y: 0.42, size: 0.09, alt: { x: 0.04, y: 0.42 } },
          tablet:  { x: 0.50, y: 0.88, size: 0.13, opacity: 0 },
          mobile:  { x: 0.50, y: 0.88, size: 0.13, opacity: 0 },
        },
        network: {
          desktop: { x: 0.63, y: 0.30, size: 0.10 },
          tablet:  { x: 0.50, y: 0.88, size: 0.12, opacity: 0 },
          mobile:  { x: 0.50, y: 0.88, size: 0.12, opacity: 0 },
        },
      },

      /* FLOW — the free column right of the heading and paragraph, all three
       * props in a tight vertical stack above the step row: the HD frame and
       * the constellation share the top band side by side, the plug drops in
       * below them. Nothing ever goes over the three steps, their icons or
       * their captions. */
      flow: {
        hd: {
          desktop: { x: 0.70, y: 0.27, size: 0.14 },
          tablet:  { x: 0.50, y: 0.14, size: 0.16, opacity: 0 },
          mobile:  { x: 0.50, y: 0.14, size: 0.16, opacity: 0 },
        },
        network: {
          desktop: { x: 0.52, y: 0.27, size: 0.10 },
          tablet:  { x: 0.50, y: 0.88, size: 0.12, opacity: 0 },
          mobile:  { x: 0.50, y: 0.88, size: 0.12, opacity: 0 },
        },
        usb: {
          desktop: { x: 0.88, y: 0.27, size: 0.10 },
          tablet:  { x: 0.50, y: 0.88, size: 0.13, opacity: 0 },
          mobile:  { x: 0.50, y: 0.88, size: 0.13, opacity: 0 },
        },
      },

      /* CLARITY — symmetric about the CTA card's vertical centre: a mirrored
       * pair flanking the panel (the constellation slightly tighter to the
       * panel than the HD frame), nothing under the buttons. The plug is
       * authored HIDDEN: at x0.50/y0.86 it would touch the footer band at
       * every size at or above the floor, and the floor is never broken to
       * make room for it. */
      clarity: {
        hd: {
          desktop: { x: 0.15, y: 0.47, size: 0.13 },
          tablet:  { x: 0.10, y: 0.32, size: 0.15 },
          mobile:  { x: 0.10, y: 0.32, size: 0.15, opacity: 0 },
        },
        network: {
          desktop: { x: 0.85, y: 0.47, size: 0.12 },
          tablet:  { x: 0.90, y: 0.32, size: 0.14 },
          mobile:  { x: 0.90, y: 0.32, size: 0.14, opacity: 0 },
        },
        usb: {
          desktop: { x: 0.50, y: 0.86, size: 0.09, opacity: 0 },
          tablet:  { x: 0.50, y: 0.88, size: 0.13, opacity: 0 },
          mobile:  { x: 0.50, y: 0.88, size: 0.13, opacity: 0 },
        },
      },
    },
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
 * Per-section choreography.
 *
 * WHERE each prop sits is authored in TUNING.layout (above) — position and
 * size, in viewport fractions, per breakpoint. This table is everything the
 * solve does not own:
 *
 *   cam / look / fov / yaw   the camera move between sections
 *   anchors.<key>.z         world depth offset from the prop's home position
 *   anchors.<key>.dim       extra multiplier on the glow
 *   anchors.<key>.sizeCap   a multiplier on props.maxScreenFraction, so one
 *                           stop can hold a prop smaller than the global cap
 *
 * There is no `scale` here on purpose. The size a prop is DRAWN at is the size
 * the validator committed (TUNING.layout's `size`, lifted to the props floor),
 * and the world scale it commits to is the one it draws with. A second
 * multiplier on top of that could put the drawn size back under the floor while
 * the box still reported the size above it — which is exactly the class of bug
 * this table used to have.
 *   converge / flow         motion weights, blended like everything else:
 *                           `converge` is the "calm" of Clarity (less spin,
 *                           less parallax), `flow` draws the pulse tubes
 *
 * All of it is blended between the two stops in view, so scrolling
 * cross-fades between sections rather than snapping.
 * ==========================================================================*/

export const STOPS = [
  {
    id: 'hero',
    cam: [0, 0.15, 8.4], look: [0, 0.05, 0], fov: 42, yaw: 0.00,
    converge: 0,
    /* The plug sits deep in the left gutter with its cable yawed OUTWARD
     * (props.usb.cableOutward) so it curls away from the headline; the
     * constellation is the furthest back of the three. */
    anchors: {
      hd:      { z:  0.0, dim: 1.00 },
      usb:     { z: -0.4, dim: 0.95 },
      network: { z: -1.8, dim: 0.85 },
    },
  },
  {
    id: 'overview',
    cam: [0.5, -0.4, 9.2], look: [0, 0.30, 0], fov: 44, yaw: 0.28,
    converge: 0,
    anchors: {
      hd:      { z:  0.2, dim: 0.90 },
      usb:     { z: -0.6, dim: 0.88 },
      network: { z: -2.0, dim: 0.80 },
    },
  },
  {
    id: 'features',
    cam: [1.8, 1.2, 10.0], look: [0, -0.20, 0], fov: 46, yaw: -0.42,
    converge: 0,
    anchors: {
      hd:      { z:  0.8, dim: 1.05 },
      usb:     { z: -1.0, dim: 0.95 },
      network: { z: -2.2, dim: 0.85 },
    },
  },
  {
    id: 'flow',
    cam: [-2.0, -0.5, 10.4], look: [0, 0.45, 0], fov: 47, yaw: 0.62,
    converge: 0,
    flow: 1,
    /* The HD frame is size-capped here so it reads as a prop rather than the
     * tower it used to be, riding the gap above the step row. */
    anchors: {
      hd:      { z: -0.6, dim: 0.90, sizeCap: 0.74 },
      usb:     { z:  0.0, dim: 1.00 },
      network: { z: -0.8, dim: 0.92 },
    },
  },
  {
    id: 'clarity',
    cam: [0, 0.6, 11.4], look: [0, 0.1, 0], fov: 45, yaw: 0.00,
    /* Calm: the spin and the parallax drop away, and the mirrored pair flanks
     * the CTA card at its own vertical centre. */
    converge: 1,
    flow: 0,
    anchors: {
      hd:      { z: -1.0, dim: 0.78 },
      usb:     { z: -1.0, dim: 0.78 },
      network: { z: -1.6, dim: 0.72 },
    },
  },
];

/* ---------------------------------------------------------------------------
 * The authored-anchor resolvers. Both are pure lookups into TUNING.layout, so
 * there is exactly one place the composition lives.
 * -------------------------------------------------------------------------*/

/** Which authored breakpoint variant a viewport width uses. */
export function layoutVariant(width) {
  if (width < TUNING.layout.breakpoints.tablet) return 'mobile';
  if (width < TUNING.layout.breakpoints.desktop) return 'tablet';
  return 'desktop';
}

/** A never-null, always COMPLETE authored anchor: the requested variant, else
 *  the desktop one, else a hidden, dead-centre fallback the validator can still
 *  move. Complete means every number is a number — a variant that only wants to
 *  hide a prop says `opacity: 0` and inherits the rest, and the blend in
 *  js/scroll.js can never be handed an `undefined` to lerp. */
export function authoredAnchor(sectionId, key, variant) {
  const per = TUNING.layout.sections[sectionId] && TUNING.layout.sections[sectionId][key];
  const found = (per && (per[variant] || per.desktop)) || null;
  const a = found || { x: 0.5, y: 0.5, size: 0.12, opacity: 0 };
  return {
    x: a.x ?? 0.5,
    y: a.y ?? 0.5,
    size: a.size ?? 0.12,
    opacity: a.opacity ?? 1,
    alt: a.alt || null,
  };
}

/** Prop -> the Features card it belongs to, used by click-to-scroll. */
export const FOCAL_TARGET = { hd: 'features', usb: 'features', network: 'features' };

/** exposure multiplier for a stop id, with a safe default. */
export function exposureFor(id) {
  return EXPOSURE_PER_SECTION[id] ?? 0.8;
}
