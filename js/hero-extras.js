/* =============================================================================
   hero-extras.js — TOOLAPIS · hero-only extras
   -----------------------------------------------------------------------------
   The hero's moving parts that are not the headline and not the motion policy:

     * a damped cursor parallax on the TOOL PASS card (6px x, 4px y);
     * the drifting coordinate readout in the hero's stamped meta strip.

   WHAT THIS FILE NO LONGER OWNS
   -----------------------------------------------------------------------------
   The previous build ran a full-bleed sky <video> and an animated contrail
   behind the hero, then a WebGL layer behind those. All three are gone. The
   ground DESIGN.md asks for — neon-lit geometry on a dark gradient, blending
   into #070707 with no hard mask — is drawn entirely in CSS by css/hero.css.
   The players and observers went with them rather than being left behind
   guarding elements that no longer exist.

   The headline parallax lives in js/motion-fx.js now, alongside the rest of the
   ambient motion, so all decorative motion is in one place.
   ========================================================================== */

(function () {
  'use strict';

  const root = document.documentElement;
  const hero = document.getElementById('hero');
  if (!hero) return;

  const pass = hero.querySelector('.hero-boarding');
  const coordsEl = hero.querySelector('[data-coords]');

  const reduced = root.classList.contains('motion-reduced')
    || root.classList.contains('reduced-motion')
    || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  /* ---------------------------------------------------------------------
     TOOL PASS parallax. Damped through a rAF loop, so the card trails the
     pointer instead of tracking it, and it is transform-only — nothing here
     can trigger layout.
     --------------------------------------------------------------------- */
  if (pass && !reduced && !coarse) {
    let x = 0, y = 0, cx = 0, cy = 0, raf = null;

    const tick = function () {
      raf = null;
      cx += (x - cx) * 0.06;
      cy += (y - cy) * 0.06;
      pass.style.transform = 'translate3d(' + cx.toFixed(2) + 'px,' + cy.toFixed(2) + 'px,0)';
      if (Math.abs(x - cx) > 0.05 || Math.abs(y - cy) > 0.05) raf = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', function (e) {
      x = (e.clientX / window.innerWidth - 0.5) * 12;
      y = (e.clientY / window.innerHeight - 0.5) * 8;
      if (!raf) raf = requestAnimationFrame(tick);
    }, { passive: true });

    window.addEventListener('mouseout', function () {
      x = 0; y = 0;
      if (!raf) raf = requestAnimationFrame(tick);
    });
  }

  /* ---------------------------------------------------------------------
     Coordinate readout. A slow sine drift, so the strip reads as a live
     instrument rather than as static text.
     --------------------------------------------------------------------- */
  if (coordsEl && !reduced) {
    const baseLat = 37.7681;
    const baseLon = -122.0039;
    let t = 0;
    window.setInterval(function () {
      t += 0.00008;
      coordsEl.textContent = (baseLat + Math.sin(t) * 0.0004).toFixed(4)
        + '° N, ' + (baseLon + Math.cos(t) * 0.0005).toFixed(4) + '° W';
    }, 1200);
  }
})();
