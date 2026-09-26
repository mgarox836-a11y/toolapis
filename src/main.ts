import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";

import { gsap } from "gsap";
import { initAtmosphere } from "./atmosphere";
import { initMotion } from "./motion";
import type { MotionController } from "./motion";
import { createPortalExperience, isFinePointer } from "./portal";

const canvas = document.querySelector<HTMLCanvasElement>("#webgl-canvas");
const sceneState = { progress: 0 };
/* The scene is never gated on the motion preference any more: with motion off it
   renders a frozen opening frame, which is more useful than a blank canvas. */
const portal = canvas ? createPortalExperience(canvas, sceneState) : null;
const render = (timeSeconds: number): void => {
  portal?.render(timeSeconds);
};

/* The scene starts before the motion layer and is independent of it: they only
   ever share sceneState.progress, which is 0 until motion takes over. */
if (portal) {
  gsap.ticker.add(render);
  portal.setSuspended(document.hidden);
}

/* Motion is progressive enhancement. If it throws, the page and the portal
   still work — they simply stop moving. */
let motion: MotionController | null = null;
try {
  motion = initMotion(sceneState);
} catch (error) {
  console.error("Motion layer unavailable, the page stays static.", error);
}

/* Runs before and regardless of the motion layer: native events in, CSS custom
   properties out. This is the background's interactivity on a machine where the
   rAF-driven layer is switched off or throttled. */
const disposeAtmosphere = initAtmosphere();

let resizeFrame = 0;
const scheduleRefresh = (): void => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    portal?.resize();
    motion?.refresh();
  });
};

const handleVisibilityChange = (): void => portal?.setSuspended(document.hidden);
const handleContextLost = (event: Event): void => {
  event.preventDefault();
  portal?.markContextLost();
};
const handleContextRestored = (): void => portal?.markContextRestored();
const handlePointerMove = (event: PointerEvent): void => {
  portal?.setPointer(
    (event.clientX / Math.max(window.innerWidth, 1)) * 2 - 1,
    -((event.clientY / Math.max(window.innerHeight, 1)) * 2 - 1),
  );
};
const resetPointer = (): void => portal?.setPointer(0, 0);

window.addEventListener("resize", scheduleRefresh, { passive: true });
window.visualViewport?.addEventListener("resize", scheduleRefresh, { passive: true });
document.addEventListener("visibilitychange", handleVisibilityChange);

if (portal && canvas) {
  canvas.addEventListener("webglcontextlost", handleContextLost);
  canvas.addEventListener("webglcontextrestored", handleContextRestored);

  if (isFinePointer()) {
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("blur", resetPointer);
    document.documentElement.addEventListener("pointerleave", resetPointer);
  }
}

const menuToggle = document.querySelector<HTMLButtonElement>(".nav-toggle");
const menu = document.querySelector<HTMLDialogElement>("#mobile-menu");
const menuClose = document.querySelector<HTMLButtonElement>("[data-menu-close]");

const setMenuOpen = (open: boolean): void => {
  if (!menuToggle || !menu) {
    return;
  }
  if (open && !menu.open) {
    menu.showModal();
  } else if (!open && menu.open) {
    menu.close();
  }
};

const syncMenuState = (): void => {
  const open = menu?.open ?? false;
  menuToggle?.setAttribute("aria-expanded", String(open));
  menuToggle?.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  document.body.classList.toggle("menu-open", open);
  motion?.setPaused(open);
};

const handleMenuToggle = (): void => setMenuOpen(!(menu?.open ?? false));
const handleMenuClose = (): void => setMenuOpen(false);
const handleMenuBackdrop = (event: MouseEvent): void => {
  if (event.target === menu) {
    menu?.close();
  }
};

menuToggle?.addEventListener("click", handleMenuToggle);
menuClose?.addEventListener("click", handleMenuClose);
menu?.addEventListener("close", syncMenuState);
menu?.addEventListener("click", handleMenuBackdrop);

const backToTop = document.querySelector<HTMLButtonElement>("#back-to-top");
const hero = document.querySelector<HTMLElement>(".hero");
let backToTopObserver: IntersectionObserver | null = null;

if (backToTop) {
  if (hero && "IntersectionObserver" in window) {
    backToTopObserver = new IntersectionObserver(([entry]) => {
      backToTop.classList.toggle("visible", !(entry?.isIntersecting ?? false));
    });
    backToTopObserver.observe(hero);
  } else {
    backToTop.classList.add("visible");
  }
}

const handleBackToTop = (): void => motion?.scrollTo(0);
backToTop?.addEventListener("click", handleBackToTop);

const copyButton = document.querySelector<HTMLButtonElement>("[data-copy-url]");
const toast = document.querySelector<HTMLElement>("#toast");
let toastTimer = 0;

const showToast = (message: string): void => {
  if (!toast) {
    return;
  }
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
};

const handleCopy = (): void => {
  const value = copyButton?.dataset.copyUrl;
  if (!value) {
    return;
  }
  if (!navigator.clipboard) {
    showToast("Copy unavailable");
    return;
  }

  void navigator.clipboard.writeText(value).then(
    () => showToast("Link copied"),
    () => showToast("Copy failed"),
  );
};

copyButton?.addEventListener("click", handleCopy);

let destroyed = false;
const dispose = (): void => {
  if (destroyed) {
    return;
  }
  destroyed = true;

  cancelAnimationFrame(resizeFrame);
  window.removeEventListener("resize", scheduleRefresh);
  window.visualViewport?.removeEventListener("resize", scheduleRefresh);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("pointermove", handlePointerMove);
  window.removeEventListener("blur", resetPointer);
  document.documentElement.removeEventListener("pointerleave", resetPointer);
  menuToggle?.removeEventListener("click", handleMenuToggle);
  menuClose?.removeEventListener("click", handleMenuClose);
  menu?.removeEventListener("close", syncMenuState);
  menu?.removeEventListener("click", handleMenuBackdrop);
  backToTop?.removeEventListener("click", handleBackToTop);
  copyButton?.removeEventListener("click", handleCopy);
  backToTopObserver?.disconnect();
  window.clearTimeout(toastTimer);

  if (portal && canvas) {
    gsap.ticker.remove(render);
    canvas.removeEventListener("webglcontextlost", handleContextLost);
    canvas.removeEventListener("webglcontextrestored", handleContextRestored);
    portal.destroy();
  }

  motion?.destroy();
  disposeAtmosphere();
};

const handlePageHide = (event: PageTransitionEvent): void => {
  if (!event.persisted) {
    dispose();
  }
};

window.addEventListener("pagehide", handlePageHide);
