/* =============================================================================
 * motion-boot.js — wires the policy once, at startup.
 *
 * A module in its own right purely so it can `import` js/motion.js. The inline
 * <head> bootstrap in index.html already applied the html classes before the
 * first paint; this file exists for the three things that must happen after the
 * document is parsed:
 *
 *   1. re-apply the classes (cheap, and it repairs anything the bootstrap
 *      could not see yet);
 *   2. strip Tailwind's `motion-reduce:` / `motion-safe:` utilities while
 *      motion is on, so the OS media query cannot switch the site off behind
 *      the policy's back;
 *   3. (there is no third step any more).
 *
 * Step 3 used to subscribe to the OS media query so a visitor changing their
 * system setting mid-session was followed live. It is gone because this site
 * does not consult that setting at all — see js/motion.js for the decision and
 * the reasoning — and there is nothing else that can change the answer without
 * the visitor pressing the button.
 *
 * Nothing here throws by construction, and if this file never runs, the
 * controllers that matter (reveal, hero ambient motion, widgets, section
 * backgrounds) each fall back to the html class the inline bootstrap set, so
 * the worst case is "the policy is not re-applied after parse", not a broken
 * page.
 * ========================================================================== */

import { initMotionPolicy } from './motion.js';

initMotionPolicy();
