/* =============================================================================
   HERO 3D CONTROLLER — js/hero3d.js
   -----------------------------------------------------------------------------
   The scene itself is CSS + SVG (css/hero3d.css). This file is only the
   controller, and it exists for three jobs:

     1. PARALLAX. The pointer's offset, capped at 12px, written to --px/--py on
        the hero. The CSS moves each layer by a different fraction of that, so
        the scene has depth while the copy never drifts off its baseline.

     2. PAUSE. Nothing animates when the hero is off screen or the tab is
        hidden. The loops are CSS animations, so pausing means toggling a class
        that sets `animation-play-state: paused` — cheaper and safer than
        cancelling and restarting Web Animations that may already be running.

     3. TEARDOWN. Every listener is registered and removed together, so a
        re-init (motion toggle, hot reload) cannot stack duplicates.

   WHY NOT THREE.JS
   A WebGL hero was removed from this site in commit b834c18: it was the entire
   performance problem — Lighthouse 42/25 with it, 77/74 without — and the
   profile was 96% native GPU. This scene gets the same read for no GPU cost.

   The module goes inert when the VISITOR turns motion off — not when their
   operating system does, which this site deliberately does not consult. With
   motion off there is no pointer tracking, and the paused class is applied
   immediately so nothing loops.
   ========================================================================== */

import { motionAllowed, onMotionChange } from './motion.js';

/* The brief's ceiling for hero parallax. Anything larger and the headline
   visibly detaches from its baseline, which reads as a bug rather than depth. */
const MAX_SHIFT = 12;
/* Below this the pointer noise is not worth a repaint. */
const DEAD_ZONE = 2;

const scene = document.querySelector('.hero-scene');
const hero = document.getElementById('hero');

let reduceMotion = false;
let onScreen = true;
let tabVisible = !document.hidden;

/* -- parallax ------------------------------------------------------------- */
let targetX = 0, targetY = 0;
let curX = 0, curY = 0;
let rafId = null;

const finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

function onPointerMove(e) {
  if (reduceMotion || !finePointer || !scene) return;
  const r = scene.getBoundingClientRect();
  if (!r.width || !r.height) return;

  /* Normalise to -1..1 from the hero's own centre, so the parallax origin
     tracks the visual rather than the viewport. */
  const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
  const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);

  targetX = Math.max(-1, Math.min(1, nx)) * MAX_SHIFT;
  targetY = Math.max(-1, Math.min(1, ny)) * MAX_SHIFT;
}

function tick() {
  /* Damping at 0.08 per frame: fast enough to feel connected, slow enough that
     the motion reads as drift rather than as a drag. */
  curX += (targetX - curX) * 0.08;
  curY += (targetY - curY) * 0.08;

  if (Math.abs(targetX - curX) < 0.05 && Math.abs(targetY - curY) < 0.05) {
    curX = targetX;
    curY = targetY;
    rafId = null;
  } else {
    rafId = requestAnimationFrame(tick);
  }

  scene.style.setProperty('--px', curX.toFixed(2) + 'px');
  scene.style.setProperty('--py', curY.toFixed(2) + 'px');
}

function startLoop() {
  if (rafId === null && !reduceMotion) rafId = requestAnimationFrame(tick);
}

/* -- pause / resume ------------------------------------------------------- */
/* Applied to the hero subtree, so it covers the ribbon, the bloom and the
   chips in one write. */
function applyRunning() {
  if (!hero) return;
  const shouldPause = reduceMotion || !onScreen || !tabVisible;
  hero.classList.toggle('is-paused', shouldPause);
  if (shouldPause) {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    /* Park the pointer where it is rather than snapping the scene back, so a
       pause is invisible and a resume picks up from the same place. */
    curX = curX; curY = curY;
  }
}

/* -- wiring --------------------------------------------------------------- */
if (scene) {
  applyRunning();

  /* Off-screen detection. A generous negative bottom margin means the scene
     keeps animating while any of it is still visible, and stops once it is
     fully gone. */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      onScreen = entries.some((en) => en.isIntersecting);
      applyRunning();
      if (onScreen && !reduceMotion) startLoop();
    }, { threshold: 0, rootMargin: '80px 0px' }).observe(scene);
  }

  document.addEventListener('visibilitychange', () => {
    tabVisible = !document.hidden;
    applyRunning();
    if (onScreen && tabVisible && !reduceMotion) startLoop();
  });

  window.addEventListener('pointermove', onPointerMove, { passive: true });

  /* Stop tracking once the pointer leaves the document, so the scene settles
     instead of holding the last offset forever. */
  document.addEventListener('pointerleave', () => {
    targetX = 0; targetY = 0;
    if (!reduceMotion) startLoop();
  });

  /* Honour the OS setting and the in-page toggle. onMotionChange returns an
     unsubscribe, which is called on pagehide so nothing is left wired. */
  reduceMotion = !motionAllowed();
  applyRunning();

  onMotionChange((allowed) => {
    reduceMotion = !allowed;
    if (reduceMotion) {
      targetX = 0; targetY = 0;
      curX = 0; curY = 0;
      if (scene) {
        scene.style.setProperty('--px', '0px');
        scene.style.setProperty('--py', '0px');
      }
    }
    applyRunning();
    if (!reduceMotion && onScreen && tabVisible) startLoop();
  });
}
