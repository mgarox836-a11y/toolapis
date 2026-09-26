/* Pure pointer-motion helpers.

   Deliberately free of DOM, gsap and listeners: motion.ts used to own the whole
   scroll narrative, and now that the portal scene and the magnetic hover are
   gone it is down to the one geometry function the custom cursor still needs.
   Keeping it dependency-free is also what lets the node test runner import it. */

export interface PortalSceneState {
  progress: number;
}

export const getMagneticOffset = (
  pointerX: number,
  pointerY: number,
  elementX: number,
  elementY: number,
  strength: number,
  maxDistance: number,
) => {
  const x = (pointerX - elementX) * strength;
  const y = (pointerY - elementY) * strength;
  const distance = Math.hypot(x, y);

  if (distance <= maxDistance) {
    return { x, y };
  }

  const scale = maxDistance / distance;
  return { x: x * scale, y: y * scale };
};
