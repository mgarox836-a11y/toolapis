/* ============================================================================
 * objects.js — TOOLAPIS · procedural props
 * ----------------------------------------------------------------------------
 * Every prop is built from code: no model files, no external textures, no build
 * step. Materials are dark glossy piano-black (MeshPhysicalMaterial, clearcoat
 * 1, low roughness) with lime emissive edges and a Fresnel rim injected into
 * the physical shader, lit by a low-intensity PMREM room environment.
 *
 * Each factory returns:
 *   { key, group, materials[], textures[], hit[], update(elapsed, dt) }
 * `materials` are tracked so the scroll choreography can dim/glow them,
 * `hit` holds the meshes the raycaster should test (phase (c)).
 * ==========================================================================*/

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TUNING, PALETTE } from './config.js';

/* ---------------------------------------------------------------------------
 * Shared scratch — the builders must not allocate in the frame loop.
 * -------------------------------------------------------------------------*/
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** Deterministic PRNG so the constellation layout never changes between loads. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ============================================================================
 * 1. SHADER INJECTION
 * ----------------------------------------------------------------------------
 * onBeforeCompile closures all share the same toString(), and three.js uses that
 * as the program cache key. That is fine while the injected GLSL is identical
 * (uniforms are per-material), but the pulse shader differs, so it gets an
 * explicit key below.
 * ==========================================================================*/

/** Chains an injection onto whatever the material already does. */
function inject(material, fn, cacheKey) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    if (typeof prev === 'function') prev.call(this, shader, renderer);
    fn(shader);
  };
  if (cacheKey) {
    material.customProgramCacheKey = () => cacheKey;
  }
  return material;
}

/**
 * Lime Fresnel rim, added after <opaque_fragment> so scene fog still applies
 * to it — distant geometry dissolves into the page instead of into bright edges.
 */
function addRim(material, color, power, strength) {
  const uniforms = {
    uRimColor:    { value: new THREE.Color(color) },
    uRimPower:    { value: power },
    uRimStrength: { value: strength },
  };
  material.userData.rim = uniforms;
  return inject(material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uRimColor;
        uniform float uRimPower;
        uniform float uRimStrength;`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        float rim = pow( 1.0 - saturate( dot( normalize( vNormal ), normalize( vViewPosition ) ) ), uRimPower );
        gl_FragColor.rgb += uRimColor * rim * uRimStrength;`);
  });
}

/* ============================================================================
 * 2. MATERIALS
 * ==========================================================================*/

/** Dark glossy piano-black base used by every prop body. */
export function makeGlossy(opts = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: opts.color ?? PALETTE.card,
    metalness: opts.metalness ?? 0.30,
    roughness: opts.roughness ?? 0.18,
    clearcoat: opts.clearcoat ?? 1,
    clearcoatRoughness: opts.clearcoatRoughness ?? 0.08,
    envMapIntensity: TUNING.env.intensity,
  });
  return addRim(
    mat,
    opts.rimColor ?? PALETTE.accent,
    opts.rimPower ?? 2.6,
    opts.rim ?? 0.5
  );
}

/** Brushed metal — the USB shell. */
export function makeMetal(opts = {}) {
  return addRim(
    new THREE.MeshPhysicalMaterial({
      color: opts.color ?? PALETTE.metal,
      metalness: opts.metalness ?? 0.95,
      roughness: opts.roughness ?? 0.24,
      clearcoat: opts.clearcoat ?? 0.6,
      clearcoatRoughness: 0.18,
      envMapIntensity: TUNING.env.intensity * 1.35,
    }),
    opts.rimColor ?? PALETTE.accent,
    opts.rimPower ?? 3.2,
    opts.rim ?? 0.42
  );
}

/** Lime emissive — the only bright element, and what bloom picks up. */
export function makeLime(opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: opts.base ?? 0x1a2409,
    emissive: new THREE.Color(opts.emissive ?? PALETTE.accent),
    emissiveIntensity: opts.intensity ?? 1.6,
    metalness: opts.metalness ?? 0.2,
    roughness: opts.roughness ?? 0.3,
    envMapIntensity: TUNING.env.intensity * 0.6,
  });
}

/** Registers a material so the loop can animate its glow with dim + hover. */
export function track(material) {
  material.userData.baseEmissive = material.emissiveIntensity ?? 0;
  material.userData.baseEnv = material.envMapIntensity ?? 1;
  material.userData.baseRim = material.userData.rim ? material.userData.rim.uRimStrength.value : 0;
  return material;
}

/* ============================================================================
 * 3. GEOMETRY HELPERS
 * ==========================================================================*/

/** Draws a rounded rectangle into any THREE.Shape / THREE.Path. */
export function drawRoundedRect(target, w, h, r) {
  const x = -w / 2, y = -h / 2;
  target.moveTo(x + r, y);
  target.lineTo(x + w - r, y);
  target.quadraticCurveTo(x + w, y, x + w, y + r);
  target.lineTo(x + w, y + h - r);
  target.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  target.lineTo(x + r, y + h);
  target.quadraticCurveTo(x, y + h, x, y + h - r);
  target.lineTo(x, y + r);
  target.quadraticCurveTo(x, y, x + r, y);
  return target;
}

/** A blocky "H" as one closed outline (two stems + a crossbar). */
function letterH(w, h, s) {
  const hw = w / 2, hh = h / 2, sh = s / 2;
  const p = new THREE.Shape();
  p.moveTo(-hw, -hh);
  p.lineTo(-hw + s, -hh);
  p.lineTo(-hw + s, -sh);
  p.lineTo(hw - s, -sh);
  p.lineTo(hw - s, -hh);
  p.lineTo(hw, -hh);
  p.lineTo(hw, hh);
  p.lineTo(hw - s, hh);
  p.lineTo(hw - s, sh);
  p.lineTo(-hw + s, sh);
  p.lineTo(-hw + s, hh);
  p.lineTo(-hw, hh);
  p.closePath();
  return p;
}

/** A "D": flat left stem, half-round bowl, with a hollow counter. */
function letterD(w, h, s) {
  const hw = w / 2, hh = h / 2, r = hh;
  const stem = -hw + (w - r);
  const p = new THREE.Shape();
  p.moveTo(-hw, -hh);
  p.lineTo(stem, -hh);
  p.absellipse(stem, 0, r, r, -Math.PI / 2, Math.PI / 2, false);
  p.lineTo(-hw, hh);
  p.closePath();

  const ir = Math.max(0.02, r - s);
  const hole = new THREE.Path();
  hole.moveTo(-hw + s, -hh + s);
  hole.lineTo(stem, -hh + s);
  hole.absellipse(stem, 0, ir, ir, -Math.PI / 2, Math.PI / 2, false);
  hole.lineTo(-hw + s, hh - s);
  hole.closePath();
  p.holes.push(hole);
  return p;
}

/** One corner-bracket "L", instanced four times around the display. */
function bracketShape(len, thick) {
  const p = new THREE.Shape();
  p.moveTo(0, 0);
  p.lineTo(len, 0);
  p.lineTo(len, thick);
  p.lineTo(thick, thick);
  p.lineTo(thick, len);
  p.lineTo(0, len);
  p.closePath();
  return p;
}

/* ============================================================================
 * 4. HD ENHANCER
 * ----------------------------------------------------------------------------
 * A bevelled extruded frame, a live "screen" running a scanline/upscaling
 * sweep, extruded HD letters floating in front of it, and four lime corner
 * brackets. The screen is a plain ShaderMaterial: the pixel-grid -> sharp
 * transition is a quantised vs. continuous uv sample of the same procedural
 * frame, so the sweep literally sharpens the image as it crosses.
 * ==========================================================================*/

const DISPLAY_VERT = /* glsl */`
  varying vec2 vDispUv;
  #include <fog_pars_vertex>
  void main() {
    vDispUv = uv;
    #include <begin_vertex>
    #include <project_vertex>
    #include <fog_vertex>
  }
`;

const DISPLAY_FRAG = /* glsl */`
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform float uSweep;
  uniform float uSharp;
  uniform float uGrid;
  uniform float uDim;
  uniform float uScan;
  uniform vec3  uInk;
  uniform vec3  uAccent;
  varying vec2 vDispUv;

  /* A stand-in for a video frame: horizon, a subject, a blocky skyline. */
  float frameLuma(vec2 uv) {
    float v = 0.22 * smoothstep(0.055, 0.0, abs(uv.y - 0.30));
    vec2 d = (uv - vec2(0.50, 0.58)) * vec2(1.0, 1.22);
    v += 0.80 * exp(-dot(d, d) * 24.0);
    float col = floor(uv.x * 5.0);
    v += 0.15 * step(0.55, fract(col * 0.37)) * step(0.64, uv.y) * step(uv.y, 0.84);
    vec2 vc = uv - 0.5;
    v *= 1.0 - 0.85 * dot(vc, vc);
    return clamp(v, 0.0, 1.0);
  }

  void main() {
    vec2 uv = vDispUv;
    float sweep = fract(uSweep);

    /* Everything the sweep has already crossed is sharp; the rest is blocky. */
    float sharpZone = smoothstep(sweep - 0.11, sweep, uv.x);
    float sharp = clamp(max(uSharp, sharpZone), 0.0, 1.0);
    vec2 q = mix(floor(uv * uGrid + 0.5) / uGrid, uv, sharp);

    float luma = frameLuma(q);
    luma *= mix(0.50, 1.0, sharp);            /* low-res side reads dimmer */

    vec3 col = mix(uInk, uAccent * 0.85, luma * 0.5);
    col += uAccent * luma * 0.55;

    /* fine scanlines, then the bright sweep band itself */
    col *= mix(1.0, 0.84 + 0.16 * sin(uv.y * 240.0), uScan);
    col += uAccent * exp(-110.0 * abs(uv.x - sweep)) * 0.9;

    gl_FragColor = vec4(col * (0.35 + 0.65 * uDim), 1.0);
    #include <fog_fragment>
  }
`;

function createHDObject() {
  const group = new THREE.Group();
  const materials = [];
  const textures = [];
  const hit = [];

  /* --- Bevelled outer frame: rounded rect with a rounded-rect hole --- */
  const frameShape = drawRoundedRect(new THREE.Shape(), 2.46, 1.86, 0.26);
  frameShape.holes.push(drawRoundedRect(new THREE.Path(), 2.00, 1.40, 0.16));
  const frameGeo = new THREE.ExtrudeGeometry(frameShape, {
    depth: 0.18,
    bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.045, bevelSegments: 4,
    curveSegments: 16,
  });
  frameGeo.center();
  const frameMat = track(makeGlossy({ metalness: 0.55, roughness: 0.20, rim: 0.70, rimPower: 2.2 }));
  const frame = new THREE.Mesh(frameGeo, frameMat);
  group.add(frame);
  materials.push(frameMat);
  hit.push(frame);

  /* --- Backing plate: keeps the frame from reading as hollow --- */
  const plateGeo = new THREE.ExtrudeGeometry(
    drawRoundedRect(new THREE.Shape(), 2.00, 1.40, 0.16),
    { depth: 0.08, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 14 }
  );
  plateGeo.center();
  plateGeo.translate(0, 0, -0.10);
  const plateMat = track(makeGlossy({ color: 0x090d10, metalness: 0.12, roughness: 0.45, rim: 0.22 }));
  group.add(new THREE.Mesh(plateGeo, plateMat));
  materials.push(plateMat);

  /* --- The live display --- */
  const dispUniforms = {
    uTime:   { value: 0 },
    uSweep:  { value: 0 },
    uSharp:  { value: 0.35 },
    uGrid:   { value: 26.0 },
    uScan:   { value: 1.0 },
    uDim:    { value: 1.0 },
    uInk:    { value: new THREE.Color(0x0a0f12) },
    uAccent: { value: new THREE.Color(PALETTE.accent) },
  };
  const dispMat = new THREE.ShaderMaterial({
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), dispUniforms),
    vertexShader: DISPLAY_VERT,
    fragmentShader: DISPLAY_FRAG,
    fog: true,
  });
  const display = new THREE.Mesh(new THREE.PlaneGeometry(1.86, 1.26), dispMat);
  display.position.z = 0.02;
  group.add(display);
  materials.push(dispMat);

  /* --- Four lime corner brackets, one instanced draw call --- */
  const brGeo = new THREE.ExtrudeGeometry(bracketShape(0.34, 0.055), {
    depth: 0.05, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2,
  });
  const brMat = track(makeLime({ intensity: 2.1 }));
  const brackets = new THREE.InstancedMesh(brGeo, brMat, 4);
  const BX = 0.93, BY = 0.63;
  const corners = [
    { p: [-BX, BY, 0.06], r: 0 },
    { p: [BX, BY, 0.06], r: -Math.PI / 2 },
    { p: [BX, -BY, 0.06], r: Math.PI },
    { p: [-BX, -BY, 0.06], r: Math.PI / 2 },
  ];
  corners.forEach((c, i) => {
    _q.setFromAxisAngle(Z_AXIS, c.r);
    _m.compose(_v.set(c.p[0], c.p[1], c.p[2]), _q, _s.setScalar(1));
    brackets.setMatrixAt(i, _m);
  });
  brackets.instanceMatrix.needsUpdate = true;
  group.add(brackets);
  materials.push(brMat);

  /* --- Extruded "HD" floating in front of the screen --- */
  const LW = 0.62, LH = 0.86, LS = 0.17;
  const letterMat = track(makeGlossy({
    color: 0x11180d, metalness: 0.25, roughness: 0.16, rim: 1.0, rimPower: 1.8,
  }));
  const letters = [];
  const hGeo = new THREE.ExtrudeGeometry(letterH(LW, LH, LS), {
    depth: 0.10, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.022, bevelSegments: 3, curveSegments: 12,
  });
  const dGeo = new THREE.ExtrudeGeometry(letterD(LW * 1.12, LH, LS), {
    depth: 0.10, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.022, bevelSegments: 3, curveSegments: 16,
  });
  const hLetter = new THREE.Mesh(hGeo, letterMat);
  const dLetter = new THREE.Mesh(dGeo, letterMat);
  const letterSpan = LW / 2 + 0.10 + (LW * 1.12) / 2;
  hLetter.position.set(-letterSpan / 2, 0, 0.16);
  dLetter.position.set(letterSpan / 2, 0, 0.16);
  group.add(hLetter, dLetter);
  letters.push(hLetter, dLetter);
  materials.push(letterMat);
  hit.push(hLetter, dLetter);

  /* --- Lime hairline around the display edge --- */
  const edgeShape = drawRoundedRect(new THREE.Shape(), 1.94, 1.34, 0.16);
  edgeShape.holes.push(drawRoundedRect(new THREE.Path(), 1.86, 1.26, 0.14));
  const edgeGeo = new THREE.ExtrudeGeometry(edgeShape, { depth: 0.02, bevelEnabled: false, curveSegments: 14 });
  const edgeMat = track(makeLime({ intensity: 1.5 }));
  const edge = new THREE.Mesh(edgeGeo, edgeMat);
  edge.position.z = 0.05;
  group.add(edge);
  materials.push(edgeMat);

  /* --- Sweep cadence: a full pass every ~4.2s, sharp in between --- */
  const SWEEP_PERIOD = 4.2;
  return {
    key: 'hd',
    group,
    materials,
    textures,
    hit,
    update(elapsed, dt, ctx) {
      const t = (elapsed % SWEEP_PERIOD) / SWEEP_PERIOD;
      dispMat.uniforms.uTime.value = elapsed;
      dispMat.uniforms.uSweep.value = t;
      /* settle to fully sharp just after the pass, then drop back to blocky */
      const settled = Math.max(0, 1 - Math.max(0, t - 0.86) / 0.14);
      dispMat.uniforms.uSharp.value = 0.25 + 0.75 * settled;
      if (ctx) dispMat.uniforms.uDim.value = 0.45 + 0.55 * Math.min(1, ctx.dim);
      for (const l of letters) {
        l.position.y = Math.sin(elapsed * 0.9) * 0.012;
      }
    },
  };
}

/* ============================================================================
 * 5. GNIREHTET — detailed USB-A + undulating cable with data pulses
 * ==========================================================================*/

const CABLE_FRAG_INJECT = /* glsl */`
  {
    float band = 0.0;
    for ( int i = 0; i < 2; i++ ) {
      float ph = fract( uTime * uPulseSpeed - float( i ) * 0.5 );
      band += smoothstep( 0.055, 0.0, abs( vPulseUv.x - ph ) );
    }
    gl_FragColor.rgb += uPulseColor * band * uPulseStrength;
  }
`;

function createUSBObject() {
  /* The whole plug lives in an `inner` group whose Y rotation is driven by the
   * scroll solver (js/scene3d.js): the plug's long axis — shell, moulded body
   * and cable — is yawed to point OUTWARD, away from the text column, so the
   * cable curls out of the composition instead of across the headline. */
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);
  const materials = [];
  const textures = [];
  const hit = [];

  /* --- Shell: an extruded rounded-rect ANNULUS, so it is a real hollow tube --- */
  const SHELL_W = 0.46, SHELL_H = 0.32, SHELL_D = 0.44;
  const shellShape = drawRoundedRect(new THREE.Shape(), SHELL_W, SHELL_H, 0.05);
  shellShape.holes.push(drawRoundedRect(new THREE.Path(), SHELL_W - 0.09, SHELL_H - 0.09, 0.035));
  const shellGeo = new THREE.ExtrudeGeometry(shellShape, {
    depth: SHELL_D, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.014, bevelSegments: 2, curveSegments: 10,
  });
  shellGeo.center();
  shellGeo.translate(0, 0, SHELL_D / 2 - 0.06);
  const shellMat = track(makeMetal({ rim: 0.5, rimPower: 3.0 }));
  const shell = new THREE.Mesh(shellGeo, shellMat);
  inner.add(shell);
  materials.push(shellMat);
  hit.push(shell);

  /* --- Back plate closing the tube --- */
  const backGeo = new RoundedBoxGeometry(SHELL_W - 0.06, SHELL_H - 0.06, 0.05, 2, 0.02);
  const darkMat = track(makeGlossy({ color: 0x06090b, metalness: 0.2, roughness: 0.6, clearcoat: 0.2, rim: 0.18 }));
  inner.add(new THREE.Mesh(backGeo, darkMat));
  materials.push(darkMat);

  /* --- Inner tongue with four lime contact pads --- */
  const tongueMat = track(makeGlossy({ color: 0x1b2126, metalness: 0.3, roughness: 0.35, rim: 0.35 }));
  const tongueGeo = new RoundedBoxGeometry(SHELL_W - 0.12, 0.075, 0.34, 2, 0.015);
  tongueGeo.translate(0, -0.075, 0.11);
  const tongue = new THREE.Mesh(tongueGeo, tongueMat);
  inner.add(tongue);
  materials.push(tongueMat);
  hit.push(tongue);

  const padMat = track(makeLime({ intensity: 1.8, metalness: 0.7, roughness: 0.22 }));
  const padGeo = new THREE.BoxGeometry(0.045, 0.012, 0.16);
  padGeo.translate(0, -0.034, 0.10);
  const pads = new THREE.InstancedMesh(padGeo, padMat, 4);
  for (let i = 0; i < 4; i++) {
    _m.compose(_v.set((i - 1.5) * 0.075, 0, 0), _q.identity(), _s.setScalar(1));
    pads.setMatrixAt(i, _m);
  }
  pads.instanceMatrix.needsUpdate = true;
  inner.add(pads);
  materials.push(padMat);

  /* --- Two retention holes in the top wall --- */
  const holeMat = track(makeGlossy({ color: 0x04070a, metalness: 0.1, roughness: 0.8, clearcoat: 0, rim: 0 }));
  const holeGeo = new THREE.BoxGeometry(0.085, 0.05, 0.12);
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(holeGeo, holeMat);
    h.position.set(sx * 0.11, SHELL_H / 2 - 0.012, 0.16);
    inner.add(h);
  }
  materials.push(holeMat);

  /* --- Moulded body + strain relief behind the shell --- */
  const bodyMat = track(makeGlossy({ color: 0x0d1216, metalness: 0.08, roughness: 0.52, clearcoat: 0.5, rim: 0.45 }));
  const bodyGeo = new RoundedBoxGeometry(0.50, 0.40, 0.46, 4, 0.07);
  bodyGeo.translate(0, 0, -0.30);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  inner.add(body);
  materials.push(bodyMat);
  hit.push(body);

  const reliefGeo = new THREE.CylinderGeometry(0.11, 0.15, 0.22, 16, 1, false);
  reliefGeo.rotateX(Math.PI / 2);
  reliefGeo.translate(0, 0, -0.60);
  inner.add(new THREE.Mesh(reliefGeo, bodyMat));

  /* --- Cable: TubeGeometry along a CatmullRomCurve3 that undulates ---
   * Deliberately SHORT (it used to run 2.2 units behind the plug, which in the
   * hero reached straight across the headline). The visible length is now
   * under 1.5 units, and the outward yaw foreshortens it further, so it reads
   * as a cable leaving frame rather than as a line drawn through the copy. */
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3( 0.00,  0.00, -0.66),
    new THREE.Vector3( 0.02,  0.09, -0.92),
    new THREE.Vector3(-0.14,  0.13, -1.16),
    new THREE.Vector3(-0.24, -0.02, -1.36),
    new THREE.Vector3(-0.14, -0.16, -1.50),
  ], false, 'catmullrom', 0.5);
  const cableGeo = new THREE.TubeGeometry(curve, 64, 0.072, 12, false);
  const cableMat = track(makeGlossy({
    color: 0x0a0e12, metalness: 0.1, roughness: 0.45, clearcoat: 0.7, rim: 0.55,
  }));
  const pulseUniforms = {
    uTime:         { value: 0 },
    uPulseColor:   { value: new THREE.Color(PALETTE.accent) },
    uPulseSpeed:   { value: 0.28 },
    uPulseStrength: { value: 0 },
  };
  cableMat.userData.pulse = pulseUniforms;
  inject(cableMat, (shader) => {
    Object.assign(shader.uniforms, pulseUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec2 vPulseUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vPulseUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vPulseUv;
        uniform float uTime;
        uniform vec3 uPulseColor;
        uniform float uPulseSpeed;
        uniform float uPulseStrength;`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${CABLE_FRAG_INJECT}`);
  }, 'toolapis-cable-pulse');
  const cable = new THREE.Mesh(cableGeo, cableMat);
  inner.add(cable);
  materials.push(cableMat);
  hit.push(cable);

  /* --- Lime signal collar at the joint --- */
  const ringGeo = new THREE.TorusGeometry(0.10, 0.016, 8, 28);
  ringGeo.translate(0, 0, -0.68);
  const ringMat = track(makeLime({ intensity: 2.2 }));
  inner.add(new THREE.Mesh(ringGeo, ringMat));
  materials.push(ringMat);

  return {
    key: 'usb',
    group,
    /* Exposed so js/scene3d.js can yaw the plug outward from the text. The
     * target is set per frame from the anchor side the solver chose; this
     * value is the current (damped) angle. */
    inner,
    outwardYaw: 0,
    outwardTarget: 0,
    materials,
    textures,
    hit,
    update(elapsed, dt, ctx) {
      pulseUniforms.uTime.value = elapsed;
      /* pulses brighten with the glow the loop assigns to this object */
      pulseUniforms.uPulseStrength.value = (ctx ? ctx.glow : 0.6) * 0.9;
      /* Outward yaw, with a slow breathing tilt so it is never rigid. The
       * solver owns the base angle; the wobble is this object's own. */
      const yaw = this.outwardYaw;
      inner.rotation.y = yaw + Math.sin(elapsed * 0.21) * 0.06;
      inner.rotation.z = 0.14 + Math.cos(elapsed * 0.17) * 0.05;
      inner.rotation.x = -0.10 + Math.sin(elapsed * 0.13 + 1.1) * 0.05;
    },
  };
}

/* ============================================================================
 * 6. SOCIAL MEDIA — 10-node constellation, lime links, travelling packets
 * ==========================================================================*/

const NODE_COUNT = 10;

function createNetworkObject() {
  const group = new THREE.Group();
  const materials = [];
  const textures = [];
  const hit = [];

  const rand = seeded(20260929);
  const R = 1.28;

  /* Golden-angle shell: even coverage, stable layout, no hand-tuning. */
  const nodes = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    if (i === 0) {
      nodes.push({ p: new THREE.Vector3(0, 0, 0), r: 0.30, centre: true });
      continue;
    }
    const k = i - 1;
    const n = NODE_COUNT - 1;
    const y = 1 - (k / (n - 1)) * 2;
    const rXZ = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = k * 2.39996323;
    const rad = R * (0.82 + rand() * 0.30);
    nodes.push({
      p: new THREE.Vector3(Math.cos(theta) * rXZ * rad, y * rad * 0.82, Math.sin(theta) * rXZ * rad),
      r: 0.062 + rand() * 0.052,
      centre: false,
      phase: rand() * Math.PI * 2,
    });
  }

  /* --- Nodes: one InstancedMesh, per-instance scale pulse on the CPU --- */
  const nodeMat = track(makeGlossy({
    color: 0x0f1519, metalness: 0.5, roughness: 0.14, clearcoat: 1, rim: 0.95, rimPower: 2.0,
  }));
  const nodeGeo = new THREE.IcosahedronGeometry(1, 2);
  const nodeMesh = new THREE.InstancedMesh(nodeGeo, nodeMat, nodes.length);
  group.add(nodeMesh);
  materials.push(nodeMat);
  hit.push(nodeMesh);

  /* --- Links: LineSegments, centre hub + three cross edges --- */
  const linkPairs = [];
  for (let i = 1; i < nodes.length; i++) linkPairs.push([0, i]);
  linkPairs.push([1, 4], [2, 6], [3, 8]);
  const linePos = new Float32Array(linkPairs.length * 6);
  linkPairs.forEach(([a, b], i) => {
    linePos[i * 6 + 0] = nodes[a].p.x; linePos[i * 6 + 1] = nodes[a].p.y; linePos[i * 6 + 2] = nodes[a].p.z;
    linePos[i * 6 + 3] = nodes[b].p.x; linePos[i * 6 + 4] = nodes[b].p.y; linePos[i * 6 + 5] = nodes[b].p.z;
  });
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  const lineMat = new THREE.LineBasicMaterial({
    color: PALETTE.accent, transparent: true, opacity: 0.34, depthWrite: false,
  });
  lineMat.userData.baseEmissive = 0;
  lineMat.userData.baseEnv = 0;
  lineMat.userData.baseRim = 0;
  group.add(new THREE.LineSegments(lineGeo, lineMat));
  materials.push(lineMat);

  /* --- Packets travelling along every hub link --- */
  const PACKETS_PER_LINK = 2;
  const packetCount = linkPairs.length * PACKETS_PER_LINK;
  const packetMat = new THREE.MeshBasicMaterial({
    color: PALETTE.accentHi, transparent: true, opacity: 0.95, depthWrite: false, fog: true,
  });
  packetMat.userData.baseEmissive = 0;
  packetMat.userData.baseEnv = 0;
  packetMat.userData.baseRim = 0;
  const packetMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.032, 0), packetMat, packetCount);
  packetMesh.frustumCulled = false;
  group.add(packetMesh);
  materials.push(packetMat);
  /* per-packet: link index, phase, speed */
  const packetState = [];
  for (let i = 0; i < packetCount; i++) {
    packetState.push({
      link: Math.floor(i / PACKETS_PER_LINK),
      t: (i % PACKETS_PER_LINK) / PACKETS_PER_LINK,
      speed: 0.20 + rand() * 0.12,
    });
  }

  return {
    key: 'network',
    group,
    materials,
    textures,
    hit,
    update(elapsed, dt, ctx) {
      const glow = ctx ? ctx.glow : 0.7;

      /* nodes: gentle breathing, centre node leads */
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const pulse = n.centre
          ? 1.0 + 0.09 * Math.sin(elapsed * 1.15)
          : 1.0 + 0.16 * Math.sin(elapsed * 1.6 + n.phase);
        _m.compose(n.p, _q.identity(), _s.setScalar(n.r * pulse));
        nodeMesh.setMatrixAt(i, _m);
      }
      nodeMesh.instanceMatrix.needsUpdate = true;

      /* packets: crawl hub -> node, fading in and out at the ends */
      for (let i = 0; i < packetCount; i++) {
        const p = packetState[i];
        const [a, b] = linkPairs[p.link];
        p.t += dt * p.speed;
        if (p.t > 1) p.t -= 1;
        _v.copy(nodes[a].p);
        _v2.copy(nodes[b].p);
        _v.lerp(_v2, p.t);
        _v.z += Math.sin(p.t * Math.PI) * 0.10;   /* slight arc off the line */
        const fade = Math.sin(p.t * Math.PI);
        _m.compose(_v, _q.identity(), _s.setScalar(0.55 + 0.75 * fade));
        packetMesh.setMatrixAt(i, _m);
      }
      packetMesh.instanceMatrix.needsUpdate = true;

      lineMat.opacity = 0.16 + 0.24 * Math.min(1, glow);
      packetMat.opacity = 0.40 + 0.55 * Math.min(1, glow);
    },
  };
}

/* ============================================================================
 * 7. BACKGROUND PROPS — depth without competing with the copy
 * ==========================================================================*/

function radialCanvasTexture(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [pos, color] of stops) grd.addColorStop(pos, color);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createBackgroundProps() {
  const group = new THREE.Group();
  const textures = [];
  const B = TUNING.background;

  /* Faint wireframe icosahedron, far behind everything.
   * Every value here is deliberately at the floor of visibility: this layer
   * sits BEHIND the whole page, so anything more than a whisper reads as a
   * pattern behind the headline rather than as depth. */
  const wireMat = new THREE.MeshBasicMaterial({
    color: PALETTE.accent, wireframe: true, transparent: true, opacity: B.wire.opacity,
    depthWrite: false, fog: true,
  });
  const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(B.wire.radius, 1), wireMat);
  wire.position.set(0, 0.5, B.wire.z);
  wire.rotation.set(0.4, 0.2, 0);
  group.add(wire);

  /* Two tilted orbit rings, same treatment, and thinner than a hairline. */
  const ringMat = new THREE.MeshBasicMaterial({
    color: PALETTE.accent, transparent: true, opacity: B.ring.opacity, depthWrite: false, fog: true,
  });
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(B.ring.radiusA, B.ring.tube, 6, 120), ringMat);
  ringA.position.set(0, 0.5, B.ring.z);
  ringA.rotation.set(1.15, 0.35, 0.2);
  group.add(ringA);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(B.ring.radiusB, B.ring.tube * 0.8, 6, 120), ringMat);
  ringB.position.set(0, 0.5, B.ring.z);
  ringB.rotation.set(1.55, -0.5, -0.3);
  group.add(ringB);

  /* Ground glow: a SMALL additive radial sprite hugging the bottom edge.
   * It is not a floor plane and it is not a horizon: at full width it turned
   * the bottom of every section into an olive band, so it is capped at
   * `background.groundGlow.opacity` (0.12), sized well inside the frame, and
   * dropped far enough down that only its top sliver is ever on screen. */
  const glowTex = radialCanvasTexture(256, [
    [0.0, `rgba(163,230,53,${B.groundGlow.core})`],
    [0.45, `rgba(163,230,53,${B.groundGlow.mid})`],
    [1.0, `rgba(163,230,53,${B.groundGlow.edge})`],
  ]);
  textures.push(glowTex);
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTex, transparent: true, opacity: B.groundGlow.opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(B.groundGlow.sizeX, B.groundGlow.sizeZ),
    glowMat
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, B.groundGlow.y, B.groundGlow.z);
  group.add(ground);

  return {
    group,
    textures,
    materials: [wireMat, ringMat, glowMat],
    update(elapsed) {
      wire.rotation.y = elapsed * 0.018;
      wire.rotation.x = 0.4 + Math.sin(elapsed * 0.07) * 0.06;
      ringA.rotation.z = 0.2 + elapsed * 0.012;
      ringB.rotation.z = -0.3 - elapsed * 0.009;
    },
    dispose() {
      for (const t of textures) t.dispose();
    },
  };
}

/* ============================================================================
 * 8. PARTICLES — 3 depth layers, one draw call
 * ==========================================================================*/

const DUST_VERT = /* glsl */`
  attribute float aPhase;
  attribute float aSize;
  attribute float aLayer;
  attribute float aTwinkle;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSize;
  uniform float uDrift;
  uniform float uStreak;
  uniform float uLayerMax;
  varying float vFade;
  varying float vTwinkle;

  void main() {
    vec3 p = position;
    /* deeper layers (aLayer 0..2) drift slower => parallax */
    float layerScale = mix(1.0, 0.34, aLayer / max(1.0, uLayerMax - 1.0));
    p.y += sin( uTime * 0.28 + aPhase ) * 0.55 * uDrift * layerScale;
    p.x += cos( uTime * 0.19 + aPhase * 1.7 ) * 0.45 * uDrift * layerScale;
    p.z += sin( uTime * 0.11 + aPhase * 0.9 ) * 0.30 * uDrift * layerScale;

    /* scroll velocity smears the field along view-space Y */
    p.y -= uStreak * ( 0.4 + aLayer * 0.9 );

    vec4 mv = modelViewMatrix * vec4( p, 1.0 );
    gl_Position = projectionMatrix * mv;

    float depth = -mv.z;
    gl_PointSize = uSize * aSize * uPixelRatio * ( 300.0 / max( depth, 0.001 ) )
                 * ( 1.0 + uStreak * 1.3 );
    vFade = clamp( 1.0 - depth / 40.0, 0.0, 1.0 );
    vTwinkle = 0.5 + 0.5 * sin( uTime * ( 0.9 + aTwinkle * 1.6 ) + aPhase * 3.1 );
  }
`;

const DUST_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTwinkle;
  varying float vFade;
  varying float vTwinkle;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = dot( uv, uv );
    if ( d > 0.25 ) discard;
    float a = smoothstep( 0.25, 0.0, d );
    float tw = mix( 1.0 - uTwinkle, 1.0, vTwinkle );
    gl_FragColor = vec4( uColor, a * uOpacity * vFade * tw );
  }
`;

export function createParticles(count) {
  const P = TUNING.particles;
  const rand = seeded(0x5eed);
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);
  const layers = new Float32Array(count);
  const twinkles = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const layer = i % P.layers;
    const zc = P.layerZ[layer];
    const zs = P.layerSpread[layer];
    positions[i * 3 + 0] = (rand() - 0.5) * 34;
    positions[i * 3 + 1] = (rand() - 0.5) * 20;
    positions[i * 3 + 2] = zc + (rand() - 0.5) * zs;
    phases[i] = rand() * Math.PI * 2;
    sizes[i] = 0.4 + rand() * 0.9;
    layers[i] = layer;
    twinkles[i] = rand();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aLayer', new THREE.BufferAttribute(layers, 1));
  geo.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:        { value: 0 },
      uPixelRatio:  { value: 1 },
      uSize:        { value: P.size },
      uDrift:       { value: 0.35 },
      uStreak:      { value: 0 },
      uColor:       { value: new THREE.Color(PALETTE.accent) },
      uOpacity:     { value: P.opacity },
      uTwinkle:     { value: P.twinkle },
      uLayerMax:    { value: P.layers },
    },
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, material: mat, count };
}

/* ============================================================================
 * 8b. FLOW LINKS — pulses travelling between the three props
 * ----------------------------------------------------------------------------
 * Only alive during the Flow section. Each link is a straight tube built once
 * along local +Z; every frame it is re-aimed between the two live prop
 * positions and stretched to fit, so nothing is ever rebuilt or reallocated.
 * A short bow is added by spinning the tube about its own axis so the
 * azimuth of the arc points out of the screen rather than sideways.
 * ==========================================================================*/

const FLOW_PAIRS = [['usb', 'hd'], ['hd', 'network'], ['network', 'usb']];
const FLOW_BOW = 0.18;   /* fraction of the link length */
const FLOW_RADIUS = 0.022;

const _qAim = new THREE.Quaternion();
const _qBow = new THREE.Quaternion();
const _vDir = new THREE.Vector3();
const _vBow = new THREE.Vector3();
const _vToCam = new THREE.Vector3();
const _mBow = new THREE.Matrix4();

export function createFlowLinks() {
  const group = new THREE.Group();
  const materials = [];
  const textures = [];
  const links = [];

  /* Canonical geometry: unit length along +Z, bowed out in +X. */
  const bowAt = (t) => new THREE.Vector3(Math.sin(t * Math.PI) * FLOW_BOW, 0, t);
  const curve = new THREE.CatmullRomCurve3([
    bowAt(0), bowAt(0.25), bowAt(0.5), bowAt(0.75), bowAt(1),
  ], false, 'catmullrom', 0.5);
  const linkGeo = new THREE.TubeGeometry(curve, 40, FLOW_RADIUS, 8, false);

  FLOW_PAIRS.forEach((pair, i) => {
    const uniforms = {
      uTime:         { value: 0 },
      uPulseColor:   { value: new THREE.Color(PALETTE.accent) },
      uPulseSpeed:   { value: 0.22 + i * 0.05 },
      uPulseStrength: { value: 0 },
      uPhase:        { value: i * 0.37 },
      /* [x0, x1] NDC span of the hard text column at this link's height. */
      uColumn:       { value: new THREE.Vector2(-1, 1) },
    };
    const mat = new THREE.MeshBasicMaterial({
      color: PALETTE.accent,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    mat.userData.flow = uniforms;
    inject(mat, (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n varying vec2 vPulseUv;\n varying float vNdcX;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vPulseUv = uv;
          vNdcX = gl_Position.x / max( gl_Position.w, 1e-4 );`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec2 vPulseUv;
          varying float vNdcX;
          uniform float uTime;
          uniform vec3 uPulseColor;
          uniform float uPulseSpeed;
          uniform float uPulseStrength;
          uniform float uPhase;
          uniform vec2 uColumn;`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
          {
            /* Fade the link to nothing across the text column, so a pulse is
               never drawn on top of copy. The band is widened slightly and
               eased, which reads as the link ducking behind the text. */
            float d = abs( vNdcX - clamp( vNdcX, uColumn.x, uColumn.y ) );
            float clear = smoothstep( 0.0, 0.10, d );
            float band = 0.0;
            for ( int i = 0; i < 3; i++ ) {
              float ph = fract( uTime * uPulseSpeed + uPhase - float( i ) * 0.34 );
              band += smoothstep( 0.07, 0.0, abs( vPulseUv.x - ph ) );
            }
            gl_FragColor.a *= clear;
            gl_FragColor.rgb += uPulseColor * band * uPulseStrength * clear;
          }`);
    }, 'toolapis-flow-pulse');

    const mesh = new THREE.Mesh(linkGeo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);
    materials.push(mat);
    links.push({ mesh, mat, uniforms, from: pair[0], to: pair[1] });
  });

  return {
    group,
    materials,
    textures,
    /* The endpoint keys, in draw order. js/scene3d.js reads this so it can
       resolve the text column at each link's OWN height — the link's index
       here is the index the shader gets as `i`. */
    pairs: FLOW_PAIRS,
    update(elapsed, dt, ctx, positions, camera) {
      const flow = ctx ? ctx.flow : 0;
      const visible = flow > 0.02;
      group.visible = visible;
      if (!visible) return;

      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const a = positions[link.from];
        const b = positions[link.to];
        if (!a || !b) { link.mesh.visible = false; continue; }
        link.mesh.visible = true;

        _vDir.subVectors(b, a);
        const len = _vDir.length();
        if (len < 0.001) { link.mesh.visible = false; continue; }
        _vDir.divideScalar(len);

        /* Aim local +Z from A to B... */
        _qAim.setFromUnitVectors(Z_AXIS, _vDir);

        /* ...then spin about that axis so the local +X bow points out of the
           screen: that is dir x (towards the camera), normalised. */
        _vToCam.subVectors(camera.position, a).normalize();
        _vBow.crossVectors(_vDir, _vToCam);
        if (_vBow.lengthSq() < 1e-8) _vBow.set(0, 1, 0);
        _vBow.normalize();
        _mBow.makeRotationFromQuaternion(_qAim);
        _vBow.transformDirection(_mBow);
        const theta = Math.atan2(_vBow.y, _vBow.x);
        _qBow.setFromAxisAngle(Z_AXIS, theta);
        link.mesh.quaternion.copy(_qAim).multiply(_qBow);

        link.mesh.position.copy(a);
        link.mesh.scale.set(1, 1, len);

        const w = flow;
        link.mat.opacity = 0.12 + 0.34 * w;
        link.uniforms.uTime.value = elapsed;
        link.uniforms.uPulseStrength.value = 1.6 * w;
        /* Never cross copy: the caller hands us the text column for THIS
         * link's own height (a link that runs through a free band gets no
         * column at all and draws in full; one that would cross the copy
         * fades out across it). */
        const col = (ctx && typeof ctx.columnFor === 'function')
          ? ctx.columnFor(a, b, i)
          : (ctx ? ctx.column : null);
        if (col) link.uniforms.uColumn.value.set(col[0], col[1]);
      }
    },
    dispose() {
      linkGeo.dispose();
      for (const t of textures) t.dispose();
    },
  };
}

/* ============================================================================
 * 9. FACTORY MAP + DISPOSE
 * ==========================================================================*/

const FACTORIES = {
  hd: createHDObject,
  usb: createUSBObject,
  network: createNetworkObject,
};

export function buildObject(key) {
  const factory = FACTORIES[key];
  if (!factory) throw new Error(`scene3d: unknown object "${key}"`);
  return factory();
}

export function disposeObject(obj) {
  obj.group.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) m.dispose();
    }
  });
  for (const t of obj.textures || []) t.dispose();
}
