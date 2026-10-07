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
 * first paint. TRUE means the OS "prefers-reduced-motion: reduce" setting may
 * switch motion off: a visitor who has asked their system for less motion gets
 * none, and the footer Motion button (or ?motion=on) can still override it in
 * the other direction.
 */
export const TUNING = {
  motion: {
    respectReducedMotion: true,
    allowUserToggle: true,
    storageKey: 'toolapis-reduce-motion',
  },
};