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
 *   2. the schedule, and therefore WHEN the entrance ends if nothing else does.
 *
 * WHAT IT DOES NOT OWN
 * ----------------------------------------------------------------------------
 *   `finishIntro(reason)` — the release, the background unfocusing, the scroll
 *   lock, the events, the teardown of both full-viewport layers, and the audit
 *   that follows it — belongs to the inline <head> bootstrap in index.html,
 *   which exposes it as `window.__tlIntro.finishIntro`. That split is the whole
 *   safety argument: if this module never executes — CDN down, a syntax error,
 *   an exception during import — the bootstrap's own 5.8s timer still releases
 *   everything, because the failure mode of the alternative is a full-viewport
 *   layer over a page with a background that cannot be focused or clicked.
 *
 *   Note what is not in that list either: there is no second copy of "the intro
 *   is over" in here. There used to be one, the two had to be called in the
 *   right order by every path, and one caller got it wrong. The visitor saw a
 *   blank page for the rest of the session; the paragraph on state classes
 *   below is what that bug was.
 *
 * WHY THE OVERLAY IS NOT A LOADER
 * ----------------------------------------------------------------------------
 * It is not waiting for anything. No asset is being fetched, no module is being
 * parsed, and the page behind it is already in the DOM and already laid out.
 * Those five seconds are choreography, and choreography that cannot be
 * interrupted is a prison. So there is exactly one thing the visitor has to do
 * to end it early, and then everything else ends it too: pressing Esc, Enter or
 * Space, clicking the panel, tapping it, or pressing the Skip button. Somebody
 * who has seen it once and does not want to see it again never has to sit
 * through it twice.
 *
 * WHY SCROLLING IS NOT ONE OF THOSE THINGS (this changed, deliberately)
 * ----------------------------------------------------------------------------
 * It used to be. Any wheel, touch, pointer, key or scroll event ended the
 * entrance, on the reasoning that a visitor who scrolls has said the thing they
 * wanted is the page. That reasoning stopped being true the moment the entrance
 * gained a real scroll lock — because the first gesture got cancelled and every
 * gesture after it scrolled, since the same gesture is what releases the lock.
 * So the visitor got a document moving under a panel that was halfway out, with
 * the hero's schedule compressed underneath it. Scrolling is now locked, not
 * honoured: a visitor who scrolls during the entrance gets nothing for five
 * seconds and a normal page afterwards, which is what "I pressed the key too
 * early" should mean. The Skip control is right there and says what it does.
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
 *   - WRITE A CLASS ONTO <html> THAT ANY OTHER ELEMENT ALSO CARRIES. It did,
 *     once: `intro-skip` was both the compressed-schedule state and the Skip
 *     BUTTON's skin class, so skipping put `opacity: 0` on the document element
 *     and emptied the page — the blank screen this file was rewritten for. The
 *     state class is `intro-compressed`, a name nothing else in the project
 *     uses. See "THE STATE CLASSES" in css/intro.css before renaming it.
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
 * It owns no state worth the name: `window.__tlIntro.finishIntro` is idempotent
 * and does the classes, the lock, the unfocusing, the events, the teardown and
 * the audit. What is left here is the ONE thing only this module can do — tell
 * the hero's CSS choreography that it may start sooner — and only while the
 * overlay is still up.
 *
 * `early` is the difference between "you waited for the entrance" and "you
 * ended it".
 */
function finish(reason, early) {
  if (finished) return;
  finished = true;

  if (rafId) { try { cancelAnimationFrame(rafId); } catch (e) {} rafId = 0; }
  if (scheduleId) { try { clearTimeout(scheduleId); } catch (e) {} scheduleId = 0; }
  if (exitId) { try { clearTimeout(exitId); } catch (e) {} exitId = 0; }
  stopWatching();

  const how = reason || 'done';

  /* THE HANDOVER COMES FIRST, ALWAYS.
     Everything below this line is an optimisation on top of a page being handed
     over; everything above it is the handover. The order is not stylistic: a
     throw in the compress path once left the visitor with a full-viewport layer
     over the page and no way to dismiss it, because the one statement that
     releases everything had not run yet when the exception unwound past it. */
  if (typeof window.__tlIntro === 'object' && window.__tlIntro
      && typeof window.__tlIntro.finishIntro === 'function') {
    try { window.__tlIntro.finishIntro(how); } catch (e) {}
  } else {
    /* The bootstrap is missing (someone deleted it, or this page is not the one
       the module was written for). Release the minimum, by hand, rather than
       leaving a full-viewport layer with a live button on it. This is the ONE
       place a second implementation of the release is allowed to exist: it is
       the branch where the first one is provably absent. */
    try { html.classList.remove('intro-active'); html.classList.add('intro-exit'); } catch (e) {}
    try { html.style.overflow = ''; if (document.body) document.body.style.overflow = ''; } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent('toolapis:intro-complete',
        { detail: { reason: how } }));
    } catch (e) {}
    exitId = setTimeout(orphanCleanup, 0);
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
      /* No overlay means nothing was being watched, so there is no schedule to
         answer. Compressing it anyway would rewrite the hero's delays for a
         visitor who never saw an entrance. */
      if (overlay && elapsed() < clock.handover) compress();
    } catch (e) { /* the long schedule is the harmless outcome */ }
  }

  /* Focus is handed to the page one exit-fade later, by `cleanup`. The bootstrap
     removes the overlay on its own clock; this one exists for the focus handoff
     and for the `intro-done` class in the no-bootstrap branch, and both are
     idempotent, so the two clocks agreeing is the only thing they need. */
  exitId = setTimeout(cleanup, neverPainted() ? 0 : clock.exit + 60);
}

/** Only reachable when the inline bootstrap is gone. It exists so that a page
 *  with no bootstrap still loses its overlay, rather than keeping a full-screen
 *  layer and a focusable button forever. */
function orphanCleanup() {
  try { html.classList.add('intro-done'); html.classList.remove('intro-exit'); } catch (e) {}
  try {
    const o = document.getElementById('intro-overlay');
    if (o && o.parentNode) o.parentNode.removeChild(o);
  } catch (e) {}
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
 *
 * `intro-compressed`, and the name is load-bearing. This used to write
 * `intro-skip` onto <html>, and css/intro.css also gave the Skip BUTTON the
 * class `intro-skip` — whose skin starts at `opacity: 0`. A class selector
 * matches <html> when <html> carries that class, so every visitor who skipped
 * the entrance got an invisible document for the rest of the session.
 */
function compress() {
  try {
    html.classList.add('intro-compressed', 'intro-restart');
    void html.offsetHeight;
    html.classList.remove('intro-restart');
  } catch (e) {
    /* No layout to flush, or no classList: the schedule simply stays long. The
       page is still correct, just slower to arrive than it could have been. */
    try { html.classList.remove('intro-restart'); } catch (e2) {}
  }
}

/**
 * TERMINAL. The overlay leaves the DOM.
 *
 * Removing it rather than hiding it is deliberate: for the rest of the page's
 * life there is no full-viewport layer, no z-index 1200, and no focusable Skip
 * button that a later stylesheet might accidentally make visible. What is gone
 * cannot be interacted with.
 *
 * The bootstrap's `finishIntro` does the removal and sets the classes on the
 * normal path; this function is what still runs if `finishIntro` was never
 * reached, and either way it runs before focus is handed over — because focusing
 * the Skip button while it is still on screen leaves the visitor with a focus on
 * an element that is about to be deleted, and a browser that loses the focused
 * element resets focus to <body>. */
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;

  if (exitId) { try { clearTimeout(exitId); } catch (e) {} exitId = 0; }
  stopWatching();

  try { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); } catch (e) {}
  focusPage();
}

/* ------------------------------------------------------------------ *
 * 7. THE WAYS OUT
 * ------------------------------------------------------------------ */

/* A gesture ends the entrance when it means "I don't want to watch this", and
   not when it means something else. The distinction is not a detail: the entrance
   LOCKS the scroll (index.html, "THE SCROLL LOCK"), and the previous version of
   this file ended the entrance on `wheel`/`touchmove`/`scroll` as well — so the
   same gesture that was cancelled by the lock also released it, and every
   gesture after it scrolled a document that had just been handed over
   mid-animation. The visitor who scrolled too early got a broken page; the fix
   is that scrolling is no longer an exit.

   WHAT IS STILL AN EXIT
     - the Skip button, by click;
     - a TAP anywhere on the panel — pointerup within 10px of where it went
       down, inside 600ms. A drag is not a tap, which is exactly what keeps a
       thumb-drag on a phone from releasing the lock half-way through the swipe;
     - Esc, Enter and Space. Tab is left alone, because a visitor who tabs into
       the page and then tabs back has not asked for anything.

   The three keys are cancelled in this handler as well as allowed through by the
   bootstrap's key handler: Space is a scroll key in every browser, and the only
   reason it does not scroll is that focus happens to be on the Skip button. That
   is not a guarantee, it is a coincidence of the current focus order. */
const SKIP_KEYS = { Escape: 1, Esc: 1, Enter: 1, NumpadEnter: 1, ' ': 1, Space: 1, Spacebar: 1 };

function onSkipKey(e) {
  /* `defaultPrevented` is deliberately NOT consulted. The scroll lock in the
     <head> bootstrap runs first on the same phase and the same target, and it
     cancels Space — correctly, because Space scrolls a page whose focus is not
     on a button. The consequence was that this handler, which arrived second,
     read a cancelled key as "someone else has it" and did nothing: Space became
     the one key that neither scrolled nor skipped. The lock and this handler
     are the same feature answering for the same gesture, and the lock's answer
     is not a veto. */
  if (!SKIP_KEYS[e.key]) return;
  e.preventDefault();
  finish('skipped', true);
}

let downX = 0;
let downY = 0;
let downAt = 0;
let dragging = false;

function onPointerDown(e) {
  downX = e.clientX; downY = e.clientY;
  downAt = (e.timeStamp || performance.now());
  dragging = false;
}

function onPointerMove(e) {
  if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 10) dragging = true;
}

function onPointerUp(e) {
  if (dragging) return;
  if ((e.timeStamp || performance.now()) - downAt > 600) return;
  finish('tapped', true);
}

function wireInput() {
  try { window.addEventListener('keydown', onSkipKey, { passive: false, capture: true }); } catch (e) {}
  try { window.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true }); } catch (e) {}
  try { window.addEventListener('pointermove', onPointerMove, { passive: true, capture: true }); } catch (e) {}
  try { window.addEventListener('pointerup', onPointerUp, { passive: true, capture: true }); } catch (e) {}
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
     and, critically, `finishIntro` still has to run, because the bootstrap has
     already put `intro-active` on <html> and installed the scroll lock. */
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

  /* `pageshow` (bfcache) and `visibilitychange` are the bootstrap's, not this
     module's, and they were duplicated here until this pass. Both are
     idempotent, so the duplication was harmless and it was also invisible: a
     reader comparing the two could not tell which one was load-bearing for the
     scroll lock. They live in index.html now, which is the file that has to
     release the page when nothing on this side runs at all. */

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