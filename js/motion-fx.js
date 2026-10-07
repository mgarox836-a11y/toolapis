/* =============================================================================
   motion-fx.js — TOOLAPIS · ambient motion
   -----------------------------------------------------------------------------
   The page's decorative motion, kept in one module and separate from both the
   motion POLICY (js/motion.js) and any tool logic:

     1. hero headline reveal, per word, with the tracking settle;
     2. hero glow parallax, capped at 12px;
     3. navbar state on scroll.

   Item 3 USED to be duplicated here as a fallback for script.js's
   IntersectionObserver. It no longer is: the sentinel in script.js is the only
   thing that toggles `.nav-solid`, because two listeners racing to set the
   same class on the same scroll is a bug waiting for the one case they
   disagree on.

   DESIGN.md does not define motion, so the character is "instrument panel":
   precise, calm, transform/opacity only, and completely inert when motion is
   off (either the visitor's choice or the OS setting).

   No dependencies. Every step is wrapped: this file failing costs ambience and
   nothing else.
   ========================================================================== */

import { motionAllowed, onMotionChange } from './motion.js';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** True when nothing should move: either policy says so, or the OS does. */
function still() {
  try {
    if (!motionAllowed()) return true;
    return typeof window.matchMedia === 'function'
      && window.matchMedia(REDUCED_QUERY).matches === true;
  } catch (e) {
    return false;
  }
}

/* ---------------------------------------------------------------------------
   1. HERO HEADLINE
   The words start translated down inside their own line mask and are released
   one at a time. The nth-child delays live in css/animations.css, so this
   function only has to add the class.
   ------------------------------------------------------------------------- */
function heroReveal() {
  const words = document.querySelectorAll('.hero-title .word-reveal');
  if (!words.length) return;

  const release = () => {
    Array.prototype.forEach.call(words, (w, i) => {
      window.setTimeout(() => w.classList.add('is-visible'), i * 80);
    });
  };

  if (still()) {
    Array.prototype.forEach.call(words, w => w.classList.add('is-visible'));
    return;
  }

  /* There is no preloader to wait out any more, so the words go as soon as the
     DOM is ready. The nth-child transition-delays in css/animations.css do the
     staggering; this only hands over the class. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', release, { once: true });
  } else {
    release();
  }
}

/* ---------------------------------------------------------------------------
   2. HERO GLOW PARALLAX
   Capped at 12px. Damped toward the target so the glow trails the pointer
   instead of tracking it, which is what makes it feel like depth.
   ------------------------------------------------------------------------- */
function heroParallax() {
  const glow = document.querySelector('.hero-glow');
  const grid = document.querySelector('.hero-grid-lines');
  if (!glow || !grid) return;
  if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;

  let tx = 0, ty = 0, cx = 0, cy = 0, raf = null;

  const tick = () => {
    raf = null;
    cx += (tx - cx) * 0.06;
    cy += (ty - cy) * 0.06;
    glow.style.transform = 'translate3d(' + cx.toFixed(2) + 'px,' + cy.toFixed(2) + 'px,0)';
    if (Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05) raf = requestAnimationFrame(tick);
  };

  const onMove = (e) => {
    tx = clamp((e.clientX / window.innerWidth - 0.5) * 2, -1, 1) * 12;
    ty = clamp((e.clientY / window.innerHeight - 0.5) * 2, -1, 1) * 12;
    if (!raf) raf = requestAnimationFrame(tick);
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('mouseout', () => {
    tx = 0; ty = 0;
    if (!raf) raf = requestAnimationFrame(tick);
  });
}

/* ---------------------------------------------------------------------------
   3. NAVBAR STATE — REMOVED
   This used to re-assert `.nav-solid` on scroll as a fallback for script.js's
   sentinel observer. Two listeners setting the same class from two different
   definitions of "scrolled" (a sentinel's intersection ratio vs a raw scrollY
   comparison) is not a belt-and-braces pair, it is two answers to one
   question, and during a fast restore or a momentum scroll they will disagree
   for a frame. script.js's sentinel is now the only writer.
   ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
   BOOT
   ------------------------------------------------------------------------- */
function boot() {
  try { heroReveal(); } catch (e) {}
  /* The parallax is the only part that depends on the policy, so it is attached
     and detached with it rather than being decided once at load. */
  try {
    if (!still()) {
      heroParallax();
    } else {
      onMotionChange((allowed) => {
        if (allowed) heroParallax();
      });
    }
  } catch (e) {}
}

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
} catch (e) { /* the page keeps working; only the ambience is missing */ }
