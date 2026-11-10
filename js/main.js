/* =============================================================================
   MAIN — motion policy, entrance, smooth scroll, motion switch
   -----------------------------------------------------------------------------
   The page behaviour that was already tested (menu, scrollspy, toast, copy,
   page transition) stays in script.js. This module owns the new layer only.
   ========================================================================== */

import { initNav } from './nav.js';
import { initAnimations } from './animations.js';

const doc = document.documentElement;
const STORAGE_KEY = 'toolapis-motion';
const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

let lenis = null;
let animations = null;
let introDone = false;
let resolveIntro = () => {};
const introPromise = new Promise((resolve) => { resolveIntro = resolve; });

const isReduced = () => doc.classList.contains('motion-reduced');

function readPref() {
  try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
}

function writePref(value) {
  try { localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
}

/* ---------------------------------------------------------------------------
   Entrance
   ------------------------------------------------------------------------- */
function finishIntro() {
  if (introDone) return;
  introDone = true;
  doc.classList.remove('intro-active');
  const overlay = document.getElementById('intro-overlay');
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  resolveIntro();
}

function playIntro() {
  const overlay = document.getElementById('intro-overlay');
  if (!overlay) { finishIntro(); return introPromise; }

  let deepLink = false;
  try { deepLink = !!window.location.hash; } catch (e) {}
  let introOff = false;
  try { introOff = new URLSearchParams(window.location.search).get('intro') === 'off'; } catch (e) {}

  if (isReduced() || deepLink || introOff || !window.gsap) {
    finishIntro();
    return introPromise;
  }

  doc.classList.add('intro-active');

  const tl = window.gsap.timeline({ onComplete: finishIntro });
  window.gsap.set('.intro__brand', { y: 22, opacity: 0 });
  window.gsap.set('.intro__status', { opacity: 0 });

  tl.to('.intro__brand', { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out' })
    .to('#intro-fill', { scaleX: 1, duration: 0.85, ease: 'power3.inOut' }, 0.1)
    .to('.intro__status', { opacity: 1, duration: 0.35 }, 0.5)
    .to('#intro-overlay', { yPercent: -100, duration: 0.65, ease: 'power4.inOut' }, '+=0.12');

  /* The overlay is the one element that can take the page hostage. If the
     timeline never finishes, this timer removes it anyway. */
  window.setTimeout(finishIntro, 2600);
  return introPromise;
}

function heroEntrance() {
  if (!window.gsap || isReduced()) return;
  const lines = document.querySelectorAll('.hero__line > span');
  if (!lines.length) return;

  const tl = window.gsap.timeline({ defaults: { ease: 'power3.out' } });
  tl.to(lines, { yPercent: 0, duration: 0.9, stagger: 0.09, ease: 'power4.out' })
    .to('.hero__eyebrow, .hero__subtitle, .hero__cta', { y: 0, opacity: 1, duration: 0.7, stagger: 0.08 }, '-=0.55')
    .to('.hero__art', { opacity: 1, y: 0, duration: 0.9 }, '-=0.6')
    .to('.hero__chip', { opacity: 1, y: 0, duration: 0.5, stagger: 0.08 }, '-=0.5');
}

/* ---------------------------------------------------------------------------
   Lenis
   ------------------------------------------------------------------------- */
function makeLenis() {
  if (isReduced() || !window.Lenis) return null;
  try {
    const instance = new window.Lenis({
      duration: 1.1,
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.4
    });

    if (window.gsap && window.ScrollTrigger) {
      instance.on('scroll', window.ScrollTrigger.update);
      window.gsap.ticker.add((time) => instance.raf(time * 1000));
      window.gsap.ticker.lagSmoothing(0);
    } else {
      const raf = (time) => { instance.raf(time); window.requestAnimationFrame(raf); };
      window.requestAnimationFrame(raf);
    }
    window.__lenis = instance;
    return instance;
  } catch (e) {
    return null;
  }
}

/* ---------------------------------------------------------------------------
   Motion switch
   ------------------------------------------------------------------------- */
function updateToggle(reduced) {
  const btn = document.getElementById('motion-toggle');
  if (!btn) return;
  const label = btn.querySelector('.motion-toggle-label');
  btn.setAttribute('aria-pressed', reduced ? 'true' : 'false');
  if (label) label.textContent = reduced ? 'Turn motion back on' : 'Reduce motion';
  const hint = document.getElementById('motion-toggle-hint');
  if (hint) {
    hint.textContent = reduced
      ? 'Animations off. Turn back on any time.'
      : 'Animations on. Turn off if motion bothers you.';
  }
}

function applyMotion(reduced, persist) {
  doc.classList.toggle('motion-reduced', reduced);
  if (persist) writePref(reduced ? 'off' : 'on');
  updateToggle(reduced);

  if (reduced) {
    if (lenis) { lenis.destroy(); lenis = null; }
    /* Lenis leaves `scroll-behavior: smooth` inline on <html>. An inline style
       beats the stylesheet, so the "no motion" promise would be a lie. */
    doc.style.removeProperty('scroll-behavior');
    if (animations) animations.destroy();
  } else {
    if (!lenis) lenis = makeLenis();
    if (animations) animations.rebuild();
  }

  document.dispatchEvent(new CustomEvent('tl:motion', { detail: { reduced } }));
}

function initToggle() {
  const btn = document.getElementById('motion-toggle');
  if (!btn) return;
  updateToggle(isReduced());
  btn.addEventListener('click', () => {
    applyMotion(!isReduced(), true);
  });

  /* The OS preference only has a say while the visitor has not chosen. */
  const onChange = (event) => {
    if (readPref()) return;
    applyMotion(event.matches, false);
  };
  if (reduceQuery.addEventListener) reduceQuery.addEventListener('change', onChange);
  else if (reduceQuery.addListener) reduceQuery.addListener(onChange);
}

/* ---------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------- */
function waitForGsap() {
  return new Promise((resolve) => {
    let tries = 0;
    const tick = () => {
      if (window.gsap) return resolve(true);
      if (tries++ > 30) return resolve(false);
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

async function boot() {
  initToggle();

  const ready = await waitForGsap();
  const willPlayIntro = !isReduced() && ready && !window.location.hash
    && new URLSearchParams(window.location.search).get('intro') !== 'off';

  /* Hide the hero lines behind the entrance so the reveal starts from zero,
     not from a visible frame. Only when the entrance will actually run. */
  if (willPlayIntro) {
    window.gsap.set('.hero__line > span', { yPercent: 110 });
    window.gsap.set('.hero__eyebrow, .hero__subtitle, .hero__cta', { opacity: 0, y: 16 });
    window.gsap.set('.hero__art', { opacity: 0, y: 24 });
    window.gsap.set('.hero__chip', { opacity: 0, y: 10 });
  }

  lenis = makeLenis();
  initNav(() => lenis);
  animations = initAnimations();

  const intro = playIntro();
  intro.then(() => {
    if (willPlayIntro) heroEntrance();
    if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  });
}

if (document.readyState === 'complete') boot();
else window.addEventListener('load', boot, { once: true });

/* Last resort for the overlay: no module execution order can leave it up. */
window.setTimeout(() => {
  if (!introDone) finishIntro();
}, 3500);
