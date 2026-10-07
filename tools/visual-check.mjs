#!/usr/bin/env node
/* ============================================================================
 * tools/visual-check.mjs — viewport-only screenshots + the spotlight experiment.
 * ----------------------------------------------------------------------------
 * Two jobs, both things a computed-style assertion cannot settle:
 *
 *   1. PIXELS AT THE JOIN. seam-assert.mjs proves the paint stack is correct:
 *      video box flush, mask alpha 0, scrim terminating on #090909. That is
 *      necessary but it is still a statement about declarations. This puts the
 *      real rendered pixels of the join under a microscope and reports the
 *      worst row-to-row delta down a column through the boundary.
 *
 *   2. IS #spotlight THE CULPRIT. `#spotlight` is `fixed -inset-px z-index:30`
 *      and script.js rewrites its inline background on every mousemove, which
 *      looks like exactly the kind of overlay that paints a band across a
 *      fixed boundary. It has never been ruled out — only rationalised away.
 *      So: shoot the join with it, shoot it again with it hidden, diff the two.
 *      If the step survives without it, it is exonerated by measurement.
 *
 * Why viewport-only: `fullPage + clip` needs Chromium to raster the entire
 * document, and under swiftshader this page takes >300s for one such frame
 * (tools/hero-check.mjs timed out repeatedly). Every shot here is a plain
 * viewport capture after scrolling, which is what actually failed to hang.
 *
 *   node tools/visual-check.mjs
 *   node tools/visual-check.mjs --width 390
 * ==========================================================================*/

import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] ?? true); };
const WIDTHS = arg('width') ? [Number(arg('width'))] : [1440, 390];
const BASE = String(arg('url', 'http://localhost:5500/'));
const OUT = 'tools/shots';
const TAG = String(arg('tag', 'visual'));

const CANDIDATES = ['/usr/bin/brave', '/usr/bin/brave-browser', '/usr/bin/chromium'];
let exe = null;
for (const p of CANDIDATES) { try { await access(p); exe = p; break; } catch { /* next */ } }
if (!exe) { console.error('no browser found'); process.exit(1); }
await mkdir(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** px.mjs is spawned per scan, so this resolves to its stdout text. */
const px = (file, from, to, cols) =>
  run('node', ['tools/px.mjs', file, String(from), String(to), '--cols', cols, '--max', '255'])
    .then((r) => r.stdout)
    .catch((e) => (e.stdout || '') + (e.stderr || ''));

/**
 * The systematic luminance step across the boundary.
 *
 * "Worst single-row jump" is the wrong statistic for this claim. A seam is a
 * step that persists — every column is brighter above the line than below it —
 * whereas the page also draws perfectly legitimate single rows near the join:
 * `.hero-grid-lines` paints a 1px `--color-iron-edge` rule every 56px, and the
 * run that surfaced this had one land at y=448, two rows above the join, where
 * it reads as a 37-unit "jump" that is a designed background grid, not a defect.
 *
 * So: average the mean of the four rows before the join against the four rows
 * after it, across a spread of columns. One grid line inside four rows is
 * quartered; a seam survives the averaging intact. This is the measurement that
 * actually distinguishes "there is a line here" from "there is a line drawn here".
 *
 * @returns {{step:number, above:number, below:number}|null}
 */
function bandStep(scanText, joinRow) {
  const rows = new Map();
  for (const m of scanText.matchAll(/y=\s*(\d+)\s+.*?mean=([\d.]+)/g)) {
    rows.set(Number(m[1]), Number(m[2]));
  }
  const meanOf = (ys) => {
    const v = ys.map((y) => rows.get(y)).filter((n) => Number.isFinite(n));
    return v.length ? v.reduce((a, c) => a + c, 0) / v.length : null;
  };
  const above = meanOf([-4, -3, -2, -1].map((d) => joinRow + d));
  const below = meanOf([1, 2, 3, 4].map((d) => joinRow + d));
  if (above === null || below === null) return null;
  return { step: Math.abs(below - above), above, below };
}

let failures = 0;
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio'],
});

for (const width of WIDTHS) {
  const height = width === 390 ? 844 : 900;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  const warnings = [], errors = [], failedReqs = [];
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error') errors.push(m.text());
    else if (t === 'warning') warnings.push({ text: m.text(), loc: m.location() });
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => failedReqs.push(`${r.url()} — ${r.failure()?.errorText}`));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 180000 }).catch(() => {});
  await wait(2000);

  const geo = await page.evaluate(() => {
    const hero = document.getElementById('hero');
    const overview = document.getElementById('overview');
    return {
      heroTop: hero.getBoundingClientRect().top + window.scrollY,
      heroH: Math.round(hero.getBoundingClientRect().height),
      overviewTop: overview.getBoundingClientRect().top + window.scrollY,
      cardsTop: Math.round(document.querySelector('#overview .tool-card').getBoundingClientRect().top + window.scrollY),
      docH: document.documentElement.scrollHeight,
      vh: window.innerHeight,
    };
  });

  /* Park the cursor so #spotlight is in a known place rather than wherever the
     last synthetic event left it; then read what it actually resolved to. */
  await page.mouse.move(width * 0.5, height * 0.5);
  await wait(400);
  const spot = await page.evaluate(() => {
    const s = document.getElementById('spotlight');
    const cs = getComputedStyle(s);
    const r = s.getBoundingClientRect();
    return {
      position: cs.position, zIndex: cs.zIndex, opacity: cs.opacity,
      backgroundImage: cs.backgroundImage,
      backgroundColor: cs.backgroundColor,
      blendMode: cs.mixBlendMode,
      rect: [Math.round(r.width), Math.round(r.height)],
      inlineStyle: s.getAttribute('style'),
      coversViewport: r.width >= window.innerWidth && r.height >= window.innerHeight,
    };
  });

  const goto = async (y) => {
    const target = Math.max(0, y);
    for (let tries = 0; tries < 2; tries++) {
      try {
        await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), target);
        break;
      } catch (e) {
        const msg = String(e);
        if (/execution context/i.test(msg)) {
          await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
          await wait(600);
          continue;
        }
        throw e;
      }
    }
    await wait(1600);
  };

  /* `animations: 'disabled'` is the point, not a convenience. This tool reads
     PIXELS to decide whether a join has a hard edge, and the page under it is
     never still: the hero glow breathes on a 7s cycle, the phosphor accent card
     pulses, and #spotlight is repainted on a timer. With `animations: 'allow'`
     the two screenshots of the SAME seam differ by whatever each happened to
     catch mid-motion — which is how the exoneration comparison read 3-vs-3,
     3-vs-8 and 3-vs-13 on three identical runs of the same markup. Freezing
     animations makes the shot a measurement of the paint stack, which is the
     only thing the verdict is about. */
  const shot = async (name) => {
    const file = `${OUT}/${TAG}-${width}-${name}.png`;
    await page.screenshot({ path: file, timeout: 120000, animations: 'disabled', caret: 'hide' });
    return file;
  };

  /* ---- 1. the four framings ------------------------------------------ */
  const marks = {
    'hero-top': 0,
    'hero-mid': Math.round(geo.heroH / 2 - geo.vh / 2),
    /* puts the hero/next boundary in the vertical middle of the frame */
    'join': Math.round(geo.overviewTop - geo.vh / 2),
    'cards': Math.round(geo.cardsTop - 120),
  };
  const files = {};
  for (const [name, y] of Object.entries(marks)) {
    await goto(Math.max(0, y));
    files[name] = await shot(name);
    process.stdout.write(`  shot ${name} @ scrollY=${Math.max(0, y)} -> ${files[name]}\n`);
  }

  /* ---- 2. the spotlight experiment, at the join ------------------------ */
  await goto(marks.join);
  const joinRow = Math.round(geo.vh / 2);
  const col = String(Math.round(width / 2));
  const withSpot = files.join;

  await page.evaluate(() => { const s = document.getElementById('spotlight'); s.dataset.vc = '1'; s.style.display = 'none'; });
  await wait(500);
  const withoutSpot = await shot('join-nospot');
  await page.evaluate(() => { const s = document.getElementById('spotlight'); s.style.display = ''; delete s.dataset.vc; });
  await wait(400);

  /* Scan a spread of columns, not one. A single centre column is a single
     sample of a full-width boundary, and it is exactly how the 1px hero grid
     rule got mistaken for the join. */
  const cols = Array.from({ length: 9 }, (_, i) => Math.round((width * (i + 1)) / 10)).join(',');
  const scanA = await px(withSpot, joinRow - 4, joinRow + 4, cols);
  const scanB = await px(withoutSpot, joinRow - 4, joinRow + 4, cols);
  /* The wide window is kept, but only reported — it is a content measurement,
     not a seam measurement, and must not drive the verdict. */
  const wideA = await px(withSpot, joinRow - 70, joinRow + 70, col);

  const stepA = bandStep(scanA, joinRow);
  const stepB = bandStep(scanB, joinRow);

  console.log(`\n=== ${width}x${height} · #spotlight ===`);
  console.log(`  position=${spot.position} z=${spot.zIndex} opacity=${spot.opacity} blend=${spot.blendMode} rect=${spot.rect.join('x')} coversViewport=${spot.coversViewport}`);
  console.log(`  resolved background-image: ${spot.backgroundImage}`);
  console.log(`  inline style attribute   : ${spot.inlineStyle}`);
  console.log('  --- join column scan WITH #spotlight ---');
  console.log(scanA.trim().split('\n').map((l) => '  ' + l).join('\n'));
  console.log('  --- join column scan WITHOUT #spotlight ---');
  console.log(scanB.trim().split('\n').map((l) => '  ' + l).join('\n'));


  console.log(`=== ${width}x${height} · console ===`);
  console.log(`  errors: ${errors.length ? errors.join(' / ') : 'none'}`);
  console.log(`  warnings: ${warnings.length}`);
  warnings.forEach((w) => console.log(`    - ${w.text.slice(0, 160)}  @ ${w.loc?.url || '?'}:${w.loc?.lineNumber ?? '?'}`));
  console.log(`  failed requests: ${failedReqs.length ? failedReqs.join(' / ') : 'none'}`);

  /* ---- verdict -------------------------------------------------------- */
  const ok = [], bad = [];
  const check = (l, pass, d) => (pass ? ok : bad).push(`${l}${d ? '  [' + d + ']' : ''}`);
  const worst = (txt) => {
    /* px.mjs prints "worst single-row jump: 269 at y=437". An earlier version of
       this regex looked for "max delta", matched nothing, and returned NaN — and
       because every comparison against NaN is false, that reported PASS while
       measuring nothing. A measurement helper must fail loudly, not return NaN
       into a boolean. */
    const m = /worst single-row jump:\s*(\d+)/i.exec(txt);
    if (!m) throw new Error('px.mjs output not parseable — refusing to guess:\n' + txt.slice(-400));
    return Number(m[1]);
  };

  const dWith = worst(scanA), dWithout = worst(scanB);
  /* The wide window is measured but never asserted on: it spans real content
     (stamped hero strip below, section heading above), so its worst jump is a
     glyph edge, not a seam. Reported so the two numbers are not confused. */
  console.log('  informational: same column over a wide +/-70px window, worst jump ' + worst(wideA) + ' (content edge, not a seam)');
  console.log(`  systematic step across the join: with #spotlight ${stepA.step.toFixed(2)} (${stepA.above.toFixed(1)} -> ${stepA.below.toFixed(1)}), without ${stepB.step.toFixed(2)} (${stepB.above.toFixed(1)} -> ${stepB.below.toFixed(1)})`);
  check('no console errors', errors.length === 0, errors.join(' / ') || 'none');
  check('#spotlight is a smooth 2D radial, so it cannot paint a horizontal band', /radial-gradient/.test(spot.backgroundImage), spot.backgroundImage.slice(0, 90));
  /* script.js rewrites this inline on every mousemove, so the assertion is that
     the live value is the Phosphor Mint token and not the retired lime. */
  check('#spotlight recolour survived script.js rewriting its inline background', /112,\s*220,\s*211/.test(spot.backgroundImage), spot.backgroundImage.slice(0, 90));
  check('#spotlight is not blended over the page', spot.blendMode === 'normal', spot.blendMode);
  /* Threshold 8, and it is set from measurement rather than taste. At 1440 the
     band straddles the Phosphor accent card, which reaches the join and reads
     rgb(105,207,198) — so a genuine discontinuity here, if the .hero-fade ever
     stopped resolving to Void Canvas, would show a step of 40+ in a single row,
     not 8. The measured legitimate reading is ~2.15 (the card's own sub-pixel
     antialiasing against the canvas, identical above and below the line) and
     ~0.05 at 390 where nothing but canvas is in range. 8 sits above the noise
     floor and an order of magnitude below the failure it exists to catch. */
  check('join shows no hard edge with #spotlight present', stepA.step <= 8, `step ${stepA.step.toFixed(2)} across the join (${stepA.above.toFixed(1)} -> ${stepA.below.toFixed(1)})`);
  /* The point is exoneration, not that two numbers match. #spotlight is a fixed
     -inset overlay whose inline background is rewritten on every mousemove, so
     the thing to establish is that the join is clean BOTH ways — comparing two
     sub-threshold readings for equality was the wrong test: at these magnitudes
     the residual is quantisation noise in the PNG, not signal. */
  check('#spotlight is exonerated: the join is clean with it and without it', stepA.step <= 8 && stepB.step <= 8, `with=${stepA.step.toFixed(2)} without=${stepB.step.toFixed(2)}`);

  console.log(`=== ${width}x${height} · verdict ===`);
  ok.forEach((l) => console.log('  PASS  ' + l));
  bad.forEach((l) => console.log('  FAIL  ' + l));
  failures += bad.length;

  await writeFile(`${OUT}/${TAG}-${width}-report.json`, JSON.stringify({ geo, spot, files, warnings, errors, failedReqs, dWith, dWithout, stepA, stepB }, null, 2));
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? '\nall assertions passed' : `\n${failures} assertion(s) failed`);
process.exit(failures === 0 ? 0 : 1);
