/**
 * intro.js — TOOLAPIS 5s intro, entry policy and icon safety net
 *
 * Progressive enhancement only. The page is complete and correct without
 * this file: the overlay is hidden by default (see css/intro.css) and the
 * inline failsafe in <head> is the only thing the intro strictly needs.
 *
 * Everything here is wrapped so that ANY failure — including a module that
 * never evaluates at all — leaves the visitor with a normal, usable page.
 *
 * THREE JOBS
 * ---------------------------------------------------------------------------
 * 1. THE CURTAIN. 0.6s logo, 0.6-3.6s counter, then at 3.6s the whole panel
 *    slides up and out (0.9s) while the hero assembles underneath it and the
 *    3D props fly in. The overlay is removed when the animation ends, or after
 *    a timeout, whichever comes first. INTRO_DURATION (5.0s) is the end of the
 *    experience; the hard failsafe at 5.5s lives in the inline head script.
 *
 * 2. WHERE THE PAGE OPENS. Always the hero at the top, never the cards. A
 *    deliberate hash (#features, #flow, #clarity) is honoured with the short
 *    intro; an empty or #overview hash is treated as "the top" and removed from
 *    the URL, and the nav's Overview link scrolls to the hero rather than to
 *    the #overview section. scrollRestoration is set to 'manual' in the head.
 *
 * 3. THE ICON SAFETY NET. script.js parks the card / flow icon boxes at inline
 *    `opacity: 0` before its Motion pop-in and tags them `data-motion-kind`;
 *    if that animation never lands the box stays invisible. The primary fix is
 *    the CSS safety net in css/intro.css; the sweep below is the deterministic
 *    backstop for the inline-style case, and it is deliberately independent of
 *    the intro.
 */

export const INTRO_DURATION = 5.0;      /* seconds, full experience   */
export const INTRO_SHORT = 1.5;         /* hash / no-WebGL / failure  */
export const FAILSAFE_MS = 5500;

/* Curtain timeline, in ms from module boot. */
const LOAD_MS = 3600;                   /* counter hits 100, curtain lifts */
const CURTAIN_MS = 900;                 /* the slide-up itself               */
const REDUCED_LAND_MS = 320;            /* whole reduced intro <= 0.6s      */

const BOOT = performance.now();
const html = document.documentElement;
const body = document.body;

let cleaned = false;
let lifted = false;
let finished = false;
let landedAt = 0;
let timers = [];
let planTimers = [];
let stopProgress = null;

/* ------------------------------------------------------------------ *
 * cleanup — the single teardown path. The inline head failsafe has an
 * identical copy, so either one alone is enough to free the page.
 * ------------------------------------------------------------------ */
export function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const id of timers) clearTimeout(id);
  timers = [];
  planTimers = [];
  if (stopProgress) { try { stopProgress(); } catch (e) {} stopProgress = null; }

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

/** A timer that belongs to the current timeline and can be dropped if that
 *  timeline is replaced (the full 5s plan becoming the short no-WebGL plan). */
function plan(fn, ms) {
  const id = later(fn, ms);
  planTimers.push(id);
  return id;
}

function dropPlan() {
  for (const id of planTimers) clearTimeout(id);
  planTimers = [];
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

function emit(name, detail) {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  } catch (e) { /* never let a listener break the timeline */ }
}

/* ==================================================================== *
 * 2. ENTRY POLICY — where the page opens, and what a nav click means
 * ==================================================================== */

/** Hashes that mean "the top of the page". #overview is the CARDS section,
 *  so treating it as a destination is exactly what dropped visitors on the
 *  TikTok HD Enhancer cards instead of the hero. */
const TOP_HASHES = ['', '#', '#overview'];

export function isTopHash(hash) {
  return TOP_HASHES.indexOf(String(hash || '').toLowerCase()) !== -1;
}

function currentHash() {
  return String(window.location.hash || '').toLowerCase();
}

function cleanUrl() {
  const loc = window.location;
  return loc.pathname + loc.search;
}

/** Removes a top-level hash from the URL so a refresh cannot jump to it. */
export function clearTopHash() {
  try {
    if (isTopHash(currentHash())) {
      history.replaceState(history.state, '', cleanUrl());
    }
  } catch (e) { /* replaceState is a nicety, never a requirement */ }
}

/** A deliberate deep link: an id that exists and is not the top marker. */
function deepTargetFor(hash) {
  if (!hash || hash.length < 2 || hash.charAt(0) !== '#') return null;
  if (isTopHash(hash)) return null;
  let id = hash.slice(1);
  try { id = decodeURIComponent(id); } catch (e) { /* keep the raw id */ }
  if (!id) return null;
  return document.getElementById(id) || null;
}

/** Hard reset to the top. Runs while the scroll lock is on and again after
 *  it lifts, because a locked document can swallow the first attempt. */
export function scrollToTop() {
  try {
    window.scrollTo(0, 0);
    if (html) html.scrollTop = 0;
    if (body) body.scrollTop = 0;
  } catch (e) { /* nothing to do */ }
}

/** Mirrors the frozen scrollspy in script.js so the nav matches the
 *  position we actually ended up in. */
function setNavActive(id) {
  try {
    const links = document.querySelectorAll('.nav-link');
    const want = '#' + id;
    for (const link of links) {
      link.classList.toggle('active', link.getAttribute('href') === want);
    }
  } catch (e) { /* never fatal */ }
}

/**
 * "#overview" links — brand mark, nav, footer, hero scroll cue — mean
 * "take me to the top", not "take me to the cards". Everything else keeps
 * the browser's native anchor behaviour (html has scroll-smooth and
 * style.css sets scroll-margin-top).
 */
function setupAnchorPolicy() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || href.charAt(0) !== '#') return;
    if (!isTopHash(href.toLowerCase())) return;

    e.preventDefault();
    clearTopHash();
    const reduced = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    if (reduced) {
      scrollToTop();
    } else {
      /* Only a real scroll call here: an extra scrollTo(0,0) right after would
         cancel the smooth animation and turn the click into a jump. */
      let ok = false;
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); ok = true; } catch (e) { ok = false; }
      if (!ok) scrollToTop();
    }
    setNavActive('overview');
  }, false);
}

/* ==================================================================== *
 * 3. ICON SAFETY NET (does not depend on the intro)
 * ==================================================================== */

const iconZero = new WeakMap();
let iconWatchId = 0;

function sweepIcons() {
  let nodes;
  try { nodes = document.querySelectorAll('[data-motion-kind="icon"]'); } catch (e) { return; }
  if (!nodes.length) return;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    /* script.js parks the box at inline `opacity: 0` / `scale(0.85)` before
       the Motion pop-in and clears both when it lands. An INLINE opacity of 0
       that survives two seconds is Motion that never ran — the pop-in budget
       is 0.32s of delay plus 0.55s, so there is no in-flight animation this
       could interrupt. The computed value is checked too, in case something
       else is the one hiding the box. */
    let stuck = node.style.opacity === '0';
    if (!stuck) {
      try { stuck = window.getComputedStyle(node).opacity === '0'; } catch (e) { stuck = false; }
    }
    const runs = (iconZero.get(node) || 0) + (stuck ? 1 : 0);
    iconZero.set(node, runs);
    if (runs >= 2) {
      /* Clear the parked style, and drop the CSS safety net too, so the icon
         is left in the same state a completed pop-in would have. */
      node.style.opacity = '';
      node.style.transform = '';
      try { node.style.animation = 'none'; } catch (e) { /* noop */ }
      iconZero.set(node, 0);
    }
  }
}

function startIconWatch() {
  if (iconWatchId) return;
  try {
    iconWatchId = setInterval(sweepIcons, 1000);
  } catch (e) { /* a missing timer is not a problem */ }
}

/* ==================================================================== *
 * 1. THE CURTAIN
 * ==================================================================== */

/**
 * Drives the counter with requestAnimationFrame so it is time-eased and
 * smooth. `readiness` is a 0..1 value reported by the scene; the counter
 * follows it but never falls behind the scripted floor.
 */
function runProgress(duration, floorAt, readiness) {
  if (stopProgress) { try { stopProgress(); } catch (e) {} stopProgress = null; }
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
  const cancel = () => cancelAnimationFrame(raf);
  /* The frame loop is not in `timers` (it is not a timeout): `stopProgress`
     cancels it, and cleanup() always calls that. */
  stopProgress = cancel;
  return cancel;
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
    plan(() => setStatus(text), t0 + span * at);
  }
}

/** 3.6s+: the hero content stagger. Driven by a class so the timing lives in
    CSS and the existing .reveal / IntersectionObserver behaviour in script.js
    is left completely untouched. */
function revealHero() {
  html.classList.add('intro-reveal');
}

/** The curtain starts rising: counter at 100, panel translates up, the hero
    assembles underneath it and the 3D props start their fly-in. */
function lift() {
  if (lifted || cleaned) return;
  lifted = true;
  setBar(100);
  setCounter(100);
  setStatus('Ready');
  setStage(3);              /* css/intro.css -> tl-curtain-up, 0.9s */
  revealHero();
  /* Tear down as soon as the browser says the curtain is done... */
  const overlay = el('intro-overlay');
  if (overlay) {
    overlay.addEventListener('animationend', onCurtainEnd, { once: true });
  }
  /* ...and on a timeout when it never says (throttled tab, skipped frames). */
  plan(() => land(), CURTAIN_MS + 160);
  emit('toolapis:intro-curtain', { at: performance.now() - BOOT });
}

/** The curtain is gone: take the overlay out of the DOM, give the page its
    scroll back and mark the intro done. */
function land() {
  if (cleaned) return;
  /* Remember where the page came to rest: finish() must undo any late anchor
     jump, but it must not yank a visitor who has already started scrolling. */
  try { landedAt = window.scrollY || 0; } catch (e) { landedAt = 0; }
  cleanup();
}

function onCurtainEnd(e) {
  if (e && e.target && e.target.id !== 'intro-overlay') return;
  land();
}

/** End of the experience: settle the final scroll position and announce it. */
function finish(reason) {
  if (finished) return;
  finished = true;
  const deepTarget = deepTargetFor(currentHash());
  if (deepTarget) {
    try { deepTarget.scrollIntoView({ block: 'start' }); } catch (e) { /* ignore */ }
  } else {
    /* The hero is the destination unless the visitor moved in the last
       moments of the intro, in which case their position wins. */
    let moved = false;
    try { moved = Math.abs((window.scrollY || 0) - landedAt) > 2; } catch (e) { moved = false; }
    if (!moved) { scrollToTop(); clearTopHash(); }
    setNavActive('overview');
  }
  emit('toolapis:intro-complete', { reason: reason || 'timed' });
}

/** The short 1.5s plan: a deliberate deep link, no WebGL, or a failure. */
function runShort(reason) {
  const total = INTRO_SHORT * 1000;
  setStage(1);
  runProgress(total, 1, null);
  scheduleStatus(0, total);
  plan(() => setStage(2), 250);
  plan(() => lift(), Math.max(320, total - 700));
  plan(() => land(), total);
  /* finish() is deliberately NOT a tracked timer: cleanup() clears the plan,
     and the handover has to happen either way. */
  setTimeout(() => finish(reason), total + 60);
}

function run() {
  const overlay = el('intro-overlay');
  if (!overlay) { cleanup(); return; }

  /* The failsafe may already have run while this module was loading. */
  if (html.classList.contains('intro-done')) return;

  const reduced = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  /* Where we open: a deliberate deep link, or the top of the page. */
  const deepTarget = deepTargetFor(currentHash());

  if (!deepTarget) {
    /* Empty hash or #overview: clean the URL first, so the browser never gets
       a chance to jump to it, then hold the hero at the top. */
    clearTopHash();
    scrollToTop();
  }

  lockScroll();
  setStage(0);
  setBar(0);
  setCounter(0);
  setStatus('Initializing tools');

  if (reduced) {
    /* <=0.6s: no curtain, one short fade. */
    setStage(2);
    plan(() => lift(), 0);
    plan(() => land(), REDUCED_LAND_MS);
    setTimeout(() => finish('reduced-motion'), REDUCED_LAND_MS + 60);
    return;
  }

  if (deepTarget) {
    /* A hash deep-link is a deliberate act; don't make the visitor wait 5s
       behind a curtain for it. */
    runShort('deep-link');
    return;
  }

  /* ---- full timeline: 0-3.6s loading, 3.6-4.5s curtain, 5.0s done ---- */
  let sceneReady = false;
  const onReady = () => { sceneReady = true; };
  window.addEventListener('toolapis:3d-ready', onReady, { once: true });

  /* No WebGL (or the scene failed): nothing is going to fly in behind the
     curtain, so use the short plan instead of a fake 3.6s of loading. */
  window.addEventListener('toolapis:3d-unavailable', () => {
    if (lifted || cleaned || finished) return;
    dropPlan();
    if (stopProgress) { try { stopProgress(); } catch (e) {} stopProgress = null; }
    runShort('no-webgl');
  }, { once: true });

  let fontsReady = false;
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { fontsReady = true; }).catch(() => { fontsReady = true; });
  } else {
    fontsReady = true;
  }

  plan(() => setStage(1), 600);
  runProgress(LOAD_MS, 0.86, () => {
    let v = 0;
    if (fontsReady) v += 0.35;
    if (sceneReady) v += 0.65;
    /* Never stalls: a small time-based trickle guarantees movement. */
    const t = (performance.now() - BOOT) / LOAD_MS;
    return Math.max(v, Math.min(0.85, t * 0.85));
  });
  scheduleStatus(600, LOAD_MS);

  /* Info panel while the counter works, then the exit. */
  plan(() => setStage(2), LOAD_MS - 700);
  plan(() => lift(), LOAD_MS);
  plan(() => land(), LOAD_MS + CURTAIN_MS + 40);
  /* Untracked: cleanup() drops the plan, and the end of the experience still
     has to be announced. */
  setTimeout(() => finish('timed'), INTRO_DURATION * 1000);
}

/* Entry policy and the icon net are installed at module scope: neither may
   depend on the overlay, the intro timeline, or the 3D scene. */
try { setupAnchorPolicy(); } catch (err) { /* the page still works */ }
try { startIconWatch(); } catch (err) { /* ditto */ }

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
