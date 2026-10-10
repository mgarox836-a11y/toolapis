#!/usr/bin/env node
/* ============================================================================
 * tools/hero-edge-check.mjs — prove the hero has no hard rectangular edge.
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The hero's glow was reported as "a blue block with a sharp edge on the right".
 * It was not one thing but two, and only one of them was a glow bug:
 *
 *   1. At 1366 the hard edge at x≈1262 was the TOOL PASS accent card — a solid
 *      mint panel, luminance step ~174/255 across 345px of scanline. A card has
 *      edges. It is gone now.
 *
 *   2. At 1920 and above there was a second, genuine defect: a ~14/255 step
 *      persisting 167px at x=1792. That one WAS the glow. `.hero-scene__ground`
 *      painted `--gradient-ground` (top stop rgb(22,48,82)) through a mask that
 *      faded its left, top and bottom edges but held `#000` to 100% on the
 *      right, on the reasoning that the scene box bleeds off-screen so that edge
 *      "never needs one". True at 1366 (box right = 1427) and 1440 (1464); false
 *      at 1920 (1793) and 2560 (2272), where the box's right edge is INSIDE the
 *      viewport and the gradient ends on a straight vertical line.
 *
 *      The clip was NOT the cause. Forcing `overflow: visible` at runtime left
 *      the edge exactly where it was, because a gradient with no ramp on one
 *      side has that side whatever box contains it. Fixed by adding the missing
 *      right ramp to the mask AND making the scene's bleed track the shell's
 *      own side margin, so the box clears the viewport at every width.
 *
 * WHAT IT MEASURES
 *
 * Not "is there an edge somewhere" — a screenshot diff would be useless here,
 * because a soft glow legitimately has bright-to-dark transitions everywhere.
 * The defect is SPECIFICALLY a discontinuity: a step between two ADJACENT
 * pixels that then holds for a long straight run. That is what a rectangular
 * gradient edge is, and it is what no amount of intended shading produces.
 *
 * For each column x, in the hero band:
 *
 *     step(x) = |luma(x, y) - luma(x+1, y)|   for every row y
 *
 * A column is FLAGGED when the step exceeds THRESH for a run of at least MINRUN
 * consecutive rows — i.e. the discontinuity is not a glyph, an icon or a chip,
 * it is a LINE. Same for rows.
 *
 * WHAT IT GRADES
 *
 * Only the AMBIENT layers — `.hero-bg`, `.hero-grid-lines`, `.hero-glow`,
 * `.hero-fade`, `.hero-horizon`, `.hero-scene` — and the canvas between them.
 * Everything else in the hero is UI with a straight edge by design: a chip's
 * 1px border, a pill's outline, the `.hero-horizon` hairline, every glyph. The
 * exclusion set is built from the DOM rather than hardcoded, so the scan keeps
 * up with the hero's own markup.
 *
 * A naive first pass flagged ~200 edges per screenshot and reported the hero as
 * broken; every one was a letterform or a chip border. So the tool grades the
 * pixels that painted light and empty canvas share, and asks of them the only
 * question that matters here: is any of them a RECTANGLE?
 *
 * TEXT IS EXCLUDED BY GEOMETRY, NOT BY GUESSING. A naive first pass flagged
 * ~200 edges per screenshot, all of them letterforms: every stem is a straight
 * vertical edge. The fix is to skip columns whose run overlaps a DOM text box,
 * measured in the page rather than inferred from the pixels. The glow lives in
 * empty areas, so nothing real is lost — and what remains is exactly the
 * geometric edges this tool exists to catch.
 *
 * IT IS VALIDATED AGAINST THE DEFECT, NOT JUST AGAINST THE FIX
 *
 * A checker that passes on the repaired stylesheet proves nothing — it may be
 * passing because it cannot see. So it was run against the committed CSS from
 * before the fix (`git checkout 675b65d -- css/hero3d.css`), and it fails there
 * on exactly the defect it was written for:
 *
 *     FAIL  1920 · 100%   vertical@1792 run=526px peak=20
 *     FAIL  2560 · 100%   vertical@2271 run=842px peak=28
 *     FAIL  1920 · 80%    vertical@1792 run=526px peak=20
 *     FAIL  1920 · 125%   vertical@1792 run=526px peak=21
 *
 * and passes on all ten cases once the mask ramps both ends and the bleed
 * tracks the shell's margin. If a future change breaks it, this file is the
 * list of numbers to compare against before assuming the check has gone blind.
 *
 *   node tools/hero-edge-check.mjs
 *   node tools/hero-edge-check.mjs --url http://localhost:5500/
 *   node tools/hero-edge-check.mjs --shots    # also write the isolated PNGs
 *
 * Exits 1 on any failure so it can gate a commit.
 * ==========================================================================*/

import { chromium } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (k) => argv.includes('--' + k);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };

const BASE = String(opt('url', 'http://localhost:5500/'));
const SHOTS = flag('shots');
const SHOT_DIR = path.resolve(String(opt('out', '/tmp/shots/revert-glass/edge')));

/* The widths in the report, plus the two ends of the zoom range. 1366 and 1440
   are the laptops the bug was reported from; 1920 and 2560 are where the box
   edge first resolved INSIDE the viewport, which is the whole regression. */
const CASES = [
  { w: 1366, h: 900, zoom: 1,    label: '1366 · 100%' },
  { w: 1440, h: 900, zoom: 1,    label: '1440 · 100%' },
  { w: 1920, h: 900, zoom: 1,    label: '1920 · 100%' },
  { w: 2560, h: 1440, zoom: 1,   label: '2560 · 100%' },
  { w: 1366, h: 900, zoom: 0.8,  label: '1366 · 80%' },
  { w: 1440, h: 900, zoom: 0.8,  label: '1440 · 80%' },
  { w: 1920, h: 900, zoom: 0.8,  label: '1920 · 80%' },
  { w: 1366, h: 900, zoom: 1.25, label: '1366 · 125%' },
  { w: 1440, h: 900, zoom: 1.25, label: '1440 · 125%' },
  { w: 1920, h: 900, zoom: 1.25, label: '1920 · 125%' },
];

/* A discontinuity of 6/255 in luma is roughly the smallest step a display shows
   as an edge on a near-black field; below it, banding. 80 rows is long enough
   that a letterform stem (20-40px) and a chip border (28px) cannot reach it,
   and short enough to catch a card edge crossing the hero. */
const THRESH = 6;
const MINRUN = 80;

/* Browser discovery, matching the other tools in this directory. The
   playwright-managed chromium is tried first: the system list is Brave, which is
   what the other checks use, but a missing system browser should degrade to
   "still checked" rather than to "cannot check". */
const CANDIDATES = [
  ...(process.env.CHROME_PATH ? [process.env.CHROME_PATH] : []),
  '/usr/bin/brave', '/usr/bin/brave-browser', '/usr/bin/chromium',
  '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
  path.join(process.env.HOME || '', '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),
];
let exe = null;
for (const p of CANDIDATES) { try { await access(p); exe = p; break; } catch { /* next */ } }
if (!exe) { console.error('no browser found'); process.exit(1); }

/* --- a PNG decoder, in the file, so this tool has no dependencies ----------
   Playwright can screenshot, but it cannot tell you whether the result has a
   straight edge in it. Decoding is the one piece that cannot be delegated, and
   it is ~30 lines: concatenate the IDAT chunks, inflate, undo the five PNG
   scanline filters. Non-interlaced 8-bit only, which is all Chromium emits. */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let p = 8, w = 0, h = 0, depth = 0, color = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; color = data[9];
      if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
      if (data[12] !== 0) throw new Error('interlaced png unsupported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = color === 6 ? 4 : color === 2 ? 3 : color === 0 ? 1 : color === 4 ? 2 : 0;
  if (!ch) throw new Error(`unsupported colour type ${color}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = ch;                 // 8-bit: one byte per channel
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;          // left
      const b = prev ? prev[i] : 0;                  // above
      const c = (prev && i >= bpp) ? prev[i - bpp] : 0; // upper-left
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += Math.floor((a + b) / 2);
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
  }
  return { w, h, bpp, stride, data: out };
}

/* Rec.709 luma. The channel order matters: for bpp<3 this is greyscale, and for
   bpp 3/4 the first three bytes are R,G,B. */
const luma = (img, x, y) => {
  const i = y * img.stride + x * img.bpp;
  return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
};

function findHardEdges(img) {
  const flagged = [];

  /* A genuine rectangle edge is a SUSTAINED step: the pixels on one side sit at a
     different brightness from the pixels on the other, for the whole length of
     the run. A single bright pixel between two identical neighbours is a 1px
     line — a hairline, an antialiasing seam, a stroke's own centre — and it is
     not what this tool is looking for. Measured on the real page: the ribbon's
     track rendered a 111px column at luma 16 with luma 8.1 on BOTH sides, which
     a naive adjacent-pixel difference reads as a 42/255 edge and a reader cannot
     see at all.

     So a candidate has to clear the threshold on the ADJACENT-COLUMN MEAN: mean
     luma of the `SHOULDER` columns to the left against the same to the right, over
     the run. A boundary moves that difference by a lot; a line cancels out. */
  const SHOULDER = 6;

  /* Vertical edges: compare column x against x+1 down every row. */
  for (let x = 1; x < img.w - SHOULDER - 1; x++) {
    let run = 0, peak = 0, start = 0;
    let leftSum = 0, rightSum = 0, n = 0;
    for (let y = 0; y < img.h; y++) {
      const step = Math.abs(luma(img, x, y) - luma(img, x + 1, y));
      if (step > THRESH) {
        if (run === 0) start = y;
        run++; peak = Math.max(peak, step);
        let l = 0, r = 0;
        for (let k = 1; k <= SHOULDER; k++) { l += luma(img, x - k, y); r += luma(img, x + 1 + k, y); }
        leftSum += l / SHOULDER; rightSum += r / SHOULDER; n++;
      } else {
        if (run >= MINRUN) {
          const d = Math.abs(leftSum / n - rightSum / n);
          if (d > THRESH) flagged.push({ axis: 'vertical', at: x, run, peak: Math.round(peak), shift: Math.round(d), from: start });
        }
        run = 0; peak = 0; leftSum = 0; rightSum = 0; n = 0;
      }
    }
    if (run >= MINRUN) {
      const d = Math.abs(leftSum / n - rightSum / n);
      if (d > THRESH) flagged.push({ axis: 'vertical', at: x, run, peak: Math.round(peak), shift: Math.round(d), from: start });
    }
  }

  /* Horizontal edges: compare row y against y+1 across every column. */
  for (let y = 1; y < img.h - SHOULDER - 1; y++) {
    let run = 0, peak = 0, start = 0;
    let upSum = 0, downSum = 0, n = 0;
    for (let x = 0; x < img.w; x++) {
      const step = Math.abs(luma(img, x, y) - luma(img, x, y + 1));
      if (step > THRESH) {
        if (run === 0) start = x;
        run++; peak = Math.max(peak, step);
        let u = 0, d = 0;
        for (let k = 1; k <= SHOULDER; k++) { u += luma(img, x, y - k); d += luma(img, x, y + 1 + k); }
        upSum += u / SHOULDER; downSum += d / SHOULDER; n++;
      } else {
        if (run >= MINRUN) {
          const d = Math.abs(upSum / n - downSum / n);
          if (d > THRESH) flagged.push({ axis: 'horizontal', at: y, run, peak: Math.round(peak), shift: Math.round(d), from: start });
        }
        run = 0; peak = 0; upSum = 0; downSum = 0; n = 0;
      }
    }
    if (run >= MINRUN) {
      const d = Math.abs(upSum / n - downSum / n);
      if (d > THRESH) flagged.push({ axis: 'horizontal', at: y, run, peak: Math.round(peak), shift: Math.round(d), from: start });
    }
  }
  return flagged;
}

/* The stylesheet that isolates the ambient hero.
 *
 * Every previous version of this tool tried to work out which pixels belonged to
 * painted light and which to UI, in the page, from bounding boxes — and every one
 * of them was wrong in a way that either hid the defect or invented it. A 1px
 * hairline got dropped by a size floor. A 1768px `.hub-ground` 848px below the
 * fold poked into the band and vetoed every column. The toast silenced a 717px
 * run 300px away. A wrapper with no background of its own masked the whole hero,
 * so the tool passed unconditionally. Against a deliberately regressed
 * stylesheet it reported "no hard edge" every time.
 *
 * So the browser decides, not a heuristic: everything that is not painted light
 * is set to `display: none`, the page is screenshotted, and only what remains can
 * be graded. Nothing to misjudge, and it cannot silently pass.
 *
 * WHAT IS GRADED
 *
 * Only the hero's FILL layers — the ones whose boundaries are supposed to be
 * invisible because each edge is masked back to the canvas:
 *
 *     .hero-bg              a dark gradient the fade below dissolves
 *     .hero-glow            the phosphor bloom
 *     .hero-fade            the dissolve into #070707
 *     .hero-scene__ground   --gradient-ground under a four-sided mask
 *     .hero-scene__bloom    the bloom inside the scene
 *
 * NOT graded: .hero-horizon, .hero-scene__floor and .hero-ribbon. Those are
 * drawn AS lines — a 1px hairline DESIGN.md names, a 64px perspective grid, a
 * stroked path. A grid is made of straight edges on purpose, so asking whether
 * one has a straight edge asks the wrong question and answers yes; grading them
 * reported the floor's own gridlines as the defect. Same reason the grid layer
 * inside `.hero-bg` is stripped rather than graded: the fill is kept, the grid
 * dropped, so the layer is graded for the thing that can actually be wrong.
 *
 * The set is named, not discovered — "is this a gradient" is not a question the
 * DOM can answer — and re-read after injection so a rename cannot quietly empty
 * the scan and turn the check into a rubber stamp. */
const AMBIENT_SELECTORS = [
  '.hero-bg', '.hero-glow', '.hero-fade', '.hero-scene__ground', '.hero-scene__bloom',
];

/* Layers drawn as lines rather than filled. */
const LINE_SELECTORS = [
  '.hero-horizon', '.hero-scene__floor', '.hero-ribbon',
];

const isolateAmbient = () => `
  /* Painted light survives; everything else stops painting.

     \`visibility: hidden\`, NOT \`display: none\`. Both remove ink, but only
     \`visibility\` leaves the boxes where they are — and the boxes are what the
     scene's geometry resolves against. \`.hero-scene\` is absolutely positioned
     with \`inset\`/\`width\` against \`.hero-inner\`, so dropping the copy column
     out of the grid moved the scene ~66px and the scan then graded a box the
     real page never has. A defect checker must measure the page as it ships: it
     may change what is painted, and nothing else. */
  html, body { background: #000 !important; }

  /* Below the hero, and chrome over it. None of these sits inside the hero's
     stacking context, so removing them outright shifts nothing in the band. */
  main > section:not(#hero), header, nav, .grain, #scroll-progress,
  .mobile-menu, .page-transition { display: none !important; }

  /* The entrance overlay. It is a fixed full-viewport panel that only exists for
     the first few seconds of the page, and this tool grades a screenshot of the
     hero — so on a page where the entrance is still running it would grade the
     PANEL, not the hero. Its progress rail is 70vw wide (capped at 320px) and
     2px tall, which is precisely the "a long straight run of discontinuity is a
     rectangle showing its edge" this tool exists to catch, and it reported that
     rectangle at eight of the ten viewports until the rail was named here.

     display: none rather than visibility: hidden because this layer is fixed
     and contributes no layout the band depends on. */
  #intro-overlay { display: none !important; }

  /* The hero's content: hidden, so its boxes still hold the layout that
     positions the ambient layers. */
  .hero-copy, .hero-cta-row, .hero-play-btn, .hero-chips { visibility: hidden !important; }

  /* Lines, not fills — see WHAT IS GRADED. */
  ${LINE_SELECTORS.join(', ')} { visibility: hidden !important; }

  /* .hero-bg carries a diagonal gradient AND a 56px grid in the same
     background-image stack. The fill is what can show a bad edge; the grid is
     made of straight lines by design. Keep the first layer, drop the rest. */
  .hero-bg {
    background-image: linear-gradient(180deg, rgba(20, 20, 24, 0.9) 0%, rgba(7, 7, 7, 0) 42%) !important;
    background-size: 100% 100% !important;
  }
`;

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio'],
});

if (SHOTS) await mkdir(SHOT_DIR, { recursive: true });

console.log(`\n=== hero edge check · ${BASE} ===`);
console.log(`threshold ${THRESH}/255 · min run ${MINRUN}px · ambient layers only, UI removed\n`);

let failures = 0;

for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  /* Let the bloom and the reveal animations settle into a static pose, so a scan
     cannot trip over a gradient that is mid-breath.

     THE ENTRANCE HAS TO BE OVER FIRST. The page now holds a panel over the
     viewport for the first few seconds of every load, and this is a tool that
     grades what is painted on screen — asked a second and a half in, it would be
     grading the panel. `intro-done` is written by the <head> bootstrap and by
     js/intro.js whichever survives, and it is only ever set after the overlay
     element has left the DOM, so waiting for it cannot hang on a module that
     never runs. */
  await page.waitForFunction(
    () => document.documentElement.classList.contains('intro-done')
       || !document.getElementById('intro-overlay'),
    null, { timeout: 20000 },
  ).catch(() => {});
  await page.waitForTimeout(900);

  /* The hero's own height, BEFORE anything is hidden, so the band is the hero as
     the reader gets it rather than as the isolated render leaves it. */
  const heroH = await page.evaluate(() => {
    const r = document.querySelector('#hero').getBoundingClientRect();
    return Math.min(Math.ceil(r.height), document.documentElement.clientHeight);
  });

  /* Strip everything that is not painted light. */
  await page.addStyleTag({ content: isolateAmbient() });
  await page.waitForTimeout(250);

  /* The isolated hero is shorter than it was, because the copy that gave it its
     height is gone. Scan what is actually painted rather than a stale number. */
  const bandH = await page.evaluate(() => {
    const r = document.querySelector('#hero').getBoundingClientRect();
    return Math.max(1, Math.min(Math.ceil(r.height), document.documentElement.clientHeight));
  });

  /* The scan is only meaningful if the layers it grades are really on screen. An
     emptied selector list would otherwise report "no hard edge" because there was
     nothing left to have one. */
  const painted = await page.evaluate((sels) => sels.map((s) => {
    const el = document.querySelector(s);
    if (!el) return `${s}: MISSING`;
    const r = el.getBoundingClientRect();
    return r.width < 1 && r.height < 1 ? `${s}: ZERO-SIZED` : null;
  }).filter(Boolean), AMBIENT_SELECTORS);

  const band = { x: 0, y: 0, width: c.w, height: bandH };
  const buf = await page.screenshot({ clip: band });
  const img = decodePNG(buf);
  const edges = findHardEdges(img);

  if (SHOTS) {
    await writeFile(path.join(SHOT_DIR, `hero-${c.w}-z${String(c.zoom).replace('.', '')}.png`), buf);
  }

  const problems = [];
  if (edges.length) problems.push(edges.map((e) => `${e.axis}@${e.at} run=${e.run}px peak=${e.peak}`).join(' ; '));
  if (painted.length) problems.push(painted.join(' ; '));
  if (errors.length) problems.push(`console: ${errors.slice(0, 2).join(' | ')}`);

  const ok = problems.length === 0;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.label.padEnd(14)} ${ok ? 'no hard edge' : problems.join(' | ')}`);
  await page.close();
}

await browser.close();

console.log('');
if (failures) {
  console.log(`FAILED · ${failures} of ${CASES.length} viewports have a hard edge`);
  console.log('A long straight run of discontinuity is a rectangle showing its edge.');
  console.log('Check .hero-scene__ground\'s mask — every side needs a ramp — and that');
  console.log('.hero-scene\'s bleed still clears the viewport at this width.');
  process.exit(1);
}
console.log(`PASSED · ${CASES.length} viewports · no hard edge in the hero at any zoom`);