/* ============================================================================
 * reveal.js — TOOLAPIS · blur + fade-in-upward reveal for the blocks
 *              script.js never reaches
 * ----------------------------------------------------------------------------
 * script.js owns the `.reveal` / `[data-reveal]` system: an IntersectionObserver
 * adds `.is-visible` + `.active`, `.reveal-group` children cascade through
 * `data-delay`, and css/reveal.css turns that into the blur + fade + rise.
 * That file is not ours to touch.
 *
 * What it does NOT reach. Script.js's reveal observes the `.reveal` /
 * `[data-reveal]` containers and cascades `.reveal-group` children, and its
 * Motion system owns `main h2` and the footer; the INTRO controller owns the
 * hero. What none of them cascade is the copy INSIDE a revealed block:
 *
 *   - the h3 + paragraph of each tool card and each flow step, so the width of
 *     the card does not arrive as one flat slab;
 *   - the section-intro paragraph under each `main h2`;
 *   - the CTA card's paragraph and its three buttons, after Motion's title.
 *
 * This module tags exactly those with `.rv`, sets `--reveal-delay` per index
 * for the stagger, and observes them once each. It adds no animation of its
 * own: the visual is entirely in css/reveal.css, keyed on the same
 * `.is-visible` class script.js uses, so the two systems are indistinguishable
 * on screen and cannot fight.
 *
 * PROMISES
 * ----------------------------------------------------------------------------
 * 1. Never touches an element script.js already owns. Anything carrying
 *    `.reveal` / `[data-reveal]`, anything inside a `.reveal-group`, anything
 *    carrying `data-intro-reveal` (the hero, which the intro controller drives)
 *    and anything Motion has tagged `data-motion-kind` is skipped outright.
 *    script.js is byte-for-byte unchanged.
 * 2. Never animates chrome. The sticky header, nav, progress bar, back-to-top,
 *    spotlight, grain, toast, mobile menu, page-transition plate and the canvas
 *    are excluded by container, and anything whose computed position is
 *    `fixed` or `sticky` is excluded by measurement.
 * 3. Never leaves a block hidden. No IntersectionObserver -> reveal everything.
 *    Anything already in the viewport -> revealed on the spot, on load, after
 *    the intro hands over, and on a deep link. A watchdog re-runs the sweep.
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
  /* the feature and flow section intros: the h2 (Motion's) then this paragraph */
  ['#features .max-w-3xl.reveal', 80],
  ['#flow .max-w-3xl.reveal', 80],
  /* the three tool cards: title, accent, body — left to right */
  ['#overview .reveal-group', 70],
  /* the two feature tiles: same, with the wide one first */
  ['#features .reveal-group', 80],
  /* the three flow steps: title, body — left to right */
  ['#flow .reveal-group', 90],
  /* the CTA card: paragraph, then the three buttons */
  ['#clarity > .reveal .relative', 90],
];

/** The headings and the copy that sit INSIDE a block the existing system
 *  already reveals. The container fades, rises and blurs; this cascades
 *  underneath it, which is where "title, then accent, then body" comes from. */
const CANDIDATES = ['h3', '.reveal p', '.reveal .btn', '.reveal button'].join(',');

/** Chrome. By container, because the header's own class list is not ours. */
const CHROME = [
  '#navbar', '#nav-sentinel', '#scroll-progress', '#back-to-top',
  '#spotlight', '.grain', '#toast', '#page-transition', '#intro-overlay',
  '#mobile-menu', '.skip-link', '#scene3d-canvas', '#scene3d-debug',
].join(',');

const html = document.documentElement;
const seen = new WeakSet();
const revealed = new WeakSet();
const targets = [];

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
  /* script.js / the intro controller already animate this element. */
  if (el.matches('.reveal, [data-reveal], [data-intro-reveal]')) return true;
  /* A `.reveal-group` child is a target in its own right: script.js staggers
     them and reveals each one. Only what is INSIDE one is ours. */
  if (el.closest('.reveal-group')) return !el.closest('.reveal-group > *');
  /* The hero is the intro controller's, top to bottom. */
  if (el.closest('[data-intro-reveal]')) return true;
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
  /* transitionend is the clean exit; the timer bounds it when the event never
     comes (a display:none ancestor, a skipped frame, a cancelled transition). */
  try { el.addEventListener('transitionend', done, { once: true }); } catch (err) { /* noop */ }
  setTimeout(done, animBudget());
}

function revealOne(el) {
  if (!el || el.dataset.rvDone === '1') return;
  el.dataset.rvDone = '1';
  for (let i = 0; i < VISIBLE.length; i++) {
    try { el.classList.add(VISIBLE[i]); } catch (err) { /* noop */ }
  }
  /* One-way: `revealed` is a WeakSet, so a swept-and-revealed element can
     never be un-revealed by a later pass. */
  revealed.add(el);
  markAnimating(el);
}

/** Everything, now. The no-observer path and the watchdog both use it. */
function revealAll() {
  for (const el of targets) revealOne(el);
}

/* ------------------------------------------------------------------ *
 * 4. OBSERVER + SWEEPS
 * ------------------------------------------------------------------ */

let io = null;
let sweepId = 0;

/** Anything whose box already touches the viewport reveals immediately. This
 *  is what covers the first paint, a deep link (`#flow` is at the top of the
 *  document on arrival) and any block the observer was too late for. */
function passVisible() {
  const vh = window.innerHeight || 0;
  const vw = window.innerWidth || 0;
  for (const el of targets) {
    if (revealed.has(el)) continue;
    let r = null;
    try { r = el.getBoundingClientRect(); } catch (err) { r = null; }
    if (!r || (r.width === 0 && r.height === 0)) continue;
    if (r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw) revealOne(el);
  }
}

/** Bounded re-sweep: fonts land, Tailwind's CDN lands, the intro hands over,
 *  and a deep link jumps. None of those is an observer event. */
function scheduleSweeps(count) {
  let left = count;
  const tick = () => {
    passVisible();
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
      if (el.matches('[data-intro-reveal]') || isChrome(el)) continue;
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
  /* The failsafe's "both halves are alive" marker. The inline 5.5s timer
     leaves the page alone while this is present, because at that moment the
     scroll reveal owns every block below the fold and force-revealing them
     would turn the whole thing into a no-op. */
  try { html.setAttribute('data-reveal-live', '1'); } catch (err) { /* noop */ }

  if ('IntersectionObserver' in window) {
    try {
      io = new IntersectionObserver((entries, obs) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          obs.unobserve(en.target);
          revealOne(en.target);
        });
      }, { threshold: REVEAL.threshold, rootMargin: REVEAL.rootMargin });
      for (const el of targets) io.observe(el);
    } catch (err) {
      io = null;
    }
  }

  /* No observer (or one that could not be built): show everything. */
  if (!io) revealAll();

  /* In view right now -> right now, not in 700ms. */
  passVisible();
  scheduleSweeps(6);

  /* The intro hands over at 3.6-5.0s and a deep link jumps at the same beat;
     both land after every bounded sweep above has run. */
  const onHandover = () => { passVisible(); scheduleSweeps(4); };
  window.addEventListener('toolapis:intro-complete', onHandover);
  window.addEventListener('load', onHandover, { once: true });
  window.addEventListener('pageshow', onHandover);
  if ('ResizeObserver' in window) {
    try { new ResizeObserver(onHandover).observe(document.body); }
    catch (err) { /* resize + scroll sweeps cover it */ }
  }
  let rafId = 0;
  const onLayout = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; passVisible(); });
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