/* ============================================================================
 * reveal.js — TOOLAPIS · blur + fade-in-upward reveal for the blocks
 *              script.js never reaches
 * ----------------------------------------------------------------------------
 * script.js owns the `.reveal` / `[data-reveal]` system: an IntersectionObserver
 * adds `.is-visible` + `.active`, `.reveal-group` children cascade through
 * `data-delay`, and css/animations.css turns that into the fade + rise.
 * That file is not ours to touch.
 *
 * What it does NOT reach. Script.js's reveal observes the `.reveal` /
 * `[data-reveal]` containers and cascades `.reveal-group` children, and its
 * Motion system owns `main h2` and the footer; the load choreography
 * (`[data-load-reveal]`, pure CSS) owns the hero. What none of them cascade is
 * the copy INSIDE a revealed block:
 *
 *   - the h3 + paragraph of each tool card and each flow step, so the width of
 *     the card does not arrive as one flat slab;
 *   - the section-intro paragraph under each `main h2`;
 *   - the CTA card's paragraph and its three buttons, after Motion's title.
 *
 * This module tags exactly those with `.rv`, sets `--reveal-delay` per index
 * for the stagger, and observes them once each. It adds no animation of its
 * own: the visual is entirely in css/animations.css, keyed on the same
 * `.is-visible` class script.js uses, so the two systems are indistinguishable
 * on screen and cannot fight.
 *
 * PROMISES
 * ----------------------------------------------------------------------------
 * 1. Never touches an element script.js already owns. Anything carrying
 *    `.reveal` / `[data-reveal]`, anything inside a `.reveal-group`, anything
 *    carrying `data-load-reveal` (the hero's arrival, which css/animations.css
 *    plays on load) and anything Motion has tagged `data-motion-kind` is
 *    skipped outright.
 * 2. Never animates chrome. The sticky header, nav, progress bar, back-to-top,
 *    grain, toast, mobile menu, page-transition plate, the hero's light-ribbon
 *    scene and its floating chips are excluded by container, and anything whose
 *    computed position is
 *    `fixed` or `sticky` is excluded by measurement.
 * 3. NEVER LEAVES A BLOCK HIDDEN. Not "eventually, unless the observer fires" —
 *    never. An IntersectionObserver only ever answers the question "did this
 *    element ENTER the viewport", and that question has no answer for a block
 *    that travelled across the viewport while nothing was looking: it was above
 *    the root when the observer first saw it and below it when it looked again,
 *    so it was never seen entering, and `isIntersecting` was false for both
 *    samples. The entrance's hold is what makes that window exist — handovers
 *    are queued for the length of it — so this module's own deferral is the
 *    first thing that can strand a block. The answer is a sweep that asks the
 *    other question: anything not yet revealed whose top is above the fold (or
 *    already behind the visitor) is revealed NOW. It runs on every handover, on
 *    the first scroll after one, on `load`, on `pageshow`, on a resize and on a
 *    9s watchdog, and a 4-pass self-heal checks computed opacity on screen for
 *    six seconds afterwards and says so in the console if it has to intervene.
 * 4. Cannot fail the page. Everything is wrapped; the whole module is inside
 *    one try/catch, and any failure before the class is added leaves the
 *    hide-initial styles switched off, i.e. the content visible.
 *
 * NO IMPORTS. This must evaluate even when the three.js importmap, the CDN or
 * the whole 3D layer is unavailable — which is precisely the case it exists
 * to cover.
 * ==========================================================================*/

/* ------------------------------------------------------------------ *
 * 1. CONSTANTS
 * ------------------------------------------------------------------ */

/** The observer. `threshold: 0.15` is the same value script.js uses, so the
 *  two systems hand a block over at the same moment; the rootMargin asks for
 *  the last 8% of the viewport to count as "not yet", which keeps a block from
 *  finishing its entrance while still only clipping the bottom edge. */
export const REVEAL = {
  threshold: 0.15,
  rootMargin: '0px 0px -8% 0px',
  /** Per index inside a group. 100ms puts five blocks inside the .9s. */
  stagger: 100,
  /** Ceiling, so a long footer cascade cannot push its tail past the entrance. */
  maxDelay: 420,
  /** Re-sweep interval while the page is settling (fonts, Tailwind, intro). */
  sweepMs: 700,
  /** Watchdog. Past this, any target still without `.is-visible` is revealed. */
  watchdogMs: 9000,
};

/** Containers that hold a block to cascade under: [selector, per-index step].
 *  Flat across each container, in DOM order, so the copy walks the row rather
 *  than the whole grid arriving as one slab. */
const GROUPS = [
  /* the section intros: the h2 (Motion's) then this paragraph */
  ['#features .section-head', 80],
  ['#flow .section-head', 80],
  ['#clarity .section-head', 80],
  /* the four bento cards, left to right across two rows */
  ['#overview .bento', 70],
  /* the three feature rows */
  ['#features .feature', 90],
  /* the three flow steps */
  ['#flow .reveal-group', 90],
  /* the four accordion questions */
  ['#clarity .acc', 70],
  /* the closing CTA band: paragraph, then the buttons */
  ['#clarity .cta-band__inner', 90],
];

/** The headings and the copy that sit INSIDE a block the existing system
 *  already reveals. The container fades, rises and blurs; this cascades
 *  underneath it, which is where "title, then accent, then body" comes from. */
const CANDIDATES = ['h3', '.reveal p', '.reveal .btn', '.reveal button'].join(',');

/** Chrome. By container, because the header's own class list is not ours. */
const CHROME = [
  '#navbar', '#nav-sentinel', '#scroll-progress', '#back-to-top',
  '.grain', '#toast', '#page-transition',
  '.hero-scene', '.hero-chip',
  '#mobile-menu', '.skip-link',
].join(',');

const html = document.documentElement;
const seen = new WeakSet();
const revealed = new WeakSet();
const targets = [];

/* Blocks handed over while the entrance still owns the screen, waiting for it
   to let go. See `introHolds`. */
const deferred = [];

/* ------------------------------------------------------------------ *
 * 2b. THE ENTRANCE
 * ------------------------------------------------------------------ */

/**
 * Is the five-second intro still holding the page?
 *
 * The entrance (css/intro.css, js/intro.js) covers the viewport for the first
 * 2.5 seconds and lifts at 2.5s. Anything this module reveals in that window
 * reveals BEHIND the overlay: the block finishes its fade and blur while nobody
 * can see it, and by the time the overlay moves the first screen has already
 * arrived flat, with none of the choreography the entrance exists to deliver.
 * So during the hold, handovers are queued rather than played.
 *
 * THE DEADLINE IS THE POINT OF THIS FUNCTION. `intro-complete` is dispatched by
 * a module that can fail, by a bootstrap that can fail, and a reveal system
 * that defers on a promise nobody kept would leave a page's content at opacity 0
 * indefinitely. So the hold expires on its own clock regardless: 14s is far past
 * the inline bootstrap's own 5.8s ceiling, which means this deadline is only
 * ever reached if the entire entrance has already been broken — and in that case
 * the right answer is to stop deferring and show the page, which is exactly what
 * this does. */
const INTRO_DEADLINE = 14000;
let introDeadline = 0;

function introHolds() {
  if (!html.classList.contains('intro-active')) return false;
  return performance.now() < introDeadline;
}

/* ------------------------------------------------------------------ *
 * 2. SELECTION
 * ------------------------------------------------------------------ */

function isChrome(el) {
  if (el.closest(CHROME)) return true;
  try {
    const pos = window.getComputedStyle(el).position;
    /* fixed AND sticky: a sticky block is furniture that rides the page,
       not content that arrives. */
    if (pos === 'fixed' || pos === 'sticky') return true;
  } catch (err) { /* no computed style: the container check has already run */ }
  return false;
}

function isOwned(el) {
  /* script.js / the load choreography already animate this element. */
  if (el.matches('.reveal, [data-reveal], [data-load-reveal]')) return true;
  /* A `.reveal-group` child is a target in its own right: script.js staggers
     them and reveals each one. Only what is INSIDE one is ours. */
  if (el.closest('.reveal-group')) return !el.closest('.reveal-group > *');
  /* The hero is the load choreography's, top to bottom. */
  if (el.closest('[data-load-reveal]')) return true;
  /* Motion owns `main h2` and the footer, and tags the well-sized icon boxes
     inside `.reveal`. It sets `data-motion-kind` synchronously at its own boot,
     and script.js is a deferred script earlier in the document than this
     module, so the tag is always here before we look. If the Motion CDN is
     down it never arrives — which is the correct signal for us to take over. */
  if (el.closest('[data-motion-kind]')) return true;
  /* Decorative: a connector dash, a gradient blob. */
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if (isChrome(el)) return true;
  /* Hidden outright. */
  try {
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return true;
  } catch (err) { /* measurable below or not at all */ }
  /* A box with nothing in it is a frame, not a block of copy — this is what
     keeps the 48px glass icon wells inside the flow steps out of it. */
  const text = (el.textContent || '').trim();
  if (!text && !el.querySelector('img, svg')) return true;
  return false;
}

/** Every element this module is responsible for. */
function collect() {
  const out = [];
  const add = (el) => {
    if (!el || seen.has(el) || isOwned(el)) return;
    seen.add(el);
    out.push(el);
  };

  /* The headings and the copy that sit INSIDE a block the existing system
     already reveals. The container fades, rises and blurs; this cascades
     underneath it, which is where "title, then accent, then paragraph, then
     buttons" comes from. */
  let list;
  try { list = document.querySelectorAll(CANDIDATES); } catch (err) { list = []; }
  for (let i = 0; i < list.length; i++) add(list[i]);
  return out;
}

/* ------------------------------------------------------------------ *
 * 3. REVEAL
 * ------------------------------------------------------------------ */

/** The visible class, shared with script.js so the two are indistinguishable. */
const VISIBLE = ['is-visible', 'active'];

/** Read one of the `--reveal-*` custom properties off <html>. CSS stays the
 *  single place the numbers live; the JS defaults are only a fallback for an
 *  engine that will not hand back a computed custom property. */
function cssPx(name, fallback) {
  try {
    const v = parseFloat(window.getComputedStyle(html).getPropertyValue(name));
    return v > 0 ? v : fallback;
  } catch (err) { return fallback; }
}

/** Longest a promoted layer may be held: the transition plus its delay plus a
 *  full second of slack for a dropped frame. */
function animBudget() {
  const dur = cssPx('--reveal-duration', 0.9) * 1000;
  const delay = cssPx('--reveal-max-delay', 420);
  return dur + delay + 1000;
}

function markAnimating(el) {
  el.classList.add('rv-anim');
  const done = () => {
    el.classList.remove('rv-anim');
    el.style.willChange = '';
  };
  /* `transitionend` is the clean exit and the timer bounds it when the event
     never comes (a display:none ancestor, a skipped frame, a cancelled
     transition). The `{ once: true }` listener is removed either way, which
     matters more than it used to: the reveal now transitions THREE properties,
     so `transitionend` fires three times per block and a listener left attached
     would run `done` twice — harmless today, but only because `done` is
     idempotent. */
  try { el.addEventListener('transitionend', done, { once: true }); } catch (err) { /* noop */ }
  setTimeout(done, animBudget());
}

/**
 * REVEAL ONE BLOCK. `instant` skips the transition and writes the finished
 * state directly, which is what a block the visitor has already scrolled past
 * needs: animating it would mean spending 900ms on something nobody is looking
 * at, from a page that is trying to stop wasting frames.
 */
function revealOne(el, instant) {
  if (!el || el.dataset.rvDone === '1') return;
  /* Queued, not played: see `introHolds`. Bounded, because `introDeadline` is
     and because a duplicate here would only cost one extra class write. */
  if (introHolds() && deferred.indexOf(el) === -1) {
    deferred.push(el);
    return;
  }
  el.dataset.rvDone = '1';
  for (let i = 0; i < VISIBLE.length; i++) {
    try { el.classList.add(VISIBLE[i]); } catch (err) { /* noop */ }
  }
  /* One-way: `revealed` is a WeakSet, so a swept-and-revealed element can
     never be un-revealed by a later pass. */
  revealed.add(el);
  try { if (io) io.unobserve(el); } catch (err) { /* noop */ }

  if (instant) {
    /* The final state, written. `transition: none` first so the class just added
       above does not animate from the hidden state on its way here — which is
       the whole point of the `instant` branch. */
    try {
      el.style.transition = 'none';
      el.style.opacity = '1';
      el.style.transform = 'none';
      el.style.filter = 'none';
      el.style.willChange = 'auto';
    } catch (err) { /* noop */ }
  }
  markAnimating(el);
}

/** Everything, now. The no-observer path and the watchdog both use it. */
function revealAll() {
  for (const el of targets) revealOne(el);
}

/** Play whatever the entrance was holding, and report what it played. Called on
 *  `intro-complete`, and again from a timer, because the one thing worse than a
 *  page that reveals late is a page that never reveals. */
function flushDeferred() {
  const played = [];
  while (deferred.length) {
    const el = deferred.shift();
    revealOne(el, passed(el));
    played.push(el);
  }
  return played;
}

/* ------------------------------------------------------------------ *
 * 4. OBSERVER + SWEEPS
 * ------------------------------------------------------------------ */

let io = null;
let sweepId = 0;

/** Has this block already gone past the top of the viewport? Measured, not
 *  assumed — a block that is off to the side, or inside a collapsed section,
 *  can sit at a negative top without ever having been on screen. */
function passed(el) {
  try {
    const r = el.getBoundingClientRect();
    return !!r && r.height > 0 && r.bottom < 0;
  } catch (err) {
    return false;
  }
}

/** Anything whose box already touches the viewport reveals immediately. This
 *  is what covers the first paint, a deep link (`#flow` is at the top of the
 *  document on arrival) and any block the observer was too late for.
 *  Uses 1.05x viewport height to catch elements just past the fold. */
function passVisible() {
  const vh = window.innerHeight || 0;
  const vw = window.innerWidth || 0;
  const vhThreshold = vh * 1.05;
  const shown = [];
  for (const el of targets) {
    if (revealed.has(el)) continue;
    let r = null;
    try { r = el.getBoundingClientRect(); } catch (err) { r = null; }
    if (!r || (r.width === 0 && r.height === 0)) continue;
    if (r.top < vhThreshold && r.right > 0 && r.left < vw) {
      revealOne(el, passed(el));
      shown.push(el);
    }
  }
  return shown;
}

/**
 * THE RECOVERY SWEEP. This is the function the blank screen came down to.
 *
 * Every other path in this file asks "has this block entered the viewport?".
 * The entrance holds those handovers for as long as it owns the screen, and a
 * block that MOVED during that hold — because the document scrolled, or because
 * Chrome restored a position after a refresh, or because the layout above it
 * changed height — is never seen entering. It was above the viewport before the
 * observer's first callback and below it after, and `isIntersecting` was false
 * for both. The block was then never revealed by anything, at any point, for
 * the rest of the session: the page renders a hole where a paragraph is.
 *
 * So the sweep asks the other question. Anything not yet revealed whose top is
 * above `innerHeight * 1.05` — in view OR already behind the visitor — is
 * revealed now, and anything already behind is revealed without its transition,
 * because an animation the visitor cannot see is 900ms of layout on a page that
 * is already behind.
 *
 * It is called on every entrance handover, on the first `scroll` after one, on
 * `load`, on `pageshow`, on a resize, and again by the self-heal below. It is
 * idempotent, it is `targets.length` of integer comparisons, and it cannot make
 * anything invisible — the only thing it does is add a class that makes an
 * element visible.
 */
function recover() {
  const batch = flushDeferred();
  const seen = passVisible();
  if (!batch.length && !seen.length) return;

  /* AT MOST SIX STEPS. A recovery sweep can be asked to reveal twenty blocks at
     once — a visitor who restored a deep scroll position, then scrolled back to
     the top, hands this function a screenful of past-the-fold blocks all at
     once. With the authored per-group staggers those twenty land inside the same
     420ms ceiling and arrive as one flat slab, which is the exact thing the
     cascade exists to avoid. Six steps across the batch is the compromise: the
     walk is still legible, and the last block is still inside the ceiling the
     rest of the system is budgeted against. */
  const n = batch.length + seen.length;
  if (n > 1) {
    const step = Math.min(70, Math.floor(420 / (n - 1)));
    for (let i = 0; i < n; i++) {
      const el = batch[i] || seen[i];
      try { el.style.setProperty('--reveal-delay', Math.round(i * step) + 'ms'); } catch (e) {}
    }
  }
}

/** Bounded re-sweep: fonts land, Tailwind's CDN lands, and a deep link
 *  jumps. None of those is an observer event. */
function scheduleSweeps(count) {
  let left = count;
  const tick = () => {
    recover();
    left -= 1;
    if (left > 0) sweepId = setTimeout(tick, REVEAL.sweepMs);
    else sweepId = 0;
  };
  if (sweepId) clearTimeout(sweepId);
  sweepId = setTimeout(tick, REVEAL.sweepMs);
}

/* ------------------------------------------------------------------ *
 * 5. BOOT
 * ------------------------------------------------------------------ */

function boot() {
  /* Tag first, then arm the CSS. If anything below throws, `reveal-ready` is
     never set, the hide-initial rules never match, and the page is visible. */
  const els = collect();

  /* Backstop for the one failure this module cannot cover itself: script.js
     never ran, so nothing is observing `.reveal`. `html.js` is the flag
     script.js sets on its first line, so it is the honest test — and when it
     is absent this module takes those over, which is a fallback rather than
     double handling. */
  const scriptAlive = html.classList.contains('js');
  if (!scriptAlive) {
    let legacy = [];
    try { legacy = document.querySelectorAll('.reveal, [data-reveal]'); } catch (err) { legacy = []; }
    for (let i = 0; i < legacy.length; i++) {
      const el = legacy[i];
      if (el.matches('[data-load-reveal]') || isChrome(el)) continue;
      if (el.closest('.reveal-group')) continue;
      if (seen.has(el)) continue;
      seen.add(el);
      els.push(el);
    }
  }

  /* The other half of the same fallback. `main h2` and the footer are claimed
     by script.js's Motion system, which tags them `data-motion-kind` at its own
     boot. If the Motion CDN never arrived that tag is absent — and those are
     exactly the blocks the whole page hangs on, so they must not be left to a
     system that is not there. */
  if (!document.querySelector('[data-motion-kind]')) {
    let extra = [];
    try { extra = document.querySelectorAll('main h2, footer'); } catch (err) { extra = []; }
    for (let i = 0; i < extra.length; i++) {
      const el = extra[i];
      if (seen.has(el) || isOwned(el) || isChrome(el)) continue;
      seen.add(el);
      els.push(el);
    }
  }

  /* The cascade. Read straight off the authored custom properties so the CSS
     stays the one place the numbers live. */
  const stagger = cssPx('--reveal-stagger', REVEAL.stagger);
  const maxDelay = cssPx('--reveal-max-delay', REVEAL.maxDelay);

  for (let i = 0; i < els.length; i++) {
    els[i].classList.add('rv');
    targets.push(els[i]);
  }

  /* The cascade, per group, in DOM order. The step is the authored one unless
     the group is long enough that honouring it would push the tail past
     `--reveal-max-delay`, in which case it is compressed to fit — so a wide
     grid walks its copy instead of stranding its last card, and a short one
     keeps the rhythm it was designed with. Every child starts one stagger
     behind its container, which is still rising. */
  for (const [selector, step] of GROUPS) {
    let group = null;
    try { group = document.querySelector(selector); } catch (err) { group = null; }
    if (!group) continue;
    let found = [];
    try { found = group.querySelectorAll('.rv'); } catch (err) { found = []; }
    if (!found.length) continue;
    const n = found.length;
    const room = Math.max(0, maxDelay - stagger);
    const s = n > 1 ? Math.min(step, room / (n - 1)) : 0;
    for (let i = 0; i < n; i++) {
      const el = found[i];
      if (el.dataset.rvDelay) continue;
      const ms = Math.min(Math.round(stagger + i * s), maxDelay);
      el.dataset.rvDelay = String(ms);
      try { el.style.setProperty('--reveal-delay', ms + 'ms'); } catch (err) { /* noop */ }
    }
  }

  /* Arm the CSS. From here on the blocks are hidden until `.is-visible`. */
  html.classList.add('reveal-ready');
  /* The failsafe's "both halves are alive" marker. The inline timer in
   * index.html polls for this attribute, so it must be set synchronously and
   * unconditionally here — a delay of one tick is a delay that timer has to
   * keep waiting through. See that script for why it polls rather than firing
   * once at a fixed deadline.

   Its presence also tells the failsafe to leave the page alone, because at this
   moment the scroll reveal owns every block below the fold and force-revealing
   them would turn the whole system into a no-op. */
  try { html.setAttribute('data-reveal-live', '1'); } catch (err) { /* noop */ }

  /* Set BEFORE anything can call revealOne, including the no-observer path
     below: `introHolds` reads it, and a deadline of 0 would read as "the
     entrance is long gone" and skip the hold entirely. */
  introDeadline = performance.now() + INTRO_DEADLINE;

  if ('IntersectionObserver' in window) {
    try {
      io = new IntersectionObserver((entries, obs) => {
        for (const en of entries) {
          const el = en.target;
          /* TWO WAYS IN, NOT ONE.
             `isIntersecting` is the normal one: the block is entering, play it.
             The second is the bug this whole pass exists for: a block that was
             ALREADY above the viewport when the observer first looked at it —
             it moved during the entrance's hold, or Chrome restored a scroll
             position, or the layout above it changed height. For those,
             `isIntersecting` is false and always was: the observer saw the
             element above the root, then below it, and never "entering". So the
             top edge of the element against the top edge of the root is the
             second condition, and it is checked from the entry's own geometry
             rather than from a fresh measurement. */
          let arrived = en.isIntersecting;
          if (!arrived) {
            try {
              const root = en.rootBounds;
              arrived = !!root && en.boundingClientRect.top < root.top;
            } catch (err) { arrived = false; }
          }
          if (!arrived) continue;
          /* `revealOne` unobserves, and only once the block has actually been
             handed over. The old order — unobserve, then discover that the
             entrance is holding this one and queue it — dropped it on the floor
             with nothing left watching it. */
          revealOne(el);
        }
      }, { threshold: REVEAL.threshold, rootMargin: REVEAL.rootMargin });
      for (const el of targets) io.observe(el);
    } catch (err) {
      io = null;
    }
  }

  /* No observer (or one that could not be built): show everything. */
  if (!io) revealAll();

  /* In view right now -> right now, not in 700ms — unless the entrance still
     owns the screen, in which case both of those are queued for its handover. */
  passVisible();
  scheduleSweeps(6);
  /* The belt to the deadline's braces: whatever is still queued when the hold
     expires is played whether the entrance announced anything or not. */
  setTimeout(recover, INTRO_DEADLINE - 200);

  /* ========================================================== THE HANDOVER.
     Every one of these four listeners runs the same recovery sweep, and the
     reason there are four is that they fail independently of one another:

       - `toolapis:intro-complete` is dispatched by the inline <head> bootstrap
         and by js/intro.js, so it arrives even when one of them never runs;
       - `load` covers a page whose entrance was skipped entirely (`?intro=off`,
         a deep link, motion off), where no handover event will ever be fired;
       - `pageshow` covers a bfcache restore, which arrives with the page already
         at whatever position it had;
       - the ResizeObserver covers a viewport change, which is the other way a
         block can travel out of view without ever being seen entering.

     The sweep is deferred one frame because it reads geometry, and a scroll
     event's geometry is only final after the frame that moved it. */
  const onHandover = () => {
    requestAnimationFrame(() => {
      recover();
      scheduleSweeps(4);
      startSelfHeal(700);
    });
  };
  window.addEventListener('toolapis:intro-complete', onHandover);
  window.addEventListener('load', onHandover, { once: true });
  window.addEventListener('pageshow', onHandover);
  if ('ResizeObserver' in window) {
    try { new ResizeObserver(onHandover).observe(document.body); }
    catch (err) { /* resize + scroll sweeps cover it */ }
  }

  /* `intro-done` is the class the terminal teardown writes, and it is the one
     signal that is TRUE by construction: every exit path ends in it, including
     the paths where nothing above ran at all. It is watched rather than read so
     that a handover this module was not present for still starts the watchdog. */
  if (typeof MutationObserver === 'function') {
    try {
      new MutationObserver(() => {
        if (html.classList.contains('intro-done')) { startSelfHeal(700); recover(); }
      }).observe(html, { attributes: true, attributeFilter: ['class'] });
    } catch (err) { /* the event listener above is the primary path */ }
  }

  /* THE SELF-HEAL. Four checks, 700ms after the handover and then every 1.5s,
     covering the six seconds in which fonts land, the CDN lands and any layout
     this module was not built for arrives.

     It asks the only question that matters — is anything intersecting the
     viewport that is still transparent? — and if the answer is yes, it reveals
     it and says so in the console. It is not a repair for a known bug: it is the
     assertion that this class of bug is not allowed to exist silently. A future
     change that breaks the reveal produces four loud lines on localhost instead
     of a blank page reported by a visitor. */
  let selfHealTimer = 0;
  let selfHealLeft = 0;
  let selfHealClean = 0;

  function startSelfHeal(delay) {
    if (selfHealTimer || selfHealLeft > 0) return;
    selfHealLeft = 4;
    const tick = () => {
      if (selfHealLeft <= 0) { stopSelfHeal(); return; }
      selfHealLeft -= 1;
      const hidden = forceRevealHidden();
      if (hidden) {
        selfHealClean = 0;
        warn('forced ' + hidden + ' hidden reveal block(s) visible');
      } else if (++selfHealClean >= 2) {
        stopSelfHeal();
        return;
      }
      selfHealTimer = setTimeout(tick, 1500);
    };
    selfHealTimer = setTimeout(tick, delay || 700);
  }

  function stopSelfHeal() {
    if (selfHealTimer) { clearTimeout(selfHealTimer); selfHealTimer = 0; }
    selfHealLeft = 0;
  }

  /** Anything on screen that is still transparent, revealed and counted. The
   *  check is on computed opacity rather than on the bookkeeping, so it also
   *  catches a block this module never tagged — which is the failure mode that
   *  matters, because an untagged block is invisible to every other path here. */
  function forceRevealHidden() {
    const vh = window.innerHeight || 0;
    const vw = window.innerWidth || 0;
    let forced = 0;
    for (const el of targets) {
      let r = null;
      try { r = el.getBoundingClientRect(); } catch (err) { continue; }
      if (!r || r.width === 0 || r.height === 0) continue;
      if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
      let op = 1;
      try { op = parseFloat(getComputedStyle(el).opacity); } catch (err) { op = 1; }
      if (!(op < 0.05)) continue;
      el.dataset.rvDone = '1';
      for (let i = 0; i < VISIBLE.length; i++) {
        try { el.classList.add(VISIBLE[i]); } catch (e) {}
      }
      revealed.add(el);
      try { if (io) io.unobserve(el); } catch (e) {}
      markAnimating(el);
      forced += 1;
    }
    return forced;
  }

  function warn(msg) {
    try {
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        console.warn('[reveal:self-heal] ' + msg);
      }
    } catch (e) {}
  }

  /* Every scroll and every resize re-runs the sweep, debounced to one frame.
     This is the "and on the first scroll after the intro" arm of the recovery:
     a visitor who scrolls straight into a block the observer never saw enter
     gets it revealed on that same scroll rather than at the end of the page. */
  let rafId = 0;
  const onLayout = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; recover(); });
  };
  window.addEventListener('scroll', onLayout, { passive: true });
  window.addEventListener('resize', onLayout, { passive: true });

  /* Watchdog: a target that was tagged but never handed over by either the
     observer or a sweep is revealed rather than left mid-blur. */
  setTimeout(revealAll, REVEAL.watchdogMs);
}

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try { boot(); } catch (err) { try { console.warn('[reveal]', err); } catch (e) {} }
    }, { once: true });
  } else {
    boot();
  }
} catch (err) {
  try { console.warn('[reveal]', err); } catch (e) {}
}