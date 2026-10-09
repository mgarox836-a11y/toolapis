/* =============================================================================
 * MOTION POLICY — one decision, one place.
 * -----------------------------------------------------------------------------
 * Every animated system on this site (CSS, the load choreography, the scroll
 * reveal, the section backgrounds, the hero scene) asks the same question
 * through this module. Nothing else in the project is allowed to answer it for
 * itself, and nothing is allowed to ask the OS.
 *
 * THE OS IS NOT ASKED. There is no `prefers-reduced-motion` query anywhere in
 * this file, and there is no `@media (prefers-reduced-motion: reduce)` block in
 * any stylesheet. That is the whole point of this module now.
 *
 * Why: an OS-level "reduce motion" is a global preference for the desktop, not
 * a statement about this page. Honouring it here meant a visitor whose laptop
 * was configured once, years ago, saw a dead-looking site — every loop
 * collapsed to one 1ms iteration by a single `html:not(.motion-on) *` rule —
 * and there was no way to get the animation back, because the control that
 * could restore it did not exist yet. So motion is ON for everyone, and turning
 * it off is an explicit, visible, reversible choice the visitor makes HERE.
 *
 * Precedence, highest first:
 *   1. stored preference (localStorage, then sessionStorage) === 'off' -> OFF
 *   2. stored preference === 'on'                                  -> ON
 *   3. ?motion=off                                                 -> OFF
 *   4. ?motion=on                                                  -> ON
 *   5. otherwise                                                   -> ON
 *
 * There is no sixth branch. `matchMedia` is not constructed, so the media query
 * is not observable and cannot be changed under us mid-session.
 *
 * No dependencies, no top-level side effects, every DOM/storage touch is
 * try/caught: this module is imported by the reveal observer, the hero ambient
 * motion, the widgets, the section backgrounds and the mocks, and a throw in
 * here would take all five down.
 * ========================================================================== */

import { TUNING } from './config.js';

const POLICY = TUNING.motion || {};

/** The legacy key script.js (read-only for this task) still reads. Kept in sync
 *  by setMotionAllowed() so the vanilla page transitions, its cursor follower
 *  and its Motion-One entrance all agree with the modules. */
const LEGACY_KEY = 'toolapis-motion';

/** Cache of the last answer, so a repeated motionAllowed() call is cheap and,
 *  more importantly, so every subsystem in one tick sees the same value. */
let cached = null;

/** Subscribers to policy changes. Set-shaped: a repeated register is a no-op. */
const listeners = new Set();

/* ---------------------------------------------------------------------------
 * The three inputs. Each one is allowed to fail.
 * ------------------------------------------------------------------------ */

/** Reads one key out of storage, trying localStorage then sessionStorage.
 *
 *  localStorage throws outright in some privacy modes and when a page is opened
 *  from a file:// origin; sessionStorage throws in a narrower set. A third
 *  storage read is not attempted: if both are refused the toggle still works,
 *  it just does not remember, which is the correct failure — a visitor is never
 *  left with a control that does nothing.
 *
 *  @param {string} key
 *  @returns {'on'|'off'|null} the stored preference, or null when unset/unreadable.
 */
function readStored(key) {
  for (const store of ['localStorage', 'sessionStorage']) {
    try {
      const raw = window[store].getItem(key);
      if (raw === 'off' || raw === 'on') return raw;
    } catch (e) { /* try the next one */ }
  }
  return null;
}

/** Writes one key to whichever storage the browser will accept, plus the legacy
 *  key script.js reads. Both are best-effort and neither throws.
 *  @param {string} key
 *  @param {'on'|'off'} value
 */
function writeStored(key, value) {
  for (const store of ['localStorage', 'sessionStorage']) {
    try { window[store].setItem(key, value); } catch (e) { /* try the next one */ }
  }
}

/** @returns {'on'|'off'|null} the ?motion= parameter, or null when absent. */
function queryPreference() {
  try {
    const raw = new URL(window.location.href).searchParams.get('motion');
    if (raw === 'off' || raw === 'on') return raw;
  } catch (e) { /* malformed URL — fall through to the default */ }
  return null;
}

/* ---------------------------------------------------------------------------
 * The decision
 * ------------------------------------------------------------------------ */

function decide() {
  const explicit = readStored(POLICY.storageKey || 'toolapis-reduce-motion');
  if (explicit) return explicit === 'on';

  const param = queryPreference();
  if (param) return param === 'on';

  /* Motion on by default. Not a fallback — the answer, for every visitor whose
     OS asked for less motion and who did not press the button. */
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
 * Writes BOTH the new key and the legacy `toolapis-motion` key, to both
 * storages. script.js reads the legacy one at parse time to decide its own
 * `html.reduced-motion` class, so writing both keys is what keeps the vanilla
 * half of the page in agreement with the modules — without editing it.
 *
 * @param {boolean} allowed
 * @returns {boolean} the value that is now in effect.
 */
export function setMotionAllowed(allowed) {
  const next = allowed ? 'on' : 'off';
  cached = allowed;

  writeStored(POLICY.storageKey || 'toolapis-reduce-motion', next);
  writeStored(LEGACY_KEY, next);

  /* Keeps the pre-module half of the page (script.js's reveal fallback and
   * page transition) consistent within this tick, before any module runs. */
  applyHtmlClass(allowed);
  stripOsMotionClasses(allowed);

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
 * `.motion-on` is the positive form and is what every stylesheet scopes against.
 * `.motion-reduced` can now ONLY be set by the visitor pressing the button (or
 * `?motion=off`, or a stored preference) — there is no OS path to it any more,
 * so a stylesheet keyed on that class is keyed on a human decision.
 *
 * `data-motion` is the machine-readable twin, and its values are the plain words
 * `on` and `off` rather than `on`/`reduced`. Two reasons: `off` is what the
 * control's `aria-pressed` says, so the attribute and the accessibility tree
 * cannot disagree; and no stylesheet keys on it (they key on the class), so
 * nothing can be broken by the rename. tools/check-motion.mjs asserts both
 * values literally.
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
    el.setAttribute('data-motion', allowed ? 'on' : 'off');
  } catch (e) { /* a document without an element root cannot happen in practice */ }
}

/**
 * Re-read the inputs and, if the answer changed, notify subscribers.
 *
 * Called on `pageshow` and whenever the stored preference could have changed
 * underneath us (another tab, or a bfcache restore). There is no media-query
 * listener any more: with the OS out of the decision there is nothing that can
 * change it mid-session except this visitor.
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
 * The control's label + pressed state, kept next to the policy so the toggle
 * can never show the wrong thing for the current value.
 *
 * The label is always the ACTION ("Reduce motion" / "Enable motion") because it
 * is also the button's accessible name, and a name that describes the current
 * state rather than the effect is announced as a control whose purpose changes
 * under the user.
 *
 * @param {boolean} allowed
 */
export function motionToggleCopy(allowed) {
  return allowed
    ? { label: 'Reduce motion', pressed: false, hint: 'Animation is on. Turn off if motion bothers you.' }
    : { label: 'Enable motion', pressed: true, hint: 'Animation is off. Turn it back on any time.' };
}

/**
 * Remove Tailwind's OS-keyed motion utilities from the live DOM.
 *
 * `motion-reduce:animate-none` and friends compile to a prefers-reduced-motion
 * media query. A stylesheet cannot cancel those generically — the query sets a
 * declaration whose value we cannot know — so the class is removed instead,
 * which stops the query from ever matching. `motion-safe:` goes too, because its
 * rules only apply when the OS has NOT asked for reduced motion, and under this
 * policy the OS's answer is not one of the inputs.
 *
 * The Tailwind CDN itself was removed from this page in the DESIGN.md rebuild
 * (`tools/design-check.mjs` asserts its absence), so on today's markup this
 * sweep finds nothing. It is kept as a cheap safety net rather than deleted,
 * because its cost is bounded — it only fires on a switch to motion-on and on
 * DOMContentLoaded — and because a future page that reintroduces Tailwind would
 * otherwise silently hand the OS a vote it no longer has.
 *
 * Class names are kept (not merely blanked) on `el.dataset.motionRemoved` so
 * nothing is silently destroyed, and re-running is a no-op.
 *
 * @param {boolean} allowed
 */
export function stripOsMotionClasses(allowed) {
  try {
    if (!allowed) return 0;
    const prefix = /(^|\s)(motion-(reduce|safe):[^\s]+)/g;
    const roots = [document.documentElement, document.body];
    /* The document is fully parsed by the time any caller with motion-on runs,
       except the DOMContentLoaded path — hence the second sweep. */
    if (document.querySelectorAll) {
      try { roots.push(...document.querySelectorAll('*')); } catch (e) {}
    }

    let stripped = 0;
    for (const el of roots) {
      if (!el || !el.classList) continue;
      const doomed = [];
      for (const cls of Array.from(el.classList)) {
        prefix.lastIndex = 0;
        if (prefix.test(' ' + cls)) doomed.push(cls);
      }
      if (!doomed.length) continue;
      try { el.classList.remove(...doomed); } catch (e) { continue; }
      stripped += doomed.length;
      try {
        el.setAttribute('data-motion-stripped', doomed.join(' '));
      } catch (e) {}
    }
    return stripped;
  } catch (e) {
    return 0;
  }
}

/** One-shot wiring: strip after parse, and keep the pageshow path honest.
 *  Safe to call repeatedly. */
export function initMotionPolicy() {
  applyHtmlClass(motionAllowed());
  stripOsMotionClasses(motionAllowed());

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        stripOsMotionClasses(motionAllowed());
      }, { once: true });
    }
  } catch (e) {}
  return cached;
}

/** The public policy object, for callers that need the storage key. */
export const MOTION_POLICY = POLICY;
