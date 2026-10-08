/* =============================================================================
   SECTION BACKGROUNDS — js/section-bg.js
   -----------------------------------------------------------------------------
   The backgrounds are CSS + SVG (css/section-bg.css). This file is only the
   controller, and it has three jobs. What it does NOT do is deliberate:

     1. PAUSE. One IntersectionObserver per `.section-bg` toggles `.is-active`,
        and the stylesheet turns that into `animation-play-state: paused` over
        the whole subtree. Per section rather than one shared observer: a shared
        one would have to fan a boolean back out to a set of elements and would
        lose the per-section answer the moment both were on screen.
     2. CURSOR SPOTLIGHT. Writes --mx/--my from a rAF that CANCELS ITSELF once
        the pointer settles. That is the whole reason it is not "loop while
        visible": a damped follow loop that never ends is a compositor wake per
        frame forever, and an idle cursor is exactly the case that pays for it.
     3. POLICY. Imports js/motion.js and never queries the OS directly, per that
        module's rule. With motion off the stylesheet's base values ARE the
        reduced-motion state, so this only has to stop its own rAF.

   NOT HERE, AND WHY
     card→edge hover sync  CSS :has(), not a listener per card plus a class
                            plus a teardown, to express one comma.
     stars and glyphs      static markup with custom properties — no per-item
                            code at all, and they still blink with JS off.
     every pulse           stroke-dashoffset keyframes. Paint, not behaviour.

   Everything is guarded and boot is in one try/catch: a failure here costs two
   ambient backdrops, because the backgrounds are markup and CSS and need none
   of this to render.
   ========================================================================== */

import { motionAllowed, onMotionChange } from './motion.js';

/* Below this the light has effectively arrived, and scheduling more frames to
   move it 0.4px is the exact cost the self-cancelling rAF exists to avoid. */
const SETTLED = 0.5;
/* Firmer than hero3d.js's 0.06: this follows a cursor across a smaller box, so
   it wants to feel attached rather than lazy. */
const DAMP = 0.12;

const HOVERS = (() => {
  try {
    return window.matchMedia('(hover: hover)').matches
        && window.matchMedia('(pointer: fine)').matches;
  } catch (e) { return false; }
})();

let motion = motionAllowed();

/* ---------------------------------------------------------------------------
   1 · PAUSE
   ------------------------------------------------------------------------- */

/* `rootMargin: 80px` matches hero3d.js so both systems agree on what "gone"
   means: a section animates while any of it is still visible, and stops once it
   is fully off.

   The class goes on the SECTION, not on .section-bg. The mock windows are
   content and live outside the background, so a class scoped to the background
   would leave the terminal typing and the progress bar moving on a section
   nobody is looking at — the exact thing this observer exists to prevent. */
function watch(section) {
  const bg = section.querySelector('.section-bg');
  if (!bg) return;
  const set = (active) => section.classList.toggle('is-active', active);
  if (!('IntersectionObserver' in window)) { set(true); return; }
  new IntersectionObserver((entries) => {
    for (let i = entries.length - 1; i >= 0; i -= 1) set(entries[i].isIntersecting);
  }, { threshold: 0, rootMargin: '80px 0px' }).observe(bg);
}

/* The tab going away is a DIFFERENT question from the section going away, and
   script.js already answers it globally with `html.is-tab-hidden`, which pauses
   every animation in the document. css/section-bg.css picks that class up, so
   there is nothing to add here — only the rAF needs telling, and that is below.
   The observer is deliberately NOT disconnected on tab-hide: doing so would
   mean re-observing and re-deriving state, for a pause a class already gives. */

/* ---------------------------------------------------------------------------
   2 · CURSOR SPOTLIGHT
   ------------------------------------------------------------------------- */

function spotlight(section) {
  const bg = section.querySelector('.section-bg');
  const spot = bg && bg.querySelector('.section-bg__spot');
  if (!spot) return null;

  let targetX = 0, targetY = 0;  /* pointer position, % from the section's corner */
  let curX = -1, curY = -1;      /* where the light is; -1 = has never moved */
  let raf = null;

  /* Percentages rather than pixels so the light stays correct across a resize
     with no re-measure: the gradient is centred at --mx/--my and resolves
     against the section box. */
  const paint = () => {
    bg.style.setProperty('--mx', curX.toFixed(1) + '%');
    bg.style.setProperty('--my', curY.toFixed(1) + '%');
  };

  function tick() {
    raf = null;
    curX += (targetX - curX) * DAMP;
    curY += (targetY - curY) * DAMP;

    if (Math.abs(targetX - curX) < SETTLED && Math.abs(targetY - curY) < SETTLED) {
      /* Park exactly on target and stop. The next real move re-arms the loop, so
         an idle cursor costs zero frames instead of sixty a second. */
      curX = targetX; curY = targetY;
      paint();
      return;
    }
    paint();
    raf = requestAnimationFrame(tick);
  }

  const wake = () => { if (raf === null) raf = requestAnimationFrame(tick); };

  function onMove(e) {
    const r = section.getBoundingClientRect();
    if (!r.width || !r.height) return;
    targetX = ((e.clientX - r.left) / r.width) * 100;
    targetY = ((e.clientY - r.top) / r.height) * 100;
    spot.classList.add('is-lit');
    wake();
  }

  /* Leaving fades the light out rather than parking it. A spotlight that follows
     the pointer out of frame is a bright patch sitting over the section's own
     content, which is the opposite of ambient. */
  function off() {
    targetX = curX = -1; targetY = curY = -1;
    spot.classList.remove('is-lit');
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
  }

  const enter = () => { if (!motion) off(); };
  section.addEventListener('pointermove', onMove, { passive: true });
  section.addEventListener('pointerenter', enter, { passive: true });
  section.addEventListener('pointerleave', off, { passive: true });

  return () => {  /* the release, as one call */
    off();
    section.removeEventListener('pointermove', onMove);
    section.removeEventListener('pointerenter', enter);
    section.removeEventListener('pointerleave', off);
  };
}

/* ---------------------------------------------------------------------------
   BOOT
   ------------------------------------------------------------------------- */

function boot() {
  const backgrounds = Array.from(document.querySelectorAll('.section-bg'));
  if (!backgrounds.length) return;

  let spots = [];

  const wire = () => {
    backgrounds.forEach((bg) => watch(bg.closest('section') || document.body));
    if (HOVERS && motion) {
      spots = backgrounds
        .map((bg) => spotlight(bg.closest('section') || document.body))
        .filter(Boolean);
    }
  };

  const unwind = () => {
    spots.forEach((fn) => { try { fn(); } catch (e) { /* one failure is not the page */ } });
    spots = [];
    /* Drop the active class too, so a section that was on screen at the moment
       motion was switched off does not keep looping behind a stylesheet that is
       about to change its mind. The observer sets it again on the next scroll. */
    backgrounds.forEach((bg) => {
      const sec = bg.closest('section');
      if (sec) sec.classList.remove('is-active');
    });
  };

  wire();

  onMotionChange((allowed) => {
    motion = allowed;
    if (allowed) wire(); else unwind();
  });

  window.addEventListener('pagehide', unwind);
}

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
} catch (e) { /* the backgrounds are CSS and SVG and still render without this */ }