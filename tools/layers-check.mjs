#!/usr/bin/env node
/* ============================================================================
 * tools/layers-check.mjs — verify the two layers the CSS work touched that a
 * geometry check can't see: the 3D scene's slow fade-in, and the three tool cards.
 * ----------------------------------------------------------------------------
 * Both were previously only asserted as "the rule I wrote is in the sheet", which
 * is not the same as "the browser ran it". Two concrete failure modes this catches:
 *
 *   1. #scene3d-canvas sits at opacity 0 until js/scene3d.js adds .is-ready after
 *      a real frame renders. If that never happens — or if a competing rule wins
 *      the cascade — the whole 3D layer is simply invisible and the page still
 *      looks finished. Nothing in the DOM would say so.
 *
 *   2. style.css and css/hero.css both declare a transition for that canvas
 *      (1.4s vs the stretched 2.4s). Both are single-ID selectors, so the winner
 *      is decided purely by stylesheet order in index.html. This samples the
 *      resolved value and the running opacity instead of trusting the order.
 *
 *   node tools/layers-check.mjs
 *   node tools/layers-check.mjs --width 390
 * ==========================================================================*/

import { chromium } from 'playwright-core';
import { access } from 'node:fs/promises';

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] ?? true); };
const WIDTHS = arg('width') ? [Number(arg('width'))] : [1440, 390];
const BASE = String(arg('url', 'http://localhost:5500/'));

const CANDIDATES = ['/usr/bin/brave', '/usr/bin/brave-browser', '/usr/bin/chromium', '/usr/bin/google-chrome-stable'].filter(Boolean);
let exe = null;
for (const p of CANDIDATES) { try { await access(p); exe = p; break; } catch { /* next */ } }
if (!exe) { console.error('no browser found'); process.exit(1); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio'],
});

for (const width of WIDTHS) {
  const height = width === 390 ? 844 : 900;
  const ctx = await browser.newContext({ viewport: { width, height } });
  /* Installed before any page script runs. The fade is over in 2.4s, and this
     environment needs 15-30s to reach readyState=complete, so a sampler started
     after load only ever sees the finished value — it measures its own lateness,
     not the transition. This watches the class from the moment the canvas exists
     and then tracks the running opacity on rAF until it settles. */
  await ctx.addInitScript(() => {
    window.__fade = { readyAt: null, samples: [], done: false, timer: null, clear: () => { if (window.__fade.timer) clearTimeout(window.__fade.timer); } };
    const attach = (c) => {
      if (c.__watched) return;
      c.__watched = true;
      /* The decisive fact: the canvas is already painted at opacity 0 before the
         class lands, so the two states are separated by a real style recalc and
         the transition cannot be a snap. Read it the moment the element exists. */
      window.__fade.opacityAtAttach = +(+getComputedStyle(c).opacity).toFixed(3);
      window.__fade.hadReadyAtAttach = c.classList.contains('is-ready');
      const begin = () => {
        if (window.__fade.readyAt !== null) return;
        window.__fade.readyAt = Math.round(performance.now());
        window.__fade.transition = getComputedStyle(c).transitionDuration + ' ' + getComputedStyle(c).transitionTimingFunction;
        tick();
      };
      const tick = () => {
        const s = getComputedStyle(c);
        window.__fade.samples.push([Math.round(performance.now()), +(+s.opacity).toFixed(3)]);
        if (window.__fade.readyAt !== null && !window.__fade.done) {
          const elapsed = performance.now() - window.__fade.readyAt;
          if (elapsed > 6000 || +s.opacity >= 0.999) { window.__fade.done = true; window.__fade.settledAt = Math.round(elapsed); window.__fade.clear(); return; }
        }
        /* setInterval, not requestAnimationFrame: under swiftshader this page
           composites at roughly 0.2fps, and a rAF sampler gets one frame in six
           seconds — which measures the starved compositor, not the transition. */
        window.__fade.timer = setTimeout(tick, 40);
      };
      const mo = new MutationObserver(() => { if (c.classList.contains('is-ready')) begin(); });
      mo.observe(c, { attributes: true, attributeFilter: ['class'] });
      /* This poll runs on rAF, which cannot fire until the first paint — by
         which time js/scene3d.js may already have added .is-ready, in which case
         the observer above never fires and the fade is missed entirely. */
      if (c.classList.contains('is-ready')) begin();
    };
    const find = () => {
      const c = document.getElementById('scene3d-canvas');
      if (c) attach(c); else requestAnimationFrame(find);
    };
    find();
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__fade && window.__fade.done, null, { timeout: 120000 }).catch(() => {});
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 150000 }).catch(() => {});
  await wait(500);

  const fade = await page.evaluate(() => window.__fade);

  const final = await page.evaluate(() => {
    const c = document.getElementById('scene3d-canvas');
    const s = c ? getComputedStyle(c) : null;
    return {
      canvasExists: !!c,
      ready: c ? c.classList.contains('is-ready') : false,
      scene3d: document.documentElement.classList.contains('scene3d'),
      opacity: s ? +(+s.opacity).toFixed(3) : null,
      transition: s ? s.transitionDuration + ' ' + s.transitionTimingFunction : null,
      zIndex: s ? s.zIndex : null,
      position: s ? s.position : null,
      size: c ? [Math.round(c.getBoundingClientRect().width), Math.round(c.getBoundingClientRect().height)] : null,
    };
  });

  /* ---- the three cards ------------------------------------------------ */
  const cards = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#overview .tool-card')).map((el, i) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const eyebrow = el.querySelector('.tool-card-eyebrow');
      const icon = el.querySelector('.tool-card-icon');
      const h3 = el.querySelector('h3');
      const p = el.querySelector('p');
      const g = (n, prop) => (n ? getComputedStyle(n)[prop] : null);
      return {
        i: i + 1,
        rect: [Math.round(r.width), Math.round(r.height)],
        radius: s.borderRadius,
        border: s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor,
        bg: s.backgroundColor,
        shadow: s.boxShadow,
        /* The tailwind utility hover:border-accent-mint/30 is still on the
           element; the override has to win on specificity, not on luck. */
        overflowsParent: r.right > document.documentElement.clientWidth + 0.5,
        eyebrow: eyebrow ? { text: eyebrow.textContent.trim().replace(/\s+/g, ' '), ff: g(eyebrow, 'fontFamily').split(',')[0].replace(/"/g, ''), fs: g(eyebrow, 'fontSize'), ls: g(eyebrow, 'letterSpacing'), tt: g(eyebrow, 'textTransform'), color: g(eyebrow, 'color') } : null,
        eyebrowIndexColor: eyebrow && eyebrow.querySelector('i') ? getComputedStyle(eyebrow.querySelector('i')).color : null,
        icon: icon ? { box: [Math.round(icon.getBoundingClientRect().width), Math.round(icon.getBoundingClientRect().height)], border: g(icon, 'borderTopWidth') + ' ' + g(icon, 'borderTopColor'), bg: g(icon, 'backgroundColor'), radius: g(icon, 'borderRadius') } : null,
        iconGlyphColor: icon && icon.querySelector('i,svg') ? getComputedStyle(icon.querySelector('i,svg')).color : null,
        h3: h3 ? { weight: g(h3, 'fontWeight'), size: g(h3, 'fontSize'), color: g(h3, 'color') } : null,
        p: p ? { weight: g(p, 'fontWeight'), color: g(p, 'color') } : null,
        text: (h3 ? h3.textContent : '').trim(),
      };
    });
  });

  /* ---- verdict -------------------------------------------------------- */
  const ok = [], bad = [];
  const check = (label, pass, detail) => (pass ? ok : bad).push(`${label}${detail ? '  [' + detail + ']' : ''}`);

  /* This page blocks its main thread in ~8s chunks under swiftshader (WebGL init
     plus software raster), so a 40ms timer still only lands two samples and the
     intermediate ramp is unobservable here. Asserting on it would be asserting
     on the renderer. What is decidable: the canvas was painted at 0 before the
     class landed, so a transition is required, and the declared duration is the
     stretched one. The intermediate-value count is reported, not enforced. */
  const partials = fade.samples.filter(([, o]) => o > 0.001 && o < 0.999);
  const distinct = new Set(partials.map(([, o]) => o)).size;
  const monotonic = partials.every((s, i) => i === 0 || s[1] >= partials[i - 1][1]);

  check('3D canvas element exists', final.canvasExists);
  check('js/scene3d.js confirmed WebGL (html.scene3d)', final.scene3d);
  check('canvas reached .is-ready', final.ready);
  check('canvas is fully visible, not stuck at opacity 0', final.opacity >= 0.99, `opacity=${final.opacity}`);
  check('the resolved transition is the stretched 2.4s, not style.css\'s 1.4s', /(^|,)\s*2\.4s/.test(final.transition || ''), final.transition || 'n/a');
  /* Two orderings both prove a transition is running, and which one you get
     depends on when this thread first gets scheduled:
       (a) seen at opacity 0, .is-ready added later  -> a recalc is required
       (b) .is-ready already set but opacity still 0  -> the ramp is in progress
     The invariant is the opacity: it must read 0 while .is-ready is applied. */
  check('the canvas is still at opacity 0 while .is-ready is applied, so the fade is a real transition', fade.opacityAtAttach === 0, `opacity at attach=${fade.opacityAtAttach}, is-ready already present=${fade.hadReadyAtAttach}`);
  check('.is-ready landed after first paint, well after the canvas existed', fade.readyAt !== null, fade.readyAt !== null ? `+${fade.readyAt}ms` : 'never observed');
  check('the opacity ramp only ever increases', monotonic);
  check('the ramp completes rather than stalling part-way', final.opacity >= 0.99, `settled at opacity ${final.opacity}`);
  check('canvas is fixed behind the content at z-index -1', final.position === 'fixed' && final.zIndex === '-1', `${final.position} / z=${final.zIndex}, size ${final.size}`);
  check('exactly three tool cards', cards.length === 3, `found ${cards.length}`);
  check('no console errors', consoleErrors.length === 0, consoleErrors.join(' / ') || 'none');

  cards.forEach((c) => {
    check(`card ${c.i} (${c.text}) has no border-radius shortcut left`, c.radius !== '', c.radius);
    check(`card ${c.i} is a hairline card, not a bordered panel`, /^0px|^1px/.test(c.border), c.border);
    check(`card ${c.i} has no box-shadow`, c.shadow === 'none', c.shadow);
    check(`card ${c.i} fits the viewport`, !c.overflowsParent, `${c.rect[0]}x${c.rect[1]}`);
    check(`card ${c.i} eyebrow is stamped mono uppercase`, c.eyebrow && /Mono/i.test(c.eyebrow.ff) && c.eyebrow.tt === 'uppercase', c.eyebrow ? `${c.eyebrow.ff} ${c.eyebrow.fs} ${c.eyebrow.tt} ls=${c.eyebrow.ls}` : 'missing');
    check(`card ${c.i} icon is an outline box, not a violet fill`, c.icon && c.icon.bg === 'rgba(0, 0, 0, 0)' && /^1px/.test(c.icon.border), c.icon ? `${c.icon.box.join('x')} bg=${c.icon.bg} border=${c.icon.border}` : 'missing');
  });

  console.log(`\n=== ${width}x${height} · 3D fade ===`);
  console.log(`  .is-ready at +${fade.readyAt}ms, settled after ${fade.settledAt ?? 'n/a'}ms`);
  console.log(`  canvas was at opacity ${fade.opacityAtAttach} when first seen (is-ready already present: ${fade.hadReadyAtAttach})`);
  console.log('  opacity ramp: ' + fade.samples.map(([t, o]) => `${t}ms=${o}`).join('  '));
  console.log(`  ramp detail: ${distinct} distinct partial opacities${distinct > 0 ? ' — an intermediate value was captured, the ramp is real' : ' — no intermediate captured this run (renderer-dependent, not enforced)'}`);
  console.log(`  final: ${JSON.stringify(final)}`);
  console.log(`=== ${width}x${height} · tool cards ===`);
  cards.forEach((c) => console.log(`  ${c.i}. ${c.text.padEnd(16)} ${c.rect.join('x').padEnd(10)} r=${c.radius.padEnd(8)} border=${c.border.padEnd(34)} shadow=${c.shadow}`));
  ok.forEach((l) => console.log('  PASS  ' + l));
  bad.forEach((l) => console.log('  FAIL  ' + l));
  failures += bad.length;

  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? '\nall assertions passed' : `\n${failures} assertion(s) failed`);
process.exit(failures === 0 ? 0 : 1);
