(function () {
  const root = document.documentElement;
  const hero = document.getElementById('hero');
  if (!hero) return;

  const video = hero.querySelector('.hero-video');
  const card = hero.querySelector('.hero-boarding');
  const contrail = hero.querySelector('.hero-contrail');

  const reduceMotion = root.classList.contains('motion-reduced') || root.classList.contains('reduced-motion') || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function pauseVideo() {
    if (video && !video.paused) {
      video.pause();
    }
  }

  function playVideo() {
    if (video && video.paused && !reduceMotion) {
      video.play().catch(function () {});
    }
  }

  if (video) {
    if (reduceMotion) {
      video.pause();
      video.removeAttribute('autoplay');
    } else {
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
    }
  }

  if (contrail && !reduceMotion) {
    window.setTimeout(function () {
      contrail.classList.add('is-drawn');
      window.setTimeout(function () {
        contrail.classList.add('is-loop');
      }, 1600);
    }, 1000);
  } else if (contrail) {
    contrail.classList.add('is-drawn', 'is-loop');
  }

  const io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        playVideo();
      } else {
        pauseVideo();
      }
    });
  }, { threshold: 0.1 });

  io.observe(hero);

  const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  let raf = null;

  function onMouseMove(e) {
    if (reduceMotion || isTouch) return;
    const x = (e.clientX / window.innerWidth - 0.5) * 2;
    const y = (e.clientY / window.innerHeight - 0.5) * 2;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () {
      if (video) {
        video.style.transform = 'scale(1.08) translate(' + (x * -6) + 'px, ' + (y * -4) + 'px)';
      }
      if (card) {
        card.style.transform = 'translateY(' + (y * 4) + 'px) translateX(' + (x * 6) + 'px)';
      }
      root.style.setProperty('--hero-parallax-x', (x * 6) + 'px');
      root.style.setProperty('--hero-parallax-y', (y * 4) + 'px');
    });
  }

  function resetParallax() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (video) video.style.transform = 'scale(1.08)';
    if (card) card.style.removeProperty('transform');
    root.style.removeProperty('--hero-parallax-x');
    root.style.removeProperty('--hero-parallax-y');
  }

  if (!reduceMotion && !isTouch) {
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('mouseout', resetParallax);
  }

  const coordsEl = hero.querySelector('[data-coords]');
  if (coordsEl) {
    const baseLat = 37.7681;
    const baseLon = -122.0039;
    let t = 0;
    function updateCoords() {
      if (reduceMotion) return;
      t += 0.00008;
      const lat = (baseLat + Math.sin(t) * 0.0004).toFixed(4);
      const lon = (baseLon + Math.cos(t) * 0.0005).toFixed(4);
      coordsEl.textContent = lat + '° N, ' + lon + '° W';
    }
    setInterval(updateCoords, 1200);
  }
})();
