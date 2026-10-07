/* =============================================================================
   WIDGETS — js/widgets.js
   -----------------------------------------------------------------------------
   Four independent behaviours that the page's markup declares but CSS alone
   cannot drive:

     • BEFORE/AFTER SLIDER  the enhancer's comparison (a real range input)
     • TYPEWRITER          the tethering terminal
     • ACTIVITY FEED       the social card's git-timeline rows
     • ACCORDION           the clarity questions
     • plus two small ones: the cursor spotlight inside bento cards, and the
       scroll-drawn flow connector.

   DESIGN RULES EVERY ONE OF THESE OBEYS
   -----------------------------------------------------------------------------
   * PAUSE OFF-SCREEN AND ON A HIDDEN TAB. Every loop is an IntersectionObserver
     plus a visibilitychange listener. An animation nobody is looking at is
     still burning a frame.
   * REDUCED MOTION IS A FINISHED STATE, NOT A STOPPED ONE. When motion is off
     the slider shows its default position, the terminal shows its full text,
     the feed shows its seed rows and the connector is drawn to the end. Never
     a half-typed line or an empty list.
   * FAIL SOFT. Every block is individually guarded and every timer is tracked,
     so a failure here costs one effect and never the page.

   ANIMATION BUDGET: transform and opacity only. The slider writes clip-path
   (compositor-friendly), the feed translates, and nothing else moves.
   ========================================================================== */

import { motionAllowed, onMotionChange } from './motion.js';

/* ==========================================================================
   SHARED — one observer for "is anything still worth animating"
   ========================================================================== */

let reduceMotion = !motionAllowed();

/* Timers created by this module, so a teardown can clear every one of them.
   Without this, a re-init (motion toggle) would stack duplicate intervals. */
const timers = new Set();
const teardown = [];

function every(ms, fn) {
  const id = setInterval(() => { if (!reduceMotion) fn(); }, ms);
  timers.add(id);
  return id;
}
function after(ms, fn) {
  const id = setTimeout(fn, ms);
  timers.add(id);
  return id;
}
function stopAll() {
  timers.forEach((id) => { clearInterval(id); clearTimeout(id); });
  timers.clear();
}

const cleanups = [];
function onCleanup(fn) { cleanups.push(fn); }

/* One IntersectionObserver shared by every widget that needs to know whether it
   is worth running. Each entry gets its own listener list. */
const visibilitySubs = new Map();
let visObserver = null;

function whenVisible(el, fn) {
  if (!('IntersectionObserver' in window)) { fn(true); return; }
  if (!visObserver) {
    visObserver = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const subs = visibilitySubs.get(en.target);
        if (subs) subs.forEach((cb) => cb(en.isIntersecting));
      });
    }, { threshold: 0, rootMargin: '64px 0px' });
  }
  if (!visibilitySubs.has(el)) {
    visibilitySubs.set(el, []);
    visObserver.observe(el);
  }
  visibilitySubs.get(el).push(fn);
}

/* One document-level visibility gate, so N widgets cost one listener. */
let docVisible = !document.hidden;
const docSubs = [];
document.addEventListener('visibilitychange', () => {
  docVisible = !document.hidden;
  docSubs.forEach((fn) => fn(docVisible));
});
function whenTabVisible(fn) { docSubs.push(fn); }

/* Convenience: "should I be animating right now?" for a given element. */
const running = new WeakMap();
function trackRunning(el) {
  const state = { onScreen: true, tab: true, get() { return this.onScreen && this.tab && !reduceMotion; } };
  running.set(el, state);
  whenVisible(el, (v) => { state.onScreen = v; });
  whenTabVisible((v) => { state.tab = v; });
  return state;
}
function isRunning(el) {
  const s = running.get(el);
  return s ? s.get() : !reduceMotion;
}

/* ==========================================================================
   1 · BEFORE / AFTER SLIDER
   --------------------------------------------------------------------------
   The visible divider is driven by a real <input type="range">, so pointer
   drag, keyboard arrows, Home/End and screen-reader announcement all come for
   free. All this does is mirror its value into --ba and keep the layers in sync.
   ========================================================================== */
document.querySelectorAll('[data-ba]').forEach((input) => {
  const frame = input.closest('.ba');
  if (!frame) return;

  const paint = () => {
    frame.style.setProperty('--ba', input.value + '%');
  };

  /* `input` fires on every drag step; `change` only on release. */
  input.addEventListener('input', paint);
  paint();

  /* No transition while dragging: a lag between the thumb and the split point
     is what makes a comparison slider feel broken. */
  input.addEventListener('pointerdown', () => {
    frame.classList.add('is-dragging');
  });
  const release = () => frame.classList.remove('is-dragging');
  input.addEventListener('pointerup', release);
  input.addEventListener('pointercancel', release);
  input.addEventListener('blur', release);
});

/* ==========================================================================
   2 · TYPEWRITER TERMINAL
   --------------------------------------------------------------------------
   Types each [data-type] element's text one character at a time, in order,
   then holds. Under reduced motion the markup's full text is simply left
   alone — so the terminal always reads as a finished terminal.

   The caret is appended to the line currently being typed and moved along, so
   it never jumps to a detached node.
   ========================================================================== */
document.querySelectorAll('[data-terminal]').forEach((term) => {
  const targets = Array.from(term.querySelectorAll('[data-type]'));
  if (!targets.length) return;

  const state = trackRunning(term);

  /* Snapshot the real strings first, so a second pass through this function
     cannot type an already-half-typed element from its own output. The
     snapshot is kept on the element as data-final, which is what
     restoreAll() reads to put the terminal back in its finished state. */
  const lines = targets.map((el) => {
    const text = el.textContent || '';
    el.dataset.final = text;
    return { el, text };
  });

  const caret = document.createElement('span');
  caret.className = 'terminal__caret';
  caret.setAttribute('aria-hidden', 'true');

  let step = 0;
  let charIndex = 0;
  let current = null;
  let job = null;

  const clearCaret = () => { if (caret.parentNode) caret.parentNode.removeChild(caret); };

  function typeOne() {
    if (current && charIndex >= current.text.length) {
      /* Write the line out in full before moving on. The loop below paints
         slice(0, charIndex) and THEN increments, so by the time the completion
         check runs the last character has been painted exactly once — reading
         textContent back here would be measuring a value this function owns,
         and getting it wrong leaves every line one character short. */
      current.el.textContent = current.text;
      clearCaret();
      current = null;
      after(320, () => { step += 1; runStep(); });
      return;
    }

    if (!current) {
      current = lines[step];
      if (!current) { job = null; return; }
      charIndex = 0;
      current.el.textContent = '';
    }

    current.el.textContent = current.text.slice(0, charIndex);
    current.el.appendChild(caret);
    charIndex += 1;

    /* ~34ms per character reads as typing without being mechanical. Slower on
       punctuation, which is where a real typist pauses anyway. */
    const ch = current.text[charIndex - 1] || ' ';
    const delay = '.,:;'.indexOf(ch) !== -1 ? 220 : 34;
    job = after(delay, typeOne);
  }

  function runStep() {
    if (step >= lines.length) { job = null; return; }
    job = after(420, typeOne);
  }

  function start() {
    if (job !== null || !state.get()) return;
    runStep();
  }
  function stop() {
    if (job !== null) { clearTimeout(job); timers.delete(job); job = null; }
  }

  /* Restore the finished state. Called on init (when motion is off) and
     whenever the visitor turns motion back off. */
  function finish() {
    stop();
    clearCaret();
    lines.forEach(({ el, text }) => { el.textContent = text; });
    step = lines.length;
  }

  if (reduceMotion) finish(); else start();

  onCleanup(() => { stop(); clearCaret(); });

  /* Restart the loop only after it has genuinely finished, so toggling motion
     off and on does not interleave two typewriters. */
  whenVisible(term, () => { if (state.get() && step >= lines.length) { step = 0; lines.forEach(({el}) => { el.textContent = ''; }); start(); } });
});

/* ==========================================================================
   3 · ACTIVITY FEED
   --------------------------------------------------------------------------
   A git-timeline list: hairline rail, 8px node per row, status dot on the
   right. Every three seconds a new row arrives at the top and the oldest is
   evicted, so the card reads as a live log rather than a static screenshot.

   TOOLAPIS-flavoured sample data. `aria-live="off"` on the container is
   deliberate: a log that pushes a new row every three seconds would otherwise
   interrupt a screen reader forever.
   ========================================================================== */
const FEED_ITEMS = [
  { title: 'clip_0412.mp4 → 1080p', meta: 'HD Enhancer · just now',     status: 'pass', tag: 'TK' },
  { title: 'usb0 connected',        meta: 'Tethering · moments ago',     status: 'done', tag: 'USB' },
  { title: 'link shared',           meta: 'Social Hub · moments ago',    status: 'pass', tag: 'SM' },
  { title: 'clip_0388.mp4 queued',  meta: 'Enhancer · moments ago',      status: 'warn', tag: 'HD' },
  { title: 'batch of 12 clipped',   meta: 'HD Enhancer · moments ago',   status: 'pass', tag: 'TK' },
  { title: 'rndis0 detached',       meta: 'Tethering · moments ago',     status: 'warn', tag: 'USB' },
  { title: 'short link copied',     meta: 'Social Hub · moments ago',    status: 'done', tag: 'SM' },
  { title: 'clip_0391.mp4 → 1080p', meta: 'HD Enhancer · moments ago',   status: 'pass', tag: 'TK' }
];

/* How many rows are visible. Matches the four seeded in the markup, so the
   first swap does not change the card's height. */
const FEED_VISIBLE = 4;

document.querySelectorAll('[data-feed]').forEach((feed) => {
  const state = trackRunning(feed);
  let cursor = FEED_ITEMS.length;
  let job = null;

  const buildRow = (item, animate) => {
    const row = document.createElement('div');
    row.className = 'feed__row' + (animate ? ' feed__row--in' : '');
    row.setAttribute('data-status', item.status);

    const rail = document.createElement('span');
    rail.className = 'feed__rail';
    rail.setAttribute('aria-hidden', 'true');
    const node = document.createElement('span');
    node.className = 'feed__node';
    rail.appendChild(node);

    const avatar = document.createElement('span');
    avatar.className = 'feed__avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = item.tag;

    const body = document.createElement('span');
    body.className = 'feed__body';
    const title = document.createElement('span');
    title.className = 'feed__title';
    title.textContent = item.title;
    const meta = document.createElement('span');
    meta.className = 'feed__meta';
    meta.textContent = item.meta;
    body.appendChild(title);
    body.appendChild(meta);

    const dot = document.createElement('span');
    dot.className = 'feed__dot';
    dot.setAttribute('aria-hidden', 'true');

    row.appendChild(rail);
    row.appendChild(avatar);
    row.appendChild(body);
    row.appendChild(dot);
    return row;
  };

  function push() {
    const item = FEED_ITEMS[cursor % FEED_ITEMS.length];
    cursor += 1;
    feed.insertBefore(buildRow(item, true), feed.firstChild);
    /* Evict from the bottom so the card's height never changes — a feed that
       reflows every three seconds is the kind of thing that makes a page feel
       unstable. */
    while (feed.children.length > FEED_VISIBLE) {
      feed.removeChild(feed.lastElementChild);
    }
  }

  function start() { if (job === null) job = every(3000, push); }
  function stop() {
    if (job !== null) { clearInterval(job); timers.delete(job); job = null; }
  }

  if (!reduceMotion) start();
  onCleanup(stop);
});

/* ==========================================================================
   4 · ACCORDION
   --------------------------------------------------------------------------
   Height animation lives in CSS (grid-template-rows 0fr -> 1fr), so there is
   no measurement here and nothing to get wrong on resize. This only manages
   the state class and aria-expanded.
   ========================================================================== */
document.querySelectorAll('[data-acc]').forEach((acc) => {
  const items = Array.from(acc.querySelectorAll('.acc__item'));

  items.forEach((item) => {
    const btn = item.querySelector('.acc__btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const open = item.classList.contains('is-open');
      item.classList.toggle('is-open', !open);
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
    });

    /* Under reduced motion CSS already kills the height transition, so opening
       is instant. Nothing extra to do — which is the point of doing the
       animation in CSS. */
  });

  /* Roving arrow-key navigation between the questions, which is what a group
     of buttons is expected to support once it is more than one. */
  acc.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const btns = items.map((i) => i.querySelector('.acc__btn')).filter(Boolean);
    const at = btns.indexOf(document.activeElement);
    if (at === -1) return;
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? (at + 1) % btns.length : (at - 1 + btns.length) % btns.length;
    btns[next].focus();
  });
});

/* ==========================================================================
   5 · CARD SPOTLIGHT
   --------------------------------------------------------------------------
   A 6% white radial that follows the pointer inside a bento card, written to
   --mx/--my. One rAF for the whole page, one pointermove listener, and the
   write is skipped entirely when the pointer has not moved.

   This is a light source the card appears to be lit by, not an elevation
   effect: DESIGN.md forbids drop shadows on cards, and this adds none.
   ========================================================================== */
const spotCards = Array.from(document.querySelectorAll('.spot-card'));
if (spotCards.length && !('ontouchstart' in window)) {
  let active = null, mx = 0, my = 0, queued = false;

  spotCards.forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      active = card;
      mx = ((e.clientX - r.left) / r.width) * 100;
      my = ((e.clientY - r.top) / r.height) * 100;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (active) active.style.setProperty('--mx', mx.toFixed(1) + '%');
        if (active) active.style.setProperty('--my', my.toFixed(1) + '%');
      });
    }, { passive: true });
  });
  onCleanup(() => { active = null; });
}

/* ==========================================================================
   6 · FLOW CONNECTOR
   --------------------------------------------------------------------------
   An SVG path whose stroke-dashoffset is bound to the section's scroll
   progress, so the line draws itself as the section comes up. The path length
   is read from the element at runtime (getTotalLength) rather than guessed,
   because the viewBox scales with the container.

   The active step gets the pulsing dot. Under reduced motion the trace is set
   to fully drawn and every step is marked active — the end state, not a
   half-drawn line.
   ========================================================================== */
document.querySelectorAll('[data-flow]').forEach((flow) => {
  const trace = flow.querySelector('[data-flow-trace]');
  const steps = Array.from(flow.querySelectorAll('[data-flow-step]'));
  if (!steps.length) return;

  trackRunning(flow);

  let len = 0;
  const measure = () => {
    if (!trace || typeof trace.getTotalLength !== 'function') return;
    try { len = trace.getTotalLength(); } catch (err) { len = 0; }
    if (!len) return;
    /* Written to the flow element, not the trace, so the CSS length and the
       JS offset can never disagree. */
    flow.style.setProperty('--flow-len', String(Math.ceil(len)));
  };

  measure();
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => measure());
    ro.observe(flow);
    onCleanup(() => ro.disconnect());
  } else {
    window.addEventListener('resize', measure, { passive: true });
    onCleanup(() => window.removeEventListener('resize', measure));
  }

  function setActive(i) {
    steps.forEach((s, n) => s.classList.toggle('is-active', n === i));
  }

  function update() {
    if (reduceMotion) return;
    const r = flow.getBoundingClientRect();
    if (!r.height) return;
    /* 0 when the section's top reaches the viewport bottom, 1 when its bottom
       passes the viewport's middle. Drawn across the middle two-thirds so it
       starts and ends on a still frame. */
    const start = window.innerHeight - r.height * 0.4;
    const end = window.innerHeight * 0.55 - r.top;
    const span = Math.max(1, end - start);
    let p = (r.top - start) / span;
    p = Math.max(0, Math.min(1, p));

    if (trace && len) trace.style.strokeDashoffset = String(len * (1 - p));

    const idx = Math.min(steps.length - 1, Math.floor(p * steps.length));
    setActive(idx);
  }

  if (reduceMotion) {
    if (trace && len) trace.style.strokeDashoffset = '0';
    steps.forEach((s) => s.classList.add('is-active'));
  } else {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; update(); });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onCleanup(() => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    });
    update();
  }
});

/* ==========================================================================
   7 · MOCK WINDOW SHINE
   --------------------------------------------------------------------------
   A single horizontal shine that crosses each mock once, when it first arrives.
   The class is added once and never removed, so it cannot re-run on every
   scroll past.
   ========================================================================== */
document.querySelectorAll('[data-mock]').forEach((mock) => {
  if (!('IntersectionObserver' in window)) { mock.classList.add('is-shown'); return; }
  new IntersectionObserver((entries, obs) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('is-shown');
      obs.unobserve(en.target);
    });
  }, { threshold: 0.35 }).observe(mock);
});

/* ==========================================================================
   TEARDOWN — restores every widget to its finished state
   ========================================================================== */
function restoreAll() {
  /* Terminals and connectors are the two that hold a partial state. */
  document.querySelectorAll('[data-terminal] [data-type]').forEach((el) => {
    el.textContent = el.dataset.final || el.textContent;
  });
  document.querySelectorAll('[data-flow]').forEach((flow) => {
    const trace = flow.querySelector('[data-flow-trace]');
    if (trace) trace.style.strokeDashoffset = '0';
    flow.querySelectorAll('[data-flow-step]').forEach((s) => s.classList.add('is-active'));
  });
}

onMotionChange((allowed) => {
  reduceMotion = !allowed;
  if (reduceMotion) {
    stopAll();
    restoreAll();
  }
});

/* Release every listener and timer if the page is being torn down. */
window.addEventListener('pagehide', () => {
  stopAll();
  cleanups.forEach((fn) => { try { fn(); } catch (err) { /* noop */ } });
  cleanups.length = 0;
});
