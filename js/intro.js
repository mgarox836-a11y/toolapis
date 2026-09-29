/**
 * intro.js — TOOLAPIS 5s intro
 *
 * Progressive enhancement only. The page is complete and correct without
 * this file: the overlay is hidden by default (see css/intro.css) and the
 * inline failsafe in <head> is the only thing the intro strictly needs.
 *
 * Everything here is wrapped so that ANY failure — including a module that
 * never evaluates at all — leaves the visitor with a normal, usable page.
 */

export const INTRO_DURATION = 5.0;      /* seconds, full experience   */
export const INTRO_SHORT = 1.5;         /* hash / no-WebGL / failure  */
export const FAILSAFE_MS = 5500;

const BOOT = performance.now();
const html = document.documentElement;
const body = document.body;

let cleaned = false;
let timers = [];

/* ------------------------------------------------------------------ *
 * cleanup — the single teardown path. The inline head failsafe has an
 * identical copy, so either one alone is enough to free the page.
 * ------------------------------------------------------------------ */
export function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const id of timers) clearTimeout(id);
  timers = [];

  const overlay = document.getElementById('intro-overlay');
  if (overlay) {
    overlay.classList.add('is-hidden');
    overlay.style.display = 'none';
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  /* intro-active is what hides the page in CSS, so it MUST come off. */
  html.classList.remove('intro-active');
  html.removeAttribute('data-intro-stage');
  html.style.overflow = '';
  html.style.touchAction = '';
  html.classList.add('intro-done');

  if (body) {
    body.style.overflow = '';
    body.style.touchAction = '';
    body.classList.add('intro-done');
  }
}

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

function el(id) { return document.getElementById(id); }

function setStage(n) { html.setAttribute('data-intro-stage', String(n)); }

function setBar(pct) {
  const bar = el('intro-bar');
  if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

function setCounter(n) {
  const c = el('intro-counter');
  if (c) c.textContent = String(Math.max(0, Math.min(100, Math.round(n)))).padStart(3, '0');
}

function setStatus(text) {
  const s = el('intro-status');
  if (s) s.textContent = text;
}

function lockScroll() {
  html.style.overflow = 'hidden';
  html.style.touchAction = 'none';
  if (body) {
    body.style.overflow = 'hidden';
    body.style.touchAction = 'none';
  }
}

/**
 * Drives the counter with requestAnimationFrame so it is time-eased and
 * smooth. `readiness` is a 0..1 value reported by the scene; the counter
 * follows it but never falls behind the scripted floor.
 */
function runProgress(duration, floorAt, readiness) {
  const start = performance.now();
  const span = duration;
  let raf = 0;
  const step = () => {
    if (cleaned) return;
    const t = (performance.now() - start) / span;
    /* easeOutCubic, clamped so it can never complete before `floorAt`. */
    const eased = 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
    const floor = Math.min(floorAt, eased);
    const ready = readiness ? readiness() : 0;
    const pct = Math.min(100, Math.max(floor, Math.min(99, ready * 100 + eased * 100 * 0.35)));
    setBar(pct);
    setCounter(pct);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  timers.push({ __raf: true, id: raf });
  return () => cancelAnimationFrame(raf);
}

/* Status rotates through the four messages across the loading window. */
function scheduleStatus(t0, t1) {
  const msgs = [
    [0.00, 'Initializing tools'],
    [0.34, 'Loading scene'],
    [0.67, 'Enhancing pixels'],
    [1.00, 'Ready'],
  ];
  const span = t1 - t0;
  for (const [at, text] of msgs) {
    later(() => setStatus(text), t0 + span * at);
  }
}

/* 3.8-5.0s: hero content reveal, in order. Driven by a class so the stagger
   lives in CSS and the existing .reveal / IntersectionObserver behaviour in
   script.js is left completely untouched. */
function revealHero() {
  html.classList.add('intro-reveal');
}

function run() {
  const overlay = el('intro-overlay');
  if (!overlay) { cleanup(); return; }

  /* The failsafe may already have run while this module was loading. */
  if (html.classList.contains('intro-done')) return;

  const reduced = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  /* A hash deep-link already scrolled the page. Fighting it with a 5s
     overlay (and a scroll lock) is hostile, so use the short version and
     restore the anchor once the lock is released. */
  const hash = window.location.hash;
  const deepTarget = hash && hash.length > 1 ? document.getElementById(hash.slice(1)) : null;
  const deepLink = !!deepTarget;

  const durationMs = (deepLink || reduced) ? INTRO_SHORT * 1000 : INTRO_DURATION * 1000;

  lockScroll();
  setStage(0);
  setBar(0);
  setCounter(0);
  setStatus('Initializing tools');

  const finish = (reason) => {
    if (cleaned) return;
    /* Release the lock first, then honour the anchor, so the browser's own
       hash jump and our code do not fight. */
    html.style.overflow = '';
    html.style.touchAction = '';
    if (body) { body.style.overflow = ''; body.style.touchAction = ''; }
    if (deepTarget) {
      deepTarget.scrollIntoView({ block: 'start' });
    }
    setStage(3);
    later(() => {
      cleanup();
      if (deepTarget) deepTarget.scrollIntoView({ block: 'start' });
      try {
        window.dispatchEvent(new CustomEvent('toolapis:intro-complete', { detail: { reason } }));
      } catch (e) { /* never let a listener break teardown */ }
    }, reduced ? 40 : 700);
  };

  if (reduced) {
    /* <=0.6s: a single fade, no motion. */
    setStage(2);
    later(() => finish('reduced-motion'), 560);
    return;
  }

  if (deepLink) {
    setStage(1);
    runProgress(INTRO_SHORT * 1000, 1, null);
    scheduleStatus(0, INTRO_SHORT * 1000);
    later(() => setStage(2), 400);
    later(() => finish('deep-link'), durationMs);
    return;
  }

  /* ---- full 5.0s timeline ---- */
  let sceneReady = false;
  const onReady = () => { sceneReady = true; };
  window.addEventListener('toolapis:3d-ready', onReady, { once: true });
  window.addEventListener('toolapis:3d-unavailable', onReady, { once: true });

  let fontsReady = false;
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { fontsReady = true; }).catch(() => { fontsReady = true; });
  } else {
    fontsReady = true;
  }

  later(() => setStage(1), 600);
  runProgress(3600, 0.86, () => {
    let v = 0;
    if (fontsReady) v += 0.35;
    if (sceneReady) v += 0.65;
    /* Never stalls: a small time-based trickle guarantees movement. */
    const t = (performance.now() - BOOT) / 3600;
    return Math.max(v, Math.min(0.85, t * 0.85));
  });
  scheduleStatus(600, 3600);

  /* 3.6-4.4s: panels lift away. */
  later(() => setStage(2), 3600);
  later(() => { setBar(92); setCounter(92); }, 3900);
  later(() => { setBar(100); setCounter(100); setStatus('Ready'); }, 4400);

  /* 3.8-5.0s: hero content reveal + 3D fly-in handoff. */
  revealHero();

  later(() => finish('timed'), durationMs);
}

/* Fire and forget, with the shared cleanup on any failure. */
try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try { run(); } catch (err) { try { console.error('[intro]', err); } catch (e) {} cleanup(); }
    }, { once: true });
  } else {
    run();
  }
} catch (err) {
  try { console.error('[intro]', err); } catch (e) {}
  cleanup();
}
