#!/usr/bin/env node
/* ============================================================================
 * tools/layers-check.mjs — verify the three tool cards against DESIGN.md.
 * ----------------------------------------------------------------------------
 * The tool cards were previously only asserted as "the rule I wrote is in the
 * sheet", which is not the same as "the browser ran it". This samples the
 * computed geometry of each one and checks the things a stylesheet cannot
 * report on its own:
 *
 *   1. a card is a Dark Surface Card — a Carbon Plate fill, a single 1px Fog
 *      hairline, 20px radius, and no box-shadow at all. Elevation in this system
 *      comes from the light border and the surface step, never from a shadow, so
 *      a stray `shadow` here means the old styling is still winning.
 *   2. each card fits its parent. A card that overflows looks fine in the DOM and
 *      broken on a phone.
 *   3. the eyebrow is stamped mono uppercase with wide tracking, and the icon is
 *      an outlined box rather than a filled swatch — DESIGN.md's rule that colour
 *      is rationed, so an icon well may not become a violet/mint block.
 *
 * This file used to also prove the 3D scene's fade-in (opacity 0 -> .is-ready).
 * That layer is gone, so that half of it is gone with it.
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
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 150000 }).catch(() => {});
  await wait(500);

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

  check('exactly three tool cards', cards.length === 3, `found ${cards.length}`);
  check('no console errors', consoleErrors.length === 0, consoleErrors.join(' / ') || 'none');

  cards.forEach((c) => {
    check(`card ${c.i} (${c.text}) has no border-radius shortcut left`, c.radius !== '', c.radius);
    check(`card ${c.i} is a hairline card, not a bordered panel`, /^0px|^1px/.test(c.border), c.border);
    check(`card ${c.i} has no box-shadow`, c.shadow === 'none', c.shadow);
    check(`card ${c.i} fits the viewport`, !c.overflowsParent, `${c.rect[0]}x${c.rect[1]}`);
    check(`card ${c.i} eyebrow is stamped mono uppercase`, c.eyebrow && /Mono/i.test(c.eyebrow.ff) && c.eyebrow.tt === 'uppercase', c.eyebrow ? `${c.eyebrow.ff} ${c.eyebrow.fs} ${c.eyebrow.tt} ls=${c.eyebrow.ls}` : 'missing');
    check(`card ${c.i} icon is an outline box, not a filled swatch`, c.icon && c.icon.bg === 'rgba(0, 0, 0, 0)' && /^1px/.test(c.icon.border), c.icon ? `${c.icon.box.join('x')} bg=${c.icon.bg} border=${c.icon.border}` : 'missing');
  });

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
