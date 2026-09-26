import "./styles/tokens.css";
import "./styles/loader.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/animations.css";
import { initAnimations } from "./scripts/animations";
import { runLoader } from "./loader";

/* The mobile menu is behaviour, not decoration, so it lives here rather than in
   the motion layer: it has to keep working on a page where motion is switched
   off. The dialog carries data-lenis-prevent, which is what stops Lenis from
   treating a scroll inside the drawer as a scroll of the page behind it. */
const menuToggle = document.querySelector<HTMLButtonElement>("[data-menu-toggle]");
const menu = document.querySelector<HTMLDialogElement>("#mobile-menu");
const menuClose = document.querySelector<HTMLButtonElement>("[data-menu-close]");

const syncMenuState = (): void => {
  const open = menu?.open ?? false;
  menuToggle?.setAttribute("aria-expanded", String(open));
  menuToggle?.setAttribute("aria-label", open ? "Tutup menu" : "Buka menu");
  document.body.classList.toggle("menu-open", open);
};

menuToggle?.addEventListener("click", () => {
  if (menu && !menu.open) {
    menu.showModal();
  }
});

menuClose?.addEventListener("click", () => menu?.close());

menu?.addEventListener("close", syncMenuState);

/* A click on the backdrop is a click on the dialog element itself. */
menu?.addEventListener("click", (event) => {
  if (event.target === menu) {
    menu.close();
  }
});

/* The intro gates the hero, so the scramble is fired by the loader when it
   finishes rather than on load. Everything else in initAnimations is
   observer-driven and runs either side of the overlay.

   Wrapped so the overlay is always released. The loader holds the scroll lock
   and covers the page, so an exception thrown anywhere in initAnimations would
   otherwise leave a black page that cannot be scrolled, with the hero parked
   below its clips. The motion layer is the only thing at stake here, so a
   failure is logged and the page still arrives. */
try {
  initAnimations();
} catch (error) {
  console.error(error);
} finally {
  runLoader();
}
