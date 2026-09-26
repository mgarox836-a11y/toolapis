import { playHeroScramble } from "./scripts/animations.ts";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@$%!";

/* Every beat is an absolute offset from the start of the intro, so the run
   always ends at exactly 5s. Chaining one wait per phase instead would let each
   phase's rounding error accumulate into the total. */
const T = {
  line: 0,
  logo: 550,
  tagline: 1400,
  progress: 2200,
  flash: 3500,
  burst: 3500,
  flashOff: 3580,
  exit: 4200,
  done: 5000,
} as const;

const LETTER_STAGGER = 70;
const LETTER_FRAMES = 22;
const LETTER_TICK = 18;
const WORD_STAGGER = 150;
const PROGRESS_MS = 1300;

/* Resolves through random glyphs, then lands on the real one. */
const scrambleChar = (el: HTMLElement, finalChar: string): void => {
  el.classList.add("lit");
  let frame = 0;
  const id = window.setInterval(() => {
    el.textContent =
      frame / LETTER_FRAMES > 0.7
        ? finalChar
        : CHARS[Math.floor(Math.random() * CHARS.length)];
    if (++frame > LETTER_FRAMES) {
      el.textContent = finalChar;
      window.clearInterval(id);
    }
  }, LETTER_TICK);
};

/* Fires each step once its offset has passed, then hands the total elapsed time
   back so the caller can land on an exact finish. */
const runTimeline = (
  steps: [number, () => void][],
  done: (elapsed: number) => void,
): void => {
  const start = performance.now();
  let next = 0;

  const tick = (now: number): void => {
    const elapsed = now - start;
    while (next < steps.length && steps[next][0] <= elapsed) {
      steps[next][1]();
      next += 1;
    }

    if (next < steps.length) {
      requestAnimationFrame(tick);
    } else {
      done(elapsed);
    }
  };

  requestAnimationFrame(tick);
};

export const runLoader = (): Promise<void> => {
  const loader = document.getElementById("loader");
  const release = (): void => {
    loader?.remove();
    document.documentElement.classList.remove("is-loading");
    /* The single signal that the page is live. The hero clip-reveal, the sub
       copy and the CTAs are all parked behind it, so it has to be set on every
       path out of the intro, including the reduced-motion bail. */
    document.documentElement.classList.add("is-ready");
    playHeroScramble();
  };

  /* No loader, or motion is off: release straight away rather than gating the
     page behind a five second wait for something the user opted out of. */
  if (!loader || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    release();
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const pct = document.getElementById("loader-pct");
    const status = document.getElementById("loader-status");
    const letters = Array.from(
      loader.querySelectorAll<HTMLElement>(".loader-char"),
    );
    const words = Array.from(
      loader.querySelectorAll<HTMLElement>("#loader-tagline span"),
    );

    const steps: [number, () => void][] = [
      [T.line, () => loader.classList.add("phase-1")],
      [
        T.logo,
        () =>
          letters.forEach((el, i) =>
            window.setTimeout(
              () => scrambleChar(el, el.dataset.char ?? el.textContent ?? ""),
              i * LETTER_STAGGER,
            ),
          ),
      ],
      [
        T.tagline,
        () =>
          words.forEach((el, i) =>
            window.setTimeout(() => el.classList.add("lit"), i * WORD_STAGGER),
          ),
      ],
      [
        T.progress,
        () => {
          loader.classList.add("phase-4");

          const started = performance.now();
          const count = (now: number): void => {
            const progress = Math.min((now - started) / PROGRESS_MS, 1);
            if (pct) {
              pct.textContent = `${String(Math.floor(progress * 100)).padStart(2, "0")}%`;
            }

            if (progress < 1) {
              requestAnimationFrame(count);
            } else if (status) {
              status.textContent = "READY.";
              status.classList.add("ready");
            }
          };

          requestAnimationFrame(count);
        },
      ],
      [T.flash, () => loader.classList.add("flash")],
      [T.burst, () => loader.classList.add("burst")],
      [T.flashOff, () => loader.classList.remove("flash")],
      [T.exit, () => loader.classList.add("exiting")],
    ];

    /* Cleanup runs on every path, including a thrown step: a loader left on
       screen is a black page with the scroll locked, which is the one failure
       mode worth guarding against. */
    try {
      runTimeline(steps, (elapsed) => {
        window.setTimeout(
          () => {
            release();
            resolve();
          },
          Math.max(0, T.done - elapsed),
        );
      });
    } catch (error) {
      console.error(error);
      release();
      resolve();
    }
  });
};
