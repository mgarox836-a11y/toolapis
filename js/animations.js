/* =============================================================================
   ANIMATIONS — scroll choreography
   -----------------------------------------------------------------------------
   Transform, opacity and the two effects the brief names explicitly (the
   squiggle's stroke and the clarity word colour). No pin, no parallax below
   1024px, nothing at all under `prefers-reduced-motion: reduce`.

   Every tween is tracked so turning motion off can undo it cleanly.
   ========================================================================== */

export function initAnimations() {
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;

  if (!gsap || !ScrollTrigger) {
    return { rebuild() {}, destroy() {} };
  }

  gsap.registerPlugin(ScrollTrigger);

  let tweens = [];
  let media = null;

  const reduced = () => document.documentElement.classList.contains('motion-reduced');

  function add(tween) {
    tweens.push(tween);
    return tween;
  }

  function build() {
    destroy();
    if (reduced()) return;

    /* Desktop only: the artwork drifts and the green blob grows. Below 1024
       those effects are skipped entirely — no pin, no fixed layout. */
    media = gsap.matchMedia();
    media.add('(min-width: 1024px)', () => {
      add(gsap.to('.hero__art', {
        y: -54,
        ease: 'none',
        scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: 0.5 }
      }));

      gsap.utils.toArray('[data-depth]').forEach((el) => {
        const depth = parseFloat(el.getAttribute('data-depth')) || 1;
        add(gsap.to(el, {
          y: -42 * depth,
          ease: 'none',
          scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: 0.6 }
        }));
      });

      add(gsap.fromTo('.tools__blob',
        { scale: 0.9, rotate: -6 },
        {
          scale: 1.02,
          rotate: 16,
          ease: 'none',
          scrollTrigger: { trigger: '.tools', start: 'top 80%', end: 'bottom bottom', scrub: 0.7 }
        }));
    });

    /* The connector draws itself as the steps arrive. */
    add(gsap.to('[data-flow-path]', {
      strokeDashoffset: 0,
      ease: 'none',
      scrollTrigger: {
        trigger: '.flow__track',
        start: 'top 78%',
        end: 'bottom 58%',
        scrub: 0.5
      }
    }));

    /* The statement warms word by word. */
    add(gsap.to('.clarity__w:not(.clarity__w--accent)', {
      color: '#f2efe2',
      stagger: 0.18,
      ease: 'none',
      scrollTrigger: {
        trigger: '[data-clarity]',
        start: 'top 80%',
        end: 'bottom 62%',
        scrub: 0.6
      }
    }));
  }

  function destroy() {
    tweens.forEach((tween) => {
      if (tween.scrollTrigger) tween.scrollTrigger.kill();
      tween.kill();
    });
    tweens = [];

    if (media) {
      media.revert();
      media = null;
    }

    gsap.set('.hero__art, [data-depth], .tools__blob', { clearProps: 'transform' });
    gsap.set('[data-flow-path]', { clearProps: 'strokeDashoffset' });
    gsap.set('.clarity__w', { clearProps: 'color' });
  }

  build();

  document.addEventListener('tl:motion', () => {
    build();
    if (!reduced()) ScrollTrigger.refresh();
  });

  if (!reduced()) {
    window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
  }

  return { rebuild: build, destroy };
}
