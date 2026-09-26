import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/animations.css";
import { initAnimations } from "./scripts/animations";

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

initAnimations();
