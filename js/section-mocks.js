/* =============================================================================
   FEATURE MOCK WINDOWS — js/section-mocks.js
   -----------------------------------------------------------------------------
   Three mock windows in #features that used to be generic skeleton bars and now
   show what each one is. Two of the three need a controller; the third does not.

     MOCK 1  toolapis · hub    five tiles stagger in once, then a pointer moves
                               between them every 2s with a ripple
     MOCK 2  adb · tethering   a terminal types itself and loops with a 4s hold
     MOCK 3  enhancer · queue  PURE CSS (width keyframe + two stacked labels
                               that cross-fade). Nothing to do here at all —
                               it pauses with the section like everything else.

   WHY THE TERMINAL IS NOT widgets.js's
   ---------------------------------------------------------------------------
   js/widgets.js has a typewriter, and it is a good one, but it TYPES ONCE AND
   HOLDS — it only restarts when the terminal scrolls out of view and back. This
   one has to loop with a pause, or a mock window someone stares at for ten
   seconds becomes a terminal that stopped working. So this mock is marked up
   with `data-mtype`, not `data-type`: two controllers writing to one element
   would interleave and leave a half-typed line on screen, which is worse than
   either alone.

   THE TWO RULES
   ---------------------------------------------------------------------------
   1. PAUSE OFF-SCREEN AND ON A HIDDEN TAB. Same IntersectionObserver the
      backgrounds use, and the same `.is-active` class on the section — so
      nothing here needs its own observer at all. The timers below simply stop.
   2. MOTION OFF IS A FINISHED STATE. The terminal shows both commands and
      "connected"; the tiles are all visible with no cursor. Never a half-typed
      line, never an empty mock.

      "Motion off" means the visitor pressed "Reduce motion". The OS
      "reduce motion" setting is not consulted anywhere on this site — that
      decision is written out in css/animations.css — so nothing here can
      branch on it, and no mock can switch itself off without being asked.

   FAILURE: every block is guarded and boot is in one try/catch. A failure here
   costs a mock's choreography and nothing else — the mock still renders, because
   every tile and every command is in the markup.
   ========================================================================== */

import { motionAllowed, onMotionChange } from './motion.js';

/* How long the terminal holds on "connected" before wiping and typing again. */
const HOLD_MS = 4000;
/* How long the pointer sits on one tile before moving to the next. */
const DWELL_MS = 2000;
/* Per-character typing interval, and the pause after one that a real typist
   would pause after. */
const CHAR_MS = 34;
const SLOW_CHAR_MS = 220;

let motion = motionAllowed();

/* Timers and listeners created here, so a motion toggle can unwind all of them
   without stacking duplicates and without a reload. */
const timers = new Set();
const cleanups = [];
/* One place to register a teardown, so a caller never has to remember whether
   this module exports a helper or wants a push. Mirrors js/widgets.js. */
function onCleanup(fn) { cleanups.push(fn); }

function after(ms, fn) {
  const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
  timers.add(id);
  return id;
}
function every(ms, fn) {
  const id = setInterval(fn, ms);
  timers.add(id);
  return id;
}
function clearTimers() {
  timers.forEach((id) => { clearTimeout(id); clearInterval(id); });
  timers.clear();
}

/** True when the section is on screen and motion is allowed. The CSS pause and
 *  this check are belt and braces on purpose: the class stops the animations,
 *  and this stops the timers, and neither one is enough alone (a paused CSS
 *  animation still exists, and a live timer still fires). */
function inView(el) {
  const section = el.closest('.section');
  return !!section && section.classList.contains('is-active') && motion;
}

/* Every mock that should be running, registered at construction. Separate from
   `cleanups` because the two run in opposite directions: cleanups tear down,
   this puts back. */
const resumables = [];
function resume() {
  /* One frame's grace: js/section-bg.js's resync writes `.is-active` in the
     same tick the policy changed, and the module load order is not something
     to rely on. A microtask is enough for a class write and costs nothing. */
  Promise.resolve().then(() => {
    for (const fn of resumables) { try { fn(); } catch (e) { /* one mock is not the page */ } }
  });
}

/* ==========================================================================
   1 · MOCK 1 — the launcher: staggered tiles, then a moving pointer
   --------------------------------------------------------------------------
   `--i` is written once so the 120ms stagger can be pure CSS (a per-tile
   `transition-delay` would need the same number in the stylesheet). The
   entrance itself is the animation in css/section-bg.css, keyed on `.is-shown`,
   which js/widgets.js already adds on first view.
   ========================================================================== */
document.querySelectorAll('[data-mock-tiles]').forEach((grid) => {
  const tiles = Array.from(grid.querySelectorAll('.mock-tile'));
  const cursor = grid.querySelector('[data-mock-cursor]');
  if (!tiles.length) return;
  tiles.forEach((t, i) => t.style.setProperty('--i', i));

  /* Measure the active tile's offset box and park the pointer on it. Measuring
     beats writing five hard-coded positions: the grid is auto-fit, so at some
     widths it is three across and at others five, and only the box knows. */
  function pointAt(tile) {
    if (!cursor) return;
    const g = grid.getBoundingClientRect();
    const t = tile.getBoundingClientRect();
    cursor.style.setProperty('--cx', Math.round(t.left - g.left + 6) + 'px');
    cursor.style.setProperty('--cy', Math.round(t.top - g.top + 2) + 'px');
  }

  function settle() {
    /* With motion off every tile is simply lit and the pointer is gone: a mock
       showing five available tools and no cursor is a finished state, whereas a
       cursor frozen over one tile forever would look stuck. */
    tiles.forEach((t) => t.classList.add('is-active'));
    if (cursor) cursor.classList.remove('is-rippling');
    pointAt(tiles[0]);
  }

  function start() {
    if (!inView(grid)) return;
    let i = 0;
    const tick = () => {
      const tile = tiles[i % tiles.length];
      tiles.forEach((t) => t.classList.toggle('is-active', t === tile));
      pointAt(tile);
      /* The ripple fires once on arrival. Re-triggering a 1-iteration animation
         needs the class removed first, or it will not restart. */
      if (cursor) {
        cursor.classList.remove('is-rippling');
        void cursor.offsetWidth; /* force a reflow so the animation replays */
        cursor.classList.add('is-rippling');
      }
      i += 1;
    };
    tick();
    every(DWELL_MS, tick);
  }

  if (motion) start(); else settle();
  cleanups.push(settle);
  resumables.push(start);

  /* Start when the section arrives, stop when it leaves. The CSS already pauses
     the tile animation; this stops the timers.

     This observer is also how the mock restarts after the visitor turns motion
     back off and on again while PARKED on this section: `unwind()` cleared the
     timers, and an IntersectionObserver does not fire when nothing about the
     element has changed. Re-starting here on a change event alone would leave
     the tiles frozen until the next scroll, so the observer is re-armed from
     the teardown handler as well. */
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) start();
        else clearTimers();
      }
    }, { threshold: 0, rootMargin: '80px 0px' });
    io.observe(grid);
    /* Not `pagehide` only: this has to fire when motion comes BACK on. */
    onCleanup(() => { try { io.disconnect(); } catch (e) { /* noop */ } });
  }
});

/* ==========================================================================
   2 · MOCK 2 — the terminal
   --------------------------------------------------------------------------
   Lines are typed in order, each held a beat, then the whole block holds for
   HOLD_MS before the loop restarts. The status line is revealed by a class
   rather than typed, because a status arriving character by character reads as a
   stall rather than as a connection.
   ========================================================================== */
document.querySelectorAll('[data-mtype-term]').forEach((term) => {
  const lines = Array.from(term.querySelectorAll('[data-mtype]'));
  const status = term.querySelector('[data-mtype-status]');
  if (!lines.length) return;

  /* Snapshot the real strings once. Reading them back later would measure this
     function's own output, which is how a second pass ends up typing the first
     pass's half-typed text. */
  const plan = lines.map((el) => {
    const text = el.textContent || '';
    el.dataset.final = text;
    return { el, text };
  });

  let line = 0;
  let char = 0;
  let job = null;

  function stop() { if (job !== null) { clearTimeout(job); timers.delete(job); job = null; } }

  function finish() {
    stop();
    plan.forEach(({ el, text }) => { el.textContent = text; });
    line = plan.length;
    if (status) status.textContent = 'connected';
  }

  function typeChar() {
    const cur = plan[line];
    if (!cur) { after(120, nextLine); return; }

    cur.el.textContent = cur.text.slice(0, char);
    char += 1;

    if (char > cur.text.length) { nextLine(); return; }
    /* Punctuation is where a real typist pauses anyway. */
    const ch = cur.text[char - 1] || ' ';
    job = after('.,:;'.indexOf(ch) !== -1 ? SLOW_CHAR_MS : CHAR_MS, typeChar);
  }

  function nextLine() {
    stop();
    if (line + 1 >= plan.length) {
      /* End of the run: reveal the status, hold, then wipe and go again. */
      if (status) status.textContent = 'connected';
      job = after(HOLD_MS, () => {
        if (!inView(term)) return;
        if (status) status.textContent = 'connecting';
        plan.forEach(({ el }) => { el.textContent = ''; });
        line = 0; char = 0;
        job = after(300, typeChar);
      });
      return;
    }
    line += 1;
    char = 0;
    job = after(260, typeChar);
  }

  function start() {
    if (job !== null || !inView(term)) return;
    line = 0; char = 0;
    job = after(300, typeChar);
  }

  if (motion) start(); else finish();
  cleanups.push(finish);
  resumables.push(start);

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) start();
        else stop();
      }
    }, { threshold: 0, rootMargin: '80px 0px' }).observe(term);
  }
});

/* ==========================================================================
   TEARDOWN
   ========================================================================== */
onMotionChange((allowed) => {
  motion = allowed;
  if (allowed) {
    /* Each mock's `settle()` is its finished state, so re-arming means putting
       that state back to "running" for whatever is actually on screen. The
       blocks registered a `start` through their IntersectionObserver, and
       `inView()` gates it on `.is-active` plus the policy — which is why
       js/section-bg.js's `resync()` has to run first, or nothing is visible to
       this module either.

       Without this, a visitor who toggled motion off and back on while parked
       mid-page saw static mocks until they scrolled. */
    resume();
    return;
  }
  clearTimers();
  cleanups.forEach((fn) => { try { fn(); } catch (e) { /* one mock is not the page */ } });
});

window.addEventListener('pagehide', () => {
  clearTimers();
  cleanups.forEach((fn) => { try { fn(); } catch (e) { /* noop */ } });
});