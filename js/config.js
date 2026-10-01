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

  /* ==== Signature choreography (the HD device's own story) ====
   * `sway`      the monitor's idle yaw sway, in radians (clamped in the
   *             animate loop; scaled down by Clarity's calm)
   * `swaySpeed` two-frequency float: the second frequency rides on this
   * `dockYaw`   the USB plug's docked rotation (tip into the monitor's port)
   * `heroYaw`   the plug's hero rotation (tip out of the copy column)
   * `orbitR`    the constellation's orbit radius around the monitor, as a
   *             multiple of the monitor's own half-width
   * `orbitSpeed`  the calm halo's angular rate
   * `orbitFlatten` the orbit's vertical squash (a tilted ellipse, not a ring)
   * `glowPulse` the soft glow pulse that fires when the CTA card enters view
   */
  signature: {
    sway: 0.30,
    swaySpeed: 0.21,
    dockYaw: -Math.PI / 2,
    heroYaw: 0.55,
    orbitR: 1.18,
    orbitSpeed: 0.12,
    orbitFlatten: 0.62,
    glowPulse: 1.6,
  },

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

  /* ==== Mouse-reactive dust (js/objects.js -> DUST_VERT) ====
   * A world-space "pointer" the nearest dust scatters around, so the field
   * reads as a volume the visitor is brushing through. `radius` in world
   * units of influence, `strength` the max push, `fade` the damp rate (per
   * second) when the pointer leaves so the dust settles instead of snapping. */
  dust: {
    radius: 2.4,
    strength: 0.55,
    fade: 4.0,
  },

  /* ==== Bokeh discs (js/objects.js -> createBokeh) ====
   * A far layer of soft, out-of-focus discs — the room's bokeh. Additive,
   * faint, drifting. Skipped entirely on the low tier. */
  bokeh: {
    count: 26,
    size: 1.30,       // point-size base at reference depth (attenuates with z)
    opacity: 0.07,
    z: -9.5,
    zSpread: 3.0,
    drift: 0.10,
    twinkle: 0.25,
  },

  /* ==== Obstacle measurement (the light validator) ====
   *
   * An obstacle is the REAL extent of something the visitor reads: the line
   * boxes of a heading or a paragraph (Range.getClientRects), the box of a
   * card, pill or icon. Never the full-width section container, which used to
   * measure as a wall from margin to margin and left no gutter at all.
   * Every rect is grown by `rectPadPx` at measure time, so "clear" already
   * means "clear with air around it".
   *
   * The validator is LIGHT on purpose: it never nudges or searches. A prop
   * whose box would overlap a TEXT obstacle fades out for that stretch of
   * scroll (damped, at full size); a translucent CARD under a prop is a soft
   * dim, not a collision — the prop reads as depth behind the glass. The
   * placement itself is AUTHORED (TUNING.layout) and verified by screenshots.
   */
  gutters: {
    rectPadPx:     24,   // every measured obstacle is grown by this on all sides
    /* The sticky header is a RESERVED BAND, never a clip. `#navbar` is
       `position: fixed` and paints an opaque (0.8 alpha) strip over the
       canvas once it is solid, so a prop that reaches into it is cut by a
       hard straight edge. The band is measured from the real navbar height
       (floor: this value) and the validator keeps every box below it; a prop
       close to the band fades out over `headerFadePx` instead of ending
       abruptly, so there is never a cut. Only reserved while the navbar is
       actually solid (js/scene3d.js watches the `nav-solid` class). */
    headerReservePx:  88,
    headerPadPx:      16,  // extra breathing room under the measured navbar
    headerFadePx:    160,  // dim ramp over this distance below the band
    baseDistance:   6.0,   // how far in front of the camera the props sit; the
                           // per-section depth adds to that DISTANCE, and the
                           // solver unprojects to it (never to a remembered z)
    /* A dim a prop takes when a translucent card sits behind it. */
    softDim:      0.62,
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
   * be placed FADES OUT at full size. These are the FLOORS; the world-scale
   * caps below are the CEILINGS.
   */
  props: {
    maxScreenFraction: 0.30,
    minScreenFraction: 0.12,
    minScreenPx:      150,
    minScreenPxUsb:   130,   // the plug is small; it may sit lower than the rest
    minOpacity:      0.75,
    edgePadPx:        32,
    footerFadePx:    180,
    /* `maxWorldScale` is SOFT — it keeps the authored size in check, and the
       size floor below outranks it. `fit` is the hard ceiling from the
       measured box. */
    hd:      { fit: 3.2, maxWorldScale: 2.2 },
    /* `cableOutward` yaws the whole plug so its long axis (and the cable) points
       AWAY from the text column. js/scene3d.js reads this every frame, so the
       two keys below are load-bearing: without `cableOutward` the plug's cable
       aimed straight into the headline. */
    usb:     { fit: 2.4, maxWorldScale: 2.2, cableOutward: true, yaw: 1.05 },
    network: { fit: 2.6, maxWorldScale: 2.2 },
  },

  /* ==== AUTHORED LAYOUT + LIGHT VALIDATOR ====
   *
   * Placement is AUTHORED, not searched. Every section says where each prop
   * sits, in VIEWPORT FRACTIONS, and the validator's only job is to check
   * that decision against the measured page:
   *
   *   x      0..1   centre of the prop, as a fraction of the viewport width
   *   y      0..1   centre of the prop, as a fraction of the viewport HEIGHT
   *                 (0 = the top edge, 1 = the bottom edge)
   *   size   0..1   how big the prop reads, as a fraction of the viewport
   *                 width: the DOMINANT dimension of its projected box
   *   opacity 0..1   0 = authored HIDDEN in this section. It is still
   *                 validated, and it is damped, so it fades rather than cuts.
   *
   * Three breakpoint variants per entry (`layoutVariant()` picks one):
   *
   *   desktop  >= breakpoints.desktop (1100px) — the authored composition
   *   tablet   >= breakpoints.tablet  ( 700px)  — at most one prop per
   *                                               section, in a corner
   *   mobile   <   700px                        — authored hidden: the page
   *                                               is a single full-bleed column
   *
   * THE LIGHT VALIDATOR (js/scroll.js). The prop's projected screen box is
   * compared against the measured obstacles (already padded by
   * gutters.rectPadPx, 24px). On a TEXT overlap the prop's opacity goes to 0
   * for this stretch of scroll: a damped fade at FULL size, never a shrink,
   * never a nudge, never a hard cut. A translucent card under a prop is a
   * soft dim, not a collision.
   *
   * `band` is the vertical band a prop's box must stay inside — from below the
   * reserved sticky-header band down to `band.bottom`, the footer band. A prop
   * fades out over `props.footerFadePx` before either edge, and the footer is
   * ALSO a measured obstacle, so nothing is ever sliced by it.
   */
  layout: {
    breakpoints: { desktop: 1100, tablet: 700 },
    band: { top: 0.06, bottom: 0.93 },
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
     * The composition — ONE signature object, two hero supporters.
     *
     * The HD device (slim glass monitor) is the constant: it presides over the
     * page from the top-right strip (features/flow) and settles centered-right
     * (clarity), sized in viewport fractions of the DOMINANT projected
     * dimension. The measured page at 1366x768 puts the free space exactly
     * there (verified by tools/shot.mjs screenshots):
     *
     *   features  heading/paragraph end at x0.54, the wide tile starts y0.35;
     *             the strip between the nav CTA (y0.07) and the tile is free
     *             right of x0.55 -> the monitor hovers at (0.80, 0.22)
     *   flow      steps row spans y0.45..0.54 full width; the same top-right
     *             strip is free -> the monitor stays at (0.80, 0.22) and the
     *             USB docks into its right-side port at (0.915, 0.22)
     *   clarity   the CTA card is one centered translucent panel; its copy
     *             ends at x0.75 -> the monitor settles behind the card's right
     *             at (0.865, 0.45), clear of every padded text box
     *
     * The supporters are hero-only: the plug in the left gutter (0.09), the
     * constellation upper-right (0.86, 0.20). Both are damped anchors, NOT
     * searched: the validator only fades what the copy leaves no room for.
     * ------------------------------------------------------------------ */
    sections: {
      /* HERO — the copy column is centred (max-w-2xl, ends ~x0.75), so the
       * right side is free: the monitor presides right of the headline at x0.87,
       * the constellation floats above it at x0.86/y0.15, the plug hugs the
       * left gutter at x0.11. All sized above the floor (0.12 vw). */
      hero: {
        hd: {
          desktop: { x: 0.87, y: 0.45, size: 0.20 },
          tablet:  { x: 0.88, y: 0.30, size: 0.20 },
          mobile:  { x: 0.90, y: 0.30, size: 0.18, opacity: 0 },
        },
        usb: {
          desktop: { x: 0.11, y: 0.65, size: 0.13 },
          tablet:  { x: 0.14, y: 0.76, size: 0.14 },
          mobile:  { x: 0.16, y: 0.82, size: 0.13, opacity: 0 },
        },
        network: {
          desktop: { x: 0.86, y: 0.15, size: 0.12 },
          tablet:  { x: 0.88, y: 0.15, size: 0.13, opacity: 0 },
          mobile:  { x: 0.72, y: 0.022, size: 0.075, minPx: 44 },
        },
      },

      /* OVERVIEW — the three tool cards span the full content width, so the
       * monitor rides the free strip above the row and the supporters fade
       * out through the section (their story is told). */
      overview: {
        /* The three tool cards are a full-width ROW (y0.10-0.48), so there is
         * no free strip at the top: an anchor up there lands on the third card
         * and the validator — correctly — fades it. The one full-width free
         * band is BETWEEN the cards and the "Small hub" heading (y0.50-0.73),
         * so the monitor rides that, right of the heading's own column, with
         * the constellation in the left half of the same band. */
        hd: {
          desktop: { x: 0.72, y: 0.69, size: 0.12 },
          tablet:  { x: 0.50, y: 0.09, size: 0.14, opacity: 0 },
          mobile:  { x: 0.50, y: 0.09, size: 0.14, opacity: 0 },
        },
        usb: {
          desktop: { x: 0.09, y: 0.90, size: 0.09, opacity: 0 },
          tablet:  { x: 0.10, y: 0.92, size: 0.12, opacity: 0 },
          mobile:  { x: 0.10, y: 0.92, size: 0.12, opacity: 0 },
        },
        network: {
          desktop: { x: 0.24, y: 0.615, size: 0.08 },
          tablet:  { x: 0.90, y: 0.92, size: 0.11, opacity: 0 },
          mobile:  { x: 0.80, y: 0.475, size: 0.075, minPx: 44 },
        },
      },

      /* FEATURES — the monitor hovers in the free top-right strip above the
       * wide tile (heading/paragraph end ~x0.54, tile starts y0.35), screen
       * wiping from pixel to sharp; the plug is parked off right edge (Flow
       * dock next), constellation hidden. */
      features: {
        hd: {
          desktop: { x: 0.80, y: 0.22, size: 0.20 },
          tablet:  { x: 0.50, y: 0.12, size: 0.16, opacity: 0 },
          mobile:  { x: 0.50, y: 0.12, size: 0.16, opacity: 0 },
        },
        usb: {
          desktop: { x: 1.15, y: 0.22, size: 0.09, opacity: 0 },
          tablet:  { x: 0.50, y: 0.88, size: 0.13, opacity: 0 },
          mobile:  { x: 0.50, y: 0.88, size: 0.13, opacity: 0 },
        },
        network: {
          desktop: { x: 0.50, y: 0.50, size: 0.08, opacity: 0 },
          tablet:  { x: 0.50, y: 0.88, size: 0.12, opacity: 0 },
          mobile:  { x: 0.80, y: 0.362, size: 0.075, minPx: 44 },
        },
      },

      /* FLOW — the monitor holds the same spot (it is the constant) and the
       * USB slides in from the right edge to dock into its side port at
       * x0.915; the cable trails off-screen right, away from the copy. */
      flow: {
        /* Same problem as overview, opposite shape: the three numbered steps
         * are a full-width ROW (y0.45-0.54), and the intro copy above them
         * ends at x0.54. So the free band is the gap BETWEEN the paragraph
         * (ends y0.29) and the steps (start y0.45) — about 120px tall, which
         * is why these two are much smaller than the 0.20 used in features:
         * at 0.20 the monitor is 223px tall and lands on the steps. */
        hd: {
          desktop: { x: 0.795, y: 0.100, size: 0.068, minPx: 88, opacity: 0 },
          tablet:  { x: 0.50, y: 0.14, size: 0.16, opacity: 0 },
          mobile:  { x: 0.50, y: 0.14, size: 0.16, opacity: 0 },
        },
        usb: {
          /* Docks into the monitor's side port, so it sits just left of it,
           * cable trailing off toward the copy's right edge. */
          desktop: { x: 0.945, y: 0.062, size: 0.048, minPx: 58, opacity: 0 },
          tablet:  { x: 0.50, y: 0.88, size: 0.13, opacity: 0 },
          mobile:  { x: 0.50, y: 0.88, size: 0.13, opacity: 0 },
        },
        /* The flow region's copy fills it: the intro paragraph ends at y0.29
         * and the three numbered steps are a full-width row at y0.45-0.54, so
         * the only free band is the ~76px gap between them (after the 24px
         * obstacle pad). A 164px monitor cannot fit there at any anchor, and
         * this section is about the small act of launching, not the hardware —
         * so the presence here is the constellation, which is small by nature
         * and reads as the hub the steps all route through. */
        network: {
          desktop: { x: 0.645, y: 0.29, size: 0.05, opacity: 1, minPx: 34 },
          tablet:  { x: 0.50, y: 0.88, size: 0.12, opacity: 0 },
          mobile:  { x: 0.80, y: 0.892, size: 0.075, minPx: 44 },
        },
      },

      /* CLARITY — the monitor settles centered-right behind the CTA card's
       * right (the card is translucent glass, so it reads as a backlit glow),
       * clear of every padded text box; the constellation undocks and orbits
       * it as a calm halo (the stop's `orbit` weight). The plug fades away
       * below: its story is over. */
      clarity: {
        hd: {
          desktop: { x: 0.865, y: 0.45, size: 0.18 },
          tablet:  { x: 0.10, y: 0.32, size: 0.15 },
          mobile:  { x: 0.10, y: 0.32, size: 0.15, opacity: 0 },
        },
        usb: {
          desktop: { x: 0.50, y: 0.90, size: 0.08, opacity: 0 },
          tablet:  { x: 0.50, y: 0.88, size: 0.13, opacity: 0 },
          mobile:  { x: 0.50, y: 0.88, size: 0.13, opacity: 0 },
        },
        network: {
          desktop: { x: 0.865, y: 0.45, size: 0.075, opacity: 0 },
          tablet:  { x: 0.90, y: 0.32, size: 0.14 },
          mobile:  { x: 0.80, y: 0.678, size: 0.075, minPx: 44 },
        },
      },
    },
  },

  /* ==== Objects hidden on the mobile tier (no side gutters exist there) ==== */
  /* On phones the two physical props are dropped: a 164px monitor on a 390px
   * screen is not decoration, it is an obstruction. The constellation is
   * small by nature (~30px), costs almost nothing, and gives every section
   * some presence — so mobile keeps it and hides only hd and usb. */
  hideOnMobile: ['hd', 'usb'],

  /* ==== Quality tier ====
   * 'high' | 'medium' | 'low': a device-tier default (mobile -> low, tablet ->
   * medium, otherwise high), overridable with `?quality=high|medium|low`, chosen
   * once at init. It drives material simplification inside objects.js (low
   * swaps MeshPhysicalMaterial for MeshStandardMaterial — no clearcoat, no
   * procedural maps, no anisotropy — keeps env + rim — and keeps only the
   * network hub halo) plus the budget toggles: bokeh discs and the inner
   * counter-rotating background are medium+, so the low tier stays lean. */
  quality: {
    forceTier: (new URLSearchParams(location.search).get('quality') || '').toLowerCase(),
    autoTier: null,
  },

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

  /* ==== Loop resilience ====
   * The frame loop is the one thing that must never die: a throw anywhere in a
   * subsystem update would otherwise leave the page with a permanently frozen
   * 3D layer and no visible cause. Each subsystem update gets its own try/catch
   * (scene3d.js -> runSubsystem), and a subsystem that throws
   * `maxSubsystemFailures` frames running is switched off so the rest of the
   * scene keeps running at full rate. The first failure of each subsystem is
   * logged in full; the rest are counted silently so a persistent fault cannot
   * flood the console at 60fps. */
  loop: {
    /* dt is clamped to this before anything integrates it, so a tab switch, a
       long GC pause or a backgrounded frame cannot teleport the dampers. */
    maxDt: 0.05,
    maxSubsystemFailures: 3,
    /* The watchdog: if the last rendered frame is older than `staleMs`, the loop
       is presumed dead and restarted. It ticks every `watchdogMs`.

       `staleMs` is a FLOOR, not the whole test — a software-GL frame can
       legitimately take 700ms, and restarting on that churns rAF handles and
       logs about a loop that is running fine. The real bar is
       `staleMs` OR `stallPeriodMultiple x` this loop's own smoothed frame
       period, whichever is larger, so only a genuine hang (a rAF that never
       comes back) trips it. */
    watchdogMs: 1000,
    staleMs: 500,
    stallPeriodMultiple: 8,
    /* Above this magnitude a position/scale/quaternion/opacity/spring is not
       "a bit off", it is the result of a divide by zero or an unproject of a
       point behind the camera — reset the prop rather than draw it. */
    maxAbs: 1e6,
  },

  /* ==== Health monitor (Part 4) ====
   * The loop watchdog answers "did the loop stop?". This answers the failure
   * that actually reaches a visitor: a loop that is RUNNING but has nothing on
   * screen (all props faded by a bad solve, or an entrance pinned at 0).
   *
   * `intervalMs`   how often to check (the spec's 1s)
   * `noFramesMs`   frames that must advance inside one interval; 0 is a dead
   *                loop. Compared on the frame COUNTER, never the wall clock,
   *                so a slow software-GL frame is not mistaken for a hang.
   * `visibilityEpsilon` below this a prop's opacity counts as invisible
   * `initRetryMs`  before a failed init is retried once before falling back
   *                to the 2D page
   * `initRetryLimit` how many init attempts (1 retry after the first = 2) */
  health: {
    intervalMs: 1000,
    /* Consecutive frameless intervals before the loop is presumed dead. Two,
       not one: under swiftshader this box renders at ~2fps, so a single 1s
       interval is legitimately frameless and restarting on it would kill a
       working loop. */
    staleTicks: 2,
    noFramesMs: 0,
    visibilityEpsilon: 0.01,
    initRetryMs: 1500,
    initRetryLimit: 1,
  },

  /* ==== Accessibility / debug ====
   * `debug` paints the solver overlay (obstacles, accepted candidates, the
   * committed boxes) — invasive, so it is opt-in and never part of a capture.
   * `inspect` only exposes the read-only `window.__scene3d` handle and the
   * per-frame debug data behind it, which is what a screenshot harness reads
   * to measure a pose; it draws nothing. `?scene3d=probe` is that mode. */
  showStaticOnReducedMotion: true,
  debug: new URLSearchParams(location.search).get('scene3d') === 'debug',
  inspect: ['debug', 'probe'].includes(new URLSearchParams(location.search).get('scene3d')),
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
    /* The display story: 0 = fully pixelated low-res. The wipe is the scroll. */
    screen: 0,
    dock: 0,
    orbit: 0,
    anchors: {
      hd:      { z:  0.0, dim: 1.00 },
      usb:     { z: -0.4, dim: 0.95 },
      network: { z: -0.8, dim: 0.90 },
    },
  },
  {
    id: 'overview',
    cam: [0.5, -0.3, 9.0], look: [0, 0.20, 0], fov: 43, yaw: 0.10,
    converge: 0,
    /* The wipe is crossing the display on the way to Features. */
    screen: 0.45,
    dock: 0,
    orbit: 0,
    anchors: {
      hd:      { z:  0.2, dim: 0.95 },
      usb:     { z: -0.6, dim: 0.80 },
      network: { z: -1.2, dim: 0.80 },
    },
  },
  {
    id: 'features',
    cam: [1.2, 0.9, 9.6], look: [0.3, 0.0, 0], fov: 45, yaw: -0.15,
    converge: 0,
    /* The "upscale" story lands: the display is fully sharp. */
    screen: 1,
    dock: 0,
    orbit: 0,
    anchors: {
      hd:      { z:  0.4, dim: 1.05 },
      usb:     { z: -1.0, dim: 0.85 },
      network: { z: -1.6, dim: 0.75 },
    },
  },
  {
    id: 'flow',
    cam: [-1.2, 0.4, 9.8], look: [-0.2, 0.10, 0], fov: 46, yaw: 0.20,
    converge: 0,
    screen: 1,
    /* The USB plug is docked into the monitor's side port. */
    dock: 1,
    orbit: 0,
    anchors: {
      hd:      { z:  0.4, dim: 1.05 },
      usb:     { z:  0.3, dim: 1.10 },
      network: { z: -1.8, dim: 0.75 },
    },
  },
  {
    id: 'clarity',
    cam: [0, 0.4, 10.6], look: [0.1, 0.10, 0], fov: 45, yaw: 0.00,
    /* Calm: the spin and the parallax drop away, the monitor settles
     * centered-right behind the CTA card's right, and the constellation
     * orbits it as a calm halo. */
    converge: 1,
    screen: 1,
    dock: 0,
    orbit: 1,
    anchors: {
      hd:      { z:  0.0, dim: 0.90 },
      usb:     { z: -1.0, dim: 0.70 },
      network: { z: -0.2, dim: 0.90 },
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
 *  fade. Complete means every number is a number — a variant that only wants to
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
    /* Optional px floor override for regions with no room for the global
     * legibility floor. Left undefined unless the anchor sets it. */
    ...(a.minPx != null ? { minPx: a.minPx } : {}),
  };
}

/** Prop -> the Features card it belongs to, used by click-to-scroll. */
export const FOCAL_TARGET = { hd: 'features', usb: 'features', network: 'features' };

/** exposure multiplier for a stop id, with a safe default. */
export function exposureFor(id) {
  return EXPOSURE_PER_SECTION[id] ?? 0.8;
}
