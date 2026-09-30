#!/usr/bin/env node
/* ============================================================================
 * tools/shot.mjs — TOOLAPIS · 3D layer screenshot harness
 * ----------------------------------------------------------------------------
 * Opens the live static site on :5500 with a SYSTEM browser (no download),
 * waits for the intro to finish, then visits each section and saves a PNG.
 *
 *   node tools/shot.mjs                       # all four shots
 *   node tools/shot.mjs --tag before          # prefix the filenames
 *   node tools/shot.mjs --only hero,flow      # a subset
 *   node tools/shot.mjs --debug               # append ?scene3d=debug
 *   node tools/shot.mjs --url http://x:5500/ # a different origin
 *
 * No browser is ever installed by this file; it drives whatever Brave/Chrome
 * is already on the box through playwright-core.
 * ==========================================================================*/

import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(HERE, 'shots');

/* ---- args ------------------------------------------------------------- */
const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf('--' + k);
  return i === -1 ? d : (argv[i + 1] ?? true);
};
const TAG = arg('tag', '');
const ONLY = String(arg('only', '') || '').split(',').filter(Boolean);
const DEBUG = argv.includes('--debug');
const ISOLATE = !argv.includes('--no-isolate');
const BASE = String(arg('url', 'http://localhost:5500/')).replace(/\/?$/, '/');
const W = Number(arg('width', 1366));
const H = Number(arg('height', 768));

/* ---- browser discovery: an INSTALLED one only, never a download --------- */
const CANDIDATES = [
  process.env.TOOLAPIS_BROWSER,
  '/usr/bin/brave',
  '/usr/bin/brave-browser',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/snap/bin/chromium',
].filter(Boolean);

async function findBrowser() {
  const { access } = await import('node:fs/promises');
  for (const p of CANDIDATES) {
    try { await access(p); return p; } catch { /* keep looking */ }
  }
  throw new Error('No installed browser found. Set TOOLAPIS_BROWSER=/path/to/binary');
}

/* Software GL: swiftshader renders WebGL headlessly on a machine with no GPU,
 * which is exactly what a 4GB box without a discrete card needs. */
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

/* ---- the four shots the art direction is judged on ---------------------- */
const SHOTS_PLAN = [
  { name: 'hero',     sel: '#hero',     top: 'top' },
  { name: 'features', sel: '#features', top: 'top' },
  { name: 'flow',     sel: '#flow',     top: 'top' },
  { name: 'clarity',  sel: '#clarity',  top: 'top' },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* Software GL on a 4GB box can lose the renderer context mid-run, which
 * destroys the JS execution context with it. Every page-side step is retried
 * a couple of times so one flaky frame does not cost the whole screenshot set,
 * and a crash is reported instead of swallowed. */
async function robust(page, problems, label, fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (err) {
      last = err;
      if (page.isClosed()) break;
      problems.console.push(`[warn] ${label} failed (try ${i + 1}): ${String(err.message || err).split('\n')[0]}`);
      await wait(700);
    }
  }
  throw last;
}

async function main() {
  const exec = await findBrowser();
  await mkdir(SHOTS, { recursive: true });

  const qs = new URLSearchParams({ quality: 'high' });
  /* probe mode exposes the read-only pose handle WITHOUT the solver overlay,
   * so the geometry dump below can be read off a clean screenshot. */
  qs.set('scene3d', DEBUG ? 'debug' : 'probe');
  const url = BASE + '?' + qs.toString();

  console.log('browser :', exec);
  console.log('url     :', url);
  console.log('viewport:', `${W}x${H}`);

  const browser = await chromium.launch({
    executablePath: exec,
    headless: true,
    args: ARGS,
  });

  const problems = { console: [], pageerror: [] };
  let shots_geo = null;

  let runError = null;

  try {
    const page = await browser.newPage({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
    });

    page.on('console', (m) => {
      const t = m.type();
      if (t === 'error' || t === 'warning') {
        problems.console.push(`[${t}] ${m.text()}`);
      }
    });
    page.on('pageerror', (e) => problems.pageerror.push(String(e && e.message || e)));
    page.on('crash', () => problems.pageerror.push('[crash] renderer process crashed (software GL out of memory?)'));
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame() && !f.url().startsWith(url.split('?')[0])) {
        problems.pageerror.push(`[nav] unexpected navigation to ${f.url()}`);
      }
    });

    /* The page has been observed to reload itself mid-run (the context is
     * destroyed "most likely because of a navigation"). Every shot therefore
     * re-checks a marker set below and, when it is gone, redoes the whole
     * wait sequence instead of shooting a locked, top-of-page reload. */
    const boot = async () => {
      let last = null;
      for (let t = 0; t < 3; t++) {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          last = null;
          break;
        } catch (err) {
          last = err;
          problems.console.push(`[warn] goto failed (try ${t + 1}): ${String(err.message || err).split('\n')[0]}`);
          await wait(1200);
        }
      }
      if (last) throw last;

      /* The scene announces itself on <html>; the intro announces itself with
       * `intro-done`. Either is a hard timeout, not a hang. */
      await page.waitForSelector('html.scene3d', { timeout: 12000 }).catch(() => {
        problems.console.push('[warn] html.scene3d never appeared');
      });
      await page.waitForFunction(
        () => document.documentElement.classList.contains('intro-done'),
        null, { timeout: 9000 },
      ).catch(() => problems.console.push('[warn] .intro-done never appeared'));

      /* Let the failsafe / entrance settle so the pose is the FINAL pose. */
      await wait(1400);
      await page.evaluate(() => { window.__SHOT_LIVE = '1'; });
    };
    const alive = async () => {
      try {
        return await page.evaluate(() => window.__SHOT_LIVE === '1'
          && !document.getElementById('intro-overlay'));
      } catch { return false; }
    };

    await boot();
    if (!(await alive())) { problems.console.push('[warn] page not live after boot'); await boot(); }

    const plan = ONLY.length ? SHOTS_PLAN.filter((s) => ONLY.includes(s.name)) : SHOTS_PLAN;

    for (const shot of plan) {
      /* A reload between shots leaves a locked page at the top: re-boot and
       * re-scroll instead of capturing it. */
      if (!(await alive())) {
        problems.console.push('[warn] page reloaded mid-run — re-booting');
        await boot();
      }
      await robust(page, problems, `scroll ${shot.name}`, () => page.evaluate(({ sel, top }) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const y = top === 'top' ? el.offsetTop : (el.offsetTop + el.offsetHeight - window.innerHeight);
        window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
      }, shot));

      /* 1.2s per section: long enough for the damped transitions and the
       * per-section transforms to arrive, short enough to stay cheap. */
      await wait(1200);

      /* Verify the scroll actually stuck (a reloaded page locks the scroll);
       * if not, re-scroll once more before the capture. */
      const where = await robust(page, problems, `measure ${shot.name}`, () =>
        page.evaluate((sel) => {
          const r = document.querySelector(sel).getBoundingClientRect();
          return { rectTop: Math.round(r.top), y: Math.round(window.scrollY) };
        }, shot.sel)).catch(() => ({ rectTop: NaN, y: NaN }));
      if (Number.isFinite(where.rectTop) && Math.abs(where.rectTop) > 2 && where.y === 0) {
        await robust(page, problems, `rescroll ${shot.name}`, () => page.evaluate(({ sel }) => {
          const el = document.querySelector(sel);
          if (el) window.scrollTo({ top: el.offsetTop, behavior: 'instant' });
        }, shot));
        await wait(900);
      }

      const file = resolve(SHOTS, `${TAG ? TAG + '-' : ''}${shot.name}.png`);
      await robust(page, problems, `capture ${shot.name}`, () =>
        page.screenshot({ path: file, scale: 'css' }));
      console.log('shot    :', `${shot.name.padEnd(9)} scrollY ${where.y}  sectionTop ${where.rectTop}`);

      /* Per-section geometry dump: the authored anchor, the committed screen
       * box, the live rotation and the measured text obstacles. This is what
       * "never overlaps the copy" and "front face >= 65% visible" are checked
       * against, alongside the pixels. */
      const geo = await robust(page, problems, `probe ${shot.name}`, () =>
        page.evaluate(() => {
          const d = window.__scene3d;
          const out = { vw: innerWidth, vh: innerHeight, props: {}, obstacles: [] };
          if (d && d.debug && d.debug.chosen) {
            for (const k of Object.keys(d.debug.chosen)) {
              const c = d.debug.chosen[k];
              const o = d.state.objects[k];
              out.props[k] = {
                box: c ? [c.x0, c.y0, c.x1, c.y1] : null,
                cx: c ? Math.round(c.x) : null, cy: c ? Math.round(c.y) : null,
                w: c ? Math.round(c.w) : null, h: c ? Math.round(c.h) : null,
                opacity: o ? +o.opacity.toFixed(3) : null,
                state: c ? c.state : null,
                rotY: o ? +(o.group.rotation.y * 57.2958).toFixed(1) : null,
                rotX: o ? +(o.group.rotation.x * 57.2958).toFixed(1) : null,
                rotZ: o ? +(o.group.rotation.z * 57.2958).toFixed(1) : null,
                scale: o ? +o.group.scale.x.toFixed(3) : null,
                visible: o ? o.group.visible : null,
                croppedPx: c ? Math.round(c.croppedPx || 0) : null,
              };
            }
          }
          /* Real text line boxes currently on screen: the same thing the
           * validator measures, read straight off the DOM. */
          const sel = 'h1,h2,h3,h4,p,li,.btn,.glass-panel,.spot-card,span.a,a';
          for (const el of document.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.bottom < 0 || r.top > innerHeight || r.width < 4 || r.height < 4) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
            const txt = (el.textContent || '').trim().slice(0, 28);
            if (!txt) continue;
            out.obstacles.push({
              tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
                ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''),
              box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
              txt,
            });
          }
          return out;
        })).catch((e) => ({ error: String(e.message || e) }));

      (shots_geo ||= []).push({ name: shot.name, ...geo });

      /* Isolated capture: the 3D layer alone. Every DOM element except the
       * canvas wrapper is hidden, so a silhouette measured from this PNG is a
       * prop and not a heading — which is what makes "no prop is pure black"
       * and "nothing is cropped at an edge" measurable. */
      if (ISOLATE) {
        await robust(page, problems, `isolate ${shot.name}`, () =>
          page.evaluate(() => {
            for (const el of document.body.children) {
              if (el.tagName === 'CANVAS') continue;
              el.dataset.shotHide = '1';
              el.style.visibility = 'hidden';
            }
            const c = document.querySelector('#scene3d-canvas');
            if (c) { c.style.visibility = 'visible'; c.style.zIndex = '2147483000'; }
          }));
        await wait(260);
        const iso = resolve(SHOTS, `${TAG ? TAG + '-' : ''}${shot.name}-3d.png`);
        await robust(page, problems, `capture-3d ${shot.name}`, () =>
          page.screenshot({ path: iso, scale: 'css' }));
        await robust(page, problems, `unisolate ${shot.name}`, () =>
          page.evaluate(() => {
            for (const el of document.querySelectorAll('[data-shot-hide]')) {
              el.style.visibility = '';
              delete el.dataset.shotHide;
            }
            const c = document.querySelector('#scene3d-canvas');
            if (c) c.style.zIndex = '';
          }));
        console.log('   3d  :', `${shot.name}-3d.png`);
      }
    }

    /* A cheap machine-read of what the layer thinks it is doing: which props
     * are visible, where they landed, whether anything is faded. */
    const state = await robust(page, problems, 'scene state', () => page.evaluate(() => {
      const d = window.__scene3d;
      if (!d || typeof d.info !== 'function') return null;
      try { return d.info(); } catch (e) { return { error: String(e) }; }
    }));
    if (state) console.log('scene   :', JSON.stringify(state));

    if (shots_geo) {
      const geoFile = resolve(SHOTS, `${TAG ? TAG + '-' : ''}geometry.json`);
      await writeFile(geoFile, JSON.stringify(shots_geo, null, 2));
      console.log('geometry: tools/shots/' + (TAG ? TAG + '-' : '') + 'geometry.json');
      /* The overlap verdict, computed here so it is never a matter of opinion:
       * every committed prop box against every measured text box. */
      let overlaps = 0;
      for (const s of shots_geo) {
        for (const [k, p] of Object.entries(s.props || {})) {
          if (!p.box || (p.opacity ?? 1) < 0.05) continue;
          for (const o of s.obstacles || []) {
            const ix = Math.min(p.box[2], o.box[2]) - Math.max(p.box[0], o.box[0]);
            const iy = Math.min(p.box[3], o.box[3]) - Math.max(p.box[1], o.box[1]);
            if (ix > 2 && iy > 2) {
              overlaps++;
              console.log(`  OVERLAP ${s.name}/${k} box ${p.box.join(',')} vs ${o.tag} "${o.txt}" by ${ix}x${iy}px`);
            }
          }
        }
      }
      console.log('overlaps:', overlaps);
    }
  } catch (err) {
    runError = err;
  } finally {
    /* One page at a time, closed immediately: this box has 4GB. */
    await browser.close().catch(() => {});
  }

  if (problems.pageerror.length) {
    console.log('\n--- pageerror ---');
    for (const p of [...new Set(problems.pageerror)]) console.log('  ' + p);
  }
  if (problems.console.length) {
    console.log('\n--- console (error/warning) ---');
    for (const p of [...new Set(problems.console)].slice(0, 30)) console.log('  ' + p);
  }
  if (!problems.pageerror.length && !problems.console.length) console.log('\nclean: no console errors, no pageerror');

  if (runError) { console.error('\nFATAL:', runError); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });