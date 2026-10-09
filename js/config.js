/* ============================================================================
 * config.js — TOOLAPIS · site policy
 * ----------------------------------------------------------------------------
 * This file used to be the 3D layer's tuning surface: object scale, lighting,
 * exposure, the obstacle solver's gutters, the placement variants, the section
 * stops, the palette bridge that read CSS custom properties into Three.js.
 * All of it went with the layer (js/scene3d.js, js/objects.js, js/scroll.js).
 *
 * What is left is the one part of it that the 2D page still depends on: the
 * MOTION POLICY, which js/motion.js reads to decide whether this visitor gets
 * animation at all. It stays here rather than moving into motion.js so the
 * flag keeps one documented home, and so the contract below — the inline
 * <head> bootstrap must agree with it — stays checkable by reading one file.
 *
 * This module has NO imports. It must stay loadable even if everything else on
 * the page fails.
 * ==========================================================================*/

/**
 * Motion policy.
 *
 * `respectReducedMotion` must stay equal to RESPECT_REDUCED_MOTION in the
 * inline <head> bootstrap in index.html, which applies the same classes before
 * first paint.
 *
 * IT IS FALSE, AND IT MUST STAY FALSE. FALSE means the OS
 * "prefers-reduced-motion: reduce" setting has no authority here: a visitor
 * whose machine asks for less motion gets the full animation anyway, and the
 * only way to turn it off is the "Reduce motion" button in the footer and the
 * mobile menu (or `?motion=off`, or a stored preference).
 *
 * Why that is the call: the flag used to be TRUE, and a single
 * `@media (prefers-reduced-motion: reduce)` block in css/animations.css
 * collapsed every animation on the site to a single 1ms iteration. That gave
 * visitors who configured their laptop once, years ago, a dead page with no way
 * to get the design back. The escape hatch exists now, it is one tap, it does
 * not reload the page, and it is announced with `aria-pressed`. See HANDOFF.md
 * for the full decision record; do not flip this back without reading it.
 */
export const TUNING = {
  motion: {
    respectReducedMotion: false,
    allowUserToggle: true,
    storageKey: 'toolapis-reduce-motion',
  },
};