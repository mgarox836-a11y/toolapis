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
   back so the caller can land on an exact finish. `stopped` is asked before
   anything is fired, so a skip that lands between two steps kills the loop
   instead of leaving it mutating an element that has already come off the
   page. */
const runTimeline = (
  steps: [number, () => void][],
  done: (elapsed: number) => void,
  stopped: () => boolean,
): void => {
  const start = performance.now();
  let next = 0;

  const tick = (now: number): void => {
    if (stopped()) {
      return;
    }

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

const SHOWN = "toolapis:loader";

/* Once per session, so a reload lands on the page rather than behind five more
   seconds of intro. sessionStorage rather than localStorage, so closing the tab
   earns the intro again and reloading inside it does not.

   Both calls are wrapped because storage throws rather than returning null when
   a privacy setting blocks it, and the failure to record is the one case where
   playing the intro again is the better answer. */
const shownThisSession = (): boolean => {
  try {
    return sessionStorage.getItem(SHOWN) !== null;
  } catch {
    return false;
  }
};

const rememberIntro = (): void => {
  try {
    sessionStorage.setItem(SHOWN, "1");
  } catch {
    /* Nothing to say: the intro simply plays once per page load instead. */
  }
};

export const runLoader = (): Promise<void> => {
  const loader = document.getElementById("loader");
  let ended = false;
  const release = (): void => {
    loader?.remove();
    document.documentElement.classList.remove("is-loading");
    /* The single signal that the page is live. The hero clip-reveal, the sub
       copy and the CTAs are all parked behind it, so it has to be set on every
       path out of the intro, including the reduced-motion bail. */
    document.documentElement.classList.add("is-ready");
    playHeroScramble();
  };
  /* The intro has four ways out now: it finishes, the user skips it, a step
     throws, or something throws on the way to any of those. All four have to
     land on the page exactly once, because the loader holds the scroll lock and
     covers the site: a missed release is a black page that cannot be scrolled,
     and a second one scrambles the hero again. */
  const end = (): void => {
    if (ended) {
      return;
    }
    ended = true;
    release();
  };

  /* No loader, motion off, or it has already played this session: straight
     through, rather than gating the page behind a five second wait for something
     the user opted out of or has already sat through. */
  if (
    !loader ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    shownThisSession()
  ) {
    end();
    return Promise.resolve();
  }

  /* Marked before the first frame rather than after the last one, so that a skip
     counts as having seen it. That is most of the point of skipping. */
  rememberIntro();

  return new Promise<void>((resolve) => {
    const onSkip = (): void => {
      finish();
    };
    /* pointerdown rather than click, so the gesture lands the same frame the
       finger does, and passive because nothing here cancels the event. The
       listeners come off on every path, including the natural finish, so a
       finished intro leaves nothing bound to the document. */
    const finish = (): void => {
      document.removeEventListener("keydown", onSkip);
      document.removeEventListener("pointerdown", onSkip);
      end();
      resolve();
    };

    document.addEventListener("keydown", onSkip);
    document.addEventListener("pointerdown", onSkip, { passive: true });

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
      runTimeline(
        steps,
        (elapsed) => {
          window.setTimeout(finish, Math.max(0, T.done - elapsed));
        },
        () => ended,
      );
    } catch (error) {
      console.error(error);
      finish();
    }
  });
};
