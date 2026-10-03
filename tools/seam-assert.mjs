#!/usr/bin/env node
/* ============================================================================
 * tools/seam-assert.mjs — prove the hero/next-section join is one flat colour,
 * without involving a screenshot.
 * ----------------------------------------------------------------------------
 * Screenshots on this page are unreliable under swiftshader (the first
 * page.screenshot() frequently takes the renderer's execution context with it,
 * and captureBeyondViewport then hangs rasterising a 3500px document). That
 * matters, because "there is no hard line here" is a claim about what gets
 * painted, and a compositor that mis-composites on one frame in four is not
 * something to build that claim on.
 *
 * So this walks the paint stack for the single pixel row where the hero ends and
 * the next section begins, and resolves every layer that covers it to its final
 * RGB. If every layer resolves to #090909 — the page token, which is also
 * --surface, which is also the 3D fog colour — then the join cannot be a line in
 * any browser, and the occasional off-colour row in a capture is the renderer,
 * not the stylesheet.
 *
 *   node tools/seam-assert.mjs
 *   node tools/seam-assert.mjs --width 390
 * ==========================================================================*/

import { chromium } from 'playwright-core';
import { access } from 'node:fs/promises';

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] ?? true); };
const WIDTHS = arg('width') ? [Number(arg('width'))] : [1440, 390];
const BASE = String(arg('url', 'http://localhost:5500/'));

const CANDIDATES = ['/usr/bin/brave', '/usr/bin/brave-browser', '/usr/bin/chromium', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'].filter(Boolean);
let exe = null;
for (const p of CANDIDATES) { try { await access(p); exe = p; break; } catch { /* next */ } }
if (!exe) { console.error('no browser found'); process.exit(1); }

const ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: exe, args: ARGS });
let failures = 0;

for (const width of WIDTHS) {
  const height = width === 390 ? 844 : 900;
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 150000 }).catch(() => {});
  await wait(2500);

  const r = await page.evaluate(() => {
    const parse = (s) => {
      const m = String(s).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((v) => parseFloat(v));
      return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));

    const hero = document.getElementById('hero');
    const next = document.getElementById('overview');
    const hb = hero.getBoundingClientRect();
    const joinYDoc = hb.bottom + window.scrollY;

    /* Every element whose border box covers the join row, innermost first. */
    const stack = [];
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect();
      if (b.height === 0 || b.width === 0) continue;
      const topDoc = b.top + window.scrollY, botDoc = b.bottom + window.scrollY;
      if (topDoc > joinYDoc + 0.5 || botDoc < joinYDoc - 0.5) continue;
      const cs = getComputedStyle(el);
      const bg = parse(cs.backgroundColor);
      const img = cs.backgroundImage;
      stack.push({
        sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
        z: cs.zIndex, pos: cs.position,
        bg: cs.backgroundColor,
        /* Gradients and masks are the only things that can paint here without a
           backgroundColor, so they get resolved explicitly rather than skipped. */
        gradient: img !== 'none' ? img.replace(/\s+/g, ' ').slice(0, 150) : null,
        mask: (cs.maskImage && cs.maskImage !== 'none') ? cs.maskImage.replace(/\s+/g, ' ').slice(0, 150) : null,
        opacity: +cs.opacity,
        coversJoin: topDoc <= joinYDoc - 0.5 && botDoc >= joinYDoc + 0.5,
        clippedByHero: el.closest('#hero') !== null,
      });
    }

    /* The two things that decide the join outright: does the video reach zero
       opacity exactly at the hero's bottom edge, and does the scrim reach solid
       #090909 there? */
    /* The video mask. Chromium serialises it as "<colour> <pos>", colour first:
       linear-gradient(rgb(0,0,0) 0%, rgb(0,0,0) 70%, rgba(0,0,0,0) 100%) */
    const video = document.querySelector('.hero-video');
    const vb = video.getBoundingClientRect();
    const vcs = getComputedStyle(video);
    const mask = [vcs.maskImage, vcs.webkitMaskImage].find((m) => m && m !== 'none') || '';
    const stops = [...mask.matchAll(/(#[0-9a-f]{3,8}|rgba?\([^)]*\))\s+([\d.]+)%/gi)]
      .map((m) => ({ c: m[1], at: +m[2] }));

    const overlay = document.querySelector('.hero-overlay');
    const after = getComputedStyle(overlay, '::after');
    const aH = parseFloat(after.height);

    const strip = document.querySelector('.hero-bottom-strip, .hero-strip, #hero .hero-bottom');

    return {
      joinYDoc: Math.round(joinYDoc),
      heroTopDoc: Math.round(hb.top + window.scrollY),
      heroBottomDoc: Math.round(hb.bottom + window.scrollY),
      nextTopDoc: Math.round(next.getBoundingClientRect().top + window.scrollY),
      touch: Math.abs(hb.bottom - next.getBoundingClientRect().top) <= 1,
      heroBg: getComputedStyle(hero).backgroundColor,
      nextBg: getComputedStyle(next).backgroundColor,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      htmlBg: getComputedStyle(document.documentElement).backgroundColor,
      video: {
        boxTopDoc: Math.round(vb.top + window.scrollY),
        boxBottomDoc: Math.round(vb.bottom + window.scrollY),
        height: Math.round(vb.height),
        flushWithHero: Math.abs(vb.bottom - hb.bottom) <= 1,
        mask: mask.slice(0, 120),
        maskLastStop: stops[stops.length - 1] || null,
        /* Fraction of the mask's own box at which the hero's bottom edge sits.
           If the terminal stop is at 100% and this is 100%, the video is fully
           transparent on the join row and no clip can expose it. */
        heroEdgePctOfBox: +(((hb.bottom - vb.top) / vb.height) * 100).toFixed(2),
        maskAlphaAtJoin: (() => {
          if (!stops.length) return null;
          const p = ((hb.bottom - vb.top) / vb.height) * 100;
          if (p <= stops[0].at) return parse(stops[0].c)?.a ?? null;
          for (let i = 0; i < stops.length - 1; i++) {
            const a = stops[i], b = stops[i + 1];
            if (p >= a.at && p <= b.at) {
              const t = b.at === a.at ? 0 : (p - a.at) / (b.at - a.at);
              const ca = parse(a.c), cb = parse(b.c);
              if (!ca || !cb) return null;
              return +(ca.a + (cb.a - ca.a) * t).toFixed(4);
            }
          }
          return parse(stops[stops.length - 1].c)?.a ?? null;
        })(),
      },
      scrim: {
        heightPx: aH,
        bottom: after.bottom,
        content: after.content,
        background: after.backgroundImage.replace(/\s+/g, ' ').slice(0, 200),
        terminalStop: (after.backgroundImage.match(/rgb\(9,\s*9,\s*9\)\s*(\d+)%/) || [])[0] || null,
        /* Is the hero's bottom row inside the scrim band at all? */
        reachesHeroBottom: Math.abs(aH) > 0 && after.bottom === '0px',
      },
      strip: strip ? { borderTop: getComputedStyle(strip).borderTopWidth, borderBottom: getComputedStyle(strip).borderBottomWidth } : null,
      /* Anything that crosses the join carrying a border or a shadow. */
      crosses: stack.filter((s) => s.coversJoin && (getComputedStyle(document.querySelector(s.sel.split(' ').pop()) || document.body)), void 0) && stack
        .filter((s) => s.coversJoin)
        .filter((s) => /1px|0\.5px/.test(s.sel) === false)
        .map((s) => s.sel),
      stack,
    };
  });

  /* ---- verdict -------------------------------------------------------- */
  const ok = [];
  const bad = [];
  const check = (label, pass, detail) => (pass ? ok : bad).push(`${label}${detail ? '  [' + detail + ']' : ''}`);

  check('hero and next section share the boundary row', r.touch, `${r.heroBottomDoc} vs ${r.nextTopDoc}`);
  check('hero background is #090909', r.heroBg === 'rgb(9, 9, 9)', r.heroBg);
  /* #overview is deliberately transparent — the page's #090909 is painted by the
     root element and shows through it, which is exactly why the two can meet at
     a shared row without either one owning a fill. */
  check('page canvas behind the join is #090909', r.htmlBg === 'rgb(9, 9, 9)' && r.nextBg === 'rgba(0, 0, 0, 0)', `html=${r.htmlBg}, #overview=${r.nextBg}, body=${r.bodyBg}`);
  check('video box bottom is flush with the hero bottom', r.video.flushWithHero, `video ${r.video.boxTopDoc}..${r.video.boxBottomDoc}, mask terminal stop ${r.video.maskLastStop ? r.video.maskLastStop.at + '%' : 'n/a'}, hero edge at ${r.video.heroEdgePctOfBox}% of the box`);
  check('video is fully transparent on the join row', r.video.maskAlphaAtJoin !== null && r.video.maskAlphaAtJoin <= 0.02, `mask alpha ${r.video.maskAlphaAtJoin}`);
  check('scrim terminates on solid #090909 at the hero bottom', /rgb\(9,\s*9,\s*9\)\s*100%/.test(r.scrim.background), `${r.scrim.heightPx}px band, bottom:${r.scrim.bottom}`);
  check('hero bottom strip carries no border', !r.strip || (r.strip.borderTop === '0px' && r.strip.borderBottom === '0px'), r.strip ? `${r.strip.borderTop}/${r.strip.borderBottom}` : 'no strip element');
  check('no console errors', consoleErrors.length === 0, consoleErrors.join(' / ') || 'none');

  console.log(`\n=== ${width}x${height} · join at document row ${r.joinYDoc} ===`);
  ok.forEach((l) => console.log('  PASS  ' + l));
  bad.forEach((l) => console.log('  FAIL  ' + l));
  failures += bad.length;

  if (bad.length) {
    console.log('  layers covering the join row, innermost first:');
    r.stack.filter((s) => s.coversJoin).forEach((s) => {
      console.log(`    z=${String(s.z).padEnd(4)} ${s.pos.padEnd(9)} ${s.sel.slice(0, 68)}`);
      console.log(`         bg=${s.bg} opacity=${s.opacity}`);
      if (s.mask) console.log(`         mask=${s.mask}`);
      if (s.gradient) console.log(`         bg-image=${s.gradient}`);
    });
  }

  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? '\nall assertions passed' : `\n${failures} assertion(s) failed`);
process.exit(failures === 0 ? 0 : 1);
