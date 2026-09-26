/* The scroll bus: one read pass and one write pass per frame.

   Every scroll-linked effect on the site reads from here rather than adding its
   own listener or its own rAF. Lenis already owns the only animation frame on
   the page, and its scroll event is what drives this, so a smooth scroll, a
   pinned track, a scrubbed connector and a nav progress bar all cost one loop
   in total rather than four.

   The two passes are kept strictly apart, and that is the whole point.
   getBoundingClientRect() forces layout; writing a custom property that
   something has already read forces layout again. Measuring everything first
   and mutating everything after means the browser lays out at most once per
   frame. Interleaving the two is what turns a cheap frame into a janky one. */

export interface ScrollState {
  /** Smoothed scroll offset in px, as Lenis has actually applied it. */
  y: number;
  /** Total scrollable distance in px. Never zero, so progress cannot divide by it. */
  max: number;
  /** Page progress: 0 at the top of the document, 1 at the bottom. */
  progress: number;
  /**
   * Signed movement over the last frame in px, capped. Positive is scrolling
   * down. This is the physical input for the velocity-reactive effects.
   */
  velocity: number;
  /** Viewport height in px, cached here so the write pass never reads layout. */
  viewport: number;
}

export const scroll: ScrollState = {
  y: 0,
  max: 1,
  progress: 0,
  velocity: 0,
  viewport: 0,
};

/* Past this the velocity consumers are already saturated, and a touch fling
   would otherwise flick them clean off screen. */
const VELOCITY_CAP = 40;

/* The trailing +0 is deliberate. Negating zero produces -0, which is equal to 0
   under === but distinct under Object.is, so a caller or a test comparing the
   result would see a difference out of nowhere. */
const clamp = (value: number, min: number, max: number): number =>
  (value < min ? min : value > max ? max : value) + 0;

/**
 * How far an element has travelled through the viewport: 0 when its top edge
 * reaches the bottom of the screen, 1 once its bottom edge clears the top.
 *
 * Pure, so the one piece of real arithmetic in the bus is testable without a
 * DOM, the same way motion.ts is.
 */
export const getSectionProgress = (
  top: number,
  height: number,
  viewport: number,
): number => {
  const span = viewport + height;
  if (span <= 0) {
    return 1;
  }
  return clamp((viewport - top) / span, 0, 1);
};

/**
 * Progress across a pinned element's own sticky window, as opposed to its
 * travel through the viewport.
 *
 * 0 is where a `position: sticky` child starts to stick, which is the section's
 * top reaching the top of the screen. 1 is where it is released, which is the
 * section's height running out. Between those two the stage is genuinely stuck,
 * so that is the only window a pinned effect should be mapped to.
 *
 * getSectionProgress is the wrong tool for this and the difference is not
 * subtle: for a 300vh section at the moment it reaches the top of the screen,
 * getSectionProgress already reports 0.25 while the rail has not moved at all.
 * A rail driven by that arrives a quarter of the way across, and then leaves two
 * thirds of its travel in the last quarter of the runway, followed by a stretch
 * of dead scroll once the stage is released.
 */
export const getStickyProgress = (
  top: number,
  height: number,
  viewport: number,
): number => {
  const travel = height - viewport;
  if (travel <= 0) {
    return 1;
  }
  return clamp(-top / travel, 0, 1);
};

type FrameListener = (state: ScrollState) => void;

/**
 * Receives the generic 0..1 viewport travel, plus the element's raw top and
 * height in px.
 *
 * The raw values are there because the generic mapping is wrong for a pinned
 * section. It runs from the element touching the bottom of the viewport to it
 * clearing the top, but a sticky stage is only pinned between the element
 * reaching the top and the element's own height running out. Anything driving a
 * pin needs that second window, and working it out here keeps the measurement
 * inside the read pass rather than making a consumer read layout for itself.
 */
type SectionListener = (progress: number, top: number, height: number) => void;

interface TrackedSection {
  el: HTMLElement;
  onProgress: SectionListener;
  top: number;
  height: number;
}

/** An element's centre and size in viewport coordinates, as of the last read. */
export interface BoxState {
  x: number;
  y: number;
  width: number;
  height: number;
}

type BoxListener = (box: BoxState) => void;

interface TrackedBox {
  el: HTMLElement;
  onBox: BoxListener;
  box: BoxState;
}

const frameListeners = new Set<FrameListener>();
const sections = new Set<TrackedSection>();
const boxes = new Set<TrackedBox>();

let lastY = 0;
let running = false;

/* Measure. Runs once per frame and may not touch the DOM for writing. */
const read = (): void => {
  scroll.viewport = window.innerHeight;
  scroll.max = Math.max(
    1,
    document.documentElement.scrollHeight - scroll.viewport,
  );
  scroll.y = window.scrollY;
  scroll.progress = clamp(scroll.y / scroll.max, 0, 1);
  scroll.velocity = clamp(scroll.y - lastY, -VELOCITY_CAP, VELOCITY_CAP);
  lastY = scroll.y;

  for (const section of sections) {
    const rect = section.el.getBoundingClientRect();
    section.top = rect.top;
    section.height = rect.height;
  }

  for (const box of boxes) {
    const rect = box.el.getBoundingClientRect();
    box.box.x = rect.left + rect.width / 2;
    box.box.y = rect.top + rect.height / 2;
    box.box.width = rect.width;
    box.box.height = rect.height;
  }
};

/* Mutate. Runs once per frame and may not read layout. */
const write = (): void => {
  const style = document.documentElement.style;

  style.setProperty("--scroll-progress", scroll.progress.toFixed(4));
  style.setProperty("--scroll-velocity", scroll.velocity.toFixed(2));

  for (const section of sections) {
    section.onProgress(
      getSectionProgress(section.top, section.height, scroll.viewport),
      section.top,
      section.height,
    );
  }

  for (const listener of frameListeners) {
    listener(scroll);
  }

  for (const box of boxes) {
    box.onBox(box.box);
  }
};

/**
 * Drive the bus. Called from Lenis's scroll event, so it inherits Lenis's
 * smoothing rather than sampling the raw native position.
 */
export const sampleScroll = (): void => {
  if (!running) {
    return;
  }
  read();
  write();
};

/** Subscribe to every frame. Returns an unsubscribe function. */
export const onScrollFrame = (listener: FrameListener): (() => void) => {
  frameListeners.add(listener);
  return () => {
    frameListeners.delete(listener);
  };
};

/**
 * Publish an element's travel through the viewport, 0 to 1.
 *
 * Callbacks fire from the write pass, so they are expected to write CSS custom
 * properties rather than read anything back.
 */
export const trackSection = (
  el: HTMLElement,
  onProgress: SectionListener,
): (() => void) => {
  const section: TrackedSection = { el, onProgress, top: 0, height: 0 };
  sections.add(section);
  /* Measure straight away so the first painted frame is not one frame stale. */
  sampleScroll();
  return () => {
    sections.delete(section);
  };
};

/**
 * Publish an element's centre and size in viewport coordinates.
 *
 * For effects that need to know where something is relative to the pointer.
 * A pointer loop cannot measure for itself: getBoundingClientRect() after a
 * frame that wrote transforms forces layout, and the pointer layer writes a
 * transform on every frame it runs. So the measurement happens here, in the
 * read pass that has already paid for a layout this frame, and the pointer loop
 * only ever reads the cached numbers.
 *
 * The callback fires from the write pass, so it is expected to write, not read.
 * It fires on scroll and on resize rather than on every animation frame, which
 * is enough: the numbers only go stale while the element is moving, and moving
 * it is what makes this fire.
 */
export const trackBox = (el: HTMLElement, onBox: BoxListener): (() => void) => {
  const box: TrackedBox = {
    el,
    onBox,
    box: { x: 0, y: 0, width: 0, height: 0 },
  };
  boxes.add(box);
  sampleScroll();
  return () => {
    boxes.delete(box);
  };
};

/**
 * Start the bus. This always runs, so --rail-p and --flow-p are published for
 * every visitor and the rail always reaches all three panels. The resting
 * values in tokens.css cover the one case where the bus never gets here at all,
 * which is no script.
 */
export const initScrollBus = (): void => {
  if (running) {
    return;
  }
  running = true;
  window.addEventListener("resize", sampleScroll, { passive: true });
  sampleScroll();
};
