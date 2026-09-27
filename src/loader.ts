import { playHeroScramble } from "./scripts/animations.ts";

/* Three beats, and every one of them is an absolute offset from the start of the
   intro, so the run always ends at exactly T.done no matter how the browser
   schedules the frames in between. */
const T = {
  out: 520,
  done: 740,
} as const;

/* The longest the font gate is allowed to hold the page. A blocked or slow font
   CDN must never turn a 740ms intro into a stall, so this is a hard ceiling on
   the wait rather than a timeout on the promise. */
const FONTS_CAP = 600;

const SHOWN = "toolapis:loader";

/* Once per session, so a reload lands on the page rather than behind the intro
   again. sessionStorage rather than localStorage, so closing the tab earns the
   intro back and reloading inside it does not.

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

  /* No loader element, or it has already played this session: straight
     through, rather than gating the page behind a wait for something the user
     has already sat through. */
  if (!loader || shownThisSession()) {
    end();
    return Promise.resolve();
  }

  /* Marked before the first frame rather than after the last one, so that a skip
     counts as having seen it. That is most of the point of skipping. */
  rememberIntro();

  return new Promise<void>((resolve) => {
    const start = performance.now();
    /* Everything below is measured against the start, so the font gate can
       shorten the wait rather than add to it. */
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

    /* The assembly is pure CSS: the slab and both bars carry their own
       durations and delays, so this one class is the whole entrance. */
    loader.classList.add("in");
    exit = window.setTimeout(() => {
      loader.classList.add("out");
    }, T.out);

    /* The hero's own entrance is parked behind .is-ready, and it plays for
       about two seconds. Letting it start before Space Grotesk has landed means
       that whole sequence runs in the fallback face and then reflows on the
       swap, which is far more visible than the loader being on screen a beat
       longer. So the release waits on the fonts, bounded by FONTS_CAP. */
    const fonts = document.fonts?.ready;
    if (fonts) {
      const settle = (): void => {
        window.clearTimeout(cap);
        window.setTimeout(finish, remaining());
      };
      fonts.then(settle, settle);
      cap = window.setTimeout(finish, remaining() + FONTS_CAP);
    } else {
      cap = window.setTimeout(finish, remaining());
    }
  });
};
