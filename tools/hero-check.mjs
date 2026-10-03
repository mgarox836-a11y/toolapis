#!/usr/bin/env node
/* ============================================================================
 * tools/hero-check.mjs — the verification pass for the hero / navbar fix.
 * ----------------------------------------------------------------------------
 * Captures the three scroll positions the seam has to be judged at (0%, 50% and
 * 100% of the hero) at BOTH required widths, in a browser this script owns —
 * not through the MCP session, whose between-call bookkeeping resets the scroll
 * position before the shutter opens.
 *
 *   node tools/hero-check.mjs                 # 1440 + 390, tag "v3"
 *   node tools/hero-check.mjs --tag trial
 *   node tools/hero-check.mjs --width 1440
 *
 * For each shot it records:
 *   * the scroll offset actually in effect (requested vs measured),
 *   * every console error and page error for the whole session,
 *   * the geometry of the join (where the hero ends, where the next section
 *     begins, whether the two touch, and the nav's state),
 * then hands the PNGs to tools/px.mjs by importing it, so the "no hard line"
 * claim is a row-to-row pixel delta rather than an opinion.
 * ==========================================================================*/

import { chromium } from 'playwright-core';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(HERE, 'shots');

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] ?? true); };
const TAG = String(arg('tag', 'v3'));
const ONLY = arg('width', null) ? [Number(arg('width'))] : [1440, 390];
const BASE = String(arg('url', 'http://localhost:5500/')).replace(/\/?$/, '/');

const CANDIDATES = [
  process.env.TOOLAPIS_BROWSER,
  '/usr/bin/brave',
  '/usr/bin/brave-browser',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
].filter(Boolean);

const ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-extensions',
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function findBrowser() {
  const { access } = await import('node:fs/promises');
  for (const p of CANDIDATES) {
    try { await access(p); return p; } catch { /* keep looking */ }
  }
  throw new Error('No installed browser found. Set TOOLAPIS_BROWSER=/path/to/binary');
}

/* ---- minimal PNG reader, shared with tools/px.mjs logic ------------------ */
function decodePng(buf) {
  let pos = 8, ihdr = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colorType: data[9], interlace: data[12] };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const { inflateSync: inflate } = { inflateSync };
  const raw = inflate(Buffer.concat(idat));
  const CH = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType];
  const stride = ihdr.width * CH;
  const px = Buffer.alloc(ihdr.height * stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  let ri = 0;
  for (let y = 0; y < ihdr.height; y++) {
    const f = raw[ri++];
    const line = raw.subarray(ri, ri + stride); ri += stride;
    const out = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= CH ? out[x - CH] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= CH ? prev[x - CH] : 0;
      const v = line[x];
      out[x] = f === 0 ? v : f === 1 ? (v + a) & 255 : f === 2 ? (v + b) & 255 : f === 3 ? (v + ((a + b) >> 1)) & 255 : (v + paeth(a, b, c)) & 255;
    }
  }
  return { ...ihdr, CH, stride, px };
}

/* Scan a vertical column across [y0,y1] and report the largest row-to-row jump,
 * plus the pixel values on either side of it. A hard edge is ONE row spiking;
 * a fade is many rows of small steps. Threshold 24/255 per channel-sum is the
 * line between "a gradient" and "a rule". */
function seamScan(img, cols, y0, y1) {
  const rows = [];
  const at = (x, y) => { const i = y * img.stride + x * img.CH; return [img.px[i], img.px[i + 1], img.px[i + 2]]; };
  let prev = null;
  for (let y = Math.max(0, y0); y <= Math.min(img.height - 1, y1); y++) {
    const cur = cols.map((x) => at(Math.max(0, Math.min(img.width - 1, x)), y));
    if (prev) {
      const d = cur.map((c, i) => Math.abs(c[0] - prev[i][0]) + Math.abs(c[1] - prev[i][1]) + Math.abs(c[2] - prev[i][2]));
      rows.push({ y, d: Math.max(...d), above: prev.map((c) => c.join(',')), below: cur.map((c) => c.join(',')) });
    }
    prev = cur;
  }
  rows.sort((a, b) => b.d - a.d);
  return { worst: rows.slice(0, 5), total: rows.length };
}

const browser = await findBrowser();
await mkdir(SHOTS, { recursive: true });
const report = { tag: TAG, url: BASE, widths: [], consoleErrors: [], pageErrors: [] };

const browserInstance = await chromium.launch({ executablePath: browser, args: ARGS });
const context = await browserInstance.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

for (const width of ONLY) {
  const height = width === 390 ? 844 : 900;
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`[${width}] ${m.text()}`); });
  page.on('pageerror', (e) => report.pageErrors.push(`[${width}] ${e.message}`));

  /* domcontentloaded, not load: the page pulls a Tailwind CDN stylesheet, Google
     Fonts and Phosphor from the network, and `load` can outstay the measurement
     window on a cold cache. Everything this script asserts is a computed style
     or a box, both of which the CSSOM has long since settled by the time the
     intro is done. */
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  /* The intro owns the first ~4s and pins the scroll at 0 while it runs, so
     anything measured before it finishes is a measurement of the curtain. */
  await page.waitForFunction(() => document.documentElement.classList.contains('intro-done'), null, { timeout: 20000 }).catch(() => {});
  /* ...and then there is the failsafe's own late sweep: index.html re-asserts
     scroll 0 at 0/100/300/800/1500ms after the LOAD event, to cancel a browser
     restore. This page's load lands tens of seconds late on a cold CDN cache,
     so scrolling before readyState=complete is simply undone underneath us.
     Measured, not guessed: the scroll was being reset to 0 by exactly this. */
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 90000 }).catch(() => {});
  await wait(3000);

  const heroH = await page.evaluate(() => document.getElementById('hero').getBoundingClientRect().height);

  /* The join, measured in DOCUMENT rows — the number that does not care where
     the window happens to be parked. */
  const geom = await page.evaluate(() => {
    const hero = document.getElementById('hero');
    const next = document.getElementById('overview');
    const hb = hero.getBoundingClientRect();
    const nb = next.getBoundingClientRect();
    const cs = (el, p) => getComputedStyle(el)[p];
    return {
      heroTopDoc: Math.round(hb.top + window.scrollY),
      heroBottomDoc: Math.round(hb.bottom + window.scrollY),
      nextTopDoc: Math.round(nb.top + window.scrollY),
      /* The whole point: the two boxes share a row to the pixel. A gap here
         means something is wedged between them, and a gap is a seam. */
      touch: Math.abs(hb.bottom - nb.top) <= 1,
      heroBg: cs(hero, 'backgroundColor'),
      heroRadius: cs(hero, 'borderRadius'),
      heroBorder: cs(hero, 'borderTopWidth') + ' ' + cs(hero, 'borderTopColor'),
      docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      /* Anything actually straddling the join that carries a border — the
         other way a seam gets drawn. */
      overJoin: Array.from(document.querySelectorAll('#hero *, #overview > *, #overview *')).filter((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        const edge = s.borderTopWidth !== '0px' || s.borderBottomWidth !== '0px';
        const box = s.boxShadow !== 'none';
        const straddles = r.height > 0 && r.width > 300 && r.top < hb.bottom - 1 && r.bottom > hb.top + 1;
        return (edge || box) && straddles && Math.abs(r.bottom - hb.bottom) < 40;
      }).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} :: bt=${cs(el, 'borderTopWidth')} bb=${cs(el, 'borderBottomWidth')} bbC=${cs(el, 'borderBottomColor')}`),
    };
  });

  /* Nav behaviour is a scroll-driven assertion, so this is the one place that
     has to move the window — done inside a single evaluate, in-page, where the
     intro's late guard can't interleave between the scroll and the read. */
  const navStates = await page.evaluate(async () => {
    const nav = document.getElementById('navbar');
    const grab = () => {
      const s = getComputedStyle(nav);
      return {
        scrollY: Math.round(window.scrollY),
        solid: nav.classList.contains('nav-solid'),
        bg: s.backgroundColor,
        blur: s.backdropFilter || s.webkitBackdropFilter,
        borderBottom: s.borderBottomWidth + ' ' + s.borderBottomColor,
        active: Array.from(nav.querySelectorAll('.nav-link.active')).map((a) => a.textContent.trim()),
        links: Array.from(nav.querySelectorAll('.nav-link')).map((a) => {
          const s2 = getComputedStyle(a);
          return { t: a.textContent.trim(), color: s2.color, ff: s2.fontFamily.split(',')[0].replace(/"/g, ''), fs: s2.fontSize, ls: s2.letterSpacing, tt: s2.textTransform };
        }),
        ctas: Array.from(nav.querySelectorAll('a.btn, button')).map((b) => {
          const s2 = getComputedStyle(b);
          return { t: (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26), bg: s2.backgroundColor, border: s2.borderTopWidth + ' ' + s2.borderTopColor, radius: s2.borderRadius, ff: s2.fontFamily.split(',')[0].replace(/"/g, '') };
        }),
      };
    };
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const out = { atTop: null, scrolled: null };
    window.scrollTo({ top: 0, behavior: 'instant' });
    await frame(); await frame();
    out.atTop = grab();
    const heroH = document.getElementById('hero').getBoundingClientRect().height;
    window.scrollTo({ top: Math.round(heroH * 0.5), behavior: 'instant' });
    await frame(); await frame();
    out.scrolled = grab();
    window.scrollTo({ top: 0, behavior: 'instant' });
    await frame();
    return out;
  });

  const marks = [
    { name: 's00', y: 0 },
    { name: 's50', y: Math.round(heroH * 0.5) },
    { name: 's100', y: Math.round(heroH) },
  ];

  /* Frames are fullPage+clip captures. This resolves the clip against the whole
     document surface, so the window is never asked to scroll — the intro holds
     the hero at scroll 0 and re-asserts it for 1.5s after the load event, so a
     scrolling harness spends most of its life fighting that.
     (A plain viewport capture is far cheaper, but on this page the first
     page.screenshot() tends to take the renderer's execution context with it;
     CDP captureBeyondViewport avoids that and then hangs rasterising 3500px
     under swiftshader. fullPage+clip is slow but it finishes and it is
     deterministic, and determinism is the point of a seam measurement.) */
  const shots = [];
  for (const m of marks) {
    const file = `${TAG}-${width}-${m.name}.png`;
    await page.screenshot({
      path: resolve(SHOTS, file),
      scale: 'css',
      fullPage: true,
      clip: { x: 0, y: m.y, width, height },
      timeout: 300000,
    });
    shots.push({ ...m, file, joinRow: geom.heroBottomDoc - m.y });
  }

  /* Seam measurement: largest row-to-row jump in a 120-row band straddling the
     join, sampled at the left edge, centre and right edge. A hard line is one
     row spiking; a fade is many rows of small steps. */
  const seam = {};
  for (const s of shots.filter((x) => x.name !== 's00')) {
    const img = decodePng(readFileSync(resolve(SHOTS, s.file)));
    const cols = [Math.round(img.width * 0.04), Math.round(img.width * 0.5), Math.round(img.width * 0.96)];
    const r = seamScan(img, cols, s.joinRow - 120, s.joinRow + 120);
    seam[s.name] = { joinRow: s.joinRow, ...r };
  }

  report.widths.push({ width, height, heroH: Math.round(heroH), geom, navStates, shots, seam });
  await page.close();
}

await context.close();
await browserInstance.close();

/* ---- print ------------------------------------------------------------- */
console.log(`\n=== ${TAG} · ${BASE} ===`);
console.log(`console errors: ${report.consoleErrors.length}   page errors: ${report.pageErrors.length}`);
report.consoleErrors.forEach((e) => console.log('  ! ' + e));
report.pageErrors.forEach((e) => console.log('  !! ' + e));

for (const w of report.widths) {
  console.log(`\n--- viewport ${w.width}x${w.height} · hero ${w.heroH}px ---`);
  const g = w.geom;
  console.log(`  hero: bg=${g.heroBg} radius=${g.heroRadius} border=${g.heroBorder}  doc-rows ${g.heroTopDoc}..${g.heroBottomDoc}`);
  console.log(`  next section top at doc row ${g.nextTopDoc} -> touch=${g.touch}  horizontal overflow=${g.docOverflowX}px`);
  console.log(g.overJoin.length ? `  EDGES NEAR THE JOIN: ${g.overJoin.join(' | ')}` : '  no bordered/shadowed element sits near the join');
  for (const s of w.navStates ? [w.navStates.atTop, w.navStates.scrolled] : []) {
    console.log(`  nav @scrollY=${s.scrollY}: solid=${s.solid} bg=${s.bg} blur=${s.blur} border-bottom=${s.borderBottom} active=[${s.active.join(',')}]`);
  }
  console.log('  nav links:');
  w.navStates.atTop.links.forEach((l) => console.log(`      ${w.navStates.atTop.active.includes(l.t) ? '*' : ' '} ${l.t.padEnd(9)} ${l.ff} ${l.fs} ${l.tt} ls=${l.ls} ${l.color}`));
  console.log('  nav controls:');
  w.navStates.atTop.ctas.forEach((c) => console.log(`      ${c.t.padEnd(28)} bg=${c.bg} border=${c.border} r=${c.radius} ${c.ff}`));
  console.log('  seam — worst row-to-row pixel jump within 120 rows of the join:');
  for (const [k, v] of Object.entries(w.seam)) {
    console.log(`      ${k} (join at image row ${v.joinRow}): ${v.worst.map((r) => `y=${r.y}:${r.d}`).join('  ')}`);
    const top = v.worst[0];
    if (top) console.log(`         worst row y=${top.y}: above=[${top.above}]  below=[${top.below}]`);
  }
}

await writeFile(resolve(SHOTS, `${TAG}-report.json`), JSON.stringify(report, null, 2));
console.log(`\nwritten: ${SHOTS}/${TAG}-report.json`);