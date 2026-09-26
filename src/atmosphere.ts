/* The atmosphere layer: pointer parallax and scroll depth for the background.
   Deliberately not GSAP and deliberately not gated on prefers-reduced-motion.
   It runs on native events and hands plain numbers to CSS custom properties, so
   the browser does the interpolating on the compositor — no requestAnimationFrame,
   no ticker, nothing that stops when a tab is occluded or a machine is slow. */

const docEl = document.documentElement;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const initAtmosphere = (): (() => void) => {
  /* The variables are written here rather than on :root on purpose. A custom
     property on :root is a candidate for inheritance, so a change can dirty
     style for the whole document. Set on the portal, only that element and its
     pseudo-elements can ever be affected, which matters on a 4GB machine. */
  const target = document.querySelector<HTMLElement>("#fallback-portal");
  if (!target) {
    return () => undefined;
  }

  const cache: Record<string, number> = { mx: Number.NaN, my: Number.NaN, sp: Number.NaN };

  /* Quantised so a pointer or scroll event that did not meaningfully move does
     not queue a style recalc. */
  const setVar = (name: string, value: number, precision: number): void => {
    const next = Math.round(value / precision) * precision;
    if (cache[name] === next) {
      return;
    }
    cache[name] = next;
    target.style.setProperty(`--${name}`, String(next));
  };

  /* Pointer normalises to -1..1 across the viewport, so screen centre is a hard
     0 and every CSS translate() term falls back to no offset. */
  const handlePointerMove = (event: PointerEvent): void => {
    setVar("mx", clamp((event.clientX / Math.max(window.innerWidth, 1)) * 2 - 1, -1, 1), 0.01);
    setVar("my", clamp((event.clientY / Math.max(window.innerHeight, 1)) * 2 - 1, -1, 1), 0.01);
  };

  const resetPointer = (): void => {
    setVar("mx", 0, 0.01);
    setVar("my", 0, 0.01);
  };

  const syncScroll = (): void => {
    const scrollable = Math.max(docEl.scrollHeight - window.innerHeight, 1);
    setVar("sp", clamp(window.scrollY / scrollable, 0, 1), 0.001);
  };

  const options: AddEventListenerOptions = { passive: true };
  window.addEventListener("pointermove", handlePointerMove, options);
  window.addEventListener("pointerleave", resetPointer, options);
  window.addEventListener("blur", resetPointer, options);
  window.addEventListener("scroll", syncScroll, options);
  window.addEventListener("resize", syncScroll, options);

  /* Seed every variable so the first paint never sees an empty calc(). */
  resetPointer();
  syncScroll();

  return () => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerleave", resetPointer);
    window.removeEventListener("blur", resetPointer);
    window.removeEventListener("scroll", syncScroll);
    window.removeEventListener("resize", syncScroll);
    target.style.removeProperty("--mx");
    target.style.removeProperty("--my");
    target.style.removeProperty("--sp");
  };
};
