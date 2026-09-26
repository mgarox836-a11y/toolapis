import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NoBlending,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  ACESFilmicToneMapping,
} from "three";
import type { PortalSceneState } from "./motion";

export interface CameraConfig {
  fov: number;
  cameraZ: number;
  portalX: number;
  portalY: number;
  portalScale: number;
  pixelRatioCap: number;
  lowPower: boolean;
}

/* A page shorter than the viewport can hand ScrollTrigger a NaN progress, and
   Math.min/max would pass it straight through into the camera matrix. */
const clamp = (value: number, minimum = 0, maximum = 1): number =>
  Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum;
const mix = (start: number, end: number, amount: number): number => start + (end - start) * amount;
const smoothstep = (start: number, end: number, value: number): number => {
  const amount = clamp((value - start) / (end - start));
  return amount * amount * (3 - 2 * amount);
};

/* Brand palette, mirrored from styles.css. Cyan reads brighter than the gold it
   replaces under additive blending, so every glow opacity is scaled back to
   land on the same perceived exposure. */
const DEEP_COLOR = "#06121c";
const ACCENT_COLOR = "#00f0ff";
const CORE_COLOR = "#d6fbff";
const GLOW_ALPHA_SCALE = 1;

/* World-space outer edge of the main torus (radius 1.58 + tube 0.17). This is the
   single number the CSS ring, the chip orbit and the headline mask all size
   themselves from, so the two layers cannot drift apart at any viewport. */
const TORUS_OUTER_RADIUS = 1.75;

/* The orb opens on the same frame the headline lands: the CSS entrance is a 0.22s
   delay plus a 1.05s line-in. One constant stands in for a JS timeline, so the
   stagger survives reduced motion and a throttled tab for free. */
const ENTER_DURATION = 1.27;

export interface ScrollPhase {
  /** Portal slides from the right-weighted opening position to optical centre. */
  centring: number;
  /** Camera dollies in and passes toward the event horizon. */
  approach: number;
  /** Portal drifts back and dims as the DOM sections take the stage. */
  departure: number;
  /** Pointer parallax authority, faded out once the scroll takes over. */
  pointerFade: number;
  /** Final dissolve — 1 means the portal is fully out of frame. */
  dissolve: number;
}

/* Pure, so the four narrative windows are unit-testable without a browser. */
export const getScrollPhase = (rawProgress: number): ScrollPhase => {
  const progress = clamp(rawProgress);

  return {
    centring: smoothstep(0.04, 0.5, progress),
    approach: smoothstep(0.08, 0.9, progress),
    departure: smoothstep(0.68, 1, progress),
    pointerFade: 1 - smoothstep(0.3, 0.76, progress),
    dissolve: smoothstep(0.8, 1, progress),
  };
};

export const getResponsiveCameraConfig = (width: number, height: number, lowPower = false): CameraConfig => {
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);
  const aspect = safeWidth / safeHeight;
  const portraitAmount = clamp((1.25 - aspect) / 0.55);
  const shortLandscape = aspect > 1.2 && safeHeight < 620 ? 1 : 0;
  const fov = clamp(44 + portraitAmount * 18 + shortLandscape * 3, 44, 65);
  const cameraZ = 6 + portraitAmount * 0.7;
  const horizontalPosition = clamp((aspect - 0.9) / 0.75);
  const verticalPosition = clamp((1.5 - aspect) / 0.6);
  const portalX = aspect < 0.9 ? 0 : mix(2.15, 0.65, horizontalPosition);
  const portalY = mix(0, 1.25, verticalPosition);
  const portalScale = (1 - portraitAmount * 0.22) * (shortLandscape ? 0.82 : 1);
  const pixelRatioCap = lowPower ? 1.15 : aspect < 0.9 ? 1.25 : 1.75;

  return { fov, cameraZ, portalX, portalY, portalScale, pixelRatioCap, lowPower };
};

export interface OrbMetrics {
  /** Orb centre, in pixels, relative to the headline box's top-left corner. */
  dx: number;
  dy: number;
  /** Projected outer radius of the main torus, in pixels. */
  r: number;
}

/* Pure, so the WebGL-to-CSS contract is unit-testable without a browser.
   NDC is normalised against a different axis per component, so each is taken
   back to pixels before the two are combined into a radius. */
export const getOrbMetrics = (
  centre: { x: number; y: number },
  edge: { x: number; y: number },
  view: { width: number; height: number },
  wrap: { left: number; top: number },
): OrbMetrics => ({
  dx: (centre.x * 0.5 + 0.5) * view.width - wrap.left,
  dy: (-centre.y * 0.5 + 0.5) * view.height - wrap.top,
  r: Math.hypot((edge.x - centre.x) * (view.width / 2), (edge.y - centre.y) * (view.height / 2)),
});

/* Pure. Frozen means there is no entrance to sit through, so the orb opens fully
   formed rather than at zero — the composition starts where it ends. */
export const getEnterProgress = (elapsed: number, frozen: boolean): number =>
  frozen ? 1 : 1 - Math.pow(1 - clamp(elapsed / ENTER_DURATION), 4);

const vertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vUv = uv;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -viewPosition.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const ringFragmentShader = `
  uniform float uTime;
  uniform float uProgress;
  uniform vec3 uDeepColor;
  uniform vec3 uAccentColor;
  uniform vec3 uCoreColor;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vec3 viewDirection = normalize(vViewPosition);
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDirection)), 2.4);
    float current = 0.5 + 0.5 * sin(vUv.y * 34.0 - uTime * 1.3 + uProgress * 12.0);
    float filament = pow(0.5 + 0.5 * sin(vUv.x * 18.0 + uTime * 0.45), 7.0);
    vec3 color = mix(uDeepColor, uAccentColor, 0.28 + fresnel * 0.66 + current * 0.08);
    color = mix(color, uCoreColor, filament * fresnel * 0.48);
    gl_FragColor = vec4(color * (0.72 + fresnel * 1.65), 1.0);
  }
`;

const membraneFragmentShader = `
  uniform float uTime;
  uniform float uProgress;
  uniform vec3 uDeepColor;
  uniform vec3 uAccentColor;
  uniform vec3 uCoreColor;
  varying vec2 vUv;

  void main() {
    vec2 point = vUv * 2.0 - 1.0;
    float radius = length(point);
    if (radius > 1.0) discard;
    float angle = atan(point.y, point.x);
    float spiral = 0.5 + 0.5 * sin(angle * 8.0 - radius * 25.0 + uTime * 1.5 + uProgress * 12.0);
    float filament = pow(1.0 - abs(sin(angle * 5.0 + radius * 17.0 - uTime * 0.9)), 8.0);
    float edge = smoothstep(1.0, 0.72, radius);
    float core = 1.0 - smoothstep(0.0, 0.22, radius);
    float fade = 1.0 - smoothstep(0.74, 1.0, uProgress);
    /* The floor keeps the event horizon from reading as a flat black disc at
       the bottom of the spiral, where spiral and filament are near zero. */
    float alpha = edge * (0.13 + spiral * 0.3 + filament * 0.34) * fade;
    vec3 color = mix(uDeepColor, uAccentColor, spiral);
    color = mix(color, uCoreColor, core * 0.72);
    gl_FragColor = vec4(color, alpha);
  }
`;

const particleVertexShader = `
  uniform float uTime;
  uniform float uProgress;
  uniform float uPixelRatio;
  attribute float aRadius;
  attribute float aAngle;
  attribute float aSpeed;
  attribute float aSize;
  attribute float aDepth;
  varying float vEnergy;

  void main() {
    float travel = mod(aDepth + uTime * aSpeed + uProgress * 9.0, 12.0) - 6.0;
    float spread = 1.0 + uProgress * 3.4;
    float angle = aAngle + uTime * aSpeed * 0.08;
    vec3 transformed = vec3(
      cos(angle) * aRadius * spread,
      sin(angle) * aRadius * 0.58 * (1.0 - uProgress * 0.22),
      travel
    );
    vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
    float perspective = clamp(70.0 / max(1.0, -viewPosition.z), 0.35, 4.0);
    gl_PointSize = aSize * uPixelRatio * perspective;
    gl_Position = projectionMatrix * viewPosition;
    vEnergy = 0.55 + 0.45 * sin(angle * 3.0 + uTime * 0.7);
  }
`;

const particleFragmentShader = `
  uniform vec3 uAccentColor;
  uniform vec3 uCoreColor;
  varying float vEnergy;

  void main() {
    vec2 point = gl_PointCoord - 0.5;
    float radius = length(point);
    if (radius > 0.5) discard;
    float alpha = smoothstep(0.5, 0.0, radius) * (0.28 + vEnergy * 0.48);
    vec3 color = mix(uAccentColor, uCoreColor, vEnergy * 0.42);
    gl_FragColor = vec4(color, alpha);
  }
`;

const createGlowTexture = (): CanvasTexture => {
  const size = 256;
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = size;
  textureCanvas.height = size;
  const context = textureCanvas.getContext("2d");

  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, `rgba(214, 251, 255, ${0.95 * GLOW_ALPHA_SCALE})`);
    gradient.addColorStop(0.18, `rgba(0, 240, 255, ${0.52 * GLOW_ALPHA_SCALE})`);
    gradient.addColorStop(0.5, "rgba(0, 102, 255, 0.1)");
    gradient.addColorStop(1, "rgba(0, 102, 255, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }

  return new CanvasTexture(textureCanvas);
};

const createParticles = (lowPower: boolean, pixelRatio: number): Points => {
  const count = lowPower ? 180 : window.innerWidth < 768 ? 320 : 720;
  const positions = new Float32Array(count * 3);
  const radii = new Float32Array(count);
  const angles = new Float32Array(count);
  const speeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const depths = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    radii[index] = 1.9 + Math.random() * 4.8;
    angles[index] = Math.random() * Math.PI * 2;
    speeds[index] = 0.12 + Math.random() * 0.48;
    sizes[index] = 0.6 + Math.random() * 1.8;
    depths[index] = Math.random() * 12;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aRadius", new BufferAttribute(radii, 1));
  geometry.setAttribute("aAngle", new BufferAttribute(angles, 1));
  geometry.setAttribute("aSpeed", new BufferAttribute(speeds, 1));
  geometry.setAttribute("aSize", new BufferAttribute(sizes, 1));
  geometry.setAttribute("aDepth", new BufferAttribute(depths, 1));

  const material = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uAccentColor: { value: new Color(ACCENT_COLOR) },
      uCoreColor: { value: new Color(CORE_COLOR) },
    },
    vertexShader: particleVertexShader,
    fragmentShader: particleFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  return new Points(geometry, material);
};

export class PortalExperience {
  private readonly state: PortalSceneState;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(44, 1, 0.1, 100);
  private readonly portal = new Group();
  private readonly ringMaterial: ShaderMaterial;
  private readonly membraneMaterial: ShaderMaterial;
  private readonly particleMaterial: ShaderMaterial;
  private readonly glowTexture: CanvasTexture;
  private readonly coreGlow: Sprite;
  private readonly innerGlow: Sprite;
  private readonly particles: Points;
  private readonly targetPointer = new Vector2();
  private readonly pointer = new Vector2();
  private config: CameraConfig;
  private elapsed = 0;
  private lastFrame = 0;
  private suspended = false;
  private destroyed = false;
  private painted = false;
  private readonly frozen: boolean;
  private lowPower: boolean;
  /* The headline box. Its rect is read on resize only, never per frame: the
     metrics published below are OFFSETS into this box, so they stay valid as the
     page scrolls and the box moves. */
  private readonly wrap = document.querySelector<HTMLElement>(".hero-title-wrap");
  private wrapLeft = 0;
  private wrapTop = 0;
  private readonly probe = new Vector3();
  private readonly probeEdge = new Vector3();
  private readonly orbVars: Record<string, number> = { dx: Number.NaN, dy: Number.NaN, r: Number.NaN };
  private viewportWidth = 1;
  private viewportHeight = 1;

  constructor(canvas: HTMLCanvasElement, state: PortalSceneState) {
    this.state = state;
    this.frozen = !isPortalMotionEnabled();

    const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
    this.lowPower = (navigator.hardwareConcurrency ?? 8) <= 4 || (navigatorWithMemory.deviceMemory ?? 8) <= 4;
    this.config = getResponsiveCameraConfig(window.innerWidth, window.innerHeight, this.lowPower);

    this.renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
      precision: this.lowPower ? "mediump" : "highp",
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.setClearColor(0x06121c, 0);

    this.camera.position.set(0, 0, this.config.cameraZ);
    this.scene.add(this.portal);

    this.ringMaterial = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uDeepColor: { value: new Color(DEEP_COLOR) },
        uAccentColor: { value: new Color(ACCENT_COLOR) },
        uCoreColor: { value: new Color(CORE_COLOR) },
      },
      vertexShader,
      fragmentShader: ringFragmentShader,
      side: DoubleSide,
    });

    this.membraneMaterial = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uDeepColor: { value: new Color("#08243a") },
        uAccentColor: { value: new Color(ACCENT_COLOR) },
        uCoreColor: { value: new Color(CORE_COLOR) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: membraneFragmentShader,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });

    const eventHorizon = new Mesh(
      new CircleGeometry(1.38, this.lowPower ? 64 : 128),
      new MeshBasicMaterial({ color: 0x06121c, side: DoubleSide, blending: NoBlending }),
    );
    eventHorizon.position.z = -0.06;
    this.portal.add(eventHorizon);

    const membrane = new Mesh(new CircleGeometry(1.37, this.lowPower ? 64 : 128), this.membraneMaterial);
    membrane.position.z = 0.01;
    this.portal.add(membrane);

    const ringSegments = this.lowPower ? 48 : 96;
    const radialSegments = this.lowPower ? 96 : 192;
    const mainRing = new Mesh(new TorusGeometry(1.58, 0.17, ringSegments, radialSegments), this.ringMaterial);
    const innerRing = new Mesh(new TorusGeometry(1.28, 0.035, ringSegments, radialSegments), this.ringMaterial);
    const outerRing = new Mesh(new TorusGeometry(1.9, 0.045, ringSegments, radialSegments), this.ringMaterial);
    innerRing.position.z = 0.05;
    outerRing.position.z = -0.02;
    outerRing.scale.set(1, 0.78, 1);
    outerRing.rotation.z = 0.38;
    this.portal.add(mainRing, innerRing, outerRing);

    this.glowTexture = createGlowTexture();
    this.coreGlow = new Sprite(
      new SpriteMaterial({
        map: this.glowTexture,
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.58 * GLOW_ALPHA_SCALE,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
      }),
    );
    this.coreGlow.scale.set(6.2, 6.2, 1);
    /* Between the backing disc and the membrane, so the halo reads as light
       inside the portal instead of glow trapped behind an opaque plate. */
    this.coreGlow.position.z = -0.02;

    this.innerGlow = new Sprite(
      new SpriteMaterial({
        map: this.glowTexture,
        color: 0xd6fbff,
        transparent: true,
        opacity: 0.42 * GLOW_ALPHA_SCALE,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
      }),
    );
    this.innerGlow.scale.set(3.5, 3.5, 1);
    this.innerGlow.position.z = 0.03;
    this.portal.add(this.coreGlow, this.innerGlow);

    this.particles = createParticles(this.lowPower, 1);
    this.particleMaterial = this.particles.material as ShaderMaterial;
    this.scene.add(this.particles);

    this.resize();
    /* The webfont lands after first paint and reflows the headline box, which
       would leave the published ring pointing at where the type used to be. */
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => this.resize()).catch(() => undefined);
    }
    /* Paint one frame right here. The first frame is what flips
       data-webgl="ready" and fades the canvas in, so it must not wait on the
       ticker or on the tab being foregrounded. */
    this.render(performance.now() / 1000);
  }

  render = (timeSeconds: number): void => {
    if (this.destroyed) {
      return;
    }

    /* Suspending is for battery, and only ever applies once something is already
       on screen. Before that, honour nothing: a hidden or suspended first frame
       is a permanently invisible canvas. */
    if (this.painted && (this.suspended || document.hidden)) {
      return;
    }

    const delta = this.lastFrame > 0 ? Math.min(timeSeconds - this.lastFrame, 0.05) : 0.016;
    this.lastFrame = timeSeconds;
    /* Frozen means reduced motion: time stands still, so the scene is a still
       frame rather than something that has to be hidden. */
    if (!this.frozen) {
      this.elapsed += delta;
    }

    const progress = this.frozen ? 0 : clamp(this.state.progress);
    const { centring, approach, departure, pointerFade, dissolve } = getScrollPhase(progress);

    this.pointer.x += (this.targetPointer.x - this.pointer.x) * Math.min(1, delta * 4.8);
    this.pointer.y += (this.targetPointer.y - this.pointer.y) * Math.min(1, delta * 4.8);

    const enter = getEnterProgress(this.elapsed, this.frozen);

    this.portal.position.x = mix(this.config.portalX, 0, centring);
    this.portal.position.y = mix(this.config.portalY, 0, centring);
    this.portal.position.z = -progress * 0.35;
    this.portal.scale.setScalar(
      this.config.portalScale *
        (1 + smoothstep(0.08, 0.58, progress) * 0.62 - departure * 0.24) *
        (1 - dissolve * 0.18) *
        /* Multiplied after the scroll scale, so the entrance opens onto the
           composition instead of being overwritten by it. */
        mix(0.72, 1, enter),
    );
    this.portal.rotation.z = this.elapsed * 0.045 + this.pointer.x * 0.08 * pointerFade;
    this.portal.rotation.y = Math.sin(this.elapsed * 0.24) * 0.08 + this.pointer.x * 0.12 * pointerFade;
    this.portal.rotation.x = Math.cos(this.elapsed * 0.19) * 0.045 - this.pointer.y * 0.08 * pointerFade + (1 - enter) * 0.9;

    this.camera.position.x = this.pointer.x * 0.15 * pointerFade;
    this.camera.position.y = -this.pointer.y * 0.11 * pointerFade;
    this.camera.position.z = this.config.cameraZ - approach * (this.config.cameraZ + 0.45);
    this.camera.lookAt(this.portal.position.x * 0.28, this.portal.position.y * 0.18, 0);

    this.ringMaterial.uniforms.uTime.value = this.elapsed;
    this.ringMaterial.uniforms.uProgress.value = progress;
    this.membraneMaterial.uniforms.uTime.value = this.elapsed;
    this.membraneMaterial.uniforms.uProgress.value = progress;
    this.particleMaterial.uniforms.uTime.value = this.elapsed;
    this.particleMaterial.uniforms.uProgress.value = progress;

    (this.coreGlow.material as SpriteMaterial).opacity = 0.58 * GLOW_ALPHA_SCALE * (1 - dissolve);
    (this.innerGlow.material as SpriteMaterial).opacity = 0.42 * GLOW_ALPHA_SCALE * (1 - dissolve);
    this.portal.visible = dissolve < 0.999;

    this.renderer.render(this.scene, this.camera);

    /* After the render, so the camera's world matrix is current and the measured
       ring lands on the frame it is describing rather than the one before it. */
    this.publishOrbMetrics();

    /* Only announce the canvas once something is actually on screen, otherwise
       the 900ms fade-in starts on an empty buffer. */
    if (!this.painted) {
      this.painted = true;
      document.documentElement.dataset.webgl = this.hasVisiblePixels() ? "ready" : "blank";
    }
  };

  /* A context can be created and still draw nothing: three.js does not throw on
     a failed shader compile, it just renders an empty scene. One probe of a few
     pixels decides which state we are really in, instead of assuming "ready". */
  private hasVisiblePixels(): boolean {
    try {
      const gl = this.renderer.getContext();
      const probe = new Uint8Array(4);
      const width = this.renderer.domElement.width;
      const height = this.renderer.domElement.height;
      const points = [
        [0.64, 0.42],
        [0.5, 0.5],
        [0.7, 0.5],
        [0.58, 0.34],
        [0.42, 0.5],
      ];

      return points.some(([x, y]) => {
        gl.readPixels((width * x) | 0, (height * y) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe);
        return probe[3] > 8;
      });
    } catch {
      return false;
    }
  }

  /* The orb's centre and radius, published to CSS as offsets into the headline
     box. Writing to that element rather than :root is deliberate: a custom
     property on :root is an inheritance candidate, so mutating it dirties style
     for the whole document. Offsets rather than viewport coordinates, so they
     need no knowledge of the grid, the page gutters or the header height — and
     so they stay correct as the box scrolls. */
  private publishOrbMetrics(): void {
    if (!this.wrap) {
      return;
    }

    const edge = TORUS_OUTER_RADIUS * this.portal.scale.x;
    this.probe.set(this.portal.position.x, this.portal.position.y, 0).project(this.camera);
    this.probeEdge.set(this.portal.position.x + edge, this.portal.position.y, 0).project(this.camera);

    const { dx, dy, r } = getOrbMetrics(
      { x: this.probe.x, y: this.probe.y },
      { x: this.probeEdge.x, y: this.probeEdge.y },
      { width: this.viewportWidth, height: this.viewportHeight },
      { left: this.wrapLeft, top: this.wrapTop },
    );

    /* Quantised to half a pixel and written only on change, so a still pointer
       and a settled scroll cost nothing. Same guard as atmosphere.ts. */
    const set = (name: string, value: number): void => {
      const next = Math.round(value * 2) / 2;
      if (this.orbVars[name] === next) {
        return;
      }
      this.orbVars[name] = next;
      this.wrap?.style.setProperty(`--orb-${name}`, `${next}px`);
    };

    set("dx", dx);
    set("dy", dy);
    set("r", r);
  }

  /* Only the headline box moves independently of the viewport: on resize, and
     once the webfont lands and reflows it. Everything else is derived per frame. */
  private measureWrap(): void {
    if (!this.wrap) {
      return;
    }
    const bounds = this.wrap.getBoundingClientRect();
    this.wrapLeft = bounds.left;
    this.wrapTop = bounds.top;
    this.orbVars.dx = Number.NaN;
    this.orbVars.dy = Number.NaN;
    this.orbVars.r = Number.NaN;
  }

  resize = (): void => {
    if (this.destroyed) {
      return;
    }

    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.config = getResponsiveCameraConfig(width, height, this.lowPower);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.config.pixelRatioCap);
    this.camera.aspect = width / height;
    this.camera.fov = this.config.fov;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.particleMaterial.uniforms.uPixelRatio.value = pixelRatio;
    this.measureWrap();
  };

  setPointer = (x: number, y: number): void => {
    if (!this.frozen) {
      this.targetPointer.set(x, y);
    }
  };

  setSuspended = (suspended: boolean): void => {
    this.suspended = suspended;
    if (!suspended) {
      this.lastFrame = 0;
    }
  };

  markContextLost = (): void => {
    this.setSuspended(true);
    document.documentElement.dataset.webgl = "lost";
  };

  markContextRestored = (): void => {
    this.resize();
    this.setSuspended(false);
    this.render(performance.now() / 1000);
  };

  destroy = (): void => {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.scene.traverse((object) => {
      if (object instanceof Mesh || object instanceof Points || object instanceof Sprite) {
        object.geometry?.dispose();
        const material = object.material;
        if (Array.isArray(material)) {
          material.forEach((item) => item.dispose());
        } else {
          material.dispose();
        }
      }
    });
    this.glowTexture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.wrap?.style.removeProperty("--orb-dx");
    this.wrap?.style.removeProperty("--orb-dy");
    this.wrap?.style.removeProperty("--orb-r");
    document.documentElement.dataset.webgl = "unsupported";
  };
}

export const createPortalExperience = (canvas: HTMLCanvasElement, state: PortalSceneState): PortalExperience | null => {
  try {
    return new PortalExperience(canvas, state);
  } catch {
    document.documentElement.dataset.webgl = "unsupported";
    return null;
  }
};

export const isPortalMotionEnabled = (): boolean => document.documentElement.dataset.motion !== "off" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const isFinePointer = (): boolean => window.matchMedia("(hover: hover) and (pointer: fine)").matches;
