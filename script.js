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
    // Scroll progress bar
    // ---------------------------------------------------------------
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

    // ---------------------------------------------------------------
    // Hero glow blobs: gentle cursor parallax
    // ---------------------------------------------------------------
    const glowField = document.getElementById('glow-field');
    if (glowField && finePointer && !reduceMotion) {
      let px = 0, py = 0, cx = 0, cy = 0;
      let rafParallax = null;
      const tick = () => {
        rafParallax = null;
        cx += (px - cx) * 0.05;
        cy += (py - cy) * 0.05;
        glowField.style.transform = 'translate3d(' + cx.toFixed(2) + 'px,' + cy.toFixed(2) + 'px,0)';
        if (Math.abs(px - cx) > 0.05 || Math.abs(py - cy) > 0.05) {
          rafParallax = requestAnimationFrame(tick);
        }
      };
      window.addEventListener('pointermove', (e) => {
        px = (e.clientX / window.innerWidth - 0.5) * 26;
        py = (e.clientY / window.innerHeight - 0.5) * 18;
        if (!rafParallax) rafParallax = requestAnimationFrame(tick);
      }, { passive: true });
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

    // ---------------------------------------------------------------
    // Motion Vanilla animations (progressive enhancement, optional)
    // ---------------------------------------------------------------
    (function initMotion() {
      if (typeof Motion === 'undefined' || reduceMotion) return;
      const ease = [0.16, 1, 0.3, 1];

      const run = (el, keyframes, opts, persistent) => {
        if (el._motionAnim) {
          try { el._motionAnim.stop(); } catch (err) { /* noop */ }
        }
        const anim = Motion.animate(el, keyframes, opts);
        el._motionAnim = anim;
        if (!persistent) {
          anim.finished.then(() => {
            try { anim.stop(); } catch (err) { /* noop */ }
            if (el._motionAnim === anim) el._motionAnim = null;
            el.style.opacity = '';
            el.style.transform = '';
          }).catch(() => {
            el.style.opacity = '';
            el.style.transform = '';
          });
        }
        return anim;
      };

      // Hero: scroll-cue fades in + slides up slightly after the headline reveals
      const heroScroll = document.querySelector('.hero-scroll');
      if (heroScroll) {
        heroScroll.style.opacity = '0';
        heroScroll.style.transform = 'translateY(-8px)';
        run(heroScroll, {
          opacity: [0, 1],
          y: [-8, 0]
        }, { duration: 0.7, easing: ease, delay: 0.9 }, false);
      }

      // Micro-interactions: light hover lift + click bounce
      const clickables = document.querySelectorAll('.btn:not([data-magnetic]), .back-to-top');
      if (finePointer) {
        clickables.forEach(el => {
          el.addEventListener('pointerenter', () => {
            run(el, { scale: 1.05, y: -2 }, { duration: 0.22, easing: 'ease-out' }, true);
          });
          el.addEventListener('pointerleave', () => {
            run(el, { scale: 1, y: 0 }, { duration: 0.18, easing: 'ease-in' }, false);
          });
        });
      }
      clickables.forEach(el => {
        el.addEventListener('pointerdown', () => {
          run(el, { scale: 0.95 }, { duration: 0.08, easing: 'ease-out' }, true);
        }, { passive: true });
        const release = () => {
          run(el, { scale: 1 }, { type: 'spring', stiffness: 520, damping: 18 }, false);
        };
        el.addEventListener('pointerup', release, { passive: true });
        el.addEventListener('pointercancel', release, { passive: true });
      });

      // Scroll reveal: headings fade up + underline draws in,
      // tool-card icons pop in with a light stagger, footer rises softly
      const motionTargets = Array.from(document.querySelectorAll('main h2')).map(el => ({ el, kind: 'heading' }));
      document.querySelectorAll('[data-reveal] > div:first-child').forEach(el => {
        if (/\bw-12\b|\bw-14\b|\bw-16\b/.test(el.className)) motionTargets.push({ el, kind: 'icon' });
      });
      const footer = document.querySelector('footer');
      if (footer) motionTargets.push({ el: footer, kind: 'block' });
      if (motionTargets.length && 'IntersectionObserver' in window) {
        let iconIndex = 0;
        const mio = new IntersectionObserver((entries, obs) => {
          entries.forEach(en => {
            if (!en.isIntersecting) return;
            obs.unobserve(en.target);
            const el = en.target;
            if (el.dataset.motionKind === 'icon') {
              el.style.opacity = '0';
              el.style.transform = 'scale(0.85)';
              run(el, {
                opacity: [0, 1],
                scale: [0.85, 1]
              }, { duration: 0.55, easing: 'ease-out', delay: Math.min(iconIndex++ * 80, 320) }, false);
            } else if (el.dataset.motionKind === 'heading') {
              el.classList.add('title-line');
              el.classList.add('is-titled');
              el.style.opacity = '0';
              el.style.transform = 'translateY(22px)';
              run(el, {
                opacity: [0, 1],
                y: [22, 0]
              }, { duration: 0.75, easing: ease }, false);
            } else {
              el.style.opacity = '0';
              el.style.transform = 'translateY(18px)';
              run(el, {
                opacity: [0, 1],
                y: [18, 0]
              }, { duration: 0.7, easing: ease }, false);
            }
          });
        }, { threshold: 0.18 });
        motionTargets.forEach(({ el, kind }) => {
          el.dataset.motionKind = kind;
          mio.observe(el);
        });
      }
    })();
  