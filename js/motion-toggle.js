/* =============================================================================
 * motion-toggle.js — the footer's "Motion" button.
 * -----------------------------------------------------------------------------
 * Writes the visitor's choice, then makes the page obey it WITHOUT a reload.
 * A reload would be the easy implementation and the wrong one: it re-runs the
 * 5s intro, loses scroll position, and is a jarring answer to "please stop
 * moving things".
 *
 * What "without a reload" has to cover, and who owns each piece:
 *   html classes           js/motion.js applyHtmlClass()      (CSS follows free)
 *   Tailwind utilities     js/motion.js stripOsMotionClasses()
 *   3D layer               js/scene3d.js onMotionPolicyChange()
 *   reveals / scroll       CSS transitions, which re-resolve on the class flip
 *
 * So this file only has to render the control and call one function; the
 * subsystems already subscribe. That split is deliberate — it means a toggle
 * click cannot half-apply.
 *
 * Two safety properties are worth stating, because a motion switch is exactly
 * the kind of control that has to behave when things are going wrong:
 *   - every failure path leaves the button showing the CURRENT policy, not the
 *     one the visitor asked for, because a control that lies is worse than one
 *     that fails quietly;
 *   - nothing here introduces a loop, so no flashing or strobing is possible
 *     (the whole flip is one class write and one re-render of a 4-property
 *     style).
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
 * Paint the control from the current policy.
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
  btn.setAttribute('data-motion-state', allowed ? 'on' : 'reduced');

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
  const btn = document.getElementById('motion-toggle');
  if (!btn) return;

  /* First paint reflects the real policy, including a ?motion=off or a stored
     "off" from a previous visit. */
  const initial = motionAllowed();
  applyHtmlClass(initial);
  stripOsMotionClasses(initial);
  render(btn, initial);

  btn.addEventListener('click', () => {
    /* Re-read rather than invert a remembered value: localStorage can be
       changed in another tab, and the class can be changed by ?motion=off. */
    setMotionAllowed(!motionAllowed());
  }, false);

  /* Keyboard parity is free on a <button> (Enter and Space both fire click),
     but the reduced-motion intro is skipped on the NEXT load only — the intro
     cannot be re-run mid-page without the 5s sequence restarting. The label
     says "Reduce motion", so an immediate, visible effect is expected; the
     intro skip is documented in the button's title via the hint below. */
  onMotionChange((allowed) => { render(btn, allowed); });

  /* Expose the one thing a test (or the console) needs, without making the
     control itself part of any public API. */
  try {
    window.__motionToggle = {
      get state() { return motionAllowed() ? 'on' : 'reduced'; },
      set: (v) => setMotionAllowed(!!v),
      el: btn,
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
