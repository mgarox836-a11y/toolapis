/* ============================================================================
 * intro.js — TOOLAPIS · the five seconds before the page exists
 * ----------------------------------------------------------------------------
 * js/intro.js is a TIMELINE. css/intro.css is the skin. Neither owns the other:
 * the numbers live in CSS custom properties on `:root` and this module reads
 * them back, so the skin and the clock cannot drift apart — the same contract
 * js/reveal.js has with `--reveal-duration`.
 *
 * WHAT IT OWNS
 * ----------------------------------------------------------------------------
 *   1. the progress rail, the tabular counter and the status line;
 *   2. every way out — Skip, click, any key, a scroll attempt, a tab switch, a
 *      bfcache restore, the motion switch, and a hard ceiling.
 *
 * WHAT IT DOES NOT OWN
 * ----------------------------------------------------------------------------
 *   The class writes, the background unfocusing and the `toolapis:intro-complete`
 *   event belong to the inline <head> bootstrap in index.html, which exposes
 *   them as `window.__tlIntro`. That split is the whole safety argument: if this
 *   module never executes — CDN down, syntax error, an exception in an import —
 *   the bootstrap's own timer still releases everything, and the two paths call
 *   the SAME two functions rather than each owning a second implementation of
 *   "the intro is over".
 *
 *   Note what is not in that list either: there is no scroll lock to release,
 *   because there is none. See "THE LOCK" in css/intro.css — locking the scroll
 *   was two lines that cost ten pixels of layout in both directions and bought
 *   nothing this module's input handling does not already give away.
 *
 * WHY THE OVERLAY IS NOT A LOADER
 * ----------------------------------------------------------------------------
 * It is not waiting for anything. No asset is being fetched, no module is being
 * parsed, and the page behind it is already in the DOM and already laid out.
 * Those five seconds are choreography, and choreography that cannot be
 * interrupted is a prison. So there is exactly one thing the visitor has to do
 * to end it early, and then everything else ends it too: pressing a key,
 * clicking, or trying to scroll all skip. Somebody who has seen it once and does
 * not want to see it again never has to sit through it twice.
 *
 * WHAT IT MUST NOT DO
 * ----------------------------------------------------------------------------
 *   - SHOW ITSELF TO SOMEONE WHO ASKED IT NOT TO. The inline bootstrap reads the
 *     motion decision before first paint and does not add `intro-active` at all
 *     when motion is off, so there is never a frame of overlay for a visitor
 *     who pressed "Reduce motion". This module repeats that check and aborts if
 *     the class appears later — including mid-intro, because the switch is live
 *     and the visitor can flip it while they watch.
 *   - LEAVE CONTENT INVISIBLE. The hero's own choreography is CSS, keyed on
 *     `data-load-reveal`, and is `both`-filled, so it lands on its final state
 *     whatever happens to this module. Skipping early cannot strand it: worst
 *     case the hero is simply already there when the overlay lifts.
 *   - DISAGREE WITH THE CSS ABOUT WHEN THAT IS. The hero's delays are authored
 *     against first paint; `firstPaintOffset` reads the page's real zero back off
 *     its own animation so the overlay is always lifting while the first hero
 *     block is already arriving.
 *
 * NO IMPORTS. This must run when the CDN is down, when js/motion.js has thrown,
 * and when every other module on the page has failed — which is precisely the
 * case it exists to cover. That is also why it watches `html.motion-reduced` with
 * a MutationObserver instead of subscribing to js/motion.js's `onMotionChange`.
 * ==========================================================================*/

/* ------------------------------------------------------------------ *
 * 1. THE CLOCK
 * ------------------------------------------------------------------ */

/* The authored schedule, read off `:root` where css/intro.css keeps it. These
   are the fallbacks for an engine that will not hand back a computed custom
   property, and the only case in which the two halves could disagree. */
const FALLBACK = { total: 5000, handover: 2500, exit: 600 };

function cssMs(name, fallback) {
  try {
    const raw = window.getComputedStyle(document.documentElement).getPropertyValue(name);
    const n = parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch (e) {
    return fallback;
  }
}

/* Read ONCE, at boot. A `getComputedStyle` call on every frame of a five-second
   animation is 300 style resolutions spent on a number that cannot change. */
const clock = {
  total: FALLBACK.total,
  handover: FALLBACK.handover,
  exit: FALLBACK.exit,
};

const overlay = document.getElementById('intro-overlay');
const html = document.documentElement;

/** Idempotence. Every terminal path runs through `finish`, and several of them
 *  can land in the same tick — the Skip click also fires `pointerdown` on the
 *  window, and the ceiling can coincide with the schedule. Whatever runs second
 *  must do nothing at all. */
let finished = false;
let cleanedUp = false;
let rafId = 0;
let scheduleId = 0;
let exitId = 0;
let watch = null;

/* ------------------------------------------------------------------ *
 * 2. WHEN T=0
 * ------------------------------------------------------------------ */

/**
 * How long ago the page started animating, in milliseconds.
 *
 * CSS animations are authored with absolute delays measured from the moment
 * the animation begins — which is FIRST PAINT, not the moment this module runs
 * and not the moment the <head> script parsed. A module that timed the overlay
 * from its own boot would drift by however long the stylesheet took to arrive,
 * which on a cold load is most of a second, and the overlay would lift at a
 * moment the hero is not ready for.
 *
 * So t=0 is read back off the animation itself: the first `[data-load-reveal]`
 * element reports when its own animation started, and that timestamp is the
 * page's real zero. The fallback is zero — "assume no drift" — which makes the
 * overlay lift early rather than late, and lifting early is the survivable
 * direction.
 */
function firstPaintOffset() {
  try {
    const el = document.querySelector('[data-load-reveal]');
    if (!el || typeof el.getAnimations !== 'function') return 0;
    const list = el.getAnimations();
    for (let i = 0; i < list.length; i++) {
      const start = Number(list[i].startTime);
      if (Number.isFinite(start) && start > 0) {
        return Math.max(0, performance.now() - start);
      }
    }
  } catch (e) { /* no animation to read: assume no drift */ }
  return 0;
}

let t0 = 0;

/** Milliseconds since the page's zero. Read through a function rather than inlined
 *  at every call site because it is called on paths that must not be able to
 *  throw: `finish` uses it to decide whether to compress, and a throw there
 *  would take the whole handover down with it. */
function elapsed() { return performance.now() - t0; }

/* ------------------------------------------------------------------ *
 * 3. THE READOUT
 * ------------------------------------------------------------------ */

/* Four lines on one fixed-width box. The instrument reads as a system coming
   up, and the width does not move when the line does. */
const STATUS = [
  [0.00, 'Initializing tools'],
  [0.30, 'Mounting sections'],
  [0.75, 'Warming interface'],
  [0.99, 'Ready'],
];

const el = {
  fill: document.getElementById('intro-rail-fill'),
  counter: document.getElementById('intro-counter'),
  status: document.getElementById('intro-status'),
};

/**
 * THE READOUT'S WINDOW IS THE OVERLAY'S OWN, NOT THE WHOLE ENTRANCE.
 *
 * The rail and the counter are on the overlay, and the overlay is gone at 3.1s
 * while the entrance runs to 5s. Measuring them against `--intro-total` would
 * mean they stop dead at 62% with the rail half empty and the counter frozen —
 * which reads as a broken progress bar, not as a deliberate handover. So they
 * measure `--intro-handover`: the overlay's boot completes, the rail fills, the
 * counter reaches its end, and the panel lifts. The rail is full exactly when
 * it stops being visible, which is the only ending it could have that looks
 * deliberate.
 */
function paint(now) {
  rafId = 0;
  const span = clock.handover;
  const p = span > 0 ? Math.min(1, Math.max(0, (now - t0) / span)) : 1;

  /* scaleX, not width: a width change relayouts the rail on every frame for
     five seconds, and a transform is composited. */
  if (el.fill) {
    try { el.fill.style.transform = 'scaleX(' + p.toFixed(4) + ')'; } catch (e) {}
  }

  if (el.counter) {
    const raw = String(Math.round(p * span));
    try { el.counter.textContent = raw.length < 3 ? ('00' + raw).slice(-3) : raw; } catch (e) {}
  }

  if (el.status) {
    let line = STATUS[0][1];
    for (let i = 0; i < STATUS.length; i++) if (p >= STATUS[i][0]) line = STATUS[i][1];
    if (el.status.textContent !== line) {
      try { el.status.textContent = line; } catch (e) {}
    }
  }

  if (p < 1 && !finished) rafId = requestAnimationFrame(paint);
}

function startReadout() {
  if (rafId) return;
  try { rafId = requestAnimationFrame(paint); } catch (e) { /* no rAF: the rail stays empty */ }
}

/* ------------------------------------------------------------------ *
 * 4. FOCUS
 * ------------------------------------------------------------------ */

/** Focus goes to the page, not back to the top of it. `preventScroll` because
 *  focusing `#main-content` without it scrolls the document to that landmark —
 *  which, on a page whose hero is still mid-entrance, is a jump the visitor did
 *  not ask for and cannot see coming. */
function focusPage() {
  try {
    const main = document.getElementById('main-content');
    if (main && typeof main.focus === 'function') main.focus({ preventScroll: true });
  } catch (e) { /* focus is a nicety, not a requirement */ }
}

function focusSkip() {
  try {
    const btn = document.getElementById('intro-skip');
    if (btn && typeof btn.focus === 'function') btn.focus({ preventScroll: true });
  } catch (e) {}
}

/* ------------------------------------------------------------------ *
 * 5. THE MOTION WATCH
 * ------------------------------------------------------------------ */

/**
 * The visitor turned motion off WHILE the intro was running.
 *
 * Watching the class rather than subscribing to js/motion.js keeps this module
 * import-free, which is the entire reason it can be trusted to run when nothing
 * else does. Created on demand, disconnected the moment the intro ends, so it
 * costs nothing for the rest of the page's life.
 */
function watchMotion() {
  if (typeof MutationObserver !== 'function') return;
  try {
    watch = new MutationObserver(() => {
      if (html.classList.contains('motion-reduced')) finish('motion-off', true);
    });
    watch.observe(html, { attributes: true, attributeFilter: ['class'] });
  } catch (e) { watch = null; }
}

function stopWatching() {
  if (!watch) return;
  try { watch.disconnect(); } catch (e) {}
  watch = null;
}

/* ------------------------------------------------------------------ *
 * 6. THE TWO EXITS
 * ------------------------------------------------------------------ */

/**
 * HANDOVER. One-way. Everything else in this file is a way of calling it.
 *
 * The overlay does not vanish here: it starts its exit fade, because a hard cut
 * from black to a page that is still arriving is the one thing that would make
 * five seconds look like five seconds. `cleanup` is what removes it, one exit
 * duration later.
 *
 * The actual release — classes, unfocusing the background, the
 * `intro-complete` event — is `window.__tlIntro.release`, owned by the inline
 * bootstrap so that it still happens when this module does not.
 *
 * `early` is the only thing that changes the page's own schedule, and it is the
 * difference between "you waited for the entrance" and "you ended it".
 */
function finish(reason, early) {
  if (finished) return;
  finished = true;

  if (rafId) { try { cancelAnimationFrame(rafId); } catch (e) {} rafId = 0; }
  if (scheduleId) { try { clearTimeout(scheduleId); } catch (e) {} scheduleId = 0; }
  if (exitId) { try { clearTimeout(exitId); } catch (e) {} exitId = 0; }
  stopWatching();

  const how = reason || 'done';

  /* THE RELEASE COMES FIRST, ALWAYS.
     Everything below this line is an optimisation on top of a page being handed
     over; everything above it is the handover. The order is not stylistic: a
     throw in the compress path once left the visitor with a full-viewport layer
     over the page and no way to dismiss it, because the one statement that
     releases everything had not run yet when the exception unwound past it. */
  if (typeof window.__tlIntro === 'object' && window.__tlIntro
      && typeof window.__tlIntro.release === 'function') {
    try { window.__tlIntro.release(how); } catch (e) {}
  } else {
    /* The bootstrap is missing (someone deleted it, or this page is not the one
       the module was written for). Release the minimum, by hand, rather than
       leaving a full-viewport layer with a live button on it. */
    try { html.classList.remove('intro-active'); html.classList.add('intro-exit'); } catch (e) {}
    try { html.style.overflow = ''; if (document.body) document.body.style.overflow = ''; } catch (e) {}
    /* Belt and braces from an older design that locked the scroll here. It is a
       no-op now — nothing sets overflow in the first place — and it stays because
       a one-line no-op costs nothing while a stale inline `overflow: hidden`
       from a cached copy of this file would cost a page nobody can scroll. */
  }

  /* Compress, but only if there is anything left to compress. Every delay in
     css/animations.css is later than the handover, so while the overlay is
     still up none of them has begun — the hero is sitting in its `both` fill's
     from-state and a shorter schedule simply means it starts sooner. Once the
     overlay is lifting there is nothing to save: the blocks are already in
     flight, and rescaling their delays now would replay the arrival of the two
     that had finished.

     Wrapped, because a page whose entrance is 900ms instead of 5s is a page
     that works, and a page still wearing its loading panel is not. */
  if (early) {
    try {
      if (elapsed() < clock.handover) compress();
    } catch (e) { /* the long schedule is the harmless outcome */ }
  }

  exitId = setTimeout(cleanup, neverPainted() ? 0 : clock.exit + 60);
}

/** Did the overlay ever actually become a screen? If it did not — motion off, a
 *  deep link, no overlay element in the markup — there is nothing to fade, and
 *  holding the element for another exit-duration just leaves dead markup in the
 *  document for whoever reads it next to wonder about. */
function neverPainted() {
  try {
    if (!overlay) return true;
    const cs = window.getComputedStyle(overlay);
    return cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.02;
  } catch (e) {
    return false;
  }
}

/**
 * Compress the hero's schedule to 18% — about 900ms — and restart it.
 *
 * Two steps, and the second is the one that matters. The class alone would
 * change `animation-delay` on an animation that has been running since first
 * paint, and CSS delays are measured from the animation's START, not from now:
 * at 1000ms into a page whose first delay just became 468ms, every block would
 * appear already half-faded. So the animation is destroyed for one frame —
 * never painted, because the two class writes land in the same frame around a
 * forced layout flush — and then the compressed schedule plays from its
 * beginning.
 */
function compress() {
  try {
    html.classList.add('intro-skip', 'intro-restart');
    void html.offsetHeight;
    html.classList.remove('intro-restart');
  } catch (e) {
    /* No layout to flush, or no classList: the schedule simply stays long. The
       page is still correct, just slower to arrive than it could have been. */
    try { html.classList.remove('intro-restart'); } catch (e2) {}
  }
}

/**
 * TERMINATE. The overlay leaves the DOM.
 *
 * Removing it rather than hiding it is deliberate: for the rest of the page's
 * life there is no full-viewport layer, no z-index 1200, and no focusable Skip
 * button that a later stylesheet might accidentally make visible. What is gone
 * cannot be interacted with.
 */
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;

  if (exitId) { try { clearTimeout(exitId); } catch (e) {} exitId = 0; }
  stopWatching();

  try { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); } catch (e) {}

  /* Focus is handed to the page HERE rather than at the handover, and the reason
     is the order of the two lines above. Focusing anything while the Skip button
     is still on screen puts focus on a button that is about to be deleted, and
     a browser that loses the focused element resets focus to <body> — so doing it
     early produced a page nobody had focus on at all, which is the same as a
     page where Tab starts from the top and the skip link is the first stop. */
  focusPage();

  if (typeof window.__tlIntro === 'object' && window.__tlIntro
      && typeof window.__tlIntro.finish === 'function') {
    try { window.__tlIntro.finish('module'); } catch (e) {}
  } else {
    try { html.classList.add('intro-done'); html.classList.remove('intro-exit'); } catch (e) {}
  }
}

/* ------------------------------------------------------------------ *
 * 7. THE WAYS OUT
 * ------------------------------------------------------------------ */

/* Every one of these is a genuine "I don't want to wait", which is the only
   reason the overlay has an exit at all. None of them is a gesture that merely
   means "I moved" — and `scroll` earns its place for a specific reason: dragging
   the scrollbar dispatches no pointer or wheel event into the document, so it is
   the only listener that hears that visitor at all. */
const INPUTS = ['wheel', 'touchstart', 'pointerdown', 'mousedown', 'keydown', 'scroll'];

function onInput() { finish('dismissed', true); }

function wireInput() {
  for (let i = 0; i < INPUTS.length; i++) {
    try { window.addEventListener(INPUTS[i], onInput, { passive: true, capture: true }); } catch (e) {}
  }
  try {
    const btn = document.getElementById('intro-skip');
    if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); finish('skipped', true); });
  } catch (e) {}
}

/* ------------------------------------------------------------------ *
 * 8. BOOT
 * ------------------------------------------------------------------ */

function boot() {
  /* Someone removed the overlay, or this page has no intro. Nothing to time —
     and, critically, the lock the <head> bootstrap took has to come off. */
  if (!overlay) { finish('no-overlay', true); return; }

  /* The switch can be flipped between the <head> script and here: localStorage,
     `?motion=`, and a module that had already read `data-motion` are three
     readers of one decision. */
  if (html.classList.contains('motion-reduced')) { finish('motion-off', true); return; }

  try { overlay.removeAttribute('aria-hidden'); } catch (e) {}

  /* The hero is choreographed against first paint; the overlay is choreographed
     against the same zero. */
  t0 = performance.now() - firstPaintOffset();

  /* A page restored mid-document is not an entrance, it is a restoration.
     Landing the visitor 4000px down and then pinning them to the top for five
     seconds is precisely the behaviour this module exists to avoid. */
  try {
    if (window.scrollY > 0 || window.scrollX > 0) window.scrollTo(0, 0);
  } catch (e) {}

  focusSkip();
  wireInput();
  watchMotion();
  startReadout();

  /* THE SCHEDULE, in two beats.

     The handover at `--intro-handover` is the real one: the overlay starts
     lifting at 2.5s and the hero is already arriving underneath it, which is
     what makes the whole thing read as one continuous five seconds rather than
     a splash screen followed by a page.

     It is scheduled against `elapsed()`, not against `clock.handover` flat,
     because this function runs some hundreds of milliseconds after the page's
     zero — a module is deferred, and everything above it on the page is
     something the browser fetched first. Scheduling the raw 2500ms from here put
     the handover at 3.0s and the finished entrance at five and a third, which
     is not the number the design says and which nobody could have named as the
     cause. Subtracting what has already elapsed puts the handover back on the
     page's clock, where `firstPaintOffset` put it.

     The beat at `--intro-total` is the ceiling, and it exists because the
     handover is scheduled in JavaScript and JavaScript schedules are not
     promises. It is two and a half seconds late on purpose: arriving late is
     free, arriving early would be a bug. */
  scheduleId = setTimeout(() => finish('timed', false), Math.max(0, clock.handover - elapsed()));

  /* `pageshow` FIRES ON EVERY LOAD, including this one. Unfiltered it would end
     the intro in the same tick it started, which is exactly the bug a
     "restore" handler invites. `persisted` is the whole difference: true only
     for a page coming back out of the back/forward cache. */
  try {
    window.addEventListener('pageshow', (e) => {
      if (e && e.persisted) finish('restored', true);
    });
  } catch (e) {}
  /* A tab that was switched away from has missed the entrance. Coming back to
     find it still running is worse than never having run it. */
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) finish('hidden', true);
    });
  } catch (e) {}

  /* The hard ceiling. The bootstrap holds the same one independently: this one
     guarantees the authored schedule is honoured when the module ran, and that
     one guarantees it when the module did not. */
  setTimeout(() => finish('ceiling', true), clock.total + 120);
}

try {
  boot();
} catch (e) {
  try { console.warn('[intro]', e); } catch (e2) {}
  /* A failed intro must still hand over. This is the entire difference between
     "the entrance broke" and "the entrance ended early". */
  try { finish('error', true); } catch (e2) {}
}