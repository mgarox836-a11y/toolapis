import { playHeroScramble } from "./scripts/animations.ts";

/* Three beats, and every one of them is an absolute offset from the start of the
   intro, so the run always ends at exactly T.done no matter how the browser
   schedules the frames in between.

   `done` doubles as the FLOOR. The intro is never allowed to end before the
   assembly has had time to play, so an instantly-resolving document.fonts.ready
   cannot collapse it into something imperceptible. The clamp in remaining() is
   what enforces that. */
const T = {
  out: 520,
  done: 740,
} as const;

/* The longest the font gate is allowed to hold the page past the timeline. A
   blocked or slow font CDN must never turn a 740ms intro into a stall, so this
   is a hard ceiling on the wait rather than a timeout on the promise. */
const FONTS_CAP = 600;

/* How long to wait for the opening frames before assuming they are not coming.
   A backgrounded tab never runs a frame callback, so the intro has to be able to
   complete on a timer alone. */
const START_BACKSTOP = 200;

export const runLoader = (): Promise<void> => {
  const loader = document.getElementById("loader");
  let ended = false;
  const release = (): void => {
    loader?.remove();
    document.documentElement.classList.remove("is-loading");
    /* The single signal that the page is live. The hero clip-reveal, the sub
       copy and the CTAs are all parked behind it, so it has to be set on every
       path out of the intro. */
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

  /* No loader element in this document: straight through. There is deliberately
     no "has this played already" check. The intro belongs to a document, so it
     plays once per document load and therefore replays on every reload and every
     fresh tab. What keeps it off hash navigation and off a bfcache restore is
     that neither of those re-runs this module: there is no router, and a
     bfcache restore resumes the document without executing anything again. */
  if (!loader) {
    end();
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const start = performance.now();
    /* Everything below is measured against the start, so the font gate can
       shorten the wait but never shorten it past the animation's own end. */
    const remaining = (): number =>
      Math.max(0, T.done - (performance.now() - start));

    let exit = 0;
    let cap = 0;
    /* pointerdown rather than click, so the gesture lands the same frame the
       finger does, and passive because nothing here cancels the event. The
       listeners come off on every path, including the natural finish, so a
       finished intro leaves nothing bound to the document. */
    const onSkip = (): void => {
      finish();
    };
    const finish = (): void => {
      window.clearTimeout(exit);
      window.clearTimeout(cap);
      document.removeEventListener("keydown", onSkip);
      document.removeEventListener("pointerdown", onSkip);
      end();
      resolve();
    };

    document.addEventListener("keydown", onSkip);
    document.addEventListener("pointerdown", onSkip, { passive: true });

    /* Armed before the intro starts, not inside the frame wait below. If the
       tab is backgrounded the opening frames never arrive, and the page still
       has to be released rather than left under a black scroll lock. */
    cap = window.setTimeout(finish, T.done + FONTS_CAP + START_BACKSTOP);

    /* The intro only starts once a frame has actually been painted with the
       loader at its start state. Adding the class in the same task that first
       styles the element gives the transition no "before" value to animate
       from, so the mark simply appears at full size; and starting the clock here
       rather than at call time keeps the JS timers and the CSS transitions on
       one clock. Two frames, because the first only commits the start state. */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        loader.classList.add("in");
        exit = window.setTimeout(() => {
          loader.classList.add("out");
        }, T.out);

        /* The hero's own entrance is parked behind .is-ready, and it plays for
           about two seconds. Letting it start before Space Grotesk has landed
           means that whole sequence runs in the fallback face and then reflows on
           the swap, which is far more visible than the loader being on screen a
           beat longer. So the release waits on the fonts, bounded by FONTS_CAP
           and never shorter than the floor. */
        const fonts = document.fonts?.ready;
        if (fonts) {
          const settle = (): void => {
            window.clearTimeout(cap);
            window.setTimeout(finish, remaining());
          };
          fonts.then(settle, settle);
        }
      });
    });
  });
};
