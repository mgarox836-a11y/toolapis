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
 *   3. subscribe to OS changes — a no-op unless
 *      TUNING.motion.respectReducedMotion is true.
 *
 * Nothing here throws by construction, and if this file never runs the three
 * controllers that matter (intro, reveal, scene3d) each fall back to the html
 * class the bootstrap set, so the worst case is "no live toggle of OS changes",
 * not a broken page.
 * ========================================================================== */

import { initMotionPolicy } from './motion.js';

initMotionPolicy();
