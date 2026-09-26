import { isMotionAllowed } from "./motion.ts";

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

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

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

type FrameListener = (state: ScrollState) => void;
type SectionListener = (progress: number) => void;

interface TrackedSection {
  el: HTMLElement;
  onProgress: SectionListener;
  top: number;
  height: number;
}

const frameListeners = new Set<FrameListener>();
const sections = new Set<TrackedSection>();

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
};

/* Mutate. Runs once per frame and may not read layout. */
const write = (): void => {
  const style = document.documentElement.style;

  style.setProperty("--scroll-progress", scroll.progress.toFixed(4));
  style.setProperty("--scroll-velocity", scroll.velocity.toFixed(2));

  for (const section of sections) {
    section.onProgress(
      getSectionProgress(section.top, section.height, scroll.viewport),
    );
  }

  for (const listener of frameListeners) {
    listener(scroll);
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
 * Start the bus. With motion switched off it never starts, so there is no rAF,
 * no measurement and no per-frame mutation at all: consumers fall back to the
 * resting values declared in tokens.css.
 */
export const initScrollBus = (): void => {
  if (running || !isMotionAllowed()) {
    return;
  }
  running = true;
  window.addEventListener("resize", sampleScroll, { passive: true });
  sampleScroll();
};
