import Lenis from "lenis";
/* The .ts extension is explicit so `node --test` can resolve this graph without
   a bundler; vite resolves it the same way. */
import { getMagneticOffset, isMotionAllowed } from "../motion.ts";
import {
  getStickyProgress,
  initScrollBus,
  sampleScroll,
  scroll,
  trackSection,
} from "../scroll.ts";
import { clack, restoreSoundPreference, setSoundEnabled } from "../sound.ts";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@$%!";

/* Matches the panel count in the markup, and the runway in components.css is
   sized from it: three panels means two stage widths of travel. */
const PANEL_COUNT = 3;

/* Marquee cycle length in seconds. Scrolling harder shortens the cycle, so the
   ticker visibly reacts to the gesture instead of running at a fixed rate. */
export const getMarqueeSpeed = (velocity: number): number =>
  Math.max(6, 22 - Math.abs(velocity) * 0.9);

/* Only a decisive upward flick flips the ticker; a soft drift keeps it running
   forward, otherwise it would stutter every time the scroll eased out. */
export const getMarqueeDirection = (velocity: number): "reverse" | "normal" =>
  velocity < -2 ? "reverse" : "normal";

export const easeOutCubic = (progress: number): number => 1 - (1 - progress) ** 3;

export const countUp = (
  el: HTMLElement,
  target: number,
  suffix = "",
  duration = 1200,
): void => {
  const start = performance.now();
  const tick = (now: number): void => {
    const progress = Math.min((now - start) / duration, 1);
    el.textContent = Math.floor(easeOutCubic(progress) * target) + suffix;
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = (target < 10 ? `0${target}` : target) + suffix;
    }
  };
  requestAnimationFrame(tick);
};

/* Resolves left to right, so the eye can follow the word being decoded. */
export const scramble = (
  el: HTMLElement,
  finalText: string,
  delay = 0,
): void => {
  window.setTimeout(() => {
    let frame = 0;
    const total = 48;
    const id = window.setInterval(() => {
      el.textContent = finalText
        .split("")
        .map((ch, i) =>
          frame / total > i / finalText.length
            ? ch
            : CHARS[Math.floor(Math.random() * CHARS.length)],
        )
        .join("");
      if (++frame > total) {
        el.textContent = finalText;
        window.clearInterval(id);
      }
    }, 18);
  }, delay);
};

const initSmoothScroll = (): void => {
  /* The single bail for the whole smooth-scroll layer. With motion off there is
     no Lenis and no rAF at all: the browser's own scrolling is already correct,
     the bus never starts, and every scroll-linked effect sits on the resting
     value declared in tokens.css. Native hash jumps stand in for Lenis's anchor
     handling, and scroll-margin-top in base.css already carries the header
     clearance, so nothing else has to change. */
  if (!isMotionAllowed()) {
    return;
  }

  /* anchors lets Lenis handle every same-page hash link itself, and it reads
     scroll-margin-top off the target, so the fixed-header clearance is one CSS
     declaration and not a second offset to keep in step here. */
  const lenis = new Lenis({
    lerp: 0.08,
    duration: 1.4,
    autoRaf: false,
    anchors: true,
  });

  const marquee = document.getElementById("marquee");

  lenis.on("scroll", (instance) => {
    /* One event drives the bus and the ticker, so the page never grows a second
       rAF. The bus is sampled first so anything it publishes this frame is
       already current by the time the ticker reads its own velocity. */
    sampleScroll();

    if (marquee) {
      marquee.style.animationDuration = `${getMarqueeSpeed(instance.velocity)}s`;
      marquee.style.animationDirection = getMarqueeDirection(instance.velocity);
    }
  });

  const raf = (time: number): void => {
    lenis.raf(time * 1000);
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
};

const initReveals = (): void => {
  const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
  if (!targets.length) {
    return;
  }

  /* Without the observer the elements would stay at opacity 0, so show them
     rather than shipping a blank page. */
  if (!("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("revealed"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        /* The reveal offset lives on the independent translate/rotate
           properties, so there is nothing to hand back to the component
           afterwards and no cleanup to schedule. */
        entry.target.classList.add("revealed");
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.12 },
  );

  targets.forEach((el) => observer.observe(el));
};

const initCounters = (): void => {
  const targets = document.querySelectorAll<HTMLElement>("[data-count]");
  if (!targets.length || !("IntersectionObserver" in window) || !isMotionAllowed()) {
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        const el = entry.target as HTMLElement;
        const target = Number.parseInt(el.dataset.count ?? "0", 10);
        if (target > 0) {
          countUp(el, target, el.dataset.suffix ?? "");
        }
        observer.unobserve(el);
      }
    },
    { threshold: 0.5 },
  );

  targets.forEach((el) => observer.observe(el));
};

/* How hard each layer chases the pointer. The crosshair is close enough to feel
   exact, the ring is not, and the gap between them is the weight. */
const CURSOR_LAG = 0.45;
const TRAIL_LAG = 0.16;

/* Cap on catch-up per frame, so a jump across the viewport sprints rather than
   teleports, and so a dropped frame cannot fling the cursor off screen. */
const CATCHUP_CAP = 60;

/* Within this many px the cursor counts as having arrived and the loop stops.
   Measured on the slower layer, so the fast one is always settled first. */
const ARRIVED = 0.15;

/* The hero shapes trail the pointer much more softly than the cursor does, so
   they read as depth behind it rather than as part of it. */
const PARALLAX_LAG = 0.07;

/* One table for the whole zone system. Anything interactive falls back to
   "link", so this only has to name the zones that behave differently. */
const ZONES = {
  link: { className: "is-link", scale: 0.9 },
  panel: { className: "is-panel", scale: 1.7 },
  text: { className: "is-text", scale: 1 },
} as const;

type ZoneName = keyof typeof ZONES;

/* How much the hero shapes drift, in px at full deflection, and how far they
   turn with it. A circle has no visible rotation, so it gets none. */
const PARALLAX = [
  { selector: ".geo--square", depth: 34, turn: 0.3 },
  { selector: ".geo--circle", depth: 46, turn: 0 },
  { selector: ".geo--triangle", depth: 20, turn: -0.22 },
] as const;

const initPointerLayer = (): void => {
  const cursor = document.getElementById("cursor");
  const trailEl = document.getElementById("cursor-trail");

  if (!cursor || !trailEl || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    return;
  }

  /* The custom cursor is a lagging motion effect, so motion off means the
     native pointer instead. base.css gates `cursor: none` behind the same
     condition, or nothing would be visible at all. */
  if (!isMotionAllowed()) {
    return;
  }

  const pointer = { x: -60, y: -60 };
  const head = { x: -60, y: -60 };
  const ring = { x: -60, y: -60 };
  let zone: ZoneName = "link";
  let frame = 0;
  let shown = false;

  /* Normalised pointer position, worked out on the event rather than in the
     loop, so the loop never reads layout to know where the pointer is. */
  const aim = { x: 0, y: 0 };

  const shapes = PARALLAX.flatMap((spec) => {
    const el = document.querySelector<HTMLElement>(spec.selector);
    return el ? [{ el, depth: spec.depth, turn: spec.turn, at: { x: 0, y: 0 } }] : [];
  });

  /* Only transform is written, never left/top, so the browser never has to
     lay the element out to move it. The -50% in the same transform keeps the
     element's centre on the point. */
  const place = (el: HTMLElement, at: { x: number; y: number }, scale: number): void => {
    el.style.transform = `translate3d(calc(${at.x.toFixed(1)}px - 50%), calc(${at.y.toFixed(1)}px - 50%), 0) scale(${scale})`;
  };

  const applyZone = (next: ZoneName, label: string): void => {
    if (next === zone) {
      return;
    }
    cursor.classList.remove(ZONES[zone].className);
    trailEl.classList.remove(ZONES[zone].className);
    zone = next;
    cursor.classList.add(ZONES[zone].className);
    trailEl.classList.add(ZONES[zone].className);
    cursor.dataset.label = label;
  };

  const tick = (): void => {
    const headOffset = getMagneticOffset(pointer.x, pointer.y, head.x, head.y, CURSOR_LAG, CATCHUP_CAP);
    const ringOffset = getMagneticOffset(pointer.x, pointer.y, ring.x, ring.y, TRAIL_LAG, CATCHUP_CAP);

    head.x += headOffset.x;
    head.y += headOffset.y;
    ring.x += ringOffset.x;
    ring.y += ringOffset.y;

    place(cursor, head, ZONES[zone].scale);
    place(trailEl, ring, 1);

    /* The shapes chase the pointer from the opposite direction, so the hero
       gains a sense of depth off a single mouse. They ease rather than track,
       which is what stops them feeling glued to the cursor. */
    let settled = 0;

    for (const shape of shapes) {
      const target = { x: aim.x * shape.depth, y: aim.y * shape.depth };
      const offset = getMagneticOffset(target.x, target.y, shape.at.x, shape.at.y, PARALLAX_LAG, CATCHUP_CAP);
      shape.at.x += offset.x;
      shape.at.y += offset.y;
      shape.el.style.transform = `translate3d(${shape.at.x.toFixed(2)}px, ${shape.at.y.toFixed(2)}px, 0) rotate(${(shape.at.x * shape.turn).toFixed(2)}deg)`;
      settled = Math.max(settled, Math.hypot(target.x - shape.at.x, target.y - shape.at.y));
    }

    const ringGap = Math.hypot(pointer.x - ring.x, pointer.y - ring.y);

    /* Loop until everything has converged, so nothing freezes part-way through
       catching up when the pointer stops moving. */
    if (ringGap > ARRIVED || settled > ARRIVED) {
      frame = requestAnimationFrame(tick);
    } else {
      frame = 0;
    }
  };

  const wake = (): void => {
    if (!frame) {
      frame = requestAnimationFrame(tick);
    }
  };

  window.addEventListener(
    "pointermove",
    (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      aim.x = (event.clientX / window.innerWidth - 0.5) * 2;
      aim.y = (event.clientY / window.innerHeight - 0.5) * 2;

      if (!shown) {
        shown = true;
        /* Held back until the first real movement, so neither block sits in the
           corner of the viewport on load. */
        head.x = ring.x = pointer.x;
        head.y = ring.y = pointer.y;
        cursor.style.opacity = "1";
        trailEl.style.opacity = "1";
      }

      wake();
    },
    { passive: true },
  );

  /* One delegated listener rather than two per interactive element, which also
     means elements added later, such as the tool rail panels, are picked up
     with no extra wiring. */
  document.addEventListener("pointerover", (event) => {
    const target = event.target as Element | null;
    const hit = target?.closest<HTMLElement>("[data-cursor], a, button");

    if (!hit) {
      applyZone("link", "");
      return;
    }

    const declared = hit.dataset.cursor as ZoneName | undefined;
    applyZone(declared && declared in ZONES ? declared : "link", hit.dataset.cursorLabel ?? "");
  });
};

const initNavShadow = (): void => {
  const nav = document.getElementById("nav");
  if (!nav) {
    return;
  }

  const sync = (): void => {
    nav.classList.toggle("is-scrolled", window.scrollY > 10);
  };

  window.addEventListener("scroll", sync, { passive: true });
  sync();
};

/* Fired by the loader once the intro wipes away, so the hero decodes as the
   site is revealed rather than behind the overlay. */
export const playHeroScramble = (): void => {
  if (!isMotionAllowed()) {
    return;
  }

  const lines: [string, string, number][] = [
    ["hero-line-1", "WEB TOOLS", 100],
    ["hero-line-2", "FOR YOU", 420],
    ["hero-line-3", "ALL IN ONE.", 720],
  ];

  for (const [id, text, delay] of lines) {
    const el = document.getElementById(id);
    if (el) {
      scramble(el, text, delay);
    }
  }
};

/* The sound toggle, plus the one delegated press listener that fires the clack.
   Both live off a single data attribute rather than per-element listeners, so
   nothing has to be rewired when markup changes. */
const initSound = (): void => {
  const toggle = document.getElementById("sound-toggle");
  let on = restoreSoundPreference();

  toggle?.setAttribute("aria-pressed", String(on));

  toggle?.addEventListener("click", () => {
    on = !on;
    setSoundEnabled(on);
    toggle.setAttribute("aria-pressed", String(on));
  });

  document.addEventListener(
    "pointerdown",
    (event) => {
      if ((event.target as Element | null)?.closest("[data-clack]")) {
        clack();
      }
    },
    { passive: true },
  );
};

/* The tool rail.

   The bus reports how far the runway has travelled through the viewport, which
   is the wrong window for a pin: it runs from the section touching the bottom of
   the screen to it clearing the top, but the stage is only actually stuck
   between the section reaching the top and the section's own height running
   out. Mapping to the generic progress directly is what makes a pinned rail
   stop moving three quarters of the way down and then leave a long stretch of
   dead scroll underneath it.

   So the sticky window is computed from the raw geometry instead. The track
   itself is pure CSS: a 0..1 number times -200% is two stage widths, which is
   the whole width of three panels. The only thing JavaScript owns here is that
   one custom property. */
const initRail = (): void => {
  const rail = document.querySelector<HTMLElement>("[data-rail]");
  const indexEl = document.querySelector<HTMLElement>("[data-rail-index]");

  if (!rail) {
    return;
  }

  let lastIndex = 0;

  trackSection(rail, (_progress, top, height) => {
    const p = getStickyProgress(top, height, scroll.viewport);

    rail.style.setProperty("--rail-p", p.toFixed(4));

    /* The counter is the only part that costs a text write, so it is written
       only when the panel actually changes rather than every frame. */
    const index = Math.min(PANEL_COUNT, Math.round(p * (PANEL_COUNT - 1)) + 1);
    if (index !== lastIndex) {
      lastIndex = index;
      if (indexEl) {
        indexEl.textContent = String(index).padStart(2, "0");
      }
    }
  });
};

export const initAnimations = (): void => {
  /* The bus starts before Lenis so it is already live when Lenis's first scroll
     event asks it to sample. */
  initScrollBus();
  initSmoothScroll();
  initReveals();
  initCounters();
  initPointerLayer();
  initRail();
  initNavShadow();
  initSound();
};
