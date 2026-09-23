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
     Preloader — counter/bar, curtain exit, camera zoom-out, hero reveal (~5s)
     --------------------------------------------------------------- */
  function preloaderSequence() {
    var pre = document.getElementById('preloader');
    var counter = document.querySelector('.loader-counter');
    var bar = document.querySelector('.loader-bar');
    var bodyClass = document.body.classList;

    if (reduceMotion() || !pre) {
      if (pre) { pre.style.display = 'none'; }
      bodyClass.remove('loading');
      if (webgl.starburst) { webgl.starburst(); }
      return;
    }

    var obj = { v: 0 };
    if (counter) { counter.textContent = '00%'; }
    if (bar) { bar.style.width = '0%'; }

    var tl = gsapLib.timeline({
      defaults: { ease: 'power2.inOut' },
      onComplete: function () {
        bodyClass.remove('loading');
        pre.style.display = 'none';
        if (window.ScrollTrigger) { window.ScrollTrigger.refresh(); }
      }
    });

    /* 0.0–2.5s — counter 00%→100% + loading bar 0→100% */
    tl.to(obj, {
      v: 100, duration: 2.5, ease: 'power2.inOut',
      onUpdate: function () {
        if (counter) { counter.textContent = String(Math.round(obj.v)).padStart(2, '0') + '%'; }
      }
    }, 0);
    tl.to(bar, { width: '100%', duration: 2.5, ease: 'power2.inOut' }, 0);

    /* 2.5–3.2s — curtain up, camera snaps to core close-up, canvas fades in */
    tl.set(webgl.camera ? webgl.camera.position : {}, { z: 1 }, 2.5);
    tl.to(pre, { yPercent: -100, duration: 0.8, ease: 'power4.inOut' }, 2.5);
    tl.fromTo('#webgl-canvas', { autoAlpha: 0 }, { autoAlpha: 1, duration: 1, ease: 'power2.inOut', clearProps: 'opacity,visibility' }, 2.6);

    /* 3.2–5.0s — camera zooms out to z:5, starfield bursts open */
    if (webgl.camera) {
      tl.to(webgl.camera.position, { z: 5, duration: 1.8, ease: 'expo.out' }, 3.2);
    }
    tl.call(function () {
      if (webgl.starburst) { webgl.starburst(); }
    }, null, 3.3);

    /* 3.4s — hero copy staggered blur-fade-up, unlock scroll at the end */
    tl.fromTo('.hero-copy > *', {
      y: 25, opacity: 0, filter: 'blur(12px)'
    }, {
      y: 0, opacity: 1, filter: 'blur(0px)', duration: 1.2, ease: 'power3.out', stagger: 0.15,
      clearProps: 'transform,opacity,filter'
    }, 3.4);
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
        window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
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