/* =============================================================================
   hero-extras.js — TOOLAPIS · hero-only extras
   -----------------------------------------------------------------------------
   The hero's one remaining extra: a damped cursor parallax on the TOOL PASS
   card (12px x, 8px y), which is the only thing on the page that moves in
   response to the pointer other than the light-ribbon scene and the card
   spotlight.

   WHAT THIS FILE NO LONGER OWNS
   -----------------------------------------------------------------------------
   Three things used to live here and are gone, each with its markup:

     * a full-bleed sky <video> and an animated contrail;
     * a WebGL layer behind both;
     * a drifting coordinate readout in a stamped meta strip.

   The preloader and the meta strip went with the redesign; the video and the
   WebGL layer went earlier (the WebGL removal is commit b834c18 — it was the
   entire performance problem, 96% native GPU). The ground DESIGN.md asks for is
   now drawn in css/hero3d.css, and its parallax lives in js/hero3d.js.

   Everything decorative lives with everything else decorative:
     js/hero3d.js   the ribbon scene
     js/motion-fx.js  headline reveal + glow parallax
     js/widgets.js   section widgets
   This file is now one effect, so it is one small IIFE.
   ========================================================================== */

(function () {
  'use strict';

  var hero = document.getElementById('hero');
  if (!hero) return;

  var pass = hero.querySelector('.hero-boarding');
  if (!pass) return;

  var root = document.documentElement;
  var reduced = root.classList.contains('motion-reduced')
    || root.classList.contains('reduced-motion')
    || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  if (reduced || coarse) return;

  /* Damped through a rAF loop, so the card trails the pointer instead of
     tracking it, and it is transform-only — nothing here can trigger layout. */
  var x = 0, y = 0, cx = 0, cy = 0, raf = null;

  var tick = function () {
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

  /* Park it when the pointer leaves the window rather than holding the last
     offset forever. */
  window.addEventListener('mouseout', function () {
    x = 0; y = 0;
    if (!raf) raf = requestAnimationFrame(tick);
  });
})();
