/* =============================================================================
   script.js — TOOLAPIS · page behaviour
   -----------------------------------------------------------------------------
   Everything that is not motion policy, not the intro, not the scroll reveal and
   not the 3D layer lives here: the page-transition plate, cursor spotlight,
   scroll progress, scrollspy, the mobile menu, the copy-to-clipboard helper and
   the toast.

   WHAT CHANGED IN THE REDESIGN
   -----------------------------------------------------------------------------
   This file used to open by assigning a `tailwind.config`, because the site was
   built on the Tailwind CDN and every colour, radius and width in the markup was
   a utility class. The redesign replaces that with css/tokens.css + real
   stylesheets, so:

     * the `tailwind.config` block and the CDN <script> are gone, and with them
       the whole class of bug where a CDN-injected <style> lands after our sheets
       and wins on source order;
     * the handful of places that used Tailwind utility classes as STATE
       (`opacity-0/100`, `translate-y-20/0`) now toggle a single semantic class
       (`is-live`) that css/base.css and css/components.css define;
     * every selector below is the same one it always was, so the behaviour is
       unchanged — only the class names it flips are.

   The script is deliberately written to be its own failsafe: every block is
   guarded, and a failure in one leaves the rest of the page working.
   ========================================================================== */

(function () {
  'use strict';

  document.documentElement.classList.add('js');

  /* Motion preference. localStorage "toolapis-motion":
     "off" -> static, unset/"on" -> animate. The modules in js/ own the real
     policy (they also consult prefers-reduced-motion); this read only keeps the
     vanilla half of the page in agreement. */
  const motionPref = (() => { try { return localStorage.getItem('toolapis-motion') || ''; } catch (err) { return ''; } })();
  const reduceMotion = motionPref === 'off';
  document.documentElement.classList.toggle('reduced-motion', reduceMotion);
  const finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

  /* ---------------------------------------------------------------------
     Page transition: fade in on load, fade out just before navigation.
     --------------------------------------------------------------------- */
  const pageTransition = document.getElementById('page-transition');
  if (pageTransition) {
    pageTransition.style.transition = 'none';
    pageTransition.classList.add('active');
    void pageTransition.offsetHeight;
    pageTransition.style.transition = '';
    const hideTransition = () => pageTransition.classList.remove('active');
    if (document.readyState === 'loading' || document.readyState === 'interactive') {
      document.addEventListener('DOMContentLoaded', hideTransition, { once: true });
    } else {
      requestAnimationFrame(hideTransition);
    }

    let transitionLocked = false;
    document.addEventListener('click', (e) => {
      if (transitionLocked || e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target.closest('a');
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;
      if (link.target === '_blank' || link.hasAttribute('download')) return;
      let url;
      try { url = new URL(href, window.location.href); } catch (err) { return; }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      if (url.origin === window.location.origin &&
          url.pathname === location.pathname &&
          url.search === location.search) return;
      e.preventDefault();
      transitionLocked = true;
      pageTransition.classList.add('active');
      window.setTimeout(() => { window.location.href = link.href; }, reduceMotion ? 0 : 400);
    });
  }

  /* ---------------------------------------------------------------------
     Cursor spotlight. Phosphor mint, tracked with one passive listener and
     written as a CSS custom property, so the gradient itself lives in the
     stylesheet with every other colour.
     --------------------------------------------------------------------- */
  const spotlight = document.getElementById('spotlight');
  if (spotlight && finePointer) {
    let spotRaf = null;
    let spotX = 0, spotY = 0;
    window.addEventListener('pointermove', (e) => {
      spotX = e.clientX; spotY = e.clientY;
      if (spotRaf) return;
      spotRaf = requestAnimationFrame(() => {
        spotRaf = null;
        spotlight.style.setProperty('--spot-x', spotX + 'px');
        spotlight.style.setProperty('--spot-y', spotY + 'px');
        spotlight.classList.add('is-live');
      });
    }, { passive: true });
  }

  /* ---------------------------------------------------------------------
     Magnetic controls. DESIGN.md's filled pill lifts 1px on hover and the
     ghost fills 8% white; a magnetic pull is kept but at a much smaller
     amplitude than before, so it reads as a nudge rather than a toy.
     --------------------------------------------------------------------- */
  if (finePointer && !reduceMotion) {
    document.querySelectorAll('[data-magnetic]').forEach(el => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - r.left - r.width / 2) * 0.06;
        const dy = (e.clientY - r.top - r.height / 2) * 0.12;
        el.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  /* ---------------------------------------------------------------------
     Staggered reveal: children of .reveal-group auto-cascade.
     --------------------------------------------------------------------- */
  const autoStagger = () => {
    document.querySelectorAll('.reveal-group').forEach((group) => {
      const step = group.hasAttribute('data-delay-step')
        ? Math.max(0, Number(group.dataset.delayStep) || 0)
        : 80;
      let i = 0;
      Array.from(group.children).forEach((el) => {
        if (el.matches('.reveal') && !el.dataset.delay) {
          el.dataset.delay = String(i * step);
          i += 1;
        }
      });
    });
  };
  autoStagger();

  /* ---------------------------------------------------------------------
     Scroll reveal (IntersectionObserver): .reveal + .is-visible
     --------------------------------------------------------------------- */
  const revealEls = document.querySelectorAll('.reveal');
  const revealed = new WeakSet();
  const revealTarget = (el) => {
    if (revealed.has(el)) return;
    revealed.add(el);
    if (el.dataset.delay) el.style.transitionDelay = el.dataset.delay + 'ms';
    el.classList.add('is-visible', 'active');
    window.setTimeout(() => { el.style.transitionDelay = ''; }, Number(el.dataset.delay || 0) + 800);
  };
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach(revealTarget);
  } else {
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(en => {
        if (en.isIntersecting) { revealTarget(en.target); obs.unobserve(en.target); }
      });
    }, { threshold: 0.15 });
    revealEls.forEach(el => io.observe(el));

    /* Safe net: once layout is stable (fonts, CSS), reveal anything already in
       view. Idempotent; IO is still the main trigger. */
    const passVisible = () => {
      revealEls.forEach(el => {
        if (revealed.has(el)) return;
        const r = el.getBoundingClientRect();
        if (r.top <= window.innerHeight && r.bottom > 0) revealTarget(el);
      });
    };
    window.addEventListener('load', () => requestAnimationFrame(passVisible), { once: true });

    let ticking = false;
    const onLayoutChange = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { passVisible(); ticking = false; });
    };
    window.addEventListener('scroll', onLayoutChange, { passive: true });
    window.addEventListener('resize', onLayoutChange, { passive: true });
  }

  /* ---------------------------------------------------------------------
     Navbar scrolled state + back-to-top visibility.
     `.nav-solid` is the single switch: it turns the navbar's bottom hairline on
     and lets the 3D solver reserve the bar's band.
     --------------------------------------------------------------------- */
  const sentinel = document.getElementById('nav-sentinel');
  const navbar = document.getElementById('navbar');
  const backToTop = document.getElementById('back-to-top');
  if (backToTop) {
    backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }
  if (sentinel && navbar && 'IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      entries.forEach(en => {
        const scrolled = !en.isIntersecting;
        navbar.classList.toggle('nav-solid', scrolled);
        if (backToTop) backToTop.classList.toggle('visible', scrolled);
      });
    }, { threshold: 0 }).observe(sentinel);
  }

  /* ---------------------------------------------------------------------
     Scroll progress bar.
     --------------------------------------------------------------------- */
  const progressBar = document.getElementById('scroll-progress');
  if (progressBar) {
    const updateProgress = () => {
      const doc = document.documentElement;
      const total = doc.scrollHeight - doc.clientHeight;
      const p = total > 0 ? doc.scrollTop / total : 0;
      progressBar.style.transform = 'scaleX(' + p + ')';
    };
    updateProgress();
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress, { passive: true });
  }

  /* ---------------------------------------------------------------------
     Scrollspy: highlight the current section in the nav.
     --------------------------------------------------------------------- */
  const navLinks = Array.from(document.querySelectorAll('.nav-link'));
  const sections = ['overview', 'features', 'flow', 'clarity']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  if (navLinks.length && sections.length && 'IntersectionObserver' in window) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        const id = '#' + en.target.id;
        navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === id));
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(sec => spy.observe(sec));
  }

  /* ---------------------------------------------------------------------
     Mobile navigation.
     --------------------------------------------------------------------- */
  const navToggle = document.getElementById('nav-toggle');
  const mobileMenu = document.getElementById('mobile-menu');
  const navIcon = document.getElementById('nav-icon');
  if (navToggle && mobileMenu) {
    /* The icon is a sprite <use>, so swapping the glyph means repointing the
       href — the class list stays put because it carries the layout rules. */
    const navGlyph = (name) => {
      if (!navIcon) return;
      const use = navIcon.querySelector('use');
      if (use) use.setAttribute('href', '#i-' + name);
      else navIcon.innerHTML = '<use href="#i-' + name + '"></use>';
    };
    const closeMenu = () => {
      mobileMenu.classList.remove('open', 'pointer-events-auto');
      mobileMenu.classList.add('pointer-events-none');
      mobileMenu.setAttribute('aria-hidden', 'true');
      navToggle.setAttribute('aria-expanded', 'false');
      navGlyph('list');
    };
    const openMenu = () => {
      mobileMenu.classList.add('open', 'pointer-events-auto');
      mobileMenu.classList.remove('pointer-events-none');
      mobileMenu.setAttribute('aria-hidden', 'false');
      navToggle.setAttribute('aria-expanded', 'true');
      navGlyph('x');
    };
    navToggle.addEventListener('click', () => {
      mobileMenu.classList.contains('open') ? closeMenu() : openMenu();
    });
    mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#navbar') && !e.target.closest('#mobile-menu')) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mobileMenu.classList.contains('open')) {
        closeMenu();
        navToggle.focus();
      }
    });
  }

  /* ---------------------------------------------------------------------
     Copy to clipboard (with a fallback for non-secure contexts).
     Exposed on window because index.html calls it from an inline onclick on
     the "Copy enhancer link" button.
     --------------------------------------------------------------------- */
  function showToast(message) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');
    if (!toast || !toastMsg) return;
    toastMsg.innerText = message;
    toast.classList.add('is-live');
    if (toast._tlTimer) clearTimeout(toast._tlTimer);
    toast._tlTimer = setTimeout(() => toast.classList.remove('is-live'), 3000);
  }

  function copyToClipboard(text, message) {
    const success = () => showToast(message);
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        success();
      } catch (err) {
        console.error('Failed to copy: ', err);
      }
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(success).catch(fallback);
    } else {
      fallback();
    }
  }

  window.copyToClipboard = copyToClipboard;

  /* ---------------------------------------------------------------------
     Motion Vanilla (optional). Progressive enhancement only: if the CDN is
     down, nothing below runs and the CSS reveals carry the page on their own.
     --------------------------------------------------------------------- */
  (function initMotion() {
    if (typeof Motion === 'undefined' || reduceMotion) return;
    const ease = [0.22, 1, 0.36, 1];

    const run = (el, keyframes, opts) => {
      if (el._motionAnim) {
        try { el._motionAnim.stop(); } catch (err) { /* noop */ }
      }
      const anim = Motion.animate(el, keyframes, opts);
      el._motionAnim = anim;
      /* Watchdog: some environments throttle WAAPI, so anim.finished may never
         resolve. Never leave a component stuck at inline opacity:0. */
      const budget = ((opts.delay || 0) + (opts.duration || 1)) * 1000 + 500;
      el._motionWatchdog = window.setTimeout(() => {
        if (el._motionAnim !== anim) return;
        el._motionAnim = null;
        el.style.opacity = '';
        el.style.transform = '';
      }, budget);
      anim.finished.then(() => {
        try { anim.stop(); } catch (err) { /* noop */ }
        if (el._motionAnim === anim) el._motionAnim = null;
        if (el._motionWatchdog) { window.clearTimeout(el._motionWatchdog); el._motionWatchdog = null; }
        el.style.opacity = '';
        el.style.transform = '';
      }).catch(() => {
        if (el._motionWatchdog) { window.clearTimeout(el._motionWatchdog); el._motionWatchdog = null; }
        el.style.opacity = '';
        el.style.transform = '';
      });
      return anim;
    };

    /* Micro-interaction: a 1px lift on the buttons that carry `data-magnetic`
       is already CSS; this is the pointer-down press. */
    const clickables = document.querySelectorAll('.btn:not([data-magnetic]), .back-to-top, .hero-pill-outline');
    if (finePointer) {
      clickables.forEach(el => {
        el.addEventListener('pointerenter', () => {
          run(el, { y: -1 }, { duration: 0.2, easing: ease });
        });
        el.addEventListener('pointerleave', () => {
          run(el, { y: 0 }, { duration: 0.2, easing: ease });
        });
      });
    }
    clickables.forEach(el => {
      el.addEventListener('pointerdown', () => {
        run(el, { scale: 0.98 }, { duration: 0.08, easing: 'ease-out' });
      }, { passive: true });
      const release = () => { run(el, { scale: 1 }, { duration: 0.2, easing: ease }); };
      el.addEventListener('pointerup', release, { passive: true });
      el.addEventListener('pointercancel', release, { passive: true });
    });

    /* Section headings rise once as they arrive. The reveal system owns
       everything else, so this deliberately touches only the h2s. */
    const headings = Array.from(document.querySelectorAll('main h2'));
    if (headings.length && 'IntersectionObserver' in window) {
      const mio = new IntersectionObserver((entries, obs) => {
        entries.forEach(en => {
          if (!en.isIntersecting) return;
          obs.unobserve(en.target);
          const el = en.target;
          el.style.opacity = '0';
          el.style.transform = 'translateY(20px)';
          run(el, { opacity: [0, 1], y: [20, 0] }, { duration: 0.75, easing: ease });
        });
      }, { threshold: 0.18 });
      headings.forEach(el => mio.observe(el));
    }
  })();
})();
