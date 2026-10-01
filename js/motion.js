/* =============================================================================
 * MOTION POLICY — one decision, one place.
 * -----------------------------------------------------------------------------
 * Every animated system on this site (CSS, the intro controller, the scroll
 * reveal, the 3D scene) asks the same question through this module instead of
 * asking the OS. Nothing else in the project is allowed to query
 * `prefers-reduced-motion` directly.
 *
 * Why: an OS-level "reduce motion" is a global accessibility preference, not a
 * statement about this page. Honouring it here meant a visitor whose laptop was
 * configured once, years ago, saw a dead-looking site with no way to get the
 * animation back — the toggle did not exist and no query parameter helped. So
 * motion is ON for everyone, and turning it off is an explicit, visible,
 * reversible choice the visitor makes here.
 *
 * Precedence, highest first:
 *   1. localStorage[storageKey] === 'off'  -> motion OFF   (the footer's switch)
 *   2. localStorage[storageKey] === 'on'   -> motion ON    (explicit override)
 *   3. ?motion=off                          -> motion OFF   (shareable link)
 *   4. ?motion=on                           -> motion ON
 *   5. TUNING.motion.respectReducedMotion === true AND OS says reduce -> OFF
 *   6. otherwise                            -> motion ON
 *
 * Step 5 is the only branch that touches the OS, and it is skipped entirely when
 * respectReducedMotion is false — `matchMedia` is not even constructed. Set
 * TUNING.motion.respectReducedMotion = true to restore OS-following.
 *
 * No dependencies, no top-level side effects, every DOM/storage touch is
 * try/caught: this module is imported by the intro controller, the reveal
 * observer and the 3D scene, and a throw in here would take all three down.
 * ========================================================================== */

import { TUNING } from './config.js';

const POLICY = TUNING.motion || {};

/** The legacy key script.js (read-only for this task) still reads. Kept in sync
 *  by setMotionAllowed() so the vanilla page transitions, its cursor follower
 *  and its Motion-One entrance all agree with the modules. */
const LEGACY_KEY = 'toolapis-motion';

const OS_QUERY = '(prefers-reduced-motion: reduce)';

/** Cache of the last answer, so a repeated motionAllowed() call is cheap and,
 *  more importantly, so every subsystem in one tick sees the same value. */
let cached = null;

/** Subscribers to policy changes. Set-shaped: a repeated register is a no-op. */
const listeners = new Set();

/* ---------------------------------------------------------------------------
 * The three inputs. Each one is allowed to fail.
 * ------------------------------------------------------------------------ */

/** @returns {'on'|'off'|null} the stored preference, or null when unset. */
function storedPreference() {
  try {
    const raw = window.localStorage.getItem(POLICY.storageKey || 'toolapis-reduce-motion');
    if (raw === 'off' || raw === 'on') return raw;
  } catch (e) { /* private mode, disabled storage, quota — not an error here */ }
  return null;
}

/** @returns {'on'|'off'|null} the ?motion= parameter, or null when absent. */
function queryPreference() {
  try {
    const raw = new URL(window.location.href).searchParams.get('motion');
    if (raw === 'off' || raw === 'on') return raw;
  } catch (e) { /* malformed URL — fall through to the default */ }
  return null;
}

/** The only OS read in the entire project. Guarded twice: by the caller's
 *  respectReducedMotion check, and by `matchMedia` existing at all. */
function osPrefersReduced() {
  try {
    if (typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(OS_QUERY).matches === true;
  } catch (e) {
    return false;
  }
}

/* ---------------------------------------------------------------------------
 * The decision
 * ------------------------------------------------------------------------ */

function decide() {
  const explicit = storedPreference();
  if (explicit) return explicit === 'on';

  const param = queryPreference();
  if (param) return param === 'on';

  /* respectReducedMotion === false must not read the OS at all: some privacy
   * configurations make matchMedia queries observable, and the whole point of
   * the flag is that the OS is not a participant in this decision. */
  if (POLICY.respectReducedMotion === true && osPrefersReduced()) return false;

  return true;
}

/**
 * Is motion allowed right now?
 * @returns {boolean} true = animate, false = static/calm.
 */
export function motionAllowed() {
  if (cached === null) cached = decide();
  return cached;
}

/**
 * Persist a choice and notify subscribers.
 *
 * Writes BOTH the new key and the legacy `toolapis-motion` key. script.js is
 * read-only for this task and reads the legacy one at parse time to decide its
 * own `html.reduced-motion` class, so writing both keys is what keeps the
 * vanilla half of the page in agreement with the modules — without editing it.
 *
 * @param {boolean} allowed
 * @returns {boolean} the value that is now in effect.
 */
export function setMotionAllowed(allowed) {
  const next = allowed ? 'on' : 'off';
  cached = allowed;

  try { window.localStorage.setItem(POLICY.storageKey || 'toolapis-reduce-motion', next); } catch (e) {}
  try { window.localStorage.setItem(LEGACY_KEY, next); } catch (e) {}

  /* Keeps the pre-module half of the page (script.js's reveal fallback and
   * page transition) consistent within this tick, before any module runs. */
  applyHtmlClass(allowed);

  for (const cb of Array.from(listeners)) {
    try { cb(allowed); } catch (e) { /* one bad subscriber must not block the rest */ }
  }
  return allowed;
}

/**
 * Subscribe to policy changes (the footer toggle, and any other in-page switch).
 * @param {(allowed: boolean) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onMotionChange(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/* ---------------------------------------------------------------------------
 * The html class, which is what CSS actually keys off.
 *
 * `.motion-on` is the positive form and is what lets a stylesheet scope a
 * motion kill to `html.motion-reduced` alone — including the overrides for
 * Tailwind's `motion-reduce:` utilities, which are keyed off the OS media
 * query and would otherwise switch the site off behind our back.
 * ------------------------------------------------------------------------ */

export const CLASS_ON = 'motion-on';
export const CLASS_REDUCED = 'motion-reduced';
/** The pre-existing name, kept so script.js's own CSS rules keep working. */
export const LEGACY_CLASS = 'reduced-motion';

/**
 * Write the motion classes onto <html>.
 *
 * Always sets both forms explicitly rather than toggling, so a stale class from
 * the inline <head> bootstrap cannot survive a change.
 *
 * @param {boolean} allowed
 */
export function applyHtmlClass(allowed) {
  try {
    const el = document.documentElement;
    if (!el) return;
    el.classList.toggle(CLASS_ON, !!allowed);
    el.classList.toggle(CLASS_REDUCED, !allowed);
    el.classList.toggle(LEGACY_CLASS, !allowed);
    el.setAttribute('data-motion', allowed ? 'on' : 'reduced');
  } catch (e) { /* a document without an element root cannot happen in practice */ }
}

/**
 * Re-read the inputs and, if the answer changed, notify subscribers.
 *
 * Called on `pageshow` and on the OS media query's change event when
 * respectReducedMotion is true — otherwise an OS-level change would have to be
 * picked up on the next navigation, which is not good enough for a preference
 * this visible.
 *
 * @returns {boolean} the value now in effect.
 */
export function refreshMotion() {
  const next = decide();
  if (cached === null) {
    cached = next;
    return next;
  }
  if (next === cached) return cached;

  cached = next;
  applyHtmlClass(next);
  for (const cb of Array.from(listeners)) {
    try { cb(next); } catch (e) {}
  }
  return cached;
}

/**
 * Watch for an OS-level change. A no-op unless respectReducedMotion is true,
 * so the media query object is never even created under the default policy.
 * @returns {() => void} teardown
 */
export function watchOsPreference() {
  if (POLICY.respectReducedMotion !== true) return () => {};
  if (typeof window.matchMedia !== 'function') return () => {};
  let mq;
  try { mq = window.matchMedia(OS_QUERY); } catch (e) { return () => {}; }

  const onChange = () => { refreshMotion(); };
  try {
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onChange);
  } catch (e) {}

  return () => {
    try {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange);
      else if (typeof mq.removeListener === 'function') mq.removeListener(onChange);
    } catch (e) {}
  };
}

/**
 * The footer button's label + pressed state, kept next to the policy so the
 * toggle can never show the wrong thing for the current value.
 * @param {boolean} allowed
 */
export function motionToggleCopy(allowed) {
  return allowed
    ? { label: 'Reduce motion', pressed: false, hint: 'Animation is on' }
    : { label: 'Enable motion', pressed: true, hint: 'Animation is off' };
}

/** The public policy object, for callers that need the storage key. */
export const MOTION_POLICY = POLICY;
