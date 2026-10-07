/* =============================================================================
   motion-fx.js — TOOLAPIS · ambient motion
   -----------------------------------------------------------------------------
   The page's decorative motion, kept in one module and separate from both the
   motion POLICY (js/motion.js) and any tool logic:

     1. hero headline reveal, per word, with the tracking settle;
     2. hero glow parallax, capped at 12px;
     3. navbar state on scroll, so `.nav-solid` does not depend on a sentinel
        alone (the sentinel stays authoritative; this only re-asserts).

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

  /* The intro controller owns the hero's arrival (INTRO_DURATION is 5s and the
     curtain lifts at 3.6s), so the words are released just after it hands over
     rather than racing it. When the intro is not running, they go immediately. */
  if (document.documentElement.classList.contains('intro-active')) {
    window.setTimeout(release, 3900);
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
   3. NAVBAR STATE
   `.nav-solid` owns the hairline under the bar. script.js toggles it from the
   top sentinel; this is a re-assert on scroll for the case where that observer
   has not fired yet on a very fast restore, and it is idempotent.
   ------------------------------------------------------------------------- */
function navState() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;
  let ticking = false;
  const apply = () => {
    ticking = false;
    navbar.classList.toggle('nav-solid', window.scrollY > 8);
  };
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(apply);
  }, { passive: true });
  apply();
}

/* ---------------------------------------------------------------------------
   BOOT
   ------------------------------------------------------------------------- */
function boot() {
  try { heroReveal(); } catch (e) {}
  try { navState(); } catch (e) {}
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
