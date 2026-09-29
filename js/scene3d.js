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
  buildObject, disposeObject, createBackgroundProps, createParticles, createFlowLinks,
} from './objects.js';
import { createScrollEngine } from './scroll.js';

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
  particles: null,      // { points, material, count }
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
  intro: { active: false, t: 0, finished: false },   /* 3.6-4.9s fly-in */
  dolly: 0,                         /* intro camera dolly, added to cam.z */
  lastTime: 0,

  /* damped scalars */
  progress: 0,
  progressTarget: 0,
  yaw: 0,

  /* pointer */
  pointer: new THREE.Vector2(0, 0),
  pointerSmooth: new THREE.Vector2(0, 0),
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
const _box = new THREE.Box3();
const _sizeV = new THREE.Vector3();
const _colScratch = [-1, 1];

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
  renderer.setClearColor(PALETTE.bg, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
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

  const key = new THREE.DirectionalLight(PALETTE.white, L.key);
  key.position.set(4, 6, 5);
  scene.add(key);

  const lime = new THREE.PointLight(PALETTE.accent, L.lime, 26, 2);
  lime.position.set(-4, 1.2, 3);
  scene.add(lime);

  const kick = new THREE.PointLight(PALETTE.accentHi, L.kick, 22, 2);
  kick.position.set(3.5, -2.5, 1.5);
  scene.add(kick);

  scene.add(new THREE.HemisphereLight(0x223040, 0x05080a, L.hemi));
}

/** One-time PMREM from RoomEnvironment: the premium gloss reflections. */
function createEnvironment() {
  if (!TUNING.env.enabled) return;
  const pmrem = new THREE.PMREMGenerator(state.renderer);
  const envScene = new RoomEnvironment();
  state.pmremRT = pmrem.fromScene(envScene, 0.04);
  state.scene.environment = state.pmremRT.texture;
  pmrem.dispose();
  disposeSceneGraph(envScene);
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
      safe: false,
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

    /* Measure the prop once, in its own local units. The clearance solver
       needs this to size the prop so it fills its gutter WITHOUT crossing the
       viewport edge or the text, at any aspect ratio. */
    _box.setFromObject(obj.group);
    _box.getSize(_sizeV);
    state.bounds[key] = {
      halfW: Math.max(0.05, _sizeV.x * 0.5),
      halfH: Math.max(0.05, _sizeV.y * 0.5),
      fitMax: TUNING.props[key].fit,
    };
  }
}

function createProps() {
  state.props = createBackgroundProps();
  state.scene.add(state.props.group);
}

function addFlowLinks() {
  state.links = createFlowLinks();
  state.scene.add(state.links.group);
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
  const p = createParticles(count);
  state.particles = p;
  p.material.uniforms.uPixelRatio.value = state.pixelRatio;
  state.scene.add(p.points);
}

/* ============================================================================
 * 6. COMPOSER — desktop tier only
 * ==========================================================================*/

function createComposer() {
  disposeComposer();
  const { renderer, scene, camera } = state;
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
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

  /* Bloom is desktop-only, and the adaptive watchdog may also have removed it. */
  const wantBloom = TUNING.bloom.enabled && tier === 'desktop' && state.qualityStep < 2;
  if (wantBloom && !state.composer) createComposer();
  if (!wantBloom && state.composer) disposeComposer();

  buildParticles(Math.round(particleCountFor(tier) * (state.qualityStep >= 3 ? 0.4 : 1)));

  for (const key of OBJ_KEYS) {
    const o = state.objects[key];
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

/** Pushes the sampled stop values onto the camera / fog / exposure. */
function applySample(s) {
  const layout = TUNING.TIER[state.tier];

  state.camera.position.set(s.cam.x, s.cam.y, s.cam.z + layout.camPush + (state.dolly || 0));
  if (Math.abs(state.camera.fov - s.fov) > 0.01) {
    state.camera.fov = s.fov;
    state.camera.updateProjectionMatrix();
  }
  state.camera.lookAt(s.look.x, s.look.y, s.look.z);

  /* "Dim + push away": thicker fog and lower exposure away from the hero. */
  const dim = s.exposure * layout.exposureMul;
  state.scene.fog.density = lerp(TUNING.fog.densityFar, TUNING.fog.densityNear, clamp(dim, 0, 1));
  state.renderer.toneMappingExposure =
    lerp(TUNING.exposure.far, TUNING.exposure.near, clamp(dim, 0, 1)) * layout.exposureMul;
}

/**
 * Places every prop for the current scroll position.
 *
 * The clearance solver (scroll.js) returns a world position that is guaranteed
 * to sit in a horizontally free band at the prop's own height. If no such band
 * exists the prop is pushed far back, shrunk and dimmed instead of overlapping
 * the copy.
 */
function placeObjects(s, dt, elapsed, scrollY) {
  const layout = TUNING.TIER[state.tier];
  const G = TUNING.gutters;
  const V = TUNING.velocity;
  const vel = state.velocity;

  /* One batch solve for all three props: find the free bands, size them, push
     them apart, and unproject — in that order, so nothing can overlap. */
  const places = state.engine.layout(s, scrollY, state.camera, state.bounds);

  for (const key of OBJ_KEYS) {
    const o = state.objects[key];
    if (!o.group.visible) continue;

    const anchor = s.anchors[key];
    const place = places[key];
    o.safe = place.safe;

    /* Damp toward the solved position so a changing free band glides. */
    o.target.set(place.x, place.y, place.z);
    const lambda = TUNING.scroll.damping * 1.6;
    o.anchor.position.x = damp(o.anchor.position.x, o.target.x, lambda, dt);
    o.anchor.position.y = damp(o.anchor.position.y, o.target.y, lambda, dt);
    /* While a prop is flying in, updateFlyIn owns its z — damping it here
       would cancel the motion. */
    if (!(state.intro.active && o.introFrom !== undefined)) {
      o.anchor.position.z = damp(o.anchor.position.z, o.target.z, lambda, dt);
    }

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

    /* --- Scale: the solver's fit x the authored per-stop scale x hover.
     * Velocity stretches along the local Z (the direction of travel). --- */
    const safeScale = o.safe ? G.safeScale : 1;
    const fitScale = place.scale * anchor.scale * o.baseScale * safeScale;
    const target = fitScale * lerp(1, TUNING.hover.scale, o.hover);
    const cs = damp(o.group.scale.x, target, TUNING.hover.damping, dt);
    o.group.scale.set(cs, cs, cs * (1 + V.stretch * vel));

    /* --- Glow: section dim x safe dim x behind-card dim x focus x hover --- */
    const softMul = place.behind ? G.softDim : 1;
    const dim = clamp(s.exposure * anchor.dim * layout.exposureMul, 0, 1.4) * focusMul * softMul;
    const safeDim = o.safe ? G.safeDim : 1;
    const glow = (0.55 + 0.45 * dim) * safeDim * (1 + (TUNING.hover.glow - 1) * o.hover);

    for (const m of o.materials) {
      const ud = m.userData || {};
      if (m.emissiveIntensity !== undefined && ud.baseEmissive !== undefined) {
        m.emissiveIntensity = ud.baseEmissive * dim * glow;
      }
      if (ud.baseEnv !== undefined) {
        m.envMapIntensity = ud.baseEnv * (0.5 + 0.5 * clamp(dim, 0, 1)) * (1 + 0.6 * o.hover);
      }
      if (ud.rim) ud.rim.uRimStrength.value = (ud.baseRim || 0) * dim * glow;
    }

    _objCtx.glow = clamp(glow, 0, 3);
    _objCtx.dim = dim;
    o.obj.update(elapsed, dt, _objCtx);

    _linkPositions[key] = o.anchor.position;
  }

  /* Feed the flow links the text column at their own height so they can fade
     out exactly where they would cross copy. */
  if (s.flow > 0.02) {
    const vh = window.innerHeight;
    const yTop = -1, yBot = 1;
    state.engine.textColumnAt(
      s.sectionId,
      (1 - yTop) * 0.5 * vh + scrollY - vh * 0.5,
      (1 - yBot) * 0.5 * vh + scrollY + vh * 0.5,
      _colScratch
    );
    _linkCtx.flow = s.flow;
    _linkCtx.column = _colScratch;
    state.links.update(state.elapsed, dt, _linkCtx, _linkPositions, state.camera);
  } else if (state.links) {
    _linkCtx.flow = 0;
    state.links.update(state.elapsed, dt, _linkCtx, _linkPositions, state.camera);
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
  const s = state.engine.sample(state.progress, window.scrollY);
  state.yaw = s.yaw;
  applySample(s);
  const places = state.engine.layout(s, window.scrollY, state.camera, state.bounds);
  for (const key of OBJ_KEYS) {
    const o = state.objects[key];
    if (!o.group.visible) continue;
    const place = places[key];
    o.safe = place.safe;
    o.anchor.position.set(place.x, place.y, place.z);
    o.spinY = 0;
    o.group.rotation.set(
      Math.sin(o.phase) * 0.16,
      state.yaw,
      Math.cos(o.phase * 0.8) * 0.12
    );
    o.group.scale.setScalar(
      place.scale * s.anchors[key].scale * o.baseScale * (o.safe ? TUNING.gutters.safeScale : 1)
    );
    _linkPositions[key] = o.anchor.position;
  }
  if (state.links) {
    _linkCtx.flow = s.flow;
    _linkCtx.column = [-1, 1];
    state.links.update(0, 0, _linkCtx, _linkPositions, state.camera);
  }
  if (state.particles) state.particles.material.uniforms.uTime.value = 0;
  renderFrame();
}

function animate(now) {
  if (!state.running) return;
  state.rafId = requestAnimationFrame(animate);

  const dt = Math.min((now - state.lastTime) / 1000, 0.05); /* clamp after tab switches */
  state.lastTime = now;
  state.elapsed += dt;
  updateFlyIn(now);
  const scrollY = window.scrollY || window.pageYOffset || 0;

  let s = state.engine.out;
  if (!state.reduced) {
    state.progressTarget = state.engine.computeProgress(scrollY);
    state.progress = damp(state.progress, state.progressTarget, TUNING.scroll.damping, dt);
    s = state.engine.sample(state.progress, scrollY);
    state.yaw = damp(state.yaw, s.yaw, TUNING.scroll.damping, dt);

    state.pointerSmooth.x = damp(state.pointerSmooth.x, state.pointer.x, TUNING.parallax.damping, dt);
    state.pointerSmooth.y = damp(state.pointerSmooth.y, state.pointer.y, TUNING.parallax.damping, dt);
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
  }

  renderFrame();
  watchPerf(dt);
}

/* ============================================================================
 * 10b. INTRO FLY-IN (3.6s - 4.9s)
 * Props arrive from depth with a stagger and a small overshoot, the camera
 * dollies in, and the particles fade up. Driven by the intro module (which
 * raises `toolapis:intro-curtain` the moment the loader curtain starts
 * rising), but the scene is fully usable — and the props fully placed —
 * whether or not it runs.
 * ==========================================================================*/
const FLYIN_ORDER = ['network', 'hd', 'usb'];
const FLYIN = { start: 3.6, end: 4.9, dolly: 2.2 };

function startFlyIn() {
  /* Once only: a late `intro-complete` must not replay the arrival after the
     props have already settled. */
  if (state.intro.active || state.intro.finished || state.reduced) return;
  state.intro.active = true;
  state.intro.t = performance.now();
  /* Park each prop deep in z so it has somewhere to fly in FROM. */
  for (const key of FLYIN_ORDER) {
    const o = state.objects[key];
    if (!o) continue;
    o.baseScale = o.baseScale || 1;
    o.introFrom = o.anchor.position.z + FLYIN.dolly * 3.4;
    o.anchor.position.z = o.introFrom;
    o.introT = performance.now() - FLYIN_ORDER.indexOf(key) * 130;
  }
  if (state.particles) state.particles.material.opacity = 0;
}

function updateFlyIn(now) {
  if (!state.intro.active) return;
  const span = (FLYIN.end - FLYIN.start) * 1000;
  for (const key of FLYIN_ORDER) {
    const o = state.objects[key];
    if (!o) continue;
    const t = (now - state.intro.t - (o.introT || 0)) / span;
    if (t <= 0) continue;
    /* easeOutBack: arrives with a small overshoot, settles back. */
    const c1 = 1.24, c3 = c1 + 1;
    const e = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    o.anchor.position.z = lerp(o.introFrom, o.target.z, Math.max(0, Math.min(1.08, e)));
  }
  /* Short camera dolly-in, eased. */
  const ct = Math.max(0, Math.min(1, (now - state.intro.t) / span));
  const eased = 1 - Math.pow(1 - ct, 3);
  state.dolly = (1 - eased) * FLYIN.dolly;
  if (state.particles) {
    state.particles.material.opacity = Math.min(1, ct * 1.4);
  }
  if (ct >= 1) {
    state.intro.active = false;
    state.intro.finished = true;
    for (const key of FLYIN_ORDER) {
      const o = state.objects[key];
      if (o) o.anchor.position.z = o.target.z;
    }
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
  document.documentElement.classList.remove('scene3d');
  log('disposed');
}

/** Undoes everything so the 2D design is exactly as it was. */
function bail(reason, err) {
  stop();
  if (err) warn(reason, err);
  else warn(reason);
  if (state.canvas && state.canvas.parentNode) state.canvas.parentNode.removeChild(state.canvas);
  state.canvas = null;
  state.renderer = null;
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
      qualityStep: state.qualityStep,
      bloom: !!state.composer,
      pixelRatio: state.pixelRatio,
      running: state.running,
      section: state.engine.out.sectionId,
      focal: state.engine.out.focal.toFixed(2),
      lineup: state.engine.out.lineup.toFixed(2),
      converge: state.engine.out.converge.toFixed(2),
      flow: state.engine.out.flow.toFixed(2),
      velocity: state.velocity.toFixed(2),
      focus: state.focusKey || '-',
      ray: state.rayKey || '-',
      safe: OBJ_KEYS.map((k) => `${k}:${state.objects[k].safe ? 'safe' : 'gutter'}`).join(' '),
      drawCalls: state.renderer.info.render.calls,
      triangles: state.renderer.info.render.triangles,
      programs: state.renderer.info.programs?.length ?? 0,
      geometries: state.renderer.info.memory.geometries,
      textures: state.renderer.info.memory.textures,
    }),
    dispose,
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
    createObjects();
    createProps();
    addFlowLinks();

    state.tier = pickTier(window.innerWidth);
    applyTier(state.tier);
    state.lastScrollY = window.scrollY || 0;

    /* Prime the first frame BEFORE revealing anything, so the fade-in has no
       flash and there is no layout shift. */
    renderOnce();

    document.documentElement.classList.add('scene3d');
    state.canvas.classList.add('is-ready');

    addListeners();
    setupInViewObserver();
    exposeDebugHandle();

    if (state.reduced) {
      log('reduced motion: static frame');
      renderOnce();
    } else {
      start();
    }

    /* The intro module owns the timeline: the fly-in starts when the loader
       curtain starts rising (`intro-curtain`, ~3.6s) so the props arrive
       while the hero is being uncovered. `intro-complete` stays wired as a
       fallback for the short intro variants, and is a no-op once the fly-in
       has already played. If neither ever fires, the scene simply sits in its
       final, correct pose. */
    window.addEventListener('toolapis:intro-curtain', () => { try { startFlyIn(); } catch (e) {} });
    window.addEventListener('toolapis:intro-complete', () => { try { startFlyIn(); } catch (e) {} });

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
