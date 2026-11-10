/* =============================================================================
   NAV — smooth in-page anchors
   -----------------------------------------------------------------------------
   script.js owns the menu, the scrollspy and the fallback anchor scroller.
   This module only upgrades the anchor path to Lenis while it exists, using a
   capture listener so script.js sees `defaultPrevented` and stands down.
   ========================================================================== */

export function initNav(getLenis) {
  const navbar = document.getElementById('navbar');

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const link = event.target.closest && event.target.closest('a[href^="#"]');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href || href === '#') return;

    let id;
    try { id = decodeURIComponent(href.slice(1)); } catch (e) { return; }
    const target = document.getElementById(id);
    if (!target) return;

    const lenis = getLenis();
    if (!lenis) return; /* script.js animates this one natively */

    event.preventDefault();

    /* One frame later, so script.js has closed the mobile menu and the page has
       relaid out. Measuring while the menu still locks scrolling lands anchors
       in the wrong place on phones. */
    window.requestAnimationFrame(() => {
      const offset = navbar ? -(navbar.getBoundingClientRect().height + 24) : 0;
      lenis.scrollTo(target, { offset, duration: 1.1 });

      if (!target.hasAttribute('tabindex') && typeof target.focus === 'function') {
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
      try { window.history.pushState(null, '', href); } catch (e) {}
    });
  }, true);
}
