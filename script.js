/* =============================================================================
   script.js — TOOLAPIS · page behaviour
   -----------------------------------------------------------------------------
   Everything that is not motion policy, not the scroll reveal and not the 3D
   layer lives here: the page-transition plate, animated anchor scrolling,
   scroll progress, scrollspy, the mobile menu, the copy-to-clipboard helper
   and the toast.

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
     "off" -> static, unset/"on" -> animate. This is the visitor's OWN choice,
     recorded by the "Reduce motion" button; nothing here reads the OS
     "reduce motion" setting, because this site does not honour it (see the
     note at the top of index.html and the reasoning in css/animations.css).
     The modules in js/ own the real policy; this read only keeps the vanilla
     half of the page in agreement, since script.js is a classic script that
     runs before any module can land. */
  const motionPref = (() => { try { return localStorage.getItem('toolapis-motion') || ''; } catch (err) { return ''; } })();
  const reduceMotion = motionPref === 'off';
  document.documentElement.classList.toggle('reduced-motion', reduceMotion);
  const finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

  /* ---------------------------------------------------------------------
     Animated scrolling, in JavaScript.

     `scroll-behavior: smooth` in the stylesheet is the primary mechanism and
     stays. It is not the ONLY one, because it is a single declaration that can
     be overridden by anything: a browser that does not implement it, an
     extension or an embedder that sets `auto` globally, or the page being
     embedded where the UA ignores it. In each of those cases every anchor on
     the site became a teleport while motion stayed on everywhere else — the
     animation the visitor asked for, silently gone.

     So anchor scrolls and the back-to-top button drive the scroll position
     themselves, on a requestAnimationFrame loop with the same easeOutQuint the
     rest of the site uses. rAF is not gated by any user setting, so this path
     animates wherever `scroll-behavior` would have been dropped.

     `window.scrollTo(0, y)` — the two-argument form — is used deliberately:
     the options form's `behavior: 'smooth'` would hand control back to the
     same UA code path this exists to avoid, and `scroll-behavior: smooth` in
     the stylesheet does not apply to a programmatic `scrollTo` with an explicit
     position, so there is nothing to fight. */
  const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
  const SCROLL_MS = 620;
  let scrollRaf = null;

  /* Read LIVE, not from the `reduceMotion` const captured at parse time. That
     const is correct for the boot-time decisions it drives, but a visitor who
     presses "Reduce motion" a second into the page must get a plain jump on
     their very next click, and this file has no way to be told — the class on
     <html> is the contract js/motion.js and the inline bootstrap both write. */
  const motionOff = () => document.documentElement.classList.contains('motion-reduced');

  function cancelScroll() {
    if (scrollRaf !== null) { cancelAnimationFrame(scrollRaf); scrollRaf = null; }
  }

  /* @param {number} to absolute document offset to land on */
  function scrollToY(to) {
    cancelScroll();

    const start = window.scrollY || window.pageYOffset || 0;
    const end = Math.max(0, Math.min(to, document.documentElement.scrollHeight - window.innerHeight));
    const delta = end - start;

    /* Motion off is a plain jump, and so is a zero-distance case. `instant`
       rather than `auto` because `auto` defers to the stylesheet's
       `scroll-behavior` — saying it explicitly means this branch cannot be
       slowed down by a later cascade change. */
    if (motionOff() || Math.abs(delta) < 2) {
      window.scrollTo({ top: end, behavior: 'instant' });
      return;
    }

    /* Duration scales with distance but is capped, so a jump from the footer
       to the top reads as the same gesture as a jump to the next section
       rather than as a slow drift across the whole document. */
    const duration = Math.min(SCROLL_MS, 220 + Math.abs(delta) * 0.28);
    const t0 = performance.now();

    const frame = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      window.scrollTo(0, Math.round(start + delta * easeOutQuint(t)));
      scrollRaf = t < 1 ? requestAnimationFrame(frame) : null;
    };
    scrollRaf = requestAnimationFrame(frame);
  }

  /* Target offset for an in-page anchor, with the sticky navbar accounted for.
     Without the offset the section heading lands underneath the bar, which is
     the single most common way a smooth-scroll implementation goes wrong. */
  function anchorTop(el) {
    const bar = document.getElementById('navbar');
    const offset = bar ? bar.getBoundingClientRect().height + 8 : 0;
    return el.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0) - offset;
  }

  /* Any pointer or key event hands control back to the visitor immediately.
     An animation that keeps running after the wheel starts is the thing that
     makes scroll-linked effects feel like a fight. */
  ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((evt) => {
    window.addEventListener(evt, cancelScroll, { passive: true });
  });

  /* ---------------------------------------------------------------------
     Pause every CSS loop while the tab is in the background.

     Brief §5. Each loop is a `transform` or `opacity` animation, so it is
     already cheap individually — but the page runs about a dozen of them at
     once (status dots, marquee, ribbon segments, hero glow, grid drift, lock
     lights), and a backgrounded tab does not need any of them. The CSS reads
     `html.is-tab-hidden` and sets `animation-play-state: paused`, which
     RESUMES where it left off; removing the animation outright would reset
     the timeline and make the ribbon snap back to its start.

     js/hero3d.js writes the same class for the hero subtree on its own
     visibilitychange listener; this one covers the loops outside #hero,
     which the hero's scoped rule cannot reach.
     --------------------------------------------------------------------- */
  const markTabHidden = () => {
    document.documentElement.classList.toggle('is-tab-hidden', document.hidden);
  };
  document.addEventListener('visibilitychange', markTabHidden, { passive: true });
  markTabHidden();

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

  /* The cursor spotlight moved into the bento cards: js/widgets.js writes
     --mx/--my on each `.spot-card` and css/sections.css paints it. The global
     fixed overlay this replaced tinted every surface the pointer passed over,
     including the mint accent card, which is exactly the co-occurrence
     DESIGN.md rules out. */

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

     `.nav-solid` has exactly one writer: this observer. js/motion-fx.js used to
     re-assert it from a raw `scrollY > 8` comparison as a fallback, which meant
     two definitions of "scrolled" racing to set one class. A sentinel is the
     better measurement anyway — it fires on layout, not on a magic number — so
     the fallback was both redundant and less correct.

     The sentinel's only fallback path is the absence of IntersectionObserver,
     which no target browser lacks; the bar simply starts transparent, as
     DESIGN.md specifies for the top of the page.
     --------------------------------------------------------------------- */
  const sentinel = document.getElementById('nav-sentinel');
  const navbar = document.getElementById('navbar');
  const backToTop = document.getElementById('back-to-top');
  if (backToTop) {
    backToTop.addEventListener('click', () => {
      scrollToY(0);
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
  } else if (backToTop) {
    /* No observer: keep the button reachable via a scroll listener instead of
       stranding it at opacity 0 for the life of the page. */
    window.addEventListener('scroll', () => {
      backToTop.classList.toggle('visible', window.scrollY > 400);
    }, { passive: true });
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
     In-page anchors, animated by hand.

     Delegated on the document rather than bound per link, because the same
     `#overview` appears in the navbar, the mobile menu and the footer and the
     three must behave identically. One listener covers all of them, and any
     anchor added later is covered for free.

     The default is only cancelled once a real target has been found: a dead
     `#anchor` must keep falling through to the browser so the URL still
     updates and the visitor still gets the "nothing here" signal, rather than
     being silently swallowed by a handler that had nothing to do.

     `#` with no id is left alone for the same reason — it is a legal no-op,
     and preventDefault on it would eat a click for no reason.
     --------------------------------------------------------------------- */
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const link = e.target.closest && e.target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href || href.charAt(0) !== '#' || href === '#') return;

    /* Modifier-clicking an anchor to open it in a new tab is a normal thing to
       do and must keep working, so this runs after the modifier check above. */
    let target;
    try { target = document.getElementById(decodeURIComponent(href.slice(1))); }
    catch (err) { target = null; }
    if (!target) return;

    e.preventDefault();

    /* Move focus with the scroll. Scrolling alone leaves keyboard and screen
       reader users at the top of the document while the viewport has jumped to
       #overview, which is the documented failure of "animated" anchors. Only
       when the target is not already focusable, so the tab order is not
       rewritten. */
    if (!target.hasAttribute('tabindex') && typeof target.focus === 'function') {
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }

    /* History is updated by hand because the default was cancelled. `replace`
       rather than `push` would keep the back button honest, but the native
       behaviour is push and changing it is a routing decision nobody asked
       for — so this is push, matching what the browser would have done. */
    if (window.history && typeof window.history.pushState === 'function') {
      try { window.history.pushState(null, '', href); } catch (err) { /* file:// */ }
    }

    scrollToY(anchorTop(target));
  });

  /* ---------------------------------------------------------------------
     Mobile navigation.
     --------------------------------------------------------------------- */
  const navToggle = document.getElementById('nav-toggle');
  const mobileMenu = document.getElementById('mobile-menu');
  const navIcon = document.getElementById('nav-icon');
  const menuClose = document.getElementById('mobile-menu-close');

  if (navToggle && mobileMenu) {
    /* The icon is a sprite <use>, so swapping the glyph means repointing the
       href — the class list stays put because it carries the layout rules.

       The label moves too: a button that says "Toggle menu" is announced as a
       toggle with no state, whereas "Open menu" / "Close menu" says what
       pressing it will do, which is the WCAG 2.5.3 reading. `aria-expanded`
       still carries the state for anyone reading the expanded state. */
    const navGlyph = (name, label) => {
      if (navIcon) {
        const use = navIcon.querySelector('use');
        if (use) use.setAttribute('href', '#i-' + name);
        else navIcon.innerHTML = '<use href="#i-' + name + '"></use>';
      }
      navToggle.setAttribute('aria-label', label);
    };

    const isOpen = () => mobileMenu.classList.contains('open');

    /* Focusable descendants, in DOM order, minus anything inert. Queried fresh
       on each Tab because the panel's contents are static but its VISIBILITY
       changes, and a cached list would happily hand focus to a hidden link. */
    const focusables = () => Array.prototype.filter.call(
      mobileMenu.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      (el) => el.offsetParent !== null || el.getClientRects().length > 0
    );

    /* THE SCROLL LOCK, and why it is a class and nothing else.

       Measured before this existed: with the panel open, a wheel event and an
       `End` keypress both scrolled the page underneath the overlay.

       It is a class on <html> and it sets `overflow: clip` in the stylesheet,
       because the lock is a TRANSIENT state that has to be fully reversible.
       A permanent `overflow` rule in the base sheet would be correct only while
       the menu happens to be open; if anything ever failed to undo it, the page
       would be unscrollable for good. One class, added and removed by exactly
       the code that knows whether the panel is open, cannot get stuck.

       The earlier version of this ALSO pinned `body` to `position: fixed` with
       a compensating width, on the theory that iOS Safari needs it. It does not,
       and it cost two things that were worse than the problem: `window.scrollY`
       reads 0 while the body is pinned (so every scroll-position check in the
       repo's own harnesses became meaningless), and restoring the position
       needed a `scrollTo` that fought `scroll-behavior: smooth` and landed 61px
       short. `overflow: clip` blocks the user's wheel and keyboard scrolling
       while leaving `scrollY` exactly where it was — no restore needed, because
       nothing moved. */
    const lockScroll = () => document.documentElement.classList.add('menu-open');
    const unlockScroll = () => document.documentElement.classList.remove('menu-open');

    /* `restoreFocus` is separate from `closeMenu` because the click and
       outside-click paths must NOT steal focus back to a button the user is
       not looking at — only the paths that were opened by keyboard interaction
       (the toggle, Escape, the panel's own close button) should.

       The target is always the HAMBURGER, never the panel's close button. That
       is what the brief asks for, and it is also the only choice that works:
       by the time focus is restored the panel is back to `visibility: hidden`,
       so focusing anything inside it is a no-op and the user is dropped on
       <body> with no idea where they are. */
    const closeMenu = (restoreFocus) => {
      if (!isOpen()) return;
      mobileMenu.classList.remove('open', 'pointer-events-auto');
      mobileMenu.classList.add('pointer-events-none');
      mobileMenu.setAttribute('aria-hidden', 'true');
      navToggle.setAttribute('aria-expanded', 'false');
      navGlyph('list', 'Open menu');
      unlockScroll();
      if (restoreFocus && navToggle && typeof navToggle.focus === 'function') {
        navToggle.focus();
      }
    };

    const openMenu = () => {
      if (isOpen()) return;
      mobileMenu.classList.add('open', 'pointer-events-auto');
      mobileMenu.classList.remove('pointer-events-none');
      mobileMenu.setAttribute('aria-hidden', 'false');
      navToggle.setAttribute('aria-expanded', 'true');
      navGlyph('x', 'Close menu');
      lockScroll();
      /* Move focus into the panel so the next Tab is inside it rather than
         somewhere behind the overlay. Synchronous, and it has to be: the
         closed panel is `visibility: hidden` (which is what makes it inert),
         and `.mobile-menu.open` sets `visibility` on a 0s duration with 0s
         delay precisely so the flip lands in this same tick. Deferring to a
         rAF worked and then didn't, depending on whether a style recalc had
         happened in between. */
      const first = focusables()[0];
      if (first && typeof first.focus === 'function') first.focus();
    };

    navToggle.addEventListener('click', () => {
      isOpen() ? closeMenu(true) : openMenu();
    });

    if (menuClose) {
      menuClose.addEventListener('click', () => closeMenu(true));
    }

    mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => closeMenu(false)));

    /* "CLOSE ON CLICK OUTSIDE", which for a full-screen panel has to be spelled
       out because there is no literal outside: `#mobile-menu` is
       `position: fixed; inset: 0`, so every pixel of the viewport belongs to
       it. What the user means by "outside" is the empty padding around the
       content — and that is exactly `e.target === mobileMenu`, the panel's own
       box rather than anything inside it.

       The document-level handler below is kept as well: it is the correct
       guard for any state where the panel does not cover the viewport, and it
       costs one listener. */
    mobileMenu.addEventListener('click', (e) => {
      if (e.target === mobileMenu) closeMenu(false);
    });

    document.addEventListener('click', (e) => {
      if (!isOpen()) return;
      if (!e.target.closest('#navbar') && !e.target.closest('#mobile-menu')) closeMenu(false);
    });

    document.addEventListener('keydown', (e) => {
      if (!isOpen()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu(true);
        return;
      }
      /* A FOCUS TRAP, which the panel needs because it is `aria-modal`: a
         dialog that claims to be modal and lets Tab walk into the page behind
         it is worse than one that admits it is not. Tab from the last
         focusable wraps to the first and Shift+Tab from the first wraps to
         the last; everything else is left alone so arrow keys, Enter and Space
         still reach the focused control. */
      if (e.key === 'Tab') {
        const items = focusables();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !mobileMenu.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    /* Crossing 900px while the panel is open would leave <html> carrying
       `menu-open` — and a `position: fixed` body — with no visible panel to
       close it, because the bar becomes a horizontal nav at that width. Any
       viewport that is 900px or wider closes it.

       `matchMedia(...).addEventListener('change')` rather than a resize
       listener, because this fires exactly once at the crossing instead of on
       every frame of a drag across the boundary. The Safari <14 fallback is
       `addListener`, which is deprecated but is the only API that version has. */
    try {
      const wide = window.matchMedia('(min-width: 900px)');
      const onWide = (e) => { if (e.matches) closeMenu(false); };
      if (typeof wide.addEventListener === 'function') wide.addEventListener('change', onWide);
      else if (typeof wide.addListener === 'function') wide.addListener(onWide);
    } catch (err) {
      window.addEventListener('resize', () => {
        if (isOpen() && window.innerWidth >= 900) closeMenu(false);
      }, { passive: true });
    }
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
