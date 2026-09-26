import Lenis from "lenis";
/* The .ts extension is explicit so `node --test` can resolve this graph without
   a bundler; vite resolves it the same way. */
import { getMagneticOffset, isMotionAllowed } from "../motion.ts";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@$%!";

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
  /* anchors: true lets Lenis handle every same-page hash link itself, and it
     reads scroll-margin-top off the target, so the fixed header offset is one
     CSS declaration rather than a second offset in JavaScript. */
  const lenis = new Lenis({
    lerp: 0.08,
    duration: 1.4,
    autoRaf: false,
    anchors: true,
  });

  const marquee = document.getElementById("marquee");

  if (marquee && isMotionAllowed()) {
    lenis.on("scroll", (instance) => {
      marquee.style.animationDuration = `${getMarqueeSpeed(instance.velocity)}s`;
      marquee.style.animationDirection = getMarqueeDirection(instance.velocity);
    });
  }

  const raf = (time: number): void => {
    lenis.raf(time * 1000);
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
};

const initReveals = (): void => {
  const targets = document.querySelectorAll<HTMLElement>("[data-reveal]");
  if (!targets.length || !("IntersectionObserver" in window)) {
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        const el = entry.target as HTMLElement;
        el.classList.add("revealed");
        /* Release the transform back to the component once the reveal has
           landed, otherwise the card would hover at the reveal's easing. */
        el.addEventListener("transitionend", () => el.classList.add("settled"), {
          once: true,
        });
        observer.unobserve(el);
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

const initCursor = (): void => {
  const cursor = document.getElementById("cursor");
  const trailEl = document.getElementById("cursor-trail");

  if (!cursor || !trailEl || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    return;
  }

  const at = { x: -40, y: -40 };
  const trailAt = { x: -40, y: -40 };

  const handleMove = (event: PointerEvent): void => {
    at.x = event.clientX;
    at.y = event.clientY;
    cursor.style.left = `${at.x}px`;
    cursor.style.top = `${at.y}px`;
    cursor.style.opacity = "1";

    /* The trail eases toward the pointer with the same capped geometry the
       magnetic hover used, instead of a setTimeout per mouse event. */
    const offset = getMagneticOffset(at.x, at.y, trailAt.x, trailAt.y, 0.3, 24);
    trailAt.x += offset.x;
    trailAt.y += offset.y;
    trailEl.style.left = `${trailAt.x}px`;
    trailEl.style.top = `${trailAt.y}px`;
    trailEl.style.opacity = "1";
  };

  window.addEventListener("pointermove", handleMove, { passive: true });

  document.querySelectorAll<HTMLElement>("a, button").forEach((el) => {
    el.addEventListener("pointerenter", () => cursor.classList.add("hover"));
    el.addEventListener("pointerleave", () => cursor.classList.remove("hover"));
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

export const initAnimations = (): void => {
  initSmoothScroll();
  initReveals();
  initCounters();
  initCursor();
  initNavShadow();

  if (isMotionAllowed()) {
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
  }
};
