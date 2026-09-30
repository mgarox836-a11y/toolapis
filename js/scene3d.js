/* ============================================================================
 * scene3d.js — TOOLAPIS · floating 3D visual layer
 * ----------------------------------------------------------------------------
 * A fixed, full-viewport WebGL layer that sits BEHIND all page content
 * (z-index: -1, pointer-events: none) and never intercepts a click.
 *
 * The module is only the *core*: it owns the renderer, the lights, the
 * per-section choreography and the frame loop. Everything else lives in
 * dedicated modules:
 *
 *   config.js   all tuning numbers, the palette and the per-section stops
 *   objects.js  the three procedural props, the background props, the dust
 *   scroll.js   scroll -> stop blending, and the text-clearance solver
 *
 * BACKGROUND MODEL (measured, not assumed)
 * ----------------------------------------------------------------------------
 * With EffectComposer + OutputPass the clear colour is colour-managed and ACES
 * tone-mapped like everything else, so a clear of #0B0F12 reaches the screen
 * as roughly rgb(50,64,73) and drifts again every time exposure changes. No
 * clear colour can land exactly on the CSS page background.
 *
 * So WebGL does not own the background at all: the canvas is `alpha: true`
 * with a fully transparent clear, `html` keeps the #0B0F12 background, and the
 * scene fog colour is read from the same token so distant geometry dissolves
 * into the page seamlessly. Exact match, exposure-independent, no colour maths.
 *
 * If WebGL is unavailable, the canvas is removed, `html.scene3d` is never
 * added, and the 2D design is left exactly as it was.
 * ==========================================================================*/

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { TUNING, PALETTE, OBJ_KEYS, STOPS, FOCAL_TARGET } from './config.js';
import {
  buildObject, disposeObject, createBackgroundProps, createParticles, createBokeh, createFlowLinks,
  buildStudioScene, setMaterialQuality, disposeSharedTextures,
} from './objects.js';
import { createScrollEngine, CENTER_TOLERANCE_PX } from './scroll.js';

/* ============================================================================
 * 1. RUNTIME STATE
 * ==========================================================================*/

const state = {
  renderer: null,
  scene: null,
  camera: null,
  composer: null,
  bloomPass: null,
  pmremRT: null,
  canvas: null,
  props: null,          // background props (wireframe, rings, ground glow)
  links: null,          // flow links between the props
  particles: null,      // { points, material, count } — the reactive dust field
  bokeh: null,          // { points, material, count } — far bokeh discs (medium+)
  quality: 'high',      // 'high' | 'medium' | 'low', chosen once at init
  dustActive: 0,        // damped 0..1 pointer reaction (settles on leave)
  objects: {},          // key -> runtime record
  trackedMats: [],      // every object material whose glow is animated
  engine: null,         // scroll.js

  tier: 'desktop',
  pixelRatio: 1,
  running: false,
  rafId: 0,
  inView: true,
  reduced: false,
  elapsed: 0,
  intro: { active: false, t: 0, finished: false, short: false },  /* prop entrance */
  scrollUnlocked: false,          /* the page left the hero; follow the scroll */
  dolly: 0,                         /* intro camera dolly, added to cam.z */
  lastTime: 0,

  /* damped scalars */
  progress: 0,
  progressTarget: 0,
  yaw: 0,

  /* pointer */
  pointer: new THREE.Vector2(0, 0),
  pointerSmooth: new THREE.Vector2(0, 0),
  pointerActive: false,
  hoverEl: null,

  /* adaptive quality */
  qualityStep: 0,
  frameAcc: 0,
  frameCount: 0,

  /* scroll velocity (px/s), damped */
  velocity: 0,
  lastScrollY: 0,

  /* raycast */
  raycaster: null,
  rayNdc: new THREE.Vector2(),
  rayKey: null,
  rayBlocked: false,

  /* the prop that currently owns the focus (hovered link/button or prop) */
  focusKey: null,

  /* per-prop world-space half extents, measured from its bounding box */
  bounds: {},
};

/* scratch — the frame loop allocates nothing */
const _objCtx = { glow: 1, dim: 1, flow: 0 };
const _linkCtx = { flow: 0, column: [-1, 1] };
const _linkPositions = { hd: null, usb: null, network: null };
/* NDC y of each placed prop this frame, and the page-space y a flow link
   actually runs through. Both feed the per-link text column. */
const _linkCy = { hd: 0, usb: 0, network: 0 };
/* Shared scratch for linkPageBand(): the frame loop resolves one band per link
   and each is consumed by the very next statement, so one buffer is enough and
   the loop stays allocation-free. */
const _linkBand = [0, 0];
let _linkScrollY = 0;
const _linkCols = [null, null, null];
const _colScratch = [-1, 1];
/* World-space point under the pointer (unprojected once per frame onto a ray
   at the props' depth) — the dust scatters around it. Scratch, never kept. */
const _dustPtr = new THREE.Vector3();

/* ============================================================================
 * 2. HELPERS
 * ==========================================================================*/

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** Frame-rate independent exponential approach. */
const damp = (current, target, lambda, dt) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

function log(...args) {
  if (TUNING.debug) console.log('[scene3d]', ...args);
}

function warn(...args) {
  console.warn('[scene3d]', ...args);
}

/** Reports a CAUGHT error that degrades the scene without killing it: the 2D
 *  design stays, so the failure is invisible unless it is logged, and a
 *  swallowed throw is the one bug that is impossible to report later. */
function degrade(message, err) {
  console.error('[scene3d]', message, err);
}

/** WebGL capability probe — runs before we touch the DOM. */
function isWebGLAvailable() {
  try {
    const probe = document.createElement('canvas');
    if (window.WebGL2RenderingContext && probe.getContext('webgl2')) return true;
    if (window.WebGLRenderingContext &&
        (probe.getContext('webgl') || probe.getContext('experimental-webgl'))) return true;
    return false;
  } catch (err) {
    return false;
  }
}

/* ============================================================================
 * 3. RENDERER / SCENE / LIGHTS
 * ==========================================================================*/

function createRenderer() {
  const canvas = document.createElement('canvas');
  canvas.id = 'scene3d-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('role', 'presentation');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: TUNING.antialias,
    /* Transparent canvas: CSS owns the page background. See the header note. */
    alpha: true,
    stencil: false,
    powerPreference: 'high-performance',
  });
  /* Clear to FULLY TRANSPARENT black. Not "bg with alpha 0" and not an opaque
     colour: a WebGL layer that never has an opinion about the page behind it
     cannot tint it, whatever the tone mapping, the exposure or the composer
     does later in the frame. `scene.background` is deliberately never set. */
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TUNING.toneMapping === 'agx'
    ? THREE.AgXToneMapping
    : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TUNING.exposure.near;
  /* setSize(w, h, false) keeps the CSS rule in charge of layout, so there is
     never a reflow jump. Sizing itself happens in syncSize(). */

  document.body.insertBefore(canvas, document.body.firstChild);
  state.canvas = canvas;
  return renderer;
}

function createScene() {
  const scene = new THREE.Scene();
  /* Fog colour MUST equal the CSS page background, or distant geometry
     dissolves into a different black than the page. */
  scene.fog = new THREE.FogExp2(PALETTE.bg, TUNING.fog.densityNear);
  state.scene = scene;
  return scene;
}

function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    TUNING.fov,
    window.innerWidth / window.innerHeight,
    TUNING.near,
    TUNING.far
  );
  camera.position.fromArray(STOPS[0].cam);
  camera.lookAt(STOPS[0].look[0], STOPS[0].look[1], STOPS[0].look[2]);
  state.camera = camera;
  return camera;
}

/**
 * Lighting is deliberately starved: one soft key plus two small lime accents
 * and a whisper of hemisphere fill. Anything brighter greys out the blacks,
 * which is the whole design.
 */
function createLights() {
  const scene = state.scene;
  const L = TUNING.lights;

  const key = new THREE.DirectionalLight(L.keyColor || PALETTE.white, L.key);
  key.position.set(4, 6, 5);
  scene.add(key);

  const lime = new THREE.PointLight(PALETTE.accent, L.lime, 26, 2);
  lime.position.set(-4, 1.2, 3);
  scene.add(lime);

  /* The low warm kicker, oriented along X: the shadow side of a prop reads
     warmer, never dead silver. */
  const kick = new THREE.PointLight(L.kickColor || PALETTE.accentHi, L.kick, 22, 2);
  kick.position.set(3.5, -2.5, 1.5);
  scene.add(kick);

  /* Mapped painterly fill: the hemisphere sky is the 6200K warm the dims are
     mapped onto, so every dark side a prop turns to the fill reads warm. */
  scene.add(new THREE.HemisphereLight(L.mappedColor || 0x223040, 0x05080a, L.hemi));
}

/**
 * One-time PMREM bake of the custom dark-room studio (see objects.js
 * buildStudioScene): the premium gloss reflections. The bake covers the mild
 * HDR range (NoToneMapping while baking), so the env reads as a lit room, not
 * as a flat fill; `TUNING.env.intensity` still scales how much of it every
 * material lets through.
 *
 * The whole thing is an OPTIONAL feature with its own try/catch: a failing
 * studio bake falls back to RoomEnvironment, and a failing RoomEnvironment
 * too simply leaves `scene.environment` unset. Every material already reads
 * `env.intensity`, so an unbaked env is a flatter reflection, never a dead
 * scene. */
function createEnvironment() {
  try {
    if (!TUNING.env.enabled) return;
    let pmrem = null;
    try {
      pmrem = new THREE.PMREMGenerator(state.renderer);
    } catch (err) {
      degrade('env generator unavailable — props get lights only', err);
      return;
    }
    let envScene = null;
    try {
      envScene = buildStudioScene();
      state.pmremRT = pmrem.fromScene(envScene, 0.10);
    } catch (err) {
      degrade('studio env bake failed — falling back to RoomEnvironment', err);
      try {
        disposeSceneGraph(envScene);
      } catch (e) { /* never let cleanup mask the original failure */ }
      envScene = null;
      try {
        envScene = new RoomEnvironment();
        state.pmremRT = pmrem.fromScene(envScene, 0.10);
      } catch (err2) {
        /* Both bakes failed: the props render lit-only. Do NOT rethrow — an
           environment is an enhancement, and taking the whole scene down for
           it is exactly the failure mode this function used to have. */
        degrade('env bake failed entirely — continuing without an environment', err2);
        state.pmremRT = null;
      }
    }
    if (state.pmremRT) state.scene.environment = state.pmremRT.texture;
    try { pmrem.dispose(); } catch (e) { /* generator already gone */ }
    if (envScene) {
      try { disposeSceneGraph(envScene); } catch (e) { /* nothing left to free */ }
    }
  } catch (err) {
    /* Last-resort net: the env is an optional feature, so even a throw in its
       own bookkeeping must leave the scene running. */
    degrade('environment setup failed — continuing without it', err);
    state.pmremRT = null;
  }
}

/* ============================================================================
 * 4. OBJECTS
 * ----------------------------------------------------------------------------
 * Each prop is parented to a position-only anchor group. The clearance solver
 * writes WORLD positions onto the anchor (it works in screen space), while the
 * prop itself owns its own rotation and scale — so the two never fight.
 * ==========================================================================*/

function createObjects() {
  for (const key of OBJ_KEYS) {
    const obj = buildObject(key);
    const anchor = new THREE.Group();
    anchor.add(obj.group);
    state.scene.add(anchor);

    obj.group.userData.key = key;
    state.objects[key] = {
      anchor,
      group: obj.group,
      obj,
      materials: obj.materials,
      hit: obj.hit || [],
      target: new THREE.Vector3(),
      baseScale: TUNING.objectScale,
      state: 'authored',
      collided: false,
      opacity: 1,
      hover: 0,
      hoverTarget: 0,
      spinMul: 1,
      spinY: 0,
      focus: 0,
      /* per-prop float personality */
      floatAmp: 1.0,
      phase: key === 'hd' ? 0.0 : key === 'usb' ? 2.1 : 4.2,
      spin: key === 'hd' ? 0.10 : key === 'usb' ? -0.14 : 0.17,
    };
    for (const m of obj.materials) state.trackedMats.push(m);

    /* The prop's own box, in its own local units. js/objects.js centres the
       prop on this box and js/scroll.js projects all 8 corners of it through
       the live camera, so the box the validator clears is the box the mesh
       draws. `quat` and `offX`/`offY` carry what the group is doing RIGHT NOW,
       so the box follows the prop's own spin and float instead of assuming a
       rest pose the page never holds. */
    const half = obj.half || { w: 0.5, h: 0.5, d: 0.5 };
    state.bounds[key] = {
      half: { w: half.w, h: half.h, d: half.d },
      halfW: half.w,
      halfH: half.h,
      halfD: half.d,
      fitMax: TUNING.props[key].fit,
      quat: new THREE.Quaternion(),
      offX: 0,
      offY: 0,
    };
  }
}

/* The background layer (wireframe geodesic, orbit rings, ground glow and the
   optional inner twin) is decorative depth BEHIND the copy. It is an optional
   feature, so it is built in its own try/catch: a throw here costs the
   backdrop and nothing else. `state.props` stays null, and every consumer
   (the frame loop, the entrance, dispose) already guards on that. */
function createProps() {
  try {
    state.props = createBackgroundProps();
    state.scene.add(state.props.group);
  } catch (err) {
    degrade('background props failed to build — continuing without them', err);
    state.props = null;
  }
}

function addFlowLinks() {
  /* The pulse tubes between the props are an optional extra on top of the
     props themselves, so a failure here leaves the props running. */
  try {
    state.links = createFlowLinks();
    state.scene.add(state.links.group);
  } catch (err) {
    degrade('flow links failed to build — continuing without them', err);
    state.links = null;
    return;
  }
  /* One column PER LINK, resolved from the height that link actually runs
     through. A link between two props that sit in the same free band finds no
     copy at its own height and therefore draws in full; a link that would run
     across a paragraph is faded out exactly across that paragraph. */
  _linkCtx.columnFor = (a, b, index) => linkColumnFor(index);
}

/** Page-space y band a link occupies, in page coordinates. Returns the shared
 *  `_linkBand` scratch, or null. Nothing keeps a reference past the call. */
function linkPageBand(index) {
  const pair = state.links.pairs[index];
  if (!pair) return null;
  const ya = _linkCy[pair[0]];
  const yb = _linkCy[pair[1]];
  if (typeof ya !== 'number' || typeof yb !== 'number') return null;
  const vh = window.innerHeight;
  const half = 0.5 * vh;
  const a = (1 - ya) * half + _linkScrollY;
  const b = (1 - yb) * half + _linkScrollY;
  _linkBand[0] = a < b ? a : b;
  _linkBand[1] = a < b ? b : a;
  return _linkBand;
}

/**
 * The hard text column at ONE link's own height. Returns null when there is
 * nothing to avoid, which objects.js reads as "draw the link in full".
 */
function linkColumnFor(index) {
  const band = linkPageBand(index);
  if (!band) return null;
  let col = _linkCols[index];
  if (!col) { col = [-1, 1]; _linkCols[index] = col; }
  const vh = window.innerHeight;
  const ids = state.engine.sectionsOnScreen(_linkScrollY, vh);
  /* A few px of slack so a link that grazes a line of text still fades. */
  const found = state.engine.textColumnAt(ids, band[0] - 24, band[1] + 24, col);
  return found ? col : null;
}

/* ============================================================================
 * 5. PARTICLES
 * ==========================================================================*/

function particleCountFor(tier) {
  const P = TUNING.particles;
  if (tier === 'mobile') return P.countMobile;
  if (tier === 'tablet') return P.countTablet;
  return P.count;
}

function disposeParticles() {
  if (!state.particles) return;
  state.scene.remove(state.particles.points);
  state.particles.points.geometry.dispose();
  state.particles.material.dispose();
  state.particles = null;
}

function buildParticles(count) {
  disposeParticles();
  /* The dust field is atmosphere, never content. A failed build (or a failed
     resize-rebuild) leaves the scene without dust rather than without props. */
  try {
    const p = createParticles(count);
    state.particles = p;
    p.material.uniforms.uPixelRatio.value = state.pixelRatio;
    state.scene.add(p.points);
  } catch (err) {
    state.particles = null;
    degrade('dust field failed to build — continuing without it', err);
  }
}

function disposeBokeh() {
  if (!state.bokeh) return;
  state.scene.remove(state.bokeh.points);
  state.bokeh.points.geometry.dispose();
  state.bokeh.material.dispose();
  state.bokeh = null;
}

function buildBokeh() {
  disposeBokeh();
  if (state.quality === 'low') return;
  /* Far out-of-focus discs: a depth cue, medium+ only, and entirely optional
     even there. Failing to build them is a missing backdrop detail, not a
     missing scene. */
  try {
    const b = createBokeh(TUNING.bokeh.count);
    state.bokeh = b;
    b.material.uniforms.uPixelRatio.value = state.pixelRatio;
    state.scene.add(b.points);
  } catch (err) {
    state.bokeh = null;
    degrade('bokeh field failed to build — continuing without it', err);
  }
}

/* ============================================================================
 * 6. COMPOSER — desktop tier only
 * ==========================================================================*/

function createComposer() {
  disposeComposer();
  const { renderer, scene, camera } = state;
  const size = renderer.getSize(new THREE.Vector2());
  /* Bloom is an optional post-process, desktop only. A failure must fall back
     to the plain renderer.render() path the frame loop already uses, not end
     the scene. */
  /* Declared OUTSIDE the try so the catch can reach the half-built composer:
     a `const` inside the block would be in its temporal dead zone there. */
  let composer = null;
  try {
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      TUNING.bloom.strength,
      TUNING.bloom.radius,
      TUNING.bloom.threshold
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    state.composer = composer;
    state.bloomPass = bloom;
  } catch (err) {
    degrade('bloom composer failed to build — rendering without it', err);
    /* state.composer is only assigned on success, so free the half-built one
       through the local reference. */
    try {
      if (composer) {
        for (const pass of composer.passes) pass.dispose?.();
        composer.renderTarget1?.dispose();
        composer.renderTarget2?.dispose();
      }
    } catch (e) { /* the render targets are already gone */ }
    state.composer = null;
    state.bloomPass = null;
  }
}

function disposeComposer() {
  if (!state.composer) return;
  for (const pass of state.composer.passes) pass.dispose?.();
  state.composer.renderTarget1?.dispose();
  state.composer.renderTarget2?.dispose();
  state.composer = null;
  state.bloomPass = null;
}

/* ============================================================================
 * 7. HOVER
 * ----------------------------------------------------------------------------
 * Delegated, so a link/button only needs `data-3d="hd|usb|social"`. Anything
 * without that attribute is matched by href or visible label, which means the
 * nav, footer and tool cards all react without a single HTML change.
 * ==========================================================================*/

const TOOL_MATCHERS = [
  { id: 'hd',     re: /tiktok-hd-enhancer|hd[ -]?enhancer/i },
  { id: 'usb',    re: /gnirehtet|drive\.google\.com/i },
  { id: 'social', re: /newsocapis|social/i },
];

/* The public hover id ("social") is deliberately not the same string as the
   scene object key ("network") — the HTML talks in product names, the scene
   talks in prop names. Everything downstream uses the OBJECT key, so resolve
   here, once. */
const OBJECT_KEY_ALIAS = { social: 'network', hd: 'hd', usb: 'usb' };

const toObjectKey = (id) => (id ? (OBJECT_KEY_ALIAS[id] ?? null) : null);

function labelOf(el) {
  return [
    el.textContent,
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
  ].filter(Boolean).join(' ');
}

function toolIdFor(el) {
  if (!el || el.nodeType !== 1) return null;
  const explicit = el.getAttribute('data-3d');
  if (explicit) return explicit.toLowerCase();
  const href = el.getAttribute('href') || '';
  const label = labelOf(el);
  for (const m of TOOL_MATCHERS) {
    if (m.re.test(href) || m.re.test(label)) return m.id;
  }
  return null;
}

function setHoverTarget(hoverId) {
  const key = toObjectKey(hoverId);
  for (const objKey of OBJ_KEYS) {
    const o = state.objects[objKey];
    if (o) o.hoverTarget = objKey === key ? 1 : 0;
  }
}

function setHoverElement(el) {
  if (state.hoverEl === el) return;
  state.hoverEl = el;
  setHoverTarget(toolIdFor(el));
}

function onPointerOver(e) {
  if (e.pointerType && e.pointerType !== 'mouse') return;
  setHoverElement(e.target instanceof Element ? e.target.closest('a, button') : null);
}

function onPointerOut(e) {
  const rel = e.relatedTarget;
  if (rel && state.hoverEl && state.hoverEl.contains(rel)) return;
  if (rel instanceof Element) {
    const next = rel.closest('a, button');
    if (next) { setHoverElement(next); return; }
  }
  setHoverElement(null);
}

const clearHover = () => {
  state.hoverEl = null;
  setHoverTarget(null);
};

/* ============================================================================
 * 8. TIER / SIZE
 * ==========================================================================*/

function pickTier(width) {
  if (width < TUNING.mobileBreakpoint) return 'mobile';
  if (width < TUNING.tabletBreakpoint) return 'tablet';
  return 'desktop';
}

/** The quality tier: `?quality=` wins, otherwise the device tier's default
 *  (mobile -> low, tablet -> medium, desktop -> high). Phase E builds the
 *  full hardware heuristic on top of this. */
function pickQuality(deviceTier) {
  const forced = TUNING.quality.forceTier;
  if (forced === 'high' || forced === 'medium' || forced === 'low') return forced;
  const auto = deviceTier === 'mobile' ? 'low' : deviceTier === 'tablet' ? 'medium' : 'high';
  TUNING.quality.autoTier = auto;
  return auto;
}

function pixelRatioFor(tier) {
  if (state.qualityStep >= 1) return 1;
  const cap = tier === 'mobile' ? TUNING.mobileMaxPixelRatio : TUNING.maxPixelRatio;
  return Math.min(window.devicePixelRatio || 1, cap);
}

function applyTier(tier) {
  state.tier = tier;
  const layout = TUNING.TIER[tier];

  state.pixelRatio = pixelRatioFor(tier);
  state.renderer.setPixelRatio(state.pixelRatio);

  /* The quality tier follows the device tier too: crossing to mobile drops the
     bokeh layer even though the props themselves are hidden there. */
  state.quality = pickQuality(tier);
  setMaterialQuality(state.quality);

  /* Bloom is desktop-only, and the adaptive watchdog may also have removed it. */
  const wantBloom = TUNING.bloom.enabled && tier === 'desktop' && state.qualityStep < 2;
  if (wantBloom && !state.composer) createComposer();
  if (!wantBloom && state.composer) disposeComposer();

  buildParticles(Math.round(particleCountFor(tier) * (state.qualityStep >= 3 ? 0.4 : 1)));
  buildBokeh();

  for (const key of OBJ_KEYS) {
    const o = state.objects[key];
    /* The tier's `scaleMul` only SEEDS the scale: from the first solve on, the
       world scale is the one the validator sized the prop to, so a quality step
       can never quietly put the drawn size back under the floor the box
       reports. */
    o.baseScale = TUNING.objectScale * layout.scaleMul;
    o.group.scale.setScalar(o.baseScale);
    o.group.visible = !(tier === 'mobile' && TUNING.hideOnMobile.includes(key));
  }

  syncSize();
  state.engine.remeasure();
}

function syncSize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  state.camera.aspect = w / h;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(w, h, false);
  if (state.composer) {
    state.composer.setPixelRatio(state.pixelRatio);
    state.composer.setSize(w, h);
  }
  if (state.particles) state.particles.material.uniforms.uPixelRatio.value = state.pixelRatio;
  if (state.bokeh) state.bokeh.material.uniforms.uPixelRatio.value = state.pixelRatio;
}

let resizeRaf = 0;
function onResize() {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    const tier = pickTier(window.innerWidth);
    if (tier !== state.tier) applyTier(tier);
    else {
      state.pixelRatio = pixelRatioFor(tier);
      state.renderer.setPixelRatio(state.pixelRatio);
      syncSize();
      state.engine.remeasure();
    }
    if (state.reduced) renderOnce();
  });
}

/* ============================================================================
 * 9. ADAPTIVE QUALITY — one-way step-down, never oscillates
 * ==========================================================================*/

function stepDownQuality(reason) {
  const order = TUNING.adaptive.steps;
  if (state.qualityStep >= order.length) return;
  const step = order[state.qualityStep];
  state.qualityStep += 1;
  state.frameAcc = 0;
  state.frameCount = 0;
  log(`quality step ${state.qualityStep} (${step}) — ${reason}`);

  if (step === 'pixelRatio') {
    state.pixelRatio = 1;
    state.renderer.setPixelRatio(1);
    syncSize();
  } else if (step === 'bloom') {
    disposeComposer();
  } else if (step === 'particles') {
    buildParticles(Math.round(particleCountFor(state.tier) * 0.4));
  }
}

function watchPerf(dt) {
  const A = TUNING.adaptive;
  state.frameAcc += dt;
  state.frameCount += 1;
  if (state.frameCount < A.sampleFrames) return;
  const fps = state.frameCount / state.frameAcc;
  state.frameAcc = 0;
  state.frameCount = 0;
  const reason = `${fps.toFixed(0)} fps`;
  /* A critical frame rate skips two steps at once — one is rarely enough. */
  if (fps < A.fpsCritical) { stepDownQuality(reason); stepDownQuality(reason); }
  else if (fps < A.fpsFloor) stepDownQuality(reason);
}

/* ============================================================================
 * 10. FRAME
 * ==========================================================================*/

function renderFrame() {
  if (state.composer) state.composer.render();
  else state.renderer.render(state.scene, state.camera);
}

/** World point under the pointer, at the props' depth — what the dust scatters
 *  around. Scratched from the camera ray, never stored. */
function updateDustPointer(mat) {
  _dustPtr.set(state.pointerSmooth.x, state.pointerSmooth.y, 0.5).unproject(state.camera);
  _dustPtr.sub(state.camera.position).normalize().multiplyScalar(7.0).add(state.camera.position);
  mat.uniforms.uPointer.value.copy(_dustPtr);
}

/** Pushes the sampled stop values onto the camera / fog / exposure. */
function applySample(s) {
  const layout = TUNING.TIER[state.tier];

  state.camera.position.set(s.cam.x, s.cam.y, s.cam.z + layout.camPush + (state.dolly || 0));
  if (Math.abs(state.camera.fov - s.fov) > 0.01) {
    state.camera.fov = s.fov;
    state.camera.updateProjectionMatrix();
  }
  state.camera.lookAt(s.look.x, s.look.y, s.look.z);
  /* The layout validator projects the props' 8 corners through this camera
     BEFORE the frame is rendered, so the world matrix and its inverse have to
     be current here — otherwise every box is one frame stale from the pose the
     camera is actually drawn at. */
  state.camera.updateMatrixWorld(true);

  /* "Dim + push away": thicker fog and lower exposure away from the hero. */
  const dim = s.exposure * layout.exposureMul;
  state.scene.fog.density = lerp(TUNING.fog.densityFar, TUNING.fog.densityNear, clamp(dim, 0, 1));
  state.renderer.toneMappingExposure =
    lerp(TUNING.exposure.far, TUNING.exposure.near, clamp(dim, 0, 1)) * layout.exposureMul;
}

/**
 * Places every prop for the current scroll position.
 *
 * The layout validator (scroll.js) takes the AUTHORED position for the section
 * and checks it against the measured page: inside the band, clear of the copy,
 * clear of the props already placed. On a collision it tries the authored
 * `alt`, then nudges the prop at its full size along the nearest free
 * direction, and it says which in `place.state`. It never answers "shrink it to
 * nothing and dim it until nobody can see it" — that ladder is why the props
 * used to vanish in Features, Flow and Clarity. `place.opacity` is the only
 * thing that can take a prop out of the frame, and it is damped, so a prop
 * that cannot be placed FADES rather than cuts.
 */
function placeObjects(s, dt, elapsed, scrollY) {
  const layout = TUNING.TIER[state.tier];
  const G = TUNING.gutters;
  const P = TUNING.props;
  const V = TUNING.velocity;
  const R = TUNING.rotation;
  const vel = state.velocity;
  const vh = window.innerHeight;
  _linkScrollY = scrollY;

  /* Hand the validator the pose each prop is actually drawn in right now, so
     the box it projects is the box the mesh occupies this frame rather than a
     rest pose the page never holds. */
  for (const key of OBJ_KEYS) {
    const o = state.objects[key];
    const b = state.bounds[key];
    if (!o || !b) continue;
    b.quat.copy(o.group.quaternion);
    b.offX = o.group.position.x;
    b.offY = o.group.position.y;
  }

  /* One batch solve for all three props: validate the authored spots, size
     them at or above their floor, keep them apart, and unproject the box
     CENTRE — in that order, so nothing can overlap. */
  const places = state.engine.layout(s, scrollY, state.camera, state.bounds);

  for (const key of OBJ_KEYS) {
    const o = state.objects[key];
    if (!o.group.visible) continue;

    const anchor = s.anchors[key];
    const place = places[key];
    o.state = place.state;
    o.collided = place.collided;
    _linkCy[key] = place.cy;

    /* Damp toward the solved position so a changing free band glides. If the
       prop has drifted more than `lagCapPx` from where the fresh solve wants
       it — a fast scroll, or a free band that moved — it chases at the fast
       rate so it cannot sit visibly off its anchor while the page keeps its
       place. World distance is converted to screen px at the prop's depth. */
    o.target.set(place.x, place.y, place.z);
    /* `place.z` is the prop's own world depth — the solver unprojects to the
       distance it sized for — so the view-axis distance is the camera's z
       minus that, not a remembered base distance plus a remembered z. */
    const distProp = Math.max(0.5, state.camera.position.z - o.target.z);
    const pxPerWorld = vh / (2 * Math.tan((state.camera.fov * Math.PI) / 360) * distProp);
    const lagPx = Math.hypot(o.anchor.position.x - o.target.x, o.anchor.position.y - o.target.y) * pxPerWorld;
    const lambda = lagPx > TUNING.scroll.lagCapPx
      ? TUNING.scroll.lagFastDamping
      : TUNING.scroll.damping * 1.6;
    o.anchor.position.x = damp(o.anchor.position.x, o.target.x, lambda, dt);
    o.anchor.position.y = damp(o.anchor.position.y, o.target.y, lambda, dt);
    o.anchor.position.z = damp(o.anchor.position.z, o.target.z, lambda, dt);


    /* --- Hover: the raycaster, or a hovered link/button carrying data-3d --- */
    o.hover = damp(o.hover, o.hoverTarget, TUNING.hover.damping, dt);
    o.spinMul = damp(o.spinMul, o.hoverTarget ? TUNING.hover.spinMul : 1, TUNING.hover.damping, dt);

    /* --- Focus: one prop is lit, the rest step back --- */
    const focusW = state.focusKey === key ? 1 : 0;
    o.focus = damp(o.focus, focusW, TUNING.focus.damping, dt);
    const others = state.focusKey ? (1 - TUNING.focus.dimOthers) : 1;
    const focusMul = lerp(others, 1, o.focus);

    /* --- Float + parallax, applied to the prop so the anchor stays solved --- */
    const bob = Math.sin(elapsed * TUNING.float.speed + o.phase) * TUNING.float.amp * o.floatAmp;
    const sway = Math.cos(elapsed * TUNING.float.speed * 0.72 + o.phase * 1.3) * TUNING.float.amp * 0.45 * o.floatAmp;
    const depth = clamp(1 - Math.abs(place.z) / 18, 0.3, 1);
    const par = TUNING.parallax.strength * depth * (1 + 0.6 * s.converge);
    o.group.position.set(
      sway + state.pointerSmooth.x * par,
      bob - state.pointerSmooth.y * par * 0.6,
      0
    );

    /* --- Rotation: slow spin, the section's yaw, and scroll-velocity kick --- */
    o.spinY += TUNING.float.spin * o.spin * o.spinMul * dt * 6;
    o.spinY += V.spin * vel * o.spin * dt * 6;
    /* Clarity is the calm section: the spin all but stops. */
    o.group.rotation.y = o.spinY + state.yaw;
    o.group.rotation.x = Math.sin(elapsed * 0.22 + o.phase) * 0.16 * (1 - 0.7 * s.converge);
    o.group.rotation.z =
      Math.cos(elapsed * 0.19 + o.phase * 0.8) * 0.12 * (1 - 0.7 * s.converge)
      + V.tilt * vel * Math.sin(elapsed * 1.7 + o.phase);
    /* Rotation clamp: a fast scroll's kick (or a long spin) can never lay a
       prop over the camera — the bob/tilt stays within ±`maxTilt`. */
    o.group.rotation.z = clamp(o.group.rotation.z, -R.maxTilt, R.maxTilt);

    /* --- Scale: the world scale the validator committed, times hover (and,
     * while the entrance is running, the prop's own arrival scale).
     * Velocity stretches along the local Z (the direction of travel). There is
     * no safe-mode multiplier any more: the validator refused any size below
     * its floor, and scaling it down again is what used to erase it. The
     * commit is the DRAWING, so the box the overlay draws and the mesh the
     * GPU renders are the same size. --- */
    const fitScale = place.scale;
    const target = fitScale * lerp(1, TUNING.hover.scale, o.hover);
    const cs = damp(o.group.scale.x, target, TUNING.hover.damping, dt);

    /* --- ENTRANCE (additive, on top of everything the solver committed) ---
     * The prop starts ~0.6vh BELOW its place (screen px converted to world
     * units at its own depth, so the move reads the same size on any screen),
     * at startScale, yawed ~25° to its side, hidden. As it arrives it rises,
     * grows, straightens and lights up, easing out with a small overshoot.
     *
     * `introK` is the UNclamped curve so the overshoot passes through the
     * position and rotation; `introP` is clamped for scale and opacity. When
     * the intro never ran (`introP` undefined) or has finished, every term is
     * 1/0 and the pose is exactly the solver's, byte for byte. */
    const entra = state.intro.active && o.introK !== undefined
      ? { k: o.introK, p: o.introP }
      : { k: 0, p: 1 };
    const riseWorld = ((1 - entra.k) * ENTRANCE.riseFraction * vh) / pxPerWorld;
    o.group.position.y -= riseWorld;
    o.group.rotation.y += (1 - entra.k) * ENTRANCE.startRotY;
    /* Yaw clamp: space spin, the velocity kick and the entrance's own 25° all
       sit INSIDE ±`maxYaw` of the section's authored facing (state.yaw) — a
       prop is discovered from the side, never dispatched from its column. */
    o.group.rotation.y = clamp(o.group.rotation.y, state.yaw - R.maxYaw, state.yaw + R.maxYaw);
    const entrScale = lerp(ENTRANCE.startScale, 1, entra.p);
    o.opacityVis = entra.p;
    o.group.scale.set(cs * entrScale, cs * entrScale, cs * (1 + V.stretch * vel) * entrScale);

    /* --- USB: the plug yaws so its long axis and its cable point OUTWARD,
     * away from the text column. The side the solver settled on is the whole
     * signal, so a prop that had to cross to the other gutter still points
     * out of the composition. --- */
    if (key === 'usb' && o.obj.outwardTarget !== undefined) {
      const U = P.usb;
      o.obj.outwardTarget = U.cableOutward ? (place.side === 'left' ? U.yaw : -U.yaw) : 0;
      o.obj.outwardYaw = damp(o.obj.outwardYaw, o.obj.outwardTarget, TUNING.hover.damping * 0.7, dt);
    }

    /* --- Glow: section dim x behind-card dim x band fade x authored opacity
     *         x focus x hover --- */
    const softMul = place.behind ? G.softDim : 1;
    /* `place.fade` is 1 everywhere except the reserved strip under the sticky
     * header, where it ramps to 0. That is what turns the old hard straight
     * cut across a prop into a soft dissolve. */
    const bandMul = place.fade === undefined ? 1 : place.fade;
    /* The authored opacity is DAMPED, so a prop the validator could not place
       dissolves instead of cutting, and a prop the page stops asking for fades
       out the same way. */
    o.opacity = damp(o.opacity, place.opacity === undefined ? 1 : place.opacity, TUNING.focus.damping, dt);
    const raw = clamp(s.exposure * anchor.dim * layout.exposureMul, 0, 1.4)
      * focusMul * softMul * bandMul;
    /* `props.minOpacity` is the floor that makes "always visible" true even at
     * the worst moment of the header fade: the prop softens, it never goes
     * out. It sits INSIDE the authored opacity, because an authored 0 is a
     * placement decision, not a dim, and must not be floored back into view. */
    const dim = Math.max(raw, P.minOpacity * layout.exposureMul) * o.opacity;
    /* The entrance gates the WHOLE visual AFTER the authored-opacity floor, so
       a prop that could not be placed stays invisible while it would have been
       there and can never be floored back into view mid-arrival. */
    const dimShown = dim * (o.opacityVis === undefined ? 1 : clamp(o.opacityVis, 0, 1));
    const glow = (0.55 + 0.45 * dimShown) * (1 + (TUNING.hover.glow - 1) * o.hover);


    for (const m of o.materials) {
      const ud = m.userData || {};
      if (m.emissiveIntensity !== undefined && ud.baseEmissive !== undefined) {
        m.emissiveIntensity = ud.baseEmissive * dimShown * glow;
      }
      if (ud.baseEnv !== undefined) {
        m.envMapIntensity = ud.baseEnv * (0.5 + 0.5 * clamp(dimShown, 0, 1)) * (1 + 0.6 * o.hover);
      }
      if (ud.rim) ud.rim.uRimStrength.value = (ud.baseRim || 0) * dimShown * glow;
    }

    _objCtx.glow = clamp(glow, 0, 3);
    _objCtx.dim = dimShown;
    o.obj.update(elapsed, dt, _objCtx);

    _linkPositions[key] = o.anchor.position;
  }

  /* Feed the flow links the text column at their OWN height (see
     linkColumnFor) so a tube fades out exactly where it would cross copy —
     and stays at full strength where it would not. */
  if (state.links) {
    _linkCtx.flow = s.flow;
    if (s.flow > 0.02) {
      /* _linkCtx.columnFor resolves per link; `column` stays a sane default
         for a frame where the per-link path is not available. */
      _linkCtx.column = _colScratch;
      state.links.update(state.elapsed, dt, _linkCtx, _linkPositions, state.camera);
    } else {
      _linkCtx.flow = 0;
      state.links.update(state.elapsed, dt, _linkCtx, _linkPositions, state.camera);
    }
  }

  if (TUNING.debug) {
    drawDebugOverlay(places);
    logPlacement(places, s.sectionId);
  }
}

/* ============================================================================
 * 10a. DEBUG OVERLAY + PLACEMENT LOG (?scene3d=debug)
 * ----------------------------------------------------------------------------
 * The clearance solver is a search, so "why is that prop over that sentence?"
 * is not answerable by reading the page — it needs the search itself. This
 * draws the three things the solve was working from:
 *
 *   red   the measured obstacles (real text line extents, boxes, cards)
 *   green every candidate that was ACCEPTED, faint the ones that were refused
 *   blue  the header band reserved for the sticky nav
 *   solid the box each prop actually committed to, plus its size in px
 *
 * `logPlacement()` prints the same story to the console, but only when the
 * picture actually changes — the section, or a prop docking — so scrolling
 * through a section does not produce a line per frame.
 * ==========================================================================*/

const DEBUG_KEY_COLORS = { hd: '#38bdf8', usb: '#a3e635', network: '#f472b6' };
let _debugCanvas = null;
let _debugCtx = null;
let _debugSig = '';

function ensureDebugOverlay() {
  if (!TUNING.debug || _debugCanvas || !document.body) return;
  const c = document.createElement('canvas');
  c.id = 'scene3d-debug';
  c.setAttribute('aria-hidden', 'true');
  c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;'
    + 'z-index:65;pointer-events:none;';
  document.body.appendChild(c);
  _debugCanvas = c;
  _debugCtx = c.getContext('2d');
}

function removeDebugOverlay() {
  if (_debugCanvas && _debugCanvas.parentNode) _debugCanvas.parentNode.removeChild(_debugCanvas);
  _debugCanvas = null;
  _debugCtx = null;
  _debugSig = '';
}

/** Shared scratch for the debug overlay's world->screen projection check. */
const _proj = new THREE.Vector3();

/**
 * ?scene3d=debug: draws what the validator SAW, not what it hoped for.
 *
 *   1. the measured obstacles, in red, in viewport space
 *   2. the band the boxes have to live in, and the reserved header band
 *   3. each prop's AUTHORED anchor, as a dashed cross
 *   4. each prop's PROJECTED box, from the same 8 corners the mesh is drawn
 *      from, with the numeric size, the offset from its authored anchor, and
 *      what the validator did about it
 *   5. the floor line under each box, so an under-sized prop is visible
 *
 * The box and the cross share a centre by construction (scroll.js centres the
 * prop on its own box and unprojects that centre), so the offset readout is the
 * projection's own error, not a fudge factor.
 */
const _liveVec = new THREE.Vector3();

/**
 * The prop's ACTUAL rendered centre, read back off its own anchor and pushed
 * through the live camera — not the solver's number. This is the self-check:
 * the solver's NDC, the unprojection, the group offset and the scale the scene
 * applied all have to agree with it, or the box is being drawn somewhere the
 * prop is not. The float/bob offset is deliberate motion layered on top of the
 * placement, so it is not part of what is being checked.
 */
function liveMark(key, place, vw, vh) {
  const o = state.objects[key];
  if (!o || !o.anchor) return null;
  _liveVec.copy(o.anchor.position).project(state.camera);
  const x = (_liveVec.x * 0.5 + 0.5) * vw;
  const y = (1 - _liveVec.y * 0.5) * 0.5 * vh;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, err: place ? Math.hypot(x - place.cxPx, y - place.cyPx) : 0 };
}

function drawDebugOverlay(places) {
  if (!_debugCtx) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(vw * dpr);
  const h = Math.round(vh * dpr);
  if (_debugCanvas.width !== w || _debugCanvas.height !== h) {
    _debugCanvas.width = w;
    _debugCanvas.height = h;
  }
  const g = _debugCtx;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  let worstLive = 0;
  let worstLiveAt = '—';
  g.clearRect(0, 0, vw, vh);

  const data = state.engine.debugData;
  const scrollY = _linkScrollY;

  /* 1. measured obstacles, in viewport space */
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(248,113,113,0.5)';
  g.fillStyle = 'rgba(248,113,113,0.08)';
  for (const r of data.obstacles) {
    const y = r.y0 - scrollY;
    if (y > vh || y + (r.y1 - r.y0) < 0) continue;
    g.fillRect(r.x0, y, r.x1 - r.x0, r.y1 - r.y0);
    g.strokeRect(r.x0, y, r.x1 - r.x0, r.y1 - r.y0);
  }

  /* 2. the band a box has to stay inside, and the reserved header strip */
  g.strokeStyle = 'rgba(249,115,22,0.55)';
  g.setLineDash([6, 4]);
  g.beginPath();
  g.moveTo(0, Math.round(data.bandTopPx) + 0.5);
  g.lineTo(vw, Math.round(data.bandTopPx) + 0.5);
  g.moveTo(0, Math.round(data.bandBottomPx) + 0.5);
  g.lineTo(vw, Math.round(data.bandBottomPx) + 0.5);
  g.stroke();
  g.setLineDash([]);
  if (data.bandPx > 0) {
    g.fillStyle = 'rgba(56,189,248,0.10)';
    g.fillRect(0, 0, vw, data.bandPx);
    g.strokeStyle = 'rgba(56,189,248,0.45)';
    g.beginPath();
    g.moveTo(0, data.bandPx + 0.5);
    g.lineTo(vw, data.bandPx + 0.5);
    g.stroke();
  }

  g.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.textBaseline = 'top';

  /* 3 + 4 + 5. the authored cross, the projected box, and the numbers */
  for (const key of OBJ_KEYS) {
    const p = places[key];
    if (!p) continue;
    const o = state.objects[key];
    const color = DEBUG_KEY_COLORS[key] || '#ffffff';
    const auth = data.authored[key] || { x: 0, y: 0, size: 0 };
    const hidden = p.state === 'hidden';

    /* the authored anchor, as asked for */
    const ax = auth.x;
    const ay = auth.y - scrollY;
    if (ay > -40 && ay < vh + 40) {
      g.strokeStyle = hidden ? 'rgba(148,163,184,0.45)' : 'rgba(148,163,184,0.8)';
      g.setLineDash([3, 3]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(ax - 9, ay); g.lineTo(ax + 9, ay);
      g.moveTo(ax, ay - 9); g.lineTo(ax, ay + 9);
      g.stroke();
      g.setLineDash([]);
    }

    /* the projected box, exactly as the mesh's 8 corners land on screen */
    g.strokeStyle = p.collided ? 'rgba(248,113,113,0.95)' : color;
    g.lineWidth = p.nudged ? 3 : 2;
    g.strokeRect(p.x0, p.y0 - scrollY, p.wPx, p.hPx);
    if (o) {
      /* the box the GPU is actually drawing, filled in faintly */
      g.fillStyle = hidden ? 'rgba(100,116,139,0.10)' : 'rgba(226,232,240,0.07)';
      g.fillRect(p.x0, p.y0 - scrollY, p.wPx, p.hPx);
    }

    /* the floor it may not go under, and the size it committed to */
    const floorY = p.y0 - scrollY + p.hPx + 6;
    const shortBy = p.floorPx - p.committedPx;
    g.strokeStyle = shortBy > 1 ? 'rgba(248,113,113,0.9)' : 'rgba(74,222,128,0.55)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(p.x0, floorY + 0.5);
    g.lineTo(p.x0 + p.wPx, floorY + 0.5);
    g.stroke();
    /* where the prop is actually being drawn, read back off its own anchor */
    const live = liveMark(key, p, vw, vh);
    g.strokeStyle = live ? color : 'rgba(248,113,113,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(live.x - 7, live.y); g.lineTo(live.x + 7, live.y);
    g.moveTo(live.x, live.y - 7); g.lineTo(live.x, live.y + 7);
    g.stroke();
    g.fillStyle = p.collided ? '#fecaca' : '#e2e8f0';
    const tag = `${key} ${Math.round(p.committedPx)}px`
      + (p.clamped
        ? (p.committedPx < p.authoredPx ? ` (floor ${Math.round(p.floorPx)})` : ' (cap)')
        : '')
      + ` Δ${live ? live.err.toFixed(1) : '--'}`
      + (state.intro.active && o ? ` ~${Math.round((o.introP ?? 0) * 100)}%` : '')
      + ` crop${Math.round(p.croppedPx || 0)} · near${Math.round(p.nearestPx || 0)}px`
      + (p.state === 'nudged' ? ' NUDGED' : p.state === 'alt' ? ' ALT' : '');
    g.fillText(tag, Math.max(2, p.x0), Math.max(2, p.y0 - scrollY - 14));
    if (p.collided) {
      g.fillStyle = '#fecaca';
      g.fillText('NO FREE BOX — faded out', Math.max(2, p.x0), Math.max(2, p.y0 - scrollY + p.hPx + 10));
    }
    if (live && live.err > worstLive) { worstLive = live.err; worstLiveAt = key; }
  }

  /* 6. one block of state, top-left, out of the way of the nav */
  const st = data.stats || {};
  g.lineWidth = 1;
  g.fillStyle = 'rgba(11,15,18,0.75)';
  g.fillRect(0, data.bandPx + 4, 300, 88);
  g.fillStyle = '#e2e8f0';
  g.fillText(`#${data.sectionId}  ${Math.round(window.scrollY)}px  ${vw}x${vh}  ${data.variant}`, 8, data.bandPx + 10);
  g.fillStyle = '#94a3b8';
  g.fillText(`obstacles ${data.obstacles.length} (text ${st.text || 0} box ${st.box || 0} chip ${st.chip || 0} card ${st.card || 0} chrome ${st.chrome || 0})`, 8, data.bandPx + 26);
  g.fillText(`dropped ${st.wrapper || 0} wrappers  ${st.wide || 0} over-wide  band ${Math.round(data.bandTopPx)}-${Math.round(data.bandBottomPx)}`, 8, data.bandPx + 42);
  const introTxt = state.intro.active
    ? 'entrance active'
    : (state.intro.finished ? 'entrance done' : 'entrance idle');
  const cropRow = OBJ_KEYS.map(k => Math.round((places[k] && places[k].croppedPx) || 0)).join('/');
  g.fillText(`crops ${cropRow}px  ${introTxt}`, 8, data.bandPx + 74);
  g.fillStyle = worstLive < CENTER_TOLERANCE_PX ? '#86efac' : '#fecaca';
  g.fillText(`worst box/marker offset ${worstLive.toFixed(2)}px at ${worstLiveAt}`
    + ` (tolerance ${CENTER_TOLERANCE_PX}px)`, 8, data.bandPx + 58);
}

/** One console line per section: what was asked for, and what was committed. */
function logPlacement(places, sectionId) {
  const parts = OBJ_KEYS
    .map((k) => `${k}=${places[k] ? places[k].state : '-'}`)
    .join(' ');
  const sig = `${sectionId}|${parts}`;
  if (sig === _debugSig) return;
  _debugSig = sig;
  const sizes = OBJ_KEYS
    .map((k) => {
      const p = places[k];
      if (!p) return `${k} -`;
      return `${k} ${Math.round(p.committedPx)}px@${Math.round(p.cxPx)}`;
    })
    .join('  ');
  const lost = OBJ_KEYS.filter((k) => places[k] && places[k].collided);
  const floor = Math.round(TUNING.props.minScreenFraction * window.innerWidth);
  if (lost.length) {
    log(`placement ${sectionId}: ${parts} — ${lost.join('+')} had no free box inside the band after the nudge, so it faded out at full size instead of shrinking under the ${floor}px floor`);
  } else {
    log(`placement ${sectionId}: ${parts} — ${sizes}`);
  }
}

/* ============================================================================
 * 10b. RAYCAST — hover and click-to-scroll
 * ----------------------------------------------------------------------------
 * The canvas is `pointer-events: none`, so the DOM always wins the cursor.
 * The raycast therefore runs against the props on WINDOW pointer events and
 * is skipped entirely while the pointer is over an interactive element —
 * those carry `data-3d` and have their own, more accurate hover reaction.
 * ==========================================================================*/

/**
 * The focus is whichever prop the visitor is pointing at, from either source:
 * a prop under the cursor, or a link/button carrying `data-3d`. Exactly one
 * function owns it, so the two sources can never fight.
 */
function updateFocus() {
  const fromRay = state.rayBlocked ? null : state.rayKey;
  const fromDom = state.hoverEl ? toObjectKey(toolIdFor(state.hoverEl)) : null;
  state.focusKey = fromRay || fromDom || null;
}

function updateRaycast() {
  if (!state.raycaster) { state.rayKey = null; return; }
  if (state.rayBlocked) { state.rayKey = null; return; }

  let hitKey = null;
  state.raycaster.setFromCamera(state.rayNdc, state.camera);
  for (const key of OBJ_KEYS) {
    const o = state.objects[key];
    if (!o.group.visible || !o.hit.length) continue;
    if (state.raycaster.intersectObjects(o.hit, false).length) { hitKey = key; break; }
  }
  state.rayKey = hitKey;

  /* While the pointer is not over an interactive element the raycast owns the
     hover reaction, so the props still react to a hover anywhere on the page. */
  setHoverTarget(hitKey);
}

/** Click on empty space (or on the prop itself) scrolls to that tool's card. */
function onClick(e) {
  if (!TUNING.pointer.clickScroll) return;
  if (e.button !== undefined && e.button !== 0) return;
  const key = state.rayKey;
  if (!key) return;
  const sectionId = FOCAL_TARGET[key];
  const el = sectionId && document.getElementById(sectionId);
  if (!el) return;
  el.scrollIntoView({ behavior: state.reduced ? 'auto' : 'smooth', block: 'start' });
}

/** Renders exactly one frame with no time-based motion (reduced motion, resize). */
function renderOnce() {
  if (!state.renderer) return;
  const scrollY = window.scrollY || 0;
  _linkScrollY = scrollY;
  const s = state.engine.sample(state.progress, scrollY);
  state.yaw = s.yaw;
  applySample(s);
  for (const key of OBJ_KEYS) {
    const o = state.objects[key];
    const b = state.bounds[key];
    if (b) { b.quat.copy(o.group.quaternion); b.offX = o.group.position.x; b.offY = o.group.position.y; }
  }
  const places = state.engine.layout(s, scrollY, state.camera, state.bounds);
  for (const key of OBJ_KEYS) {
    const o = state.objects[key];
    if (!o.group.visible) continue;
    const place = places[key];
    o.state = place.state;
    o.collided = place.collided;
    o.opacity = place.opacity;
    o.target.set(place.x, place.y, place.z);
    o.anchor.position.set(place.x, place.y, place.z);
    o.spinY = 0;
    o.group.rotation.set(
      Math.sin(o.phase) * 0.16,
      state.yaw,
      Math.cos(o.phase * 0.8) * 0.12
    );
    o.group.scale.setScalar(place.scale);
    _linkPositions[key] = o.anchor.position;
    _linkCy[key] = place.cy;
  }
  if (state.links) {
    _linkCtx.flow = s.flow;
    _linkCtx.column = [-1, 1];
    state.links.update(0, 0, _linkCtx, _linkPositions, state.camera);
  }
  if (state.particles) state.particles.material.uniforms.uTime.value = 0;
  if (state.bokeh) state.bokeh.material.uniforms.uTime.value = 0;
  renderFrame();
  if (TUNING.debug) drawDebugOverlay(places);
}

function animate(now) {
  if (!state.running) return;
  state.rafId = requestAnimationFrame(animate);

  const dt = Math.min((now - state.lastTime) / 1000, 0.05); /* clamp after tab switches */
  state.lastTime = now;
  state.elapsed += dt;
  updateEntrance(now);
  /* Before the intro is done the page is locked to the hero, so the scene must
     be too. Reading `window.scrollY` here would let a restored scroll position
     (or a stray touch) drag the whole 3D layout mid-intro. */
  const scrollY = state.scrollUnlocked || state.reduced
    ? (window.scrollY || window.pageYOffset || 0)
    : 0;

  let s = state.engine.out;
  if (!state.reduced) {
    state.progressTarget = state.engine.computeProgress(scrollY);
    state.progress = damp(state.progress, state.progressTarget, TUNING.scroll.damping, dt);
    s = state.engine.sample(state.progress, scrollY);
    state.yaw = damp(state.yaw, s.yaw, TUNING.scroll.damping, dt);

    state.pointerSmooth.x = damp(state.pointerSmooth.x, state.pointer.x, TUNING.parallax.damping, dt);
    state.pointerSmooth.y = damp(state.pointerSmooth.y, state.pointer.y, TUNING.parallax.damping, dt);
    /* the dust field settles (and wakes) at its own rate, independent of the
       parallax that drives the camera */
    state.dustActive = damp(state.dustActive, state.pointerActive ? 1 : 0, TUNING.dust.fade, dt);
  }

  /* --- Scroll velocity -> spin / tilt / stretch / particle streaks --- */
  const rawVel = state.reduced
    ? 0
    : clamp(Math.abs(scrollY - state.lastScrollY) / Math.max(dt, 1e-4) / TUNING.velocity.max, 0, 1);
  state.lastScrollY = scrollY;
  state.velocity = damp(state.velocity, rawVel, TUNING.velocity.damping, dt);

  applySample(s);
  state.camera.position.x += state.pointerSmooth.x * TUNING.parallax.strength * 0.30;
  state.camera.position.y -= state.pointerSmooth.y * TUNING.parallax.strength * 0.20;

  updateRaycast();
  updateFocus();
  placeObjects(s, dt, state.elapsed, scrollY);

  if (state.props) state.props.update(state.elapsed);
  if (state.particles) {
    const mat = state.particles.material;
    mat.uniforms.uTime.value = state.elapsed;
    mat.uniforms.uStreak.value = state.velocity * TUNING.velocity.streak;
    if (mat.uniforms.uPointer) {
      updateDustPointer(mat);
      mat.uniforms.uPointerStr.value = state.dustActive * TUNING.dust.strength;
    }
  }
  if (state.bokeh) state.bokeh.material.uniforms.uTime.value = state.elapsed;

  renderFrame();
  watchPerf(dt);
}

/* ============================================================================
 * 10b. STICKY HEADER BAND
 * #navbar turns opaque (`nav-solid`) the moment the page is scrolled, and that
 * opaque strip paints OVER the canvas. The solver reserves a band for it so no
 * prop is ever sliced by a hard straight edge; this is the one place that
 * knows when the strip exists. A MutationObserver on the class keeps it off the
 * frame budget (a per-frame classList read plus a reflow is not free).
 * ==========================================================================*/
function watchHeaderBand() {
  const nav = document.getElementById('navbar');
  if (!nav || !state.engine) return;
  const sync = () => {
    try { state.engine.setHeaderSolid(nav.classList.contains('nav-solid')); }
    catch (e) { /* never let a header detail break the scene */ }
  };
  sync();
  try {
    new MutationObserver(sync).observe(nav, { attributes: true, attributeFilter: ['class'] });
  } catch (e) { /* MutationObserver unsupported: the resize path still measures */ }
}

/**
 * Opens the scroll-follow. The scene is held on the hero until the intro is
 * genuinely over — the fly-in finishing, the intro module announcing it, or
 * the `intro-done` class the inline failsafe in index.html always adds.
 * Idempotent, and deliberately separate from `intro.finished`, which is the
 * fly-in's own once-only guard.
 */
function unlockScrollFollow() {
  if (state.scrollUnlocked) return;
  state.scrollUnlocked = true;
}

/* ============================================================================
 * 10c. INTRO ENTRANCE (3.6s - ~5.1s)
 * Props arrive from the BOTTOM of the screen, additive: each one starts ~0.6vh
 * below its solved place (converted to world units at its own depth), at 0.85x
 * scale, ~25° yawed to its side and fully transparent, then rises, scales,
 * straightens and lights up with a small overshoot. The camera dollies in
 * behind them and the particles fade up. It is driven by the intro module
 * (which raises `toolapis:intro-curtain` the moment the loader curtain starts
 * rising; `toolapis:intro-complete` is the fallback for the short variants),
 * but the scene is fully usable — and the props fully placed — whether or not
 * it ever runs, and reduced motion snaps straight to the final pose.
 *
 * ADDITIVE, on purpose. The anchor the solver wrote is never touched: the
 * entrance is layered on top of `placeObjects` every frame and removed the
 * model its final, committed pose, so a scroll during the arrival cannot
 * fight a half-written anchor.
 * ==========================================================================*/
const ENTRANCE = TUNING.entrance;

function startFlyIn(detail) {
  /* Once only: a late `intro-complete` must not replay the arrival after the
     props have already settled. Reduced motion never plays it. */
  if (state.intro.active || state.intro.finished || state.reduced) return;
  state.intro.active = true;
  state.intro.t = performance.now();
  /* The curtain event carries when it fired relative to the intro's own boot.
     Under ~2s it is the short 1.5s plan (deep link, no WebGL, a failure), and
     the entrance compresses with it. `intro-complete` (no detail) is assumed
     to be the full-length one. */
  const d = (detail && detail.detail);
  state.intro.short = !!(d && typeof d.at === 'number' && d.at < 2000);

  /* The curtain starts rising, then `delay` ticks before the first prop moves;
     after that each prop starts `stagger` later than the one before it. */
  for (let i = 0; i < ENTRANCE.order.length; i++) {
    const o = state.objects[ENTRANCE.order[i]];
    if (!o) continue;
    o.introP = 0;                       /* clamped 0..1, drives scale/yaw/opacity */
    o.introK = 0;                       /* unclamped, lets the overshoot through */
    o.introStart = state.intro.t + ENTRANCE.delay + i * ENTRANCE.stagger;
    o.introDone = false;
  }
  if (state.particles) state.particles.material.opacity = 0;
  if (state.props) {
    for (const m of state.props.materials || []) {
      if (m.userData.introBase === undefined && typeof m.opacity === 'number') {
        m.userData.introBase = m.opacity;
      }
      m.opacity = 0;
    }
  }
}

/** The per-prop easeOutBack over its own span, plus the overshoot. */
function entranceProgress(t) {
  const c1 = 1 + ENTRANCE.overshoot;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function updateEntrance(now) {
  if (!state.intro.active) return;
  const E = ENTRANCE;
  const dur = state.intro.short ? E.hashDuration : E.duration;

  /* The scene's own backstop, above and beyond the independent head failsafe:
     past `failAtMs` (or the moment the head failsafe fires), everything is
     snapped to its final pose and the entrance is over. */
  const forced = (now - state.intro.t) >= E.failAtMs
    || document.documentElement.classList.contains('reveal-all');

  let latest = 0;
  let remaining = 0;
  for (const key of E.order) {
    const o = state.objects[key];
    if (!o) continue;
    const raw = (now - o.introStart) / dur;
    const t = clamp(raw, 0, 1);
    const k = forced ? 1 : entranceProgress(t);
    const p = forced ? 1 : clamp(k, 0, 1);
    o.introK = k;
    o.introP = p;
    /* Only a prop whose full span has passed is DONE: `p` hits 1 while the
       overshoot tail is still resolving, so finishing on `p===1` would snap
       the last prop mid-air. */
    o.introDone = forced || raw >= 1;
    if (raw < 1) remaining++;
    latest = Math.max(latest, p);
  }

  /* The particles ride the props: gone at the first frame, fully there by the
     time the last prop settles. */
  if (state.particles) {
    state.particles.material.opacity = clamp(latest * 1.25, 0, 1);
  }
  /* Wire, rings and the ground glow follow SLOWER: they are the depth the props
     sit against, so they surface just after their foreground holds still. */
  if (state.props) {
    const bg = clamp(Math.pow(latest * 1.05, 0.72) * 0.96, 0, 1);
    for (const m of state.props.materials || []) {
      if (m.userData.introBase === undefined) continue;
      m.opacity = (m.userData.introBase || 1) * bg;
    }
  }

  /* Short camera dolly-in while the props arrive; settled by the end. */
  const ct = clamp((now - state.intro.t) / Math.min(dur + E.stagger * 3, 2600), 0, 1);
  const eased = 1 - Math.pow(1 - ct, 3);
  state.dolly = (1 - eased) * 2.2;

  if (forced || remaining === 0) {
    state.intro.active = false;
    state.intro.finished = true;
    for (const key of E.order) {
      const o = state.objects[key];
      if (!o) continue;
      o.introDone = true;
      o.introP = 1;
      o.introK = 1;
    }
    if (state.particles) state.particles.material.opacity = 1;
    if (state.props) {
      for (const m of state.props.materials || []) {
        if (m.userData.introBase !== undefined) m.opacity = m.userData.introBase;
      }
    }
    unlockScrollFollow();
  }
}

function start() {
  if (state.running) return;
  state.running = true;
  state.lastTime = performance.now();
  state.rafId = requestAnimationFrame(animate);
}

function stop() {
  state.running = false;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = 0;
}

/* ============================================================================
 * 11. EVENTS
 * ==========================================================================*/

function onPointerMove(e) {
  if (e.pointerType && e.pointerType !== 'mouse') return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  state.pointerActive = true;
  state.pointer.set(
    (e.clientX / vw) * 2 - 1,
    -((e.clientY / vh) * 2 - 1)
  );
  state.rayNdc.copy(state.pointer);

  /* The canvas is pointer-events:none, so elementFromPoint returns whatever
     the visitor can actually see and click. If that is interactive, the
     delegated data-3d hover owns the reaction and the raycast stands down. */
  const top = document.elementFromPoint(e.clientX, e.clientY);
  const interactive = !!(top && top.closest && top.closest('a, button, [role="button"]'));
  state.rayBlocked = interactive;
}

function onPointerLeave() {
  state.rayKey = null;
  state.rayBlocked = false;
  state.pointerActive = false;
  state.pointer.set(0, 0);
}

function onVisibilityChange() {
  if (document.hidden) {
    stop();
  } else if (state.reduced) {
    renderOnce();
    try { window.dispatchEvent(new CustomEvent("toolapis:3d-ready")); } catch (e) {}
  } else {
    state.lastTime = performance.now();
    start();
  }
}

/** Pause when the whole main column has left the viewport. */
function setupInViewObserver() {
  const main = document.getElementById('main-content');
  if (!main || !('IntersectionObserver' in window)) return;
  new IntersectionObserver((entries) => {
    const visible = entries.some((en) => en.isIntersecting);
    if (visible === state.inView) return;
    state.inView = visible;
    if (!visible) {
      stop();
    } else if (state.reduced) {
      renderOnce();
    try { window.dispatchEvent(new CustomEvent("toolapis:3d-ready")); } catch (e) {}
    } else {
      state.lastTime = performance.now();
      start();
    }
  }, { threshold: 0 }).observe(main);
}

function onMediaQueryChange(e) {
  if (e.matches) {
    state.reduced = true;
    /* A mid-entrance switch to reduced motion must not leave a prop frozen
       halfway up the screen: snap the arrival to its final pose. */
    state.intro.active = false;
    state.intro.finished = true;
    for (const key of ENTRANCE.order) {
      const o = state.objects[key];
      if (!o) continue;
      o.introP = 1;
      o.introK = 1;
      o.introDone = true;
    }
    if (state.particles) state.particles.material.opacity = 1;
    if (state.props) {
      for (const m of state.props.materials || []) {
        if (m.userData.introBase !== undefined) m.opacity = m.userData.introBase;
      }
    }
    stop();
    if (TUNING.showStaticOnReducedMotion) renderOnce();
  } else {
    state.reduced = false;
    if (state.inView && !document.hidden) start();
  }
}

let motionQuery = null;

function addListeners() {
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', onResize, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerleave', onPointerLeave, { passive: true });
  window.addEventListener('blur', clearHover);
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('pointerover', onPointerOver, { passive: true });
  document.addEventListener('pointerout', onPointerOut, { passive: true });
  document.addEventListener('click', onClick);
  window.addEventListener('pagehide', dispose, { once: true });

  if (window.matchMedia) {
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motionQuery.addEventListener) {
      motionQuery.addEventListener('change', onMediaQueryChange);
    }
  }
  /* Webfonts reflow the copy, so the measured text rectangles are stale
     until the faces land. */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      state.engine.remeasure();
      if (state.reduced) renderOnce();
    }).catch(() => {});
  }
}

function removeListeners() {
  window.removeEventListener('resize', onResize);
  window.removeEventListener('orientationchange', onResize);
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerleave', onPointerLeave);
  window.removeEventListener('blur', clearHover);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  document.removeEventListener('pointerover', onPointerOver);
  document.removeEventListener('pointerout', onPointerOut);
  document.removeEventListener('click', onClick);
  if (motionQuery && motionQuery.removeEventListener) {
    motionQuery.removeEventListener('change', onMediaQueryChange);
  }
}

/* ============================================================================
 * 12. DISPOSE / BAIL
 * ==========================================================================*/

function disposeSceneGraph(root) {
  root.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) m.dispose();
    }
  });
}

function dispose() {
  stop();
  removeListeners();
  disposeComposer();
  disposeParticles();
  disposeBokeh();

  if (state.props) {
    state.scene.remove(state.props.group);
    disposeSceneGraph(state.props.group);
    state.props.dispose();
    state.props = null;
  }
  if (state.links) {
    state.scene.remove(state.links.group);
    disposeSceneGraph(state.links.group);
    state.links.dispose();
    state.links = null;
  }
  for (const key of OBJ_KEYS) {
    const o = state.objects[key];
    if (!o) continue;
    state.scene.remove(o.anchor);
    disposeObject(o.obj);
  }
  state.trackedMats.length = 0;
  state.objects = {};

  /* Shared procedural material maps (objects.js) are cached module-wide. */
  disposeSharedTextures();

  if (state.pmremRT) {
    state.scene.environment = null;
    state.pmremRT.dispose();
    state.pmremRT = null;
  }
  if (state.renderer) {
    state.renderer.dispose();
    state.renderer.forceContextLoss?.();
    state.renderer = null;
  }
  if (state.canvas && state.canvas.parentNode) {
    state.canvas.parentNode.removeChild(state.canvas);
  }
  state.canvas = null;
  removeDebugOverlay();
  document.documentElement.classList.remove('scene3d');
  log('disposed');
}

/** Undoes everything so the 2D design is exactly as it was.
 *  A caught error is reported with console.error (never swallowed, never
 *  downgraded to a warning): it is the one diagnostic that explains why the
 *  layer is gone, and it must stay in the console exactly as thrown. The
 *  reason alone is only a console.warn. */
function bail(reason, err) {
  stop();
  if (err) {
    console.error(`[scene3d] ${reason}`, err);
  } else {
    warn(reason);
  }
  if (state.canvas && state.canvas.parentNode) state.canvas.parentNode.removeChild(state.canvas);
  state.canvas = null;
  state.renderer = null;
  removeDebugOverlay();
  /* Removing the class is what re-opens .hero-bg's opaque background. */
  document.documentElement.classList.remove('scene3d');
  /* Tell the intro it should stop waiting on a scene that will never exist. */
  try {
    window.dispatchEvent(new CustomEvent('toolapis:3d-unavailable', { detail: { reason } }));
  } catch (e) { /* never let a listener take the page down */ }
}

/** ?scene3d=debug exposes window.__scene3d for console inspection. */
function exposeDebugHandle() {
  if (!TUNING.debug) return;
  window.__scene3d = {
    state, TUNING, STOPS, engine: state.engine,
    info: () => ({
      tier: state.tier,
      quality: state.quality,
      bokeh: !!state.bokeh,
      qualityStep: state.qualityStep,
      bloom: !!state.composer,
      pixelRatio: state.pixelRatio,
      running: state.running,
      section: state.engine.out.sectionId,
      variant: state.engine.out.variant,
      converge: state.engine.out.converge.toFixed(2),
      flow: state.engine.out.flow.toFixed(2),
      velocity: state.velocity.toFixed(2),
      focus: state.focusKey || '-',
      ray: state.rayKey || '-',
      props: OBJ_KEYS.map((k) => {
        const o = state.objects[k];
        const p = state.engine.debugData.chosen[k];
        /* the live anchor vs the box: the number that would go red if the
           solver and the scene ever disagreed again */
        const live = liveMark(k, p, window.innerWidth, window.innerHeight);
        return `${k}:${o.state}${o.collided ? '!' : ''}`
          + (p ? ` ${Math.round(p.committedPx)}px Δ${live ? live.err.toFixed(1) : '--'}` : '');
      }).join('  '),
      drawCalls: state.renderer.info.render.calls,
      triangles: state.renderer.info.render.triangles,
      programs: state.renderer.info.programs?.length ?? 0,
      geometries: state.renderer.info.memory.geometries,
      textures: state.renderer.info.memory.textures,
    }),
    dispose,
    /* The live solve, for the console: the measured rects in page space, the
       authored anchor per prop, and the projected box each prop committed to. */
    debug: state.engine.debugData,
  };
  log('debug handle on window.__scene3d');
}

/* ============================================================================
 * 13. INIT
 * ==========================================================================*/

/**
 * Force-reveals the page and removes the intro overlay. This is the SAME
 * cleanup the intro's own failsafe uses, so any module failure (import
 * failure, CDN outage, runtime throw) can never leave a black screen.
 */
function forceReveal() {
  try {
    const o = document.getElementById('intro-overlay');
    if (o) {
      o.classList.add('is-hidden');
      o.style.display = 'none';
      if (o.parentNode) o.parentNode.removeChild(o);
    }
    const d = document.documentElement;
    if (d) {
      d.style.overflow = ''; d.style.touchAction = '';
      d.classList.remove('intro-lock');
      d.classList.add('intro-done');
    }
    if (document.body) {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
      document.body.classList.remove('intro-lock');
      document.body.classList.add('intro-done');
    }
  } catch (e) { /* a failsafe must never throw */ }
}

function init() {
  try {
    if (!isWebGLAvailable()) {
      bail('WebGL unavailable — 2D design kept as-is.');
      return;
    }

    state.reduced = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

    state.engine = createScrollEngine();

    state.renderer = createRenderer();
    state.raycaster = new THREE.Raycaster();
    createScene();
    createCamera();
    createLights();
    createEnvironment();
    /* Quality is chosen BEFORE the builders run so objects.js can simplify
       materials, halos and background (low tier) while the props are built. */
    state.quality = pickQuality(pickTier(window.innerWidth));
    setMaterialQuality(state.quality);
    createObjects();
    createProps();
    addFlowLinks();

    state.tier = pickTier(window.innerWidth);
    applyTier(state.tier);
    /* The scene starts locked to the hero. Anything the browser restored, and
       anything the 3D module had cached from a previous scroll, is discarded
       here so the first frame is the hero placement — never a mid-page one. */
    state.intro.finished = false;
    state.intro.active = false;
    state.intro.t = 0;
    state.progress = 0;
    state.progressTarget = 0;
    state.velocity = 0;
    state.yaw = 0;
    state.lastScrollY = 0;
    watchHeaderBand();

    /* Prime the first frame BEFORE revealing anything, so the fade-in has no
       flash and there is no layout shift. */
    renderOnce();

    document.documentElement.classList.add('scene3d');
    state.canvas.classList.add('is-ready');
    ensureDebugOverlay();

    addListeners();
    setupInViewObserver();
    exposeDebugHandle();

    if (state.reduced) {
      log('reduced motion: static frame');
      renderOnce();
    } else {
      start();
    }

    /* The intro module owns the timeline: the entrance starts when the loader
       curtain starts rising (`intro-curtain`, ~3.6s) so the props arrive
       while the hero is being uncovered. `intro-complete` stays wired as a
       fallback for the short intro variants, and is a no-op once the entrance
       has already played. If neither ever fires, the scene simply sits in its
       final, correct pose. */
    window.addEventListener('toolapis:intro-curtain', (e) => { try { startFlyIn(e); } catch (err) {} });
    window.addEventListener('toolapis:intro-complete', (e) => { try { startFlyIn(e); } catch (err) {} });

    /* Hand the scene over to the scroll position as soon as the intro is
       genuinely finished — the fly-in ending, the intro module saying so, or
       the `intro-done` class the inline head failsafe in index.html always
       adds at 5.5s. The last one is a timer on its own, so nothing here can
       leave the 3D layout stranded on the hero. */
    window.addEventListener('toolapis:intro-complete', unlockScrollFollow);
    const unlockOnIntroDone = () => {
      if (document.documentElement.classList.contains('intro-done')) unlockScrollFollow();
    };
    unlockOnIntroDone();
    try {
      new MutationObserver(unlockOnIntroDone).observe(document.documentElement, {
        attributes: true, attributeFilter: ['class'],
      });
    } catch (e) { /* no MutationObserver: the failsafe timer below still fires */ }
    setTimeout(unlockScrollFollow, 6500);
    if (state.reduced) unlockScrollFollow();

    log('ready ·', state.tier, state.composer ? '+bloom' : 'no-bloom');
    try { window.dispatchEvent(new CustomEvent('toolapis:3d-ready')); } catch (e) {}
  } catch (err) {
    /* Clean up the half-built scene, then hand the page back to the visitor
       through the one shared cleanup path. */
    bail('3D layer failed to start — 2D design kept as-is.', err);
    forceReveal();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
