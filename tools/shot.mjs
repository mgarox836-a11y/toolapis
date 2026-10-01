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
/* --quality= forces the tier, so the same liveness checks can be run against
 * both ends of the adaptive ladder rather than only the machine's default. */
const QUALITY = String(arg('quality', 'high'));
/* --live=off skips the liveness probe (it adds ~3s per section). */
const LIVE = arg('live', 'on') !== 'off';
const BASE = String(arg('url', 'http://localhost:5500/')).replace(/\/?$/, '/');
const W = Number(arg('width', 1366));
const H = Number(arg('height', 768));
/* Consecutive cold reloads, and a mid-session resize to these sizes, so the
 * teardown path and the resize path are exercised rather than assumed. */
const RELOADS = Math.max(0, Number(arg('reloads', 0)) || 0);
const RESIZE_TO = String(arg('resize', '')).split('x').map(Number).filter((n) => Number.isFinite(n) && n > 0);

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
  { name: 'overview', sel: '#overview', top: 'top' },
  { name: 'features', sel: '#features', top: 'top' },
  { name: 'flow',     sel: '#flow',     top: 'top' },
  { name: 'clarity',  sel: '#clarity',  top: 'top' },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- the liveness probe ---------------------------------------------------
 * A screenshot proves a frame was drawn ONCE. It cannot tell a live, animating
 * scene from a frozen one, and it cannot tell a scene whose entrance finished
 * from one still stuck at 0. So after `intro-done` we sample the scene 6 times
 * over ~3s and assert two things:
 *
 *   frames advance   the monotonic frame counter must increase every sample.
 *                    If it does not, the loop is dead — whatever the pixels say.
 *   poses move       each prop's position or rotation must differ between
 *                    consecutive samples. A scene that renders but never moves
 *                    is frozen, and a frozen scene looks fine in a screenshot.
 *
 * Every sample also carries `gl.isContextLost()` read from the LIVE GL context,
 * not from the event flags, so a context that died without firing the event is
 * still caught.
 *
 * Healthy = frames increased AND at least one prop's pose changed.
 */
const LIVENESS_SAMPLES = 6;
/* 6 samples with 600ms between them spans 3.0s, as specified. */
const LIVENESS_GAP_MS = 600;
const LIVENESS_EPS = 1e-4;

/* Poll the live prop opacities until they stop changing, so every capture and
 * every overlap verdict is taken at the steady state rather than partway
 * through a damped fade. Returns how long it waited and whether it went quiet
 * before the ceiling — a run that never settles is reported, not hidden. */
const SETTLE_POLL_MS = 300;
const SETTLE_QUIET_MS = 900;
const SETTLE_MAX_MS = 15000;
/* Exponential damping never lands exactly, so "settled" is a RATE test, and it
 * has to watch position as well as opacity: the opacity damping is much faster
 * than the anchor/position damping, so an opacity-only test goes quiet while
 * the prop is still sliding to where it belongs — which measures the box in
 * the wrong place. The threshold is a per-300ms delta: alpha in 0..1, world
 * position in roughly -8..8, so 0.01 is a small fraction of a pixel of either. */
const SETTLE_EPS = 0.01;

async function settleProps(page, problems, label) {
  const t0 = Date.now();
  let last = null;
  let lastChange = Date.now();
  while (Date.now() - t0 < SETTLE_MAX_MS) {
    const now = await page.evaluate(() => {
      const d = window.__scene3d;
      if (!d || typeof d.info !== 'function') return null;
      return (d.info().propStates || []).flatMap((p) => [
        Number.isFinite(p.opacity) ? p.opacity : 0,
        Number.isFinite(p.px) ? p.px : 0,
        Number.isFinite(p.py) ? p.py : 0,
      ]);
    }).catch(() => null);
    if (now != null) {
      /* The damping is exponential, so it approaches the target without ever
       * reaching it: an exact comparison would wait forever. What matters is
       * that the largest per-prop CHANGE between polls has fallen below a
       * threshold — at that point the pose is visually still. */
      let maxDelta = Infinity;
      if (last != null) {
        maxDelta = 0;
        for (let i = 0; i < Math.max(now.length, last.length); i++) {
          maxDelta = Math.max(maxDelta, Math.abs((now[i] || 0) - (last[i] || 0)));
        }
        if (maxDelta > SETTLE_EPS) lastChange = Date.now();
        if (Date.now() - lastChange >= SETTLE_QUIET_MS) {
          return { ms: Date.now() - t0, quiet: true };
        }
      }
      last = now;
    }
    await wait(SETTLE_POLL_MS);
  }
  problems.console.push(`[warn] ${label}: props still fading after ${SETTLE_MAX_MS}ms — measuring mid-transition`);
  return { ms: Date.now() - t0, quiet: false };
}

async function livenessProbe(page, problems, label) {
  const samples = [];
  for (let i = 0; i < LIVENESS_SAMPLES; i++) {
    let snap;
    try {
      snap = await page.evaluate(() => {
        const d = window.__scene3d;
        if (!d || typeof d.info !== 'function') return null;
        const info = d.info();
        const canvas = document.querySelector('canvas[data-scene3d]')
          || (d.state && d.state.canvas) || null;
        return {
          frames: info.frames,
          fps: info.fps,
          introProgress: info.introProgress,
          sectionIndex: info.sectionIndex,
          section: info.section,
          tier: info.tier,
          running: info.running,
          lastFrameAgeMs: info.lastFrameAgeMs,
          contextLostCount: info.contextLostCount,
          /* read the REAL context where we can; fall back to the event flag */
          glLost: info.glContextLost !== null && info.glContextLost !== undefined
            ? info.glContextLost : info.contextLost,
          canvasFound: !!canvas,
          props: (info.propStates || []).map((p) => ({
            key: p.key,
            opacity: p.opacity,
            visible: p.visible,
            reason: p.reason,
            px: p.px, py: p.py, pz: p.pz,
            rx: p.rx, ry: p.ry, rz: p.rz,
          })),
        };
      });
    } catch (err) {
      samples.push({ error: String((err && err.message) || err) });
      if (i < LIVENESS_SAMPLES - 1) await wait(LIVENESS_GAP_MS);
      continue;
    }
    if (!snap) {
      samples.push({ error: 'no __scene3d handle (probe mode off?)' });
      if (i < LIVENESS_SAMPLES - 1) await wait(LIVENESS_GAP_MS);
      continue;
    }
    samples.push(snap);
    if (i < LIVENESS_SAMPLES - 1) await wait(LIVENESS_GAP_MS);
  }

  const good = samples.filter((s) => !s.error);
  const verdict = {
    label,
    errors: samples.length - good.length,
    framesAdvanced: false,
    posesMoved: false,
    contextOk: good.every((s) => s.glLost === false),
    introReached1: good.length ? good.every((s) => s.introProgress >= 1) : false,
    running: good.length ? good.every((s) => s.running === true) : false,
    sectionIndex: good.length ? good[good.length - 1].sectionIndex : null,
    tier: good.length ? good[good.length - 1].tier : null,
    frameDelta: 0,
    movedProps: [],
    samples,
  };

  if (good.length >= 2) {
    verdict.framesAdvanced = good.every((s, i) => i === 0 || s.frames > good[i - 1].frames);
    verdict.frameDelta = good[good.length - 1].frames - good[0].frames;
    const moved = [];
    for (const s0 of good[0].props) {
      let did = false;
      for (let i = 1; i < good.length && !did; i++) {
        const s1 = good[i].props.find((p) => p.key === s0.key);
        if (!s1) continue;
        const dp = Math.hypot(s1.px - s0.px, s1.py - s0.py, s1.pz - s0.pz);
        const dr = Math.hypot(s1.rx - s0.rx, s1.ry - s0.ry, s1.rz - s0.rz);
        /* A prop that is authored hidden still holds a pose, and holding still
         * is correct for it — so only a VISIBLE prop counts as "should move". */
        if (s0.visible && s0.opacity > 0.01 && (dp > LIVENESS_EPS || dr > LIVENESS_EPS)) did = true;
      }
      if (did) moved.push(s0.key);
    }
    verdict.movedProps = moved;
    /* "Poses move" is required for a scene that HAS a visible prop. A scene
     * whose every prop is authored hidden legitimately holds still, and that
     * is a different (and separately reported) condition. */
    const anyVisible = good[0].props.some((p) => p.visible && p.opacity > 0.01);
    verdict.posesMoved = anyVisible ? moved.length > 0 : true;
    verdict.anyVisibleProp = anyVisible;
  }
  verdict.healthy = verdict.framesAdvanced && verdict.posesMoved
    && verdict.contextOk && verdict.introReached1 && verdict.running && verdict.errors === 0;
  return verdict;
}

function printLiveness(v) {
  console.log(`\nliveness: ${v.label}  ${v.healthy ? 'PASS' : 'FAIL'}`);
  console.log('  frames  : '
    + v.samples.filter((s) => !s.error)
      .map((s) => s.frames).join(' -> ')
    + `  (+${v.frameDelta})  advanced=${v.framesAdvanced}`);
  console.log('  poses   : moved=' + (v.movedProps.length ? v.movedProps.join(',') : 'none')
    + `  anyVisible=${v.anyVisibleProp}`);
  console.log('  intro   : ' + v.samples.filter((s) => !s.error).map((s) => s.introProgress.toFixed(2)).join(' -> ')
    + `  reached1=${v.introReached1}`);
  console.log('  state   : section#' + v.sectionIndex + ' tier=' + v.tier
    + ' running=' + v.running + ' ctxLost=' + (!v.contextOk));
  const bad = v.samples.filter((s) => s.error);
  if (bad.length) {
    console.log('  errors  : ' + bad.length + ' sample(s) failed — ' + [...new Set(bad.map((s) => s.error))].join('; '));
  }
  if (!v.framesAdvanced) console.log('  !! frames did not advance — the loop is not running');
  if (!v.posesMoved) console.log('  !! no visible prop changed pose — the scene is frozen');
  if (!v.contextOk) console.log('  !! gl.isContextLost() was true on at least one sample');
  if (!v.introReached1) console.log('  !! introProgress did not reach 1 on every sample');
}

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

  const qs = new URLSearchParams({ quality: QUALITY });
  /* probe mode exposes the read-only pose handle WITHOUT the solver overlay,
   * so the geometry dump below can be read off a clean screenshot. */
  qs.set('scene3d', DEBUG ? 'debug' : 'probe');
  const url = BASE + '?' + qs.toString();

  console.log('browser :', exec);
  console.log('url     :', url);
  console.log('viewport:', `${W}x${H}`);
  console.log('quality :', QUALITY, `(liveness ${LIVE ? 'on' : 'off'})`);
  console.log('extra   :', `reloads=${RELOADS}${RESIZE_TO.length === 2 ? ` resize=${RESIZE_TO.join('x')}` : ''}`);

  const browser = await chromium.launch({
    executablePath: exec,
    headless: true,
    args: ARGS,
  });

  const problems = { console: [], pageerror: [] };
  let shots_geo = null;
  let liveness = null;
  let reloads = null;
  let resizes = null;

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

    /* Cold-reload soak: a fresh document each time, so the renderer-side
     * teardown runs exactly as it would for a returning visitor. After every
     * reload the scene must come back up and start advancing frames — a reload
     * that leaves a dead scene behind is the failure this is looking for. */
    if (RELOADS > 0) {
      const rows = [];
      for (let r = 1; r <= RELOADS; r++) {
        await boot();
        const f0 = await page.evaluate(() => {
          const d = window.__scene3d;
          return d && d.info ? d.info().frames : -1;
        }).catch(() => -1);
        await wait(1500);
        const st = await page.evaluate(() => {
          const d = window.__scene3d;
          if (!d || typeof d.info !== 'function') return null;
          const i = d.info();
          return { frames: i.frames, running: i.running, lost: i.contextLostCount, err: i.lastError || null };
        }).catch(() => null);
        const advanced = st && st.frames > f0;
        rows.push({ reload: r, frames: st ? `${f0}->${st.frames}` : 'no handle',
                    running: st ? st.running : false, ctxLost: st ? st.lost : '?', ok: !!advanced && !!(st && st.running) });
        console.log(`reload ${r}/${RELOADS}: frames ${rows[r - 1].frames} running=${rows[r - 1].running} ctxLost=${rows[r - 1].ctxLost}`);
      }
      const bad = rows.filter((x) => !x.ok).length;
      console.log('reloads :', `${RELOADS - bad}/${RELOADS} came back live`);
      if (bad) problems.pageerror.push(`[reload] ${bad}/${RELOADS} reloads did not resume a live scene`);
      (reloads ||= []).push(...rows);
    }

    /* Mid-session viewport switches: same document, same WebGL context. A
     * resize that leaves the props with stale boxes or a dead loop shows up
     * here and not in a cold boot. */
    if (RESIZE_TO.length === 2) {
      const [rw, rh] = RESIZE_TO;
      await page.setViewportSize({ width: rw, height: rh });
      console.log('resized :', `${W}x${H} -> ${rw}x${rh}`);
      await wait(900);
      const after = await page.evaluate(() => {
        const d = window.__scene3d;
        if (!d || typeof d.info !== 'function') return null;
        const i = d.info();
        const boxes = (i.propStates || []).map((p) => (p.px + ',' + p.py));
        return { frames: i.frames, running: i.running, vw: innerWidth, vh: innerHeight,
                 boxCount: boxes.filter((b) => b !== '0,0').length };
      }).catch(() => null);
      if (!after) {
        console.log('resize  : FAIL (scene handle gone)');
        problems.pageerror.push('[resize] scene handle lost after viewport change');
      } else {
        const f0 = after.frames;
        await wait(1500);
        const grown = await page.evaluate(() => (window.__scene3d.info() || {}).frames).catch(() => f0);
        const ok = grown > f0 && after.running && after.vw === rw && after.vh === rh;
        console.log('resize  :', ok ? 'PASS' : 'FAIL',
          `frames ${f0}->${grown} vw=${after.vw} vh=${after.vh} propsWithPose=${after.boxCount}`);
        if (!ok) problems.pageerror.push('[resize] scene did not resume advancing after a viewport change');
        (resizes ||= []).push({ to: `${rw}x${rh}`, frames: `${f0}->${grown}`, vw: after.vw, vh: after.vh, ok });
      }
      /* restore, so the shot plan below captures the requested viewport */
      await page.setViewportSize({ width: W, height: H });
      await wait(700);
    }

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

      /* Wait for the props to STOP MOVING rather than for a fixed delay. The
       * opacity damping is time-based, so under software GL (dt is clamped to
       * 50ms while a frame really takes ~450ms) a fixed 1.2s wait lands
       * mid-fade and reports a prop that is on its way out as an overlap with
       * the copy. Polling the live opacities measures the steady state, which
       * is the thing the overlap verdict is supposed to be about. */
      const settled = await settleProps(page, problems, shot.name);
      console.log('settled :', shot.name, `${settled.ms}ms`, `quiet=${settled.quiet}`);

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
                /* WHY the validator committed this opacity — so a faded prop in
                 * the dump is explainable without opening the overlay. */
                reason: c ? (c.reason || c.state) : null,
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
            /* A card CONTAINER is a soft obstacle, exactly as js/scroll.js treats
             * it: a translucent glass panel behind a prop is depth, not a
             * collision, and the prop is dimmed rather than faded. Only the
             * TEXT inside it is hard. Marking that here keeps the overlap
             * count below honest — counting the container would report every
             * deliberately-backlit CTA card as a failure. */
            const isCard = el.matches('.glass-panel, .spot-card')
              || !!el.closest('.glass-panel, .spot-card');
            const isText = /^(h1|h2|h3|h4|p|li|span|a|button)$/i.test(el.tagName);
            out.obstacles.push({
              tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
                ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''),
              box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
              txt,
              soft: !isText,
            });
          }
          return out;
        })).catch((e) => ({ error: String(e.message || e) }));

      (shots_geo ||= []).push({ name: shot.name, ...geo });

      /* The liveness probe, per section: sample the scene 6 times over ~3s and
       * assert the loop is advancing frames AND the props are moving. A frozen
       * scene screenshots perfectly, so this is the only thing that can tell a
       * live 3D layer from a dead one that happened to paint a good frame. */
      if (LIVE) {
        const verdict = await livenessProbe(page, problems, `${shot.name} @${QUALITY} ${W}x${H}`);
        printLiveness(verdict);
        (liveness ||= []).push(verdict);
      }

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

    if (reloads || resizes) {
      if (reloads) {
        const bad = reloads.filter((r) => !r.ok).length;
        console.log('--- reload table ---');
        for (const r of reloads) console.log(`  reload ${r.reload}  frames ${r.frames}  running=${r.running} ctxLost=${r.ctxLost}  ${r.ok ? 'PASS' : 'FAIL'}`);
        console.log(`reloads: ${reloads.length - bad}/${reloads.length} came back live`);
      }
      if (resizes) {
        console.log('--- resize table ---');
        for (const r of resizes) console.log(`  -> ${r.to}  frames ${r.frames}  viewport ${r.vw}x${r.vh}  ${r.ok ? 'PASS' : 'FAIL'}`);
      }
    }

    if (shots_geo) {
      const geoFile = resolve(SHOTS, `${TAG ? TAG + '-' : ''}geometry.json`);
      await writeFile(geoFile, JSON.stringify(shots_geo, null, 2));
      console.log('geometry: tools/shots/' + (TAG ? TAG + '-' : '') + 'geometry.json');
      /* The overlap verdict, computed here so it is never a matter of opinion:
       * every committed prop box against every measured text box. */
      let overlaps = 0;
      let backlit = 0;
      let presenceBare = 0;
      for (const s of shots_geo) {
        for (const [k, p] of Object.entries(s.props || {})) {
          /* Skip props that are not actually on screen. `visible` is the
           * authoritative signal: a prop the tier hides (all of them on
           * mobile) keeps a stale `opacity` of 1 from its last desktop frame,
           * so opacity alone would report every hidden prop as overlapping
           * the whole page. */
          if (!p.box || p.visible === false || (p.opacity ?? 1) < 0.05) continue;
          for (const o of s.obstacles || []) {
            const ix = Math.min(p.box[2], o.box[2]) - Math.max(p.box[0], o.box[0]);
            const iy = Math.min(p.box[3], o.box[3]) - Math.max(p.box[1], o.box[1]);
            if (!(ix > 2 && iy > 2)) continue;
            if (o.soft) {
              backlit++;
              console.log(`  backlit ${s.name}/${k} over ${o.tag} "${o.txt}" by ${ix}x${iy}px (soft, dimmed)`);
            } else {
              overlaps++;
              console.log(`  OVERLAP ${s.name}/${k} box ${p.box.join(',')} vs ${o.tag} "${o.txt}" by ${ix}x${iy}px`);
            }
          }
        }
      }
      console.log('overlaps:', overlaps, '(hard text) backlit:', backlit, '(glass card)');
      /* Presence: a section where every prop is hidden renders no 3D at all,
       * which is the same as the layer never having started. Counted here so
       * an "all props faded" bug cannot pass as a clean overlap report. */
      for (const s of shots_geo) {
        /* A prop that has settled at 0.09 alpha is not "present" — it is a ghost
         * left over from a fade. Require it to be both committed (not
         * 'hidden') and actually drawn at a quarter alpha. */
        const shown = Object.entries(s.props || {})
          .filter(([, p]) => p.visible !== false && p.state !== 'hidden' && (p.opacity ?? 0) > 0.25);
        if (!shown.length) {
          console.log(`  BARE ${s.name}: no prop visible (${s.vw}x${s.vh})`);
          presenceBare++;
        }
      }
      console.log('presence:', `${shots_geo.length - presenceBare}/${shots_geo.length} sections have a visible prop`);
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

  /* The counts, which is what the pass/fail table is built from. ERRORS are the
   * ones that matter: warnings here are expected (a CDN notice, a sigma clip, a
   * software-GL stall). A console ERROR is a real fault and must be 0. */
  const errorsOnly = problems.console.filter((c) => c.startsWith('[error]'));
  const warningsOnly = problems.console.filter((c) => c.startsWith('[warning]'));
  console.log('\n--- summary ---');
  console.log(`console errors   : ${errorsOnly.length}`);
  console.log(`console warnings : ${warningsOnly.length}`);
  console.log(`pageerrors       : ${problems.pageerror.length}`);
  if (errorsOnly.length) {
    for (const p of [...new Set(errorsOnly)].slice(0, 20)) console.log('  ERROR ' + p);
  }

  if (liveness && liveness.length) {
    console.log('\n--- liveness table ---');
    console.log('section        frames  poses  intro  ctx  running  verdict');
    for (const v of liveness) {
      const name = String(v.label).padEnd(13);
      console.log(
        name
        + String(`+${v.frameDelta}`).padEnd(8)
        + String(v.movedProps.length).padEnd(7)
        + String(v.introReached1 ? '1' : 'no').padEnd(7)
        + String(v.contextOk ? 'ok' : 'LOST').padEnd(5)
        + String(v.running).padEnd(9)
        + (v.healthy ? 'PASS' : 'FAIL')
      );
    }
    const bad = liveness.filter((v) => !v.healthy);
    console.log(`liveness: ${liveness.length - bad.length}/${liveness.length} healthy`);
  }

  if (!problems.pageerror.length && !problems.console.length) console.log('clean: no console errors, no pageerror');

  if (runError) { console.error('\nFATAL:', runError); process.exit(1); }
  /* A non-zero exit makes the verdict usable from a script: 0 only when the
   * console was clean of errors AND every liveness probe passed. */
  if (errorsOnly.length || problems.pageerror.length
    || (liveness && liveness.some((v) => !v.healthy))) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });