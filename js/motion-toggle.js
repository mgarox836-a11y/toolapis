/* =============================================================================
 * motion-toggle.js — the "Reduce motion" switch.
 * -----------------------------------------------------------------------------
 * Writes the visitor's choice, then makes the page obey it WITHOUT a reload.
 * A reload would be the easy implementation and the wrong one: it re-runs the
 * load choreography, loses scroll position, and is a jarring answer to "please
 * stop moving things".
 *
 * This site animates for EVERY visitor — including anyone whose operating
 * system has asked for less motion, which is deliberately not consulted here
 * (the reasoning is in css/animations.css and the record is in HANDOFF.md).
 * That makes this control the only way out, so it ships twice: once in the
 * footer and once in the mobile menu, where a phone user can reach it without
 * scrolling past four sections. Both are the SAME control — every one is found
 * by class, every one is rendered from the same policy, every one is wired to
 * the same function. Two renderings, one decision.
 *
 * What "without a reload" has to cover, and who owns each piece:
 *   html classes           js/motion.js applyHtmlClass()      (CSS follows free)
 *   Tailwind utilities     js/motion.js stripOsMotionClasses()
 *   hero ambient motion    js/motion-fx.js
 *   hero scene + parallax  js/hero3d.js
 *   widgets, mocks, bgs    js/widgets.js, js/section-mocks.js, js/section-bg.js
 *   reveal / scroll        CSS transitions, which re-resolve on the class flip
 *
 * So this file only has to render the control and call one function; the
 * subsystems already subscribe. That split is deliberate — it means a toggle
 * click cannot half-apply, and it means the second copy in the mobile menu
 * cannot drift out of sync with the first.
 *
 * Two safety properties are worth stating, because a motion switch is exactly
 * the kind of control that has to behave when things are going wrong:
 *   - every failure path leaves every button showing the CURRENT policy, not
 *     the one the visitor asked for, because a control that lies is worse than
 *     one that fails quietly;
 *   - nothing here introduces a loop, so no flashing or strobing is possible
 *     (the whole flip is one class write and a re-render of four properties).
 * ========================================================================== */

import {
  motionAllowed,
  setMotionAllowed,
  onMotionChange,
  motionToggleCopy,
  applyHtmlClass,
  stripOsMotionClasses,
} from './motion.js';

/* The one icon codepoint swap. Kept here rather than in CSS so the button's
   visible state is derived from the policy in exactly one place. */
const ICON_PLAY = 'waveform';
const ICON_PAUSE = 'pause';

/**
 * Paint one control from the current policy.
 * @param {HTMLElement} btn
 * @param {boolean} allowed
 */
function render(btn, allowed) {
  const copy = motionToggleCopy(allowed);
  btn.setAttribute('aria-pressed', copy.pressed ? 'true' : 'false');
  /* The accessible name is the label text, so it has to be the action. */
  const label = btn.querySelector('.motion-toggle-label');
  if (label) label.textContent = copy.label;
  /* `title` is the pointer-user's version of the same information; screen
     readers get aria-pressed, so this is not duplicated for them. */
  btn.setAttribute('title', `${copy.label} — ${copy.hint}`);
  btn.setAttribute('data-motion-state', allowed ? 'on' : 'off');

  const icon = btn.querySelector('.motion-toggle-icon');
  if (icon) {
    /* The glyph is a sprite <use>, so the state swap is a repointed href. The
       old icon-font path swapped `ph-*` classes and needed a CSS `content`
       fallback in case the webfont failed; with the sprite inline there is no
       second way for it to fail, so that fallback is gone too. */
    const use = icon.tagName.toLowerCase() === 'use' ? icon : icon.querySelector('use');
    const glyph = allowed ? ICON_PLAY : ICON_PAUSE;
    try {
      if (use) use.setAttribute('href', '#i-' + glyph);
      else icon.innerHTML = '<use href="#i-' + glyph + '"></use>';
    } catch (e) {}
  }
}

function init() {
  /* By CLASS, not by id. There are two of these — footer and mobile menu — and
     an id lookup would silently wire only whichever came first in the DOM,
     which is the kind of bug that survives review because the button you
     tested is the one that happens to be there. */
  const btns = Array.from(document.querySelectorAll('.motion-toggle'));
  if (!btns.length) return;

  /* First paint reflects the real policy, including a ?motion=off or a stored
     "off" from a previous visit. */
  const initial = motionAllowed();
  applyHtmlClass(initial);
  stripOsMotionClasses(initial);
  btns.forEach((btn) => render(btn, initial));

  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      /* Re-read rather than invert a remembered value: storage can be changed
         in another tab, and the value can be set by ?motion=off. */
      setMotionAllowed(!motionAllowed());
    }, false);
  });

  /* Keyboard parity is free on a <button> (Enter and Space both fire click),
     and so is touch parity — the mobile-menu copy is a real button with the
     same 44px min-height as the footer one, not an icon-only <div> that needs
     a custom tap handler. There is no page reload on either path, so the
     effect is immediate and visible rather than deferred to the next visit. */
  onMotionChange((allowed) => {
    btns.forEach((btn) => render(btn, allowed));
  });

  /* Expose the one thing a test (or the console) needs, without making the
     control itself part of any public API. */
  try {
    window.__motionToggle = {
      get state() { return motionAllowed() ? 'on' : 'off'; },
      set: (v) => setMotionAllowed(!!v),
      get buttons() { return btns.slice(); },
    };
  } catch (e) {}
}

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
} catch (e) { /* the page keeps animating; only the control is missing */ }
