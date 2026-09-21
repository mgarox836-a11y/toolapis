/* TOOLAPIS — plain JS. No frameworks, no build step.
   Honors OS prefers-reduced-motion (video pause, no animation, no smooth scroll). */

/* Loader constants — tune here (false = loader runs on every open/refresh). */
var LOADER_MIN_MS = 4000;
var LOADER_MAX_MS = 7000;
var HERO_START_OFFSET_MS = 450;
var SKIP_IF_SEEN_THIS_SESSION = false;
var SHOW_SKIP = false;

/* START_AT_TOP_ON_LOAD=true: every fresh open/refresh starts at the hero,
   the URL hash is ignored on first load, and the browser's scroll
   restoration is suppressed (scrollRestoration manual is set inline in
   <head>). In-page links still smooth-scroll and fill the hash; back/forward
   still restores position (bfcache). false = old hash-as-target behavior. */
var START_AT_TOP_ON_LOAD = true;
var startAtTopFresh = true; /* true unless this is a back_forward restore */
if (START_AT_TOP_ON_LOAD) {
  try {
    var startAtTopNav = performance.getEntriesByType('navigation')[0];
    startAtTopFresh = !startAtTopNav || startAtTopNav.type !== 'back_forward';
  } catch (e) { startAtTopFresh = true; }
}
if (START_AT_TOP_ON_LOAD && startAtTopFresh) {
  /* (a) strip the hash and pin to top as early as possible */
  if (window.location.hash && history.replaceState) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}

(function () {
  'use strict';

  /* html.js is added statically by an inline script in <head> before first
     paint, so html.js.is-loading holds the entrance from the very start.
     This line only guards against an inline-script failure (idempotent). */
  document.documentElement.classList.add('js');

  var finePointer = window.matchMedia('(pointer: fine)').matches;
  var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var motionAlways = document.documentElement.dataset.motion === 'always';
  /* the switch: html[data-motion="always"] overrides the OS reduced-motion
     preference. Everything (entrance, reveals, video, smooth scroll, tilt)
     follows this single source of truth. */
  var reduceMotion = function () { return !motionAlways && mqReduce.matches; };

  /* ---------------------------------------------------------------
     Reduced-motion: the background is a VIDEO, so CSS cannot pause it.
     Paused it holds its first frame (the poster). Match media live.
     --------------------------------------------------------------- */
  (function () {
    var v = document.querySelector('video.art');
    if (!v) return;
    function sync() {
      if (reduceMotion()) { v.pause(); }
      else { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    }
    sync();
    mqReduce.addEventListener ? mqReduce.addEventListener('change', sync) : mqReduce.addListener(sync);
  })();

  /* ---------------------------------------------------------------
     Entrance: pure CSS. Retire it once the last tween ends so a later
     breakpoint change can never replay it. The loader holds this off
     (animation-play-state: paused) and calls armEntranceRetire() at the
     release point, so both the #foot2 animationend listener and the
     4000ms safety timer start counting AFTER the hero is released, not
     at page load.
     --------------------------------------------------------------- */
  var armEntranceRetire = (function () {
    var doneFired = false;
    var timer = null;
    function done() {
      if (doneFired) return;
      doneFired = true;
      if (timer) { window.clearTimeout(timer); timer = null; }
      document.documentElement.classList.add('is-entered');
    }
    return function () {
      var last = document.getElementById('foot2');
      if (last && !reduceMotion()) {
        last.addEventListener('animationend', done, { once: true });
        timer = window.setTimeout(done, 4000);
      } else {
        done();
      }
    };
  })();

  /* ---------------------------------------------------------------
     Loader intro — preloader + cinematic shutter into the hero entrance.
     Gates: LOADER_MIN_MS + document.fonts.ready + video ready, hard cap
     LOADER_MAX_MS. Releases is-loading HERO_START_OFFSET_MS after the
     exit begins; never relies on animationend alone (safety timeout).
     --------------------------------------------------------------- */
  (function () {
    var loader = document.getElementById('loader');
    if (!loader) { armEntranceRetire(); return; }

    var docEl = document.documentElement;
    var start = Date.now();
    var shown = 0;                  /* progress 0..1, eased toward target */
    var statusTimer = null;
    var exiting = false;
    var released = false;
    var finished = false;

    var seen = false;
    if (SKIP_IF_SEEN_THIS_SESSION) {
      try { seen = sessionStorage.getItem('loader-seen') === '1'; } catch (e) { seen = false; }
      if (!seen) { try { sessionStorage.setItem('loader-seen', '1'); } catch (e) {} }
    }

    /* reduced motion without the data-motion switch, or JS session skip:
       never show the loader at all */
    if (reduceMotion() || seen) { finish(); return; }

    /* everything behind the loader is inert during the load phase */
    var inertEls = [];
    [].forEach.call(document.body.children, function (el) {
      if (el === loader || el.tagName === 'SCRIPT') return;
      inertEls.push(el);
      if ('inert' in el) el.inert = true;
    });

    var fill = loader.querySelector('.loader-fill');
    var counter = loader.querySelector('.loader-count');
    var status = loader.querySelector('.loader-status');
    var msgs = ['Loading tools', 'Preparing the hub', 'Almost there'];
    var gi = 0;
    if (status) {
      status.textContent = msgs[0];
      statusTimer = window.setInterval(function () {
        gi = (gi + 1) % msgs.length;
        status.textContent = msgs[gi];
      }, 1300);
    }

    /* readiness gates */
    var fontsReady = false;
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { fontsReady = true; }).catch(function () { fontsReady = true; });
    } else {
      fontsReady = true;
    }
    var video = document.querySelector('video.art');
    var videoReady = !video || video.readyState >= 2;
    if (video && !videoReady) {
      var onVideo = function () { videoReady = true; };
      video.addEventListener('loadeddata', onVideo, { once: true });
      video.addEventListener('canplay', onVideo, { once: true });
    }
    function ready() {
      return (Date.now() - start) >= LOADER_MIN_MS && fontsReady && videoReady;
    }

    function paint(p) {
      if (fill) fill.style.scale = p + ' 1';
      if (counter) counter.textContent = String(Math.round(p * 100)).padStart(3, '0');
    }
    function easeIO(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

    /* ease toward ~90% during the wait, settle on 100 exactly when ready */
    function tick() {
      if (finished) return;
      var force = (Date.now() - start) >= LOADER_MAX_MS;
      var target = ready() || force ? 1
        : easeIO(Math.min(1, (Date.now() - start) / LOADER_MIN_MS)) * .9;
      shown += (target - shown) * .15;
      if (shown > .995 && target === 1) shown = 1;
      paint(shown);
      if (force) { exit(); return; }
      if (ready() && shown >= .995) { exit(); return; }
      window.requestAnimationFrame(tick);
    }

    /* after the shutter opens: release the hero, unlock scroll, drop inert */
    function release() {
      if (released) return;
      released = true;
      docEl.classList.remove('is-loading');
      if (START_AT_TOP_ON_LOAD) {
        /* (c) re-pin to top right after the scroll lock is released; the
           browser cannot restore to a lowered section (manual restoration,
           hash already stripped). On a back_forward restore we deliberately
           do nothing, so bfcache keeps the browser's own position. */
        if (startAtTopFresh) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      } else if (window.location.hash) {
        var t = document.getElementById(window.location.hash.slice(1));
        if (t) t.scrollIntoView({ behavior: 'instant' });
      }
      armEntranceRetire();
      inertEls.forEach(function (el) { if ('inert' in el) el.inert = false; });
    }

    function exit() {
      if (exiting) return;
      exiting = true;
      /* (b) pin to top before the shutter starts opening, so it reveals the
         hero, never a lowered section */
      if (START_AT_TOP_ON_LOAD && startAtTopFresh) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      docEl.classList.add('loader-exit');
      window.setTimeout(release, HERO_START_OFFSET_MS);
      loader.addEventListener('animationend', function (e) {
        if (e.animationName === 'ld-up' || e.animationName === 'ld-down') finish();
      });
      window.setTimeout(finish, 1500); /* safety — not dependent on animationend */
    }

    function finish() {
      if (finished) return;
      finished = true;
      docEl.classList.remove('is-loading');
      docEl.classList.add('is-loaded');
      if (statusTimer) window.clearInterval(statusTimer);
      if (loader.parentNode) loader.parentNode.removeChild(loader);
      release();
    }

    /* opt-in Skip button (SHOW_SKIP=true) — tap target >= 44px */
    if (SHOW_SKIP) {
      var skip = loader.querySelector('.loader-skip');
      if (skip) {
        window.setTimeout(function () { skip.hidden = false; }, 1000);
        skip.addEventListener('click', function () { if (!exiting) exit(); });
      }
    }

    /* bfcache: never replay the loader on back/forward restore */
    window.addEventListener('pageshow', function (e) { if (e.persisted && !finished) finish(); });

    window.requestAnimationFrame(tick);
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