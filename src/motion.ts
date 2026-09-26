import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);

export interface PortalSceneState {
  progress: number;
}

export interface MotionController {
  scrollTo: (target: HTMLElement | number, immediate?: boolean) => void;
  setPaused: (paused: boolean) => void;
  refresh: () => void;
  destroy: () => void;
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

const isMotionEnabled = (prefersReducedMotion: MediaQueryList): boolean =>
  document.documentElement.dataset.motion !== "off" && !prefersReducedMotion.matches;

const setCurrentSection = (id: string): void => {
  document.querySelectorAll<HTMLAnchorElement>('.primary-nav a[href^="#"]').forEach((link) => {
    if (link.getAttribute("href") === `#${id}`) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
};

export const initMotion = (sceneState: PortalSceneState): MotionController => {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const dialog = document.querySelector<HTMLDialogElement>("#mobile-menu");
  let lenis: Lenis | null = null;
  let raf: ((time: number) => void) | null = null;
  let scrollUpdate: (() => void) | null = null;
  let anchorHandler: ((event: MouseEvent) => void) | null = null;
  let mediaContext: ReturnType<typeof gsap.matchMedia> | null = null;

  if (dialog) {
    dialog.dataset.lenisPrevent = "";
  }

  if (isMotionEnabled(prefersReducedMotion)) {
    lenis = new Lenis({
      autoRaf: false,
      lerp: 0.085,
      smoothWheel: true,
      syncTouch: false,
      wheelMultiplier: 0.92,
    });

    scrollUpdate = () => ScrollTrigger.update();
    lenis.on("scroll", scrollUpdate);
    /* gsap.ticker hands out seconds, Lenis wants milliseconds. */
    raf = (time: number) => lenis?.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    mediaContext = gsap.matchMedia();

    mediaContext.add("(prefers-reduced-motion: no-preference)", () => {
      const root = document.documentElement;

      /* The entrance and the background's parallax are CSS keyframes driven by
         native events in atmosphere.ts. GSAP used to own them, but its timeline
         is rAF-driven and this layer is skipped whenever the motion preference
         is set, which left the hero completely inert. Two systems animating the
         same inline transform would also have fought each other. */


      /* One timeline, one ScrollTrigger, whole document top to bottom. Raw
         start/end on the scroller — passing the <html> element as a trigger
         measures a zero-height root and yields an invalid range. The WebGL
         scene reads the proxy; the veil reads the CSS variable. */
      const sceneProxy = { progress: 0 };

      try {
        gsap
          .timeline({
            scrollTrigger: {
              start: 0,
              end: "max",
              scrub: 1,
              invalidateOnRefresh: true,
            },
          })
          .to(
            sceneProxy,
            {
              progress: 1,
              ease: "none",
              onUpdate: () => {
                sceneState.progress = sceneProxy.progress;
              },
            },
            0,
          )
          .to(
            root,
            {
              /* The veil only exists for hero-copy contrast, so it clears over
                 the first half of the page instead of tracking the document. */
              "--scene-veil": 0.22,
              duration: 0.6,
              ease: "power1.inOut",
            },
            0,
          );
      } catch (error) {
        /* A broken scroll narrative must never cost the reader the page: the
           scene simply holds its opening frame. */
        console.error("Scroll narrative unavailable, holding opening frame.", error);
      }

      try {
        gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((element) => {
          gsap.from(element, {
            autoAlpha: 0,
            /* Magnetic elements already own y; sliding them too would make the
               two tweens fight, and quickTo's overwrite strands them mid-reveal. */
            y: element.hasAttribute("data-magnetic") ? 0 : 28,
            duration: 0.95,
            ease: "expo.out",
            clearProps: "transform,opacity,visibility",
            scrollTrigger: {
              trigger: element,
              start: "top 86%",
              once: true,
            },
          });
        });

        document.querySelectorAll<HTMLElement>("main section[id]").forEach((section) => {
          ScrollTrigger.create({
            trigger: section,
            start: "top 48%",
            end: "bottom 48%",
            onEnter: () => setCurrentSection(section.id),
            onEnterBack: () => setCurrentSection(section.id),
          });
        });
      } catch (error) {
        console.error("Reveal setup failed, showing sections statically.", error);
        gsap.set("[data-reveal]", { clearProps: "transform,opacity,visibility" });
      }
    });

    mediaContext.add(
      "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
      () => {
        const cleanups = gsap.utils.toArray<HTMLElement>("[data-magnetic]").map((element) => {
          const specularCache = { x: Number.NaN, y: Number.NaN };
          const setX = gsap.quickTo(element, "x", {
            duration: 0.3,
            ease: "power3.out",
            overwrite: "auto",
          });
          const setY = gsap.quickTo(element, "y", {
            duration: 0.3,
            ease: "power3.out",
            overwrite: "auto",
          });
          const release = (): void => {
            gsap.to(element, {
              x: 0,
              y: 0,
              duration: 0.8,
              ease: "elastic.out(1, 0.35)",
              overwrite: "auto",
            });
          };
          const handleMove = (event: PointerEvent): void => {
            const bounds = element.getBoundingClientRect();
            const offset = getMagneticOffset(
              event.clientX,
              event.clientY,
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2,
              0.3,
              18,
            );
            setX(offset.x);
            setY(offset.y);

            /* Same event feeds the specular highlight. Written as a percentage of
               the element's own box so the CSS gradient needs no unit maths, and
               skipped when it has not meaningfully moved. */
            if (element.hasAttribute("data-specular")) {
              const px = Math.round(((event.clientX - bounds.left) / bounds.width) * 1000) / 10;
              const py = Math.round(((event.clientY - bounds.top) / bounds.height) * 1000) / 10;
              if (px !== specularCache.x || py !== specularCache.y) {
                specularCache.x = px;
                specularCache.y = py;
                element.style.setProperty("--px", `${px}%`);
                element.style.setProperty("--py", `${py}%`);
              }
            }
          };
          const handleBlur = (): void => {
            setX(0);
            setY(0);
          };

          element.addEventListener("pointermove", handleMove, { passive: true });
          element.addEventListener("pointerleave", release);
          element.addEventListener("pointercancel", release);
          window.addEventListener("blur", handleBlur);

          return () => {
            element.removeEventListener("pointermove", handleMove);
            element.removeEventListener("pointerleave", release);
            element.removeEventListener("pointercancel", release);
            window.removeEventListener("blur", handleBlur);
            gsap.killTweensOf(element);
            gsap.set(element, { clearProps: "transform" });
            element.style.removeProperty("--px");
            element.style.removeProperty("--py");
          };
        });

        return () => cleanups.forEach((cleanup) => cleanup());
      },
    );
  } else {
    sceneState.progress = 0;
  }

  anchorHandler = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
    if (!target) {
      return;
    }

    const href = target.getAttribute("href");
    if (!href || href === "#") {
      return;
    }

    const element = document.getElementById(href.slice(1));
    if (!element) {
      return;
    }

    event.preventDefault();
    if (dialog?.open) {
      dialog.close();
    }
    if (lenis) {
      lenis.scrollTo(element, { offset: -72, duration: 1.15 });
    } else {
      element.scrollIntoView({ behavior: "auto", block: "start" });
    }
  };

  document.addEventListener("click", anchorHandler);

  const refresh = (): void => {
    ScrollTrigger.refresh();
    lenis?.resize();
  };

  if (document.fonts?.ready) {
    void document.fonts.ready.then(refresh).catch(() => undefined);
  }

  return {
    scrollTo(target: HTMLElement | number, immediate = false): void {
      if (lenis) {
        lenis.scrollTo(target, { immediate, duration: immediate ? 0 : 1.1 });
        return;
      }
      if (typeof target === "number") {
        window.scrollTo({ top: target, behavior: "auto" });
      } else {
        target.scrollIntoView({ behavior: "auto", block: "start" });
      }
    },
    setPaused(paused: boolean): void {
      if (!lenis) {
        return;
      }
      if (paused) {
        lenis.stop();
      } else {
        lenis.start();
      }
    },
    refresh,
    destroy(): void {
      document.removeEventListener("click", anchorHandler);
      mediaContext?.revert();
      if (raf) {
        gsap.ticker.remove(raf);
      }
      if (lenis && scrollUpdate) {
        lenis.off("scroll", scrollUpdate);
      }
      lenis?.destroy();
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
    },
  };
};
