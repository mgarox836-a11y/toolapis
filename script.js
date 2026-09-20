   tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            display: ['Space Grotesk', 'sans-serif'],
            sans: ['DM Sans', 'sans-serif'],
          },
          colors: {
            surface: {
              DEFAULT: '#0B0F12',
              card: '#13191D',
              border: '#232D34',
            },
            accent: {
              mint: '#A3E635',
              'mint-hover': '#BEF264',
            }
          },
          boxShadow: {
            'mint': '0 0 24px rgba(163, 230, 53, 0.18)',
          }
        }
      }
    }

    document.documentElement.classList.add('js');

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(pointer: fine)').matches;

    // ---------------------------------------------------------------
    // 3D Tilt Cards + Spotlight Border
    // ---------------------------------------------------------------
    if (finePointer && !reduceMotion) {
      document.querySelectorAll('.tilt').forEach(card => {
        card.addEventListener('pointermove', (e) => {
          const r = card.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width;
          const py = (e.clientY - r.top) / r.height;
          const rx = (0.5 - py) * Number(card.dataset.tilt || 8);
          const ry = (px - 0.5) * Number(card.dataset.tilt || 8) * 1.4;
          card.style.transform = 'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) translateY(-4px)';
          card.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
          card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
        });
        card.addEventListener('pointerleave', () => {
          card.style.transform = '';
        });
      });
    }

    // ---------------------------------------------------------------
    // Magnetic Buttons (slight pull toward cursor)
    // ---------------------------------------------------------------
    if (finePointer && !reduceMotion) {
      document.querySelectorAll('[data-magnetic]').forEach(el => {
        el.addEventListener('pointermove', (e) => {
          const r = el.getBoundingClientRect();
          const dx = (e.clientX - r.left - r.width / 2) * 0.12;
          const dy = (e.clientY - r.top - r.height / 2) * 0.2;
          el.style.transform = 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px)';
        });
        el.addEventListener('pointerleave', () => { el.style.transform = ''; });
      });
    }

    // ---------------------------------------------------------------
    // Scroll Reveal (IntersectionObserver)
    // ---------------------------------------------------------------
    const revealEls = document.querySelectorAll('[data-reveal]');
    if (reduceMotion || !('IntersectionObserver' in window)) {
      revealEls.forEach(el => el.classList.add('is-visible'));
    } else {
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(en => {
          if (en.isIntersecting) {
            en.target.style.transitionDelay = (en.target.dataset.delay || 0) + 'ms';
            en.target.classList.add('is-visible');
            obs.unobserve(en.target);
          }
        });
      }, { threshold: 0.15 });
      revealEls.forEach(el => io.observe(el));
    }

    // ---------------------------------------------------------------
    // Navbar Solid State + Back-to-top visibility
    // ---------------------------------------------------------------
    const sentinel = document.getElementById('nav-sentinel');
    const navbar = document.getElementById('navbar');
    const backToTop = document.getElementById('back-to-top');
    const backHandler = backToTop
      ? () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
      : () => {};
    if (backToTop) backToTop.addEventListener('click', backHandler);
    if (sentinel && 'IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        entries.forEach(en => {
          const scrolled = !en.isIntersecting;
          navbar.classList.toggle('nav-solid', scrolled);
          if (backToTop) backToTop.classList.toggle('visible', scrolled);
        });
      }, { threshold: 0 }).observe(sentinel);
    }

    // ---------------------------------------------------------------
    // Scrollspy: highlight current section in the nav
    // ---------------------------------------------------------------
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

    // ---------------------------------------------------------------
    // Spotlight Cursor Effect
    // ---------------------------------------------------------------
    const spotlight = document.getElementById('spotlight');
    if (finePointer) {
      spotlight.classList.remove('opacity-0');
      spotlight.classList.add('opacity-100');
      window.addEventListener('mousemove', (e) => {
        spotlight.style.background = 'radial-gradient(600px circle at ' + e.clientX + 'px ' + e.clientY + 'px, rgba(163, 230, 53, 0.055), transparent 80%)';
      }, { passive: true });
    }

    // ---------------------------------------------------------------
    // Mobile Navigation
    // ---------------------------------------------------------------
    const navToggle = document.getElementById('nav-toggle');
    const mobileMenu = document.getElementById('mobile-menu');
    const navIcon = document.getElementById('nav-icon');
    if (navToggle && mobileMenu) {
      const closeMenu = () => {
        mobileMenu.classList.remove('open');
        mobileMenu.classList.remove('pointer-events-auto');
        mobileMenu.classList.add('pointer-events-none');
        navToggle.setAttribute('aria-expanded', 'false');
        if (navIcon) navIcon.className = 'ph-bold ph-list text-lg pointer-events-none';
      };
      const openMenu = () => {
        mobileMenu.classList.add('open');
        mobileMenu.classList.remove('pointer-events-none');
        mobileMenu.classList.add('pointer-events-auto');
        navToggle.setAttribute('aria-expanded', 'true');
        if (navIcon) navIcon.className = 'ph-bold ph-x text-lg pointer-events-none';
      };
      navToggle.addEventListener('click', () => {
        const isOpen = mobileMenu.classList.contains('open');
        isOpen ? closeMenu() : openMenu();
      });
      mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#navbar')) closeMenu();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mobileMenu.classList.contains('open')) {
          closeMenu();
          navToggle.focus();
        }
      });
    }

    // ---------------------------------------------------------------
    // Copy to Clipboard Utility (with fallback for non-secure contexts)
    // ---------------------------------------------------------------
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

    // Toast Notification System
    let toastTimer = null;
    function showToast(message) {
      const toast = document.getElementById('toast');
      const toastMsg = document.getElementById('toast-message');
      toastMsg.innerText = message;
      toast.classList.remove('translate-y-20', 'opacity-0');
      toast.classList.add('translate-y-0', 'opacity-100');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-20', 'opacity-0');
        toastTimer = null;
      }, 3000);
    }
  