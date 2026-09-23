/* TOOLAPIS — GSAP + ScrollTrigger. Animations always forced on. */

(function () {
  'use strict';

  var docEl = document.documentElement;
  var reduceMotion = function () { return false; };

  var gsapLib = window.gsap;
  var webgl = {};
  if (!gsapLib) {
    var deadPre = document.getElementById('preloader');
    if (deadPre) { deadPre.style.display = 'none'; }
    if (document.body) { document.body.classList.remove('loading'); }
    return;
  }
  if (window.ScrollTrigger) { gsapLib.registerPlugin(window.ScrollTrigger); }
  if (document.body) { document.body.classList.add('loading'); }

  /* ---------------------------------------------------------------
     3D quantum eclipse — black hole + holographic rings + 3-layer warp.
     Fullscreen background, spring parallax, reduced-motion safe.
     --------------------------------------------------------------- */
  function threeSculpt() {
    var canvas = document.getElementById('webgl-canvas');
    if (!canvas || !window.THREE) { return; }
    if (reduceMotion()) { canvas.style.display = 'none'; return; }

    try {
      var THREE = window.THREE;
      var mobile = window.innerWidth <= 760;

      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(0, 0, 5);
      webgl.camera = camera;

      var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
      renderer.setClearColor(0x000000, 0);
      renderer.outputEncoding = THREE.sRGBEncoding;

      /* -------- soft radial texture (shared by glows) -------- */
      var glowTex = (function () {
        var c = document.createElement('canvas');
        c.width = c.height = 128;
        var ctx = c.getContext('2d');
        var g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
        return new THREE.CanvasTexture(c);
      })();

      /* -------- golden accretion black hole -------- */
      var eclipse = new THREE.Group();
      var darkSphere = new THREE.Mesh(
        new THREE.SphereGeometry(2.4, 48, 48),
        new THREE.MeshBasicMaterial({ color: 0x000000 })
      );

      var glowSprite = function (color, scale, z, opacity) {
        var s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, color: color, transparent: true, opacity: opacity,
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
        s.scale.set(scale, scale, 1);
        s.position.z = z;
        return s;
      };
      /* gravitational energy halo */
      var coreGlow = glowSprite(0x00f0ff, 11, -2.5, mobile ? 0.35 : 0.5);
      var innerGlow = glowSprite(0x00d4ff, 5.5, -1, 0.4);

      /* thin additive rim = gravitational lensing on the edge */
      var fresnelRim = new THREE.Mesh(
        new THREE.RingGeometry(2.5, 2.62, 64),
        new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.6,
          side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      fresnelRim.position.z = 0.02;

      /* accretion disk — warm gold, two graded additive rings */
      var accOuter = new THREE.Mesh(
        new THREE.RingGeometry(2.6, 3.3, 80),
        new THREE.MeshBasicMaterial({ color: 0x0066ff, transparent: true, opacity: 0.35,
          side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      accOuter.position.z = -0.25;
      var accInner = new THREE.Mesh(
        new THREE.RingGeometry(2.7, 2.95, 80),
        new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.3,
          side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      accInner.position.z = -0.3;

      eclipse.add(darkSphere, coreGlow, innerGlow, fresnelRim, accOuter, accInner);
      eclipse.position.set(2, mobile ? 2 : 0, -5);
      scene.add(eclipse);

      /* -------- golden holographic rings -------- */
      var ringCore = new THREE.Mesh(
        new THREE.RingGeometry(3.2, 3.6, 80),
        new THREE.MeshStandardMaterial({
          color: 0x00f0ff, emissive: 0x00f0ff, emissiveIntensity: 1.6,
          transparent: true, opacity: 0.6, side: THREE.DoubleSide
        })
      );
      var ringData = new THREE.Mesh(
        new THREE.RingGeometry(5.1, 5.3, 80),
        new THREE.MeshBasicMaterial({
          color: 0x0066ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
          wireframe: true, blending: THREE.AdditiveBlending, depthWrite: false
        })
      );
      ringData.rotation.x = 1.15;
      ringData.position.z = 0.2;
      eclipse.add(ringCore, ringData);

      /* -------- multi-layer warp starfield — starburst on load -------- */
      var layers = [];
      var starBurst = { progress: 0 };
      var makeLayer = function (count, size, speedMin, speedMax, color, additive) {
        var cluster = new Float32Array(count * 3);
        var target = new Float32Array(count * 3);
        var speed = new Float32Array(count);
        var spreadX = 22, spreadY = 14;
        for (var i = 0; i < count; i++) {
          /* starburst origin: tight core, ready to explode */
          cluster[i * 3] = 2 + (Math.random() - 0.5) * 2;
          cluster[i * 3 + 1] = (Math.random() - 0.5) * 2;
          cluster[i * 3 + 2] = -12 + (Math.random() - 0.5) * 1;
          /* final home after the burst */
          target[i * 3] = (Math.random() - 0.5) * spreadX;
          target[i * 3 + 1] = (Math.random() - 0.5) * spreadY;
          target[i * 3 + 2] = -20 - Math.random() * 14;
          speed[i] = speedMin + Math.random() * (speedMax - speedMin);
        }
        var pos = cluster.slice();
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        var mat = new THREE.PointsMaterial({
          color: color, size: size, transparent: true, opacity: 0.85,
          sizeAttenuation: true, depthWrite: false,
          blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
        });
        var pts = new THREE.Points(geo, mat);
        scene.add(pts);
        var layer = {
          pt: pts, geo: geo, pos: pos, cluster: cluster, target: target,
          speed: speed, count: count, eased: pos.slice()
        };
        layers.push(layer);
        return layer;
      };
      if (mobile) {
        makeLayer(450, 0.03, 0.15, 0.35, 0x8fd4ff);
        makeLayer(250, 0.06, 0.5, 1.0, 0xe0f7ff);
        makeLayer(100, 0.12, 1.3, 2.2, 0xb0f0ff, true);
      } else {
        makeLayer(1100, 0.03, 0.15, 0.35, 0x8fd4ff);
        makeLayer(650, 0.06, 0.5, 1.0, 0xe0f7ff);
        makeLayer(250, 0.12, 1.3, 2.2, 0xb0f0ff, true);
      }

      /* Smoothstep: pos = cluster (0) → target (1). Driven by the GSAP tween below. */
      var CLUSTER = 1e-4;
      function easePos(layer) {
        var k = Math.min(Math.max(starBurst.progress, 0), 1);
        var c = layer.cluster, t = layer.target, o = layer.eased, pos = layer.pos;
        for (var i = 0; i < layer.count; i++) {
          var j3 = i * 3;
          o[j3] = c[j3] + (t[j3] - c[j3]) * k;
          o[j3 + 1] = c[j3 + 1] + (t[j3 + 1] - c[j3 + 1]) * k;
          o[j3 + 2] = c[j3 + 2] + (t[j3 + 2] - c[j3 + 2]) * k;
          pos[j3] = o[j3];
          pos[j3 + 1] = o[j3 + 1];
          pos[j3 + 2] = o[j3 + 2];
        }
        layer.geo.attributes.position.needsUpdate = true;
      }

      /* -------- STARBURST — triggered when preloader curtain lifts -------- */
      webgl.starburst = function () {
        gsapLib.to(starBurst, {
          progress: 1,
          duration: 1.5,
          ease: 'expo.out',
          onUpdate: function () {
            for (var i = 0; i < layers.length; i++) { easePos(layers[i]); }
          }
        });
      };
      function updateStars(dt) {
        for (var l = 0; l < layers.length; l++) {
          var layer = layers[l], arr = layer.pos;
          if (starBurst.progress < CLUSTER) {
            /* still clustered — snap to start, way too small to see */
            layer.geo.attributes.position.needsUpdate = true;
            continue;
          }
          var p = starBurst.progress;
          if (p < 1) { easePos(layer); continue; }
          for (var i = 0; i < layer.count; i++) {
            arr[i * 3 + 2] += layer.speed[i] * dt;
            if (arr[i * 3 + 2] > 4) {
              arr[i * 3] = (Math.random() - 0.5) * 22;
              arr[i * 3 + 1] = (Math.random() - 0.5) * 14;
              arr[i * 3 + 2] = -34;
            }
          }
          layer.geo.attributes.position.needsUpdate = true;
        }
      }

      /* -------- subtle golden dust halo (parallax depth) -------- */
      var dust = new THREE.Group();
      (function () {
        var count = mobile ? 90 : 220;
        var pos = new Float32Array(count * 3);
        for (var i = 0; i < count; i++) {
          var r = 3 + Math.random() * 4;
          var th = Math.random() * Math.PI * 2;
          var ph = Math.acos(2 * Math.random() - 1);
          pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
          pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.5;
          pos[i * 3 + 2] = 2 + r * Math.cos(ph);
        }
        var dg = new THREE.BufferGeometry();
        dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        var dm = new THREE.PointsMaterial({
          color: 0xe0f7ff, size: 0.05, transparent: true, opacity: 0.5,
          sizeAttenuation: true, depthWrite: false,
          blending: THREE.AdditiveBlending
        });
        dust.add(new THREE.Points(dg, dm));
        eclipse.add(dust);
      })();

      function setSize() {
        var w = window.innerWidth, h = window.innerHeight;
        if (!w || !h) { return; }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w <= 760 ? 1.5 : 2));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        if (eclipse) { eclipse.position.set(2, w <= 760 ? 2 : 0, -5); }
      }
      setSize();
      window.addEventListener('resize', setSize);

      /* -------- spring-like mouse parallax — skip on touch -------- */
      var touch = window.matchMedia('(pointer: coarse)').matches;
      var cursor = { x: 0, y: 0 };
      var rotX = null, rotY = null, panX = null, panY = null;
      if (!touch) {
        window.addEventListener('pointermove', function (e) {
          cursor.x = (e.clientX / window.innerWidth) * 2 - 1;
          cursor.y = (e.clientY / window.innerHeight) * 2 - 1;
        }, { passive: true });
        rotX = gsapLib.quickTo(camera.rotation, 'x', { duration: 1.6, ease: 'power3.out' });
        rotY = gsapLib.quickTo(camera.rotation, 'y', { duration: 1.6, ease: 'power3.out' });
        panX = gsapLib.quickTo(camera.position, 'x', { duration: 1.6, ease: 'power3.out' });
        panY = gsapLib.quickTo(camera.position, 'y', { duration: 1.6, ease: 'power3.out' });
      }

      var hidden = false;
      document.addEventListener('visibilitychange', function () {
        hidden = document.hidden;
        if (!hidden) { aframe(); }
      });

      var raf = null;
      function aframe() {
        if (hidden) { return; }
        raf = requestAnimationFrame(aframe);
        var t = performance.now() / 1000;
        var now = Date.now();
        var dt = (!aframe._last || now - aframe._last > 100) ? 0.016 : (now - aframe._last) / 1000;
        aframe._last = now;
        if (dt <= 0) { dt = 0.016; }

        updateStars(dt);

        ringCore.rotation.x += 0.0016 * dt * 60;
        ringCore.rotation.y += 0.0008 * dt * 60;
        ringData.rotation.z -= 0.0032 * dt * 60;
        fresnelRim.rotation.z += 0.0006 * dt * 60;
        accOuter.rotation.z -= 0.0028 * dt * 60;
        accInner.rotation.z += 0.0022 * dt * 60;
        dust.rotation.y -= 0.0004 * dt * 60;

        if (rotX) {
          rotX(cursor.y * 0.06);
          rotY(cursor.x * 0.1);
          panX(cursor.x * 0.22);
          panY(cursor.y * 0.16);
        }
        renderer.render(scene, camera);
      }
      aframe();
    } catch (err) {
      canvas.style.display = 'none';
      console.warn('[three] deep-space canvas disabled:', err);
    }
  }

  /* ---------------------------------------------------------------
     Preloader — split-letter reveal, counter ticker, status HUD,
     clip-path wipe exit, camera zoom-out, hero blur-fade (~4.2s)
     --------------------------------------------------------------- */
  function preloaderSequence() {
    var pre = document.getElementById('preloader');
    var counter = document.querySelector('.loader-counter');
    var bar = document.querySelector('.loader-bar');
    var statusText = document.querySelector('.loader-status-text');
    var letters = document.querySelectorAll('.loader-letter');
    var bodyClass = document.body.classList;

    if (!pre) {
      bodyClass.remove('loading');
      if (webgl.starburst) { webgl.starburst(); }
      return;
    }

    var obj = { v: 0 };
    if (counter) { counter.textContent = '00%'; }
    if (bar) { bar.style.width = '0%'; }
    if (statusText) { statusText.innerText = 'BOOTING CORE...'; }

    function statusSwap(v) {
      if (!statusText) { return; }
      var msg = 'BOOTING CORE...';
      if (v >= 100) { msg = 'READY'; }
      else if (v >= 70) { msg = 'RENDERING SCENE...'; }
      else if (v >= 25) { msg = 'LOADING ASSETS...'; }
      statusText.innerText = msg;
    }

    var tl = gsapLib.timeline({
      defaults: { ease: 'power2.inOut' },
      onComplete: function () {
        bodyClass.remove('loading');
        pre.style.display = 'none';
        pre.style.pointerEvents = 'none';
        if (window.ScrollTrigger) { window.ScrollTrigger.refresh(); }
      }
    });

    /* 0.0–0.55 — HUD + brand split-letter kinetic reveal (staggered blur fade-up) */
    tl.from('.loader-hud', { autoAlpha: 0, y: 10, duration: 0.5, ease: 'power2.out', clearProps: 'transform,opacity,visibility' }, 0);
    tl.from(letters, {
      yPercent: 120, autoAlpha: 0, filter: 'blur(8px)', duration: 0.7,
      stagger: 0.055, ease: 'power3.out', clearProps: 'transform,opacity,filter'
    }, 0.05);

    /* 0.05–2.05 — counter ticker 00→100% + glowing bar + status text swap */
    tl.to(obj, {
      v: 100, duration: 2.0, ease: 'power2.inOut',
      onUpdate: function () {
        if (counter) {
          counter.textContent = String(Math.round(obj.v)).padStart(2, '0') + '%';
          counter.style.filter = 'blur(' + ((100 - obj.v) * 0.012).toFixed(2) + 'px)';
        }
        if (bar) { bar.style.width = obj.v + '%'; }
        statusSwap(obj.v);
      }
    }, 0.05);

    /* 2.05 — complete pulse: counter pop + bar glow flash */
    tl.to('.loader-counter', { scale: 1.18, duration: 0.15, yoyo: true, repeat: 1, ease: 'power2.out', clearProps: 'transform' }, 2.05);
    tl.to('.loader-bar', { boxShadow: '0 0 22px rgba(0, 240, 255, 1)', duration: 0.2, yoyo: true, repeat: 1, clearProps: 'box-shadow' }, 2.05);

    /* 2.1–2.35 — content dissolves away before the wipe */
    tl.to('.loader-content', { autoAlpha: 0, scale: 0.96, filter: 'blur(6px)', duration: 0.25, ease: 'power2.in' }, 2.1);

    /* 2.1 — camera snaps to core close-up, canvas fades in beneath */
    tl.set(webgl.camera ? webgl.camera.position : {}, { z: 1 }, 2.1);
    tl.fromTo('#webgl-canvas', { autoAlpha: 0 }, { autoAlpha: 1, duration: 1, ease: 'power2.inOut', clearProps: 'opacity,visibility' }, 2.2);

    /* 2.3–3.2 — clip-path wipe (top→bottom) + energy swoosh streak */
    tl.fromTo(pre, { clipPath: 'inset(0% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.9, ease: 'power4.inOut' }, 2.3);
    tl.add(function () { pre.classList.add('sweeping'); }, 2.3);

    /* 3.2 — curtain gone: unlock scroll + drop preloader from the paint tree */
    tl.add(function () {
      bodyClass.remove('loading');
      pre.style.pointerEvents = 'none';
      pre.style.display = 'none';
    }, 3.2);

    /* 2.4–4.2 — camera zooms out to z:5, starfield bursts open */
    if (webgl.camera) {
      tl.to(webgl.camera.position, { z: 5, duration: 1.8, ease: 'expo.out' }, 2.4);
    }
    tl.call(function () {
      if (webgl.starburst) { webgl.starburst(); }
    }, null, 2.7);

    /* 3.0s — hero copy rides the wipe tail, staggered blur-fade-up */
    tl.fromTo('.hero-copy > *', {
      y: 25, opacity: 0, filter: 'blur(12px)'
    }, {
      y: 0, opacity: 1, filter: 'blur(0px)', duration: 1.0, ease: 'power3.out', stagger: 0.15,
      clearProps: 'transform,opacity,filter'
    }, 3.0);
  }

  /* ---------------------------------------------------------------
     Magnetic hero CTA — subtle follow on hover (skip touch)
     --------------------------------------------------------------- */
  function magneticCta() {
    var btn = document.querySelector('.hero-cta');
    if (!btn || window.matchMedia('(pointer: coarse)').matches) { return; }
    var strength = 0.3;
    btn.addEventListener('pointermove', function (e) {
      var r = btn.getBoundingClientRect();
      var dx = e.clientX - (r.left + r.width / 2);
      var dy = e.clientY - (r.top + r.height / 2);
      gsapLib.to(btn, { x: dx * strength, y: dy * strength, duration: 0.3, ease: 'power3.out', overwrite: 'auto' });
    });
    btn.addEventListener('pointerleave', function () {
      gsapLib.to(btn, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.4)', overwrite: 'auto' });
    });
  }

  /* ---------------------------------------------------------------
     Scroll reveals — blur-fade-up, staggered
     --------------------------------------------------------------- */
  function scrollReveals() {
    var st = window.ScrollTrigger;
    var reveal = function (el, vars) {
      gsapLib.from(el, {
        y: 24, opacity: 0, filter: 'blur(10px)', duration: 0.9, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 82%', once: true },
        clearProps: 'transform,opacity,filter',
        ...vars
      });
    };
    document.querySelectorAll('.sec-head').forEach(function (h) {
      gsapLib.from(h.children, {
        y: 24, opacity: 0, filter: 'blur(10px)', duration: 0.9, ease: 'power3.out',
        stagger: 0.12,
        scrollTrigger: { trigger: h, start: 'top 82%', once: true },
        clearProps: 'transform,opacity,filter'
      });
    });
    document.querySelectorAll('.grid .card, .flow .step').forEach(function (card, i) {
      reveal(card, { delay: (i % 3) * 0.1 });
    });
    document.querySelectorAll('.panel').forEach(function (el) {
      reveal(el, {});
    });
    if (st) st.refresh();
  }

  /* ---------------------------------------------------------------
     Floating elements — slow yoyo drift
     --------------------------------------------------------------- */
  function floaters() {
    gsapLib.to('.blob-a', { y: -28, duration: 6, repeat: -1, yoyo: true, ease: 'sine.inOut' });
    gsapLib.to('.blob-b', { y: 22, duration: 5, repeat: -1, yoyo: true, ease: 'sine.inOut' });
  }

  /* ---------------------------------------------------------------
     Smooth scroll — Lenis engine + native fallback, click handler,
     active menu indicator
     --------------------------------------------------------------- */
  var NAV_OFFSET = 96;
  var lenisSmooth = null;

  function initSmoothScroll() {
    if (window.Lenis) {
      lenisSmooth = new window.Lenis({ lerp: 0.09, wheelMultiplier: 1 });
      if (window.ScrollTrigger) {
        lenisSmooth.on('scroll', window.ScrollTrigger.update);
      }
      gsapLib.ticker.add(function (t) { lenisSmooth.raf(t * 1000); });
      gsapLib.ticker.lagSmoothing(0);
    }

    var anchors = document.querySelectorAll('a[href^="#"]');
    anchors.forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (document.body.classList.contains('loading')) { e.preventDefault(); return; }
        var href = a.getAttribute('href');
        if (href === '#' || href === '#top') {
          e.preventDefault();
          smoothTo(0);
          setActive(null);
          return;
        }
        var target = document.getElementById(href.slice(1));
        if (!target) { return; }
        e.preventDefault();
        var top = target.getBoundingClientRect().top + (window.scrollY || window.pageYOffset) - NAV_OFFSET;
        smoothTo(top);
        setActive(a);
      });
    });

    setActiveFromScroll();
  }

  function smoothTo(top) {
    if (lenisSmooth) {
      lenisSmooth.scrollTo(top, { duration: 1.2 });
      return;
    }
    /* rAF fallback — scrollTo(0, y) instant is never coerced by the
       browser under prefers-reduced-motion, so this stays smooth everywhere */
    var start = window.scrollY || window.pageYOffset;
    var dist = top - start;
    if (Math.abs(dist) < 2) { window.scrollTo(0, top); return; }
    var dur = 1200, t0 = null;
    var ease = function (t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    };
    function step(ts) {
      if (t0 === null) { t0 = ts; }
      var p = Math.min(1, (ts - t0) / dur);
      window.scrollTo(0, start + dist * ease(p));
      if (p < 1) { requestAnimationFrame(step); }
    }
    requestAnimationFrame(step);
  }

  function setActive(link) {
    var menu = document.querySelectorAll('.menu a');
    menu.forEach(function (m) {
      m.classList.toggle('active', link ? m === link : m.getAttribute('href') === '#overview' && window.scrollY < 1);
    });
  }

  function setActiveFromScroll() {
    var st = window.ScrollTrigger;
    if (!st) { return; }
    document.querySelectorAll('.menu a[href^="#"]').forEach(function (a) {
      var target = document.getElementById(a.getAttribute('href').slice(1));
      if (!target) { return; }
      st.create({
        trigger: target,
        start: 'top 45%',
        end: 'top 10%',
        onToggle: function (self) {
          if (self.isActive) { setActive(a); }
        }
      });
    });
  }

  /* ---------------------------------------------------------------
     Utility: navbar state + back-to-top
     --------------------------------------------------------------- */
  (function () {
    var sentinel = document.getElementById('nav-sentinel');
    var backToTop = document.getElementById('back-to-top');
    if (!sentinel || !('IntersectionObserver' in window)) {
      if (backToTop) backToTop.classList.add('visible');
      return;
    }
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var scrolled = !en.isIntersecting;
        if (backToTop) backToTop.classList.toggle('visible', scrolled);
      });
    }, { threshold: 0 }).observe(sentinel);

    if (backToTop) {
      backToTop.addEventListener('click', function () {
        smoothTo(0);
        setActive(null);
      });
    }
  })();

  /* ---------------------------------------------------------------
     Toast + clipboard (global for inline onclick)
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
      } catch (err) { /* noop */ }
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(success).catch(fallback);
    } else { fallback(); }
  };

  function start() {
    if (reduceMotion()) {
      /* content stays visible; no animation at all */
      gsapLib.set('.blob', { display: 'none' });
      var canvas = document.getElementById('webgl-canvas');
      if (canvas) { canvas.style.display = 'none'; }
      var pre = document.getElementById('preloader');
      if (pre) { pre.style.display = 'none'; }
      document.body.classList.remove('loading');
      return;
    }
    try { threeSculpt(); } catch (err) {
      console.warn('[three] deep-space init failed:', err);
      var cnv = document.getElementById('webgl-canvas');
      if (cnv) { cnv.style.display = 'none'; }
    }
    preloaderSequence();
    initSmoothScroll();
    scrollReveals();
    floaters();
    magneticCta();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      if (window.ScrollTrigger) window.ScrollTrigger.refresh();
    }).catch(function () {});
  }
})();