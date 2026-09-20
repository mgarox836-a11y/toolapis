/* TOOLAPIS — plain JS. No frameworks, no build step.
   Honors OS prefers-reduced-motion (video pause, no animation, no smooth scroll). */
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  var finePointer = window.matchMedia('(pointer: fine)').matches;
  var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduceMotion = function () { return mqReduce.matches; };

  /* ---------------------------------------------------------------
     Reduced-motion: the background is a VIDEO, so CSS cannot pause it.
     Paused it holds its first frame (the poster). Match media live.
     --------------------------------------------------------------- */
  (function () {
    var v = document.querySelector('video.art');
    if (!v) return;
    function sync() {
      if (mqReduce.matches) { v.pause(); }
      else { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    }
    sync();
    mqReduce.addEventListener ? mqReduce.addEventListener('change', sync) : mqReduce.addListener(sync);
  })();

  /* ---------------------------------------------------------------
     Entrance: pure CSS. Retire it once the last tween ends so a later
     breakpoint change can never replay it.
     --------------------------------------------------------------- */
  (function () {
    var doneFired = false;
    var timer = null;
    function done() {
      if (doneFired) return;
      doneFired = true;
      if (timer) { window.clearTimeout(timer); timer = null; }
      document.documentElement.classList.add('is-entered');
    }
    var last = document.getElementById('foot2');
    if (last && !reduceMotion()) {
      last.addEventListener('animationend', done, { once: true });
      timer = window.setTimeout(done, 4000);
    } else if (last) {
      done();
    } else {
      done();
    }
  })();

  /* ---------------------------------------------------------------
     Burger (checkbox-driven CSS): close the panel on link click, ESC,
     and click-away.
     --------------------------------------------------------------- */
  (function () {
    var navOpen = document.getElementById('nav-open');
    if (!navOpen) return;
    var close = function () { navOpen.checked = false; };
    document.querySelectorAll('.navpanel a').forEach(function (a) {
      a.addEventListener('click', close);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navOpen.checked) {
        close();
        var burger = document.querySelector('.bar .burger');
        if (burger) burger.focus();
      }
    });
  })();

  /* ---------------------------------------------------------------
     Navbar glass state + back-to-top, driven by a sentinel at page top.
     --------------------------------------------------------------- */
  (function () {
    var sentinel = document.getElementById('nav-sentinel');
    var navbar = document.getElementById('navbar');
    var backToTop = document.getElementById('back-to-top');
    if (!sentinel || !navbar || !('IntersectionObserver' in window)) {
      if (navbar) navbar.classList.add('nav-solid');
      if (backToTop) backToTop.classList.add('visible');
      return;
    }
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var scrolled = !en.isIntersecting;
        navbar.classList.toggle('nav-solid', scrolled);
        if (backToTop) backToTop.classList.toggle('visible', scrolled);
      });
    }, { threshold: 0 }).observe(sentinel);

    if (backToTop) {
      backToTop.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
      });
    }
  })();

  /* ---------------------------------------------------------------
     Scroll progress bar
     --------------------------------------------------------------- */
  (function () {
    var bar = document.getElementById('scroll-progress');
    if (!bar) return;
    var update = function () {
      var doc = document.documentElement;
      var total = doc.scrollHeight - doc.clientHeight;
      var p = total > 0 ? doc.scrollTop / total : 0;
      bar.style.transform = 'scaleX(' + p + ')';
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
  })();

  /* ---------------------------------------------------------------
     Scrollspy — highlight the section link in the top bar
     --------------------------------------------------------------- */
  (function () {
    var links = Array.prototype.slice.call(document.querySelectorAll('.bar .menu a[href^="#"]'));
    var ids = links.map(function (a) { return a.getAttribute('href').slice(1); })
      .map(function (id) { return document.getElementById(id); })
      .filter(Boolean);
    if (!links.length || !ids.length || !('IntersectionObserver' in window)) return;
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var id = '#' + en.target.id;
        links.forEach(function (l) { l.classList.toggle('active', l.getAttribute('href') === id); });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    ids.forEach(function (s) { spy.observe(s); });
  })();

  /* ---------------------------------------------------------------
     Reveal-on-scroll — respects prefers-reduced-motion
     --------------------------------------------------------------- */
  (function () {
    var els = document.querySelectorAll('.reveal');
    if (!els.length) return;
    var shown = new WeakSet();
    var show = function (el) {
      if (shown.has(el)) return;
      shown.add(el);
      el.classList.add('is-visible', 'active');
    };
    if (reduceMotion() || !('IntersectionObserver' in window)) {
      [].forEach.call(els, show);
      return;
    }
    var io = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { show(en.target); obs.unobserve(en.target); }
      });
    }, { threshold: 0.15 });
    [].forEach.call(els, function (el) { io.observe(el); });

    var passVisible = function () {
      [].forEach.call(els, function (el) {
        if (shown.has(el)) return;
        var r = el.getBoundingClientRect();
        if (r.top <= window.innerHeight && r.bottom > 0) show(el);
      });
    };
    window.addEventListener('load', function () { requestAnimationFrame(passVisible); }, { once: true });
    var ticking = false;
    var onLayout = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { passVisible(); ticking = false; });
    };
    window.addEventListener('scroll', onLayout, { passive: true });
    window.addEventListener('resize', onLayout, { passive: true });
  })();

  /* ---------------------------------------------------------------
     3D tilt cards + magnetic buttons — pointer devices only
     --------------------------------------------------------------- */
  if (finePointer && !reduceMotion()) {
    document.querySelectorAll('.tilt').forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width;
        var py = (e.clientY - r.top) / r.height;
        var rx = (0.5 - py) * Number(card.dataset.tilt || 8);
        var ry = (px - 0.5) * Number(card.dataset.tilt || 8) * 1.4;
        card.style.transform = 'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) translateY(-4px)';
        card.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
        card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
      });
      card.addEventListener('pointerleave', function () { card.style.transform = ''; });
    });

    document.querySelectorAll('[data-magnetic]').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var dx = (e.clientX - r.left - r.width / 2) * 0.12;
        var dy = (e.clientY - r.top - r.height / 2) * 0.2;
        el.style.transform = 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px)';
      });
      el.addEventListener('pointerleave', function () { el.style.transform = ''; });
    });
  }

  /* ---------------------------------------------------------------
     Spotlight cursor glow (gold, subtle)
     --------------------------------------------------------------- */
  (function () {
    var spot = document.getElementById('spotlight');
    if (!spot || !finePointer) return;
    spot.style.opacity = '1';
    window.addEventListener('mousemove', function (e) {
      spot.style.background = 'radial-gradient(600px circle at ' + e.clientX + 'px ' + e.clientY + 'px, rgba(255,214,166,0.055), transparent 80%)';
    }, { passive: true });
  })();

  /* ---------------------------------------------------------------
     Page transition overlay for external navigation
     --------------------------------------------------------------- */
  (function () {
    var pt = document.getElementById('page-transition');
    if (!pt) return;
    pt.style.transition = 'none';
    pt.classList.add('active');
    void pt.offsetHeight;
    pt.style.transition = '';
    var hide = function () { pt.classList.remove('active'); };
    if (document.readyState === 'loading' || document.readyState === 'interactive') {
      document.addEventListener('DOMContentLoaded', hide, { once: true });
    } else {
      requestAnimationFrame(hide);
    }

    var locked = false;
    document.addEventListener('click', function (e) {
      if (locked || e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var link = e.target.closest('a');
      if (!link) return;
      var href = link.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;
      if (link.target === '_blank' || link.hasAttribute('download')) return;
      var url;
      try { url = new URL(href, window.location.href); } catch (err) { return; }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      if (url.origin === window.location.origin &&
          url.pathname === window.location.pathname &&
          url.search === window.location.search) return;
      e.preventDefault();
      locked = true;
      pt.classList.add('active');
      window.setTimeout(function () { window.location.href = link.href; }, reduceMotion() ? 0 : 400);
    });
  })();

  /* ---------------------------------------------------------------
     Clipboard helper (global for onclick handlers) + toast
     --------------------------------------------------------------- */
  function showToast(message) {
    var toast = document.getElementById('toast');
    var msg = document.getElementById('toast-message');
    if (!toast || !msg) return;
    msg.innerText = message;
    toast.classList.add('show');
    if (toast._timer) { window.clearTimeout(toast._timer); }
    toast._timer = window.setTimeout(function () {
      toast.classList.remove('show');
      toast._timer = null;
    }, 3000);
  }

  window.copyToClipboard = function (text, message) {
    var success = function () { showToast(message); };
    var fallback = function () {
      try {
        var ta = document.createElement('textarea');
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
        /* noop */
      }
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(success).catch(fallback);
    } else {
      fallback();
    }
  };
})();