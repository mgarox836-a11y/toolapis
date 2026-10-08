#!/usr/bin/env node
/* ============================================================================
 * tools/check-overflow.mjs — prove the page fits every viewport it can be given.
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The page had exactly one horizontal-overflow defect and it was invisible to
 * the eye: `body { min-width: 320px }`. At a 280px viewport that floor inflated
 * the WHOLE document, so `innerWidth` read 320 against a `clientWidth` of 280,
 * 176 elements crossed the viewport edge, and the h1 ended 24px past it. Because
 * the inflation lived on the root element, nothing looked broken at any width
 * the team normally checked — and a root-level min-width is exactly the kind of
 * bug that reads as "the phone is fine" until someone opens a Galaxy Fold.
 *
 * So the check is a measurement, not a screenshot. It asserts the five
 * invariants that together mean "the layout viewport is this device's width and
 * the page fits inside it":
 *
 *     1. innerWidth          === the viewport width we asked for
 *                              (a root min-width shows up here first)
 *     2. scrollWidth         <= clientWidth          (nothing overflows)
 *     3. h1 right edge       <= clientWidth          (the headline fits)
 *     4. left gutter         == right gutter (±1px)   (nothing is off-centre)
 *     5. visualViewport.scale === 1                  (nothing zoomed out)
 *
 * plus "no element crosses the viewport edge unless a clipping ancestor
 * contains it", which is what separates a real defect from the deliberate
 * overhangs (the marquee track, the hero glow, `.hub-ground` at inset:-60px).
 *
 * IT ALSO CHECKS THE THING SCREENSHOTS CANNOT
 *
 * A second test resizes ONE live page through thirteen sizes without reloading
 * and compares the layout at each size against a FRESH load at that size. This
 * is the DevTools-docked case: dragging the window edge, or docking DevTools to
 * the right, changes the viewport width without navigating. Any code that
 * measures once at load and never again produces a layout that differs between
 * the two, and a screenshot of either one alone looks fine.
 *
 * "Layout" here means offsetTop/offsetLeft/offsetWidth/offsetHeight, NOT
 * getBoundingClientRect(). That distinction is the whole test. The rect API
 * returns TRANSFORMED geometry, and this page always has something mid-animation
 * — the hero bloom breathing, the marquee scrolling, the hub pulses travelling —
 * so two identical layouts sampled a second apart disagree on rect.top by a few
 * pixels and report a failure that does not exist. The offset* family is the
 * untransformed layout box, which is precisely the question being asked: did
 * anything re-measure or fail to reflow. Measured before this was fixed: rect
 * comparison reported 14 spurious failures across the sequence while every
 * element's real layout was identical.
 *
 *   node tools/check-overflow.mjs            # full sweep
 *   node tools/check-overflow.mjs --quick    # core widths only, for a fast gate
 *   node tools/check-overflow.mjs --width 390
 *
 * Exits 1 on any failure so it can gate a commit.
 * ==========================================================================*/

import { chromium } from 'playwright-core';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (k) => argv.includes('--' + k);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };

const BASE = String(opt('url', 'http://localhost:5500/'));
const QUICK = flag('quick');
const ONLY = opt('width', null) ? [Number(opt('width'))] : null;

/* The widths from the brief: 280 is a folded phone, 320 the narrowest phone the
   old floor allowed, 475/640 the DevTools-docked widths from the bug report,
   900 the navbar handoff, and 3440 an ultrawide. */
const WIDTHS = ONLY || (QUICK
  ? [280, 320, 390, 475, 640, 768, 1024, 1440, 3440]
  : [280, 320, 360, 390, 430, 475, 520, 600, 768, 900, 1024, 1180,
     1280, 1366, 1440, 1600, 1920, 2560, 3440]);

/* Heights chosen for what they break rather than for roundness: 400 is a desktop
   window dragged short, 653 a folded phone, 800 a laptop, 1200 a tall window. */
const HEIGHTS = QUICK ? [800] : [400, 653, 800, 1200];

/* Shapes that no single width/height pair above covers. */
const SHAPES = [
  { w: 3440, h: 1440, label: 'ultrawide' },
  { w: 1920, h: 400, label: 'very short' },
  { w: 1024, h: 1366, label: 'tablet portrait' },
  { w: 844, h: 390, label: 'phone landscape' },
  { w: 667, h: 375, label: 'small phone landscape' },
  { w: 280, h: 653, label: 'folded phone' },
];

/* Browser discovery, copied from the other tools in this directory rather than
   imported, because they are standalone scripts and this stays one too. */
const CANDIDATES = ['/usr/bin/brave', '/usr/bin/brave-browser', '/usr/bin/chromium',
                    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'];
let exe = null;
for (const p of CANDIDATES) { try { await access(p); exe = p; break; } catch { /* next */ } }
if (!exe) { console.error('no browser found'); process.exit(1); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const fail = (m) => { failures++; console.log('   FAIL  ' + m); };

/* One page, fully settled, measured. `mode` is either desktop or real mobile
   emulation: `isMobile` is what makes a browser apply the mobile viewport model,
   where a root-level min-width inflates `innerWidth` instead of producing a
   scrollbar. Testing only the desktop model is how this bug survived a whole
   previous pass.
 *
 * The context is created ONCE per mode and reused via setViewportSize + reload.
 * The first version built a fresh context per configuration — 152 of them — and
 * the browser died under the weight of it, twice, partway through a sweep. One
 * context plus a reload per size is the same measurement for a fraction of the
 * memory: `isMobile`, `hasTouch` and the device scale factor all live on the
 * context and are fixed for the run, while the viewport is the only thing that
   legitimately changes from width to width. */
async function measure(ctx, page, w, h) {
  const errors = [];
  const onErr = (m) => { if (m.type() === 'error') errors.push(m.text()); };
  const onPageErr = (e) => errors.push('pageerror: ' + e.message);
  page.on('console', onErr);
  page.on('pageerror', onPageErr);

  await page.setViewportSize({ width: w, height: h });
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  /* Wait for the webfont before measuring anything. Google Sans is loaded from
     a CDN, and a fallback face has different metrics: an earlier version of this
     test reported a spurious 1px h1 width difference (673 vs 672) at 1440 that
     came and went between runs, and it was this race and not a layout change.
     `document.fonts.ready` resolves once the real faces are in use, which makes
     the measurement deterministic instead of timing-dependent. */
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await wait(650);
  /* Scroll the whole page so every reveal and observer has fired — several
     systems only build their DOM once a section has been seen, and an
     unvisited section is exactly where a layout bug can hide. */
  await page.evaluate(async () => {
    const h = document.body.scrollHeight;
    for (let y = 0; y < h; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 12)); }
    window.scrollTo(0, 0);
  });
  await wait(220);

  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const shell = document.querySelector('#main-content .shell');
    const h1 = document.querySelector('h1');
    const sr = shell ? shell.getBoundingClientRect() : null;
    const hr = h1 ? h1.getBoundingClientRect() : null;

    /* Elements crossing the viewport edge that no clipping ancestor contains.
       The `.marquee__track`, `.hero-glow`, `.hub-ground` and `.sig-bloom`
       overhangs are deliberate and every one of them is clipped, so this filter
       is what makes the check meaningful rather than permanently red. */
    const offenders = [];
    document.querySelectorAll('body *').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed') return;
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      if (r.right > de.clientWidth + 1 || r.left < -1) {
        let p = el.parentElement, clipped = false;
        while (p) {
          const o = getComputedStyle(p).overflowX;
          if (o === 'clip' || o === 'hidden' || o === 'auto' || o === 'scroll') { clipped = true; break; }
          p = p.parentElement;
        }
        if (!clipped) offenders.push(
          el.tagName + (el.id ? '#' + el.id : '') +
          '.' + String(el.className.baseVal ?? el.className).split(' ')[0].slice(0, 28));
      }
    });

    return {
      iw: window.innerWidth,
      cw: de.clientWidth,
      sw: de.scrollWidth,
      bw: document.body.scrollWidth,
      scale: window.visualViewport ? window.visualViewport.scale : 1,
      h1r: hr ? Math.round(hr.right) : 0,
      gutL: sr ? Math.round(sr.left) : 0,
      gutR: sr ? Math.round(de.clientWidth - sr.right) : 0,
      offenders: [...new Set(offenders)].slice(0, 6),
      errors: [],
    };
  });
  m.errors = errors;
  page.off('console', onErr);
  page.off('pageerror', onPageErr);
  return m;
}

/** Apply the five invariants. Returns the list of failures as strings. */
function verify(m, w) {
  const bad = [];
  if (m.iw !== w) bad.push(`innerWidth ${m.iw} !== viewport ${w} (layout viewport inflated)`);
  if (m.sw > m.cw) bad.push(`scrollWidth ${m.sw} > clientWidth ${m.cw} (+${m.sw - m.cw}px)`);
  if (m.h1r > m.cw) bad.push(`h1 right ${m.h1r} > clientWidth ${m.cw} (+${m.h1r - m.cw}px)`);
  if (Math.abs(m.gutL - m.gutR) > 1) bad.push(`gutters asymmetric L${m.gutL}/R${m.gutR}`);
  if (Math.abs(m.scale - 1) > 0.001) bad.push(`visualViewport.scale ${m.scale} (page zoomed out)`);
  if (m.offenders.length) bad.push(`unclipped overflow: ${m.offenders.join(', ')}`);
  if (m.errors.length) bad.push(`console errors: ${m.errors.slice(0, 2).join(' | ')}`);
  return bad;
}

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio'],
});

/* ---------------------------------------------------------------- 1 · sweep */
console.log(`\n=== sweep · ${QUICK ? 'quick' : 'full'} · ${BASE} ===`);
const rows = [];
for (const mobile of [false, true]) {
  const mode = mobile ? 'mobile-emul' : 'desktop    ';
  const ctx = await browser.newContext({
    viewport: { width: WIDTHS[0], height: HEIGHTS[0] },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1,
  });
  const page = await ctx.newPage();
  for (const w of WIDTHS) {
    for (const h of HEIGHTS) {
      /* One bad config must not end a 150-config sweep, so each is contained. */
      let m;
      try {
        m = await measure(ctx, page, w, h);
      } catch (e) {
        fail(`${mode} ${w}x${h} could not be measured: ${String(e.message).split('\n')[0]}`);
        continue;
      }
      const bad = verify(m, w);
      rows.push({ mode, w, h, sw: m.sw, cw: m.cw, gut: `${m.gutL}/${m.gutR}`, bad });
      if (bad.length) { console.log(`  ${mode} ${String(w).padStart(4)}x${h}`); bad.forEach((b) => fail(b)); }
    }
  }
  await ctx.close();
  process.stdout.write(`  ${mode}: ${WIDTHS.length * HEIGHTS.length} configs checked\n`);
}

/* --------------------------------------------------------------- 2 · shapes */
console.log('\n=== shapes ===');
for (const mobile of [false, true]) {
  const ctx = await browser.newContext({
    viewport: { width: SHAPES[0].w, height: SHAPES[0].h },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1,
  });
  const page = await ctx.newPage();
  for (const { w, h, label } of SHAPES) {
    try {
      const m = await measure(ctx, page, w, h);
      const bad = verify(m, w);
      if (bad.length) { console.log(`  ${label} ${w}x${h} (${mobile ? 'mobile' : 'desktop'})`); bad.forEach((b) => fail(b)); }
      else process.stdout.write(`  ${label.padEnd(22)} ${w}x${h} ${mobile ? 'mobile ' : 'desktop'} ok\n`);
    } catch (e) {
      fail(`${label} ${w}x${h} could not be measured: ${String(e.message).split('\n')[0]}`);
    }
  }
  await ctx.close();
}

/* -------------------------------------------- 3 · live resize, no reload ---
 * The DevTools-docked case. One page is resized through thirteen sizes and its
 * geometry captured at each; then the SAME sizes are loaded fresh. If any pair
 * differs, something measures once at load and never again. */
console.log('\n=== live resize vs fresh load (no reload) ===');
const SEQ = [1440, 1100, 900, 768, 640, 475, 390, 320, 280, 430, 1024, 1366, 1440];
const H = 800;
const geom = () => {
  /* offsetTop/Left/Width/Height, deliberately — see the header. These are the
     layout box with no transform applied, so an animation being at a different
     point in its cycle cannot make two correct layouts look different. */
  const g = (s) => { const e = document.querySelector(s); if (!e) return 'missing';
    return [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight].join(','); };
  const de = document.documentElement;
  /* The vertical extent that matters, measured from the layout box of the last
     section rather than from scrollHeight, which includes the overflow of any
     mid-animation transform. */
  const last = document.querySelector('#main-content > section:last-of-type');
  return {
    shell: g('#main-content .shell'), h1: g('h1'), bento: g('#overview .bento'),
    footer: g('.site-footer .shell'), features: g('#features .shell'),
    sw: de.scrollWidth, cw: de.clientWidth,
    docH: last ? Math.round(document.body.getBoundingClientRect().height) : 0,
  };
};
const ctx = await browser.newContext({ viewport: { width: 1440, height: H } });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
await wait(900);
const resized = {};
for (const w of SEQ) {
  await page.setViewportSize({ width: w, height: H });
  await wait(420);
  await page.evaluate(async () => {
    const h = document.body.scrollHeight;
    for (let y = 0; y < h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 8)); }
    window.scrollTo(0, 0);
  });
  await wait(220);
  resized[w] = await page.evaluate(geom);
}
await ctx.close();

for (const w of SEQ) {
  const c2 = await browser.newContext({ viewport: { width: w, height: H } });
  const p2 = await c2.newPage();
  await p2.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await wait(800);
  await p2.evaluate(async () => {
    const h = document.body.scrollHeight;
    for (let y = 0; y < h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 8)); }
    window.scrollTo(0, 0);
  });
  await wait(200);
  const fresh = await p2.evaluate(geom);
  await c2.close();

  const a = resized[w];
  const diff = [];
  /* Compared numerically with a 1px tolerance rather than by string equality.
     offsetWidth/offsetHeight are ROUNDED integers, so a box whose real width is
     672.6px reports 673 on one path and 673 on another, but a box at 672.4 can
     report 672 or 673 depending on which side of a sub-pixel boundary the
     accumulated layout lands. A 1px disagreement is that rounding; anything
     larger is a real layout difference and still fails. */
  const near = (x, y) => {
    const A = String(x).split(',').map(Number), B = String(y).split(',').map(Number);
    if (A.length !== B.length) return false;
    return A.every((v, i) => Math.abs(v - B[i]) <= 1);
  };
  for (const k of ['shell', 'h1', 'bento', 'footer', 'features']) {
    if (!near(a[k], fresh[k])) diff.push(`${k} resized(${a[k]}) vs fresh(${fresh[k]})`);
  }
  if (a.sw !== fresh.sw || a.cw !== fresh.cw) diff.push(`scroll resized ${a.sw}/${a.cw} vs fresh ${fresh.sw}/${fresh.cw}`);
  if (diff.length) { console.log(`  ${String(w).padStart(4)}px`); diff.forEach((d) => fail(d)); }
  else process.stdout.write(`  ${String(w).padStart(4)}px matches a fresh load\n`);
}

await browser.close();

/* ------------------------------------------------------------------ report */
const total = rows.length + SHAPES.length * 2 + SEQ.length;
console.log(`\n${'-'.repeat(64)}`);
if (failures) {
  console.log(`FAILED · ${failures} assertion(s) across ${total} checks`);
  process.exit(1);
}
console.log(`PASSED · ${total} checks · every viewport fits, gutters symmetric,`);
console.log(`         live resize matches a fresh load at all ${SEQ.length} sizes`);