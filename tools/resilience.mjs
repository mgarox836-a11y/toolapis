#!/usr/bin/env node
/* ============================================================================
 * tools/resilience.mjs — TOOLAPIS · frame-loop resilience checks
 * ----------------------------------------------------------------------------
 * Drives the live site with playwright-core (installed browser only) and
 * asserts the four guarantees js/scene3d.js now makes:
 *
 *   1. a subsystem that throws cannot kill the loop, is logged ONCE, and is
 *      disabled after `maxSubsystemFailures` consecutive failures while the
 *      rest of the scene keeps running
 *   2. a non-finite prop is reset to its section anchor, warned once, and the
 *      frame keeps rendering
 *   3. the loop resumes after being stopped, and the watchdog restarts a loop
 *      whose frames stopped arriving
 *   4. webglcontextlost / webglcontextrestored are handled and logged
 *
 *   node tools/resilience.mjs
 * ==========================================================================*/

import { chromium } from 'playwright-core';
import { access } from 'node:fs/promises';

const ARGS = [
  '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
  '--hide-scrollbars', '--mute-audio', '--disable-extensions',
];
const CANDIDATES = [
  process.env.TOOLAPIS_BROWSER, '/usr/bin/brave', '/usr/bin/brave-browser',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome', '/snap/bin/chromium',
].filter(Boolean);
const URL_ = (process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:5500/').replace(/\/?$/, '/');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function findBrowser() {
  for (const p of CANDIDATES) {
    try { await access(p); return p; } catch { /* keep looking */ }
  }
  throw new Error('No installed browser found. Set TOOLAPIS_BROWSER=/path/to/binary');
}

let failed = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

const browser = await chromium.launch({ executablePath: await findBrowser(), args: ARGS });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

/* Every console line, so the assertions can count how many times something was
   actually reported rather than trusting that it was reported at all. */
const lines = [];
page.on('console', (m) => lines.push({ type: m.type(), text: m.text() }));
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));

const countMatching = (re) => lines.filter((l) => re.test(l.text)).length;

/* ---------------------------------------------------------------- boot ---- */
await page.goto(`${URL_}?quality=high&scene3d=probe`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__scene3d && window.__scene3d.state
  && window.__scene3d.state.objects && window.__scene3d.state.objects.hd), null, { timeout: 45000 });
await wait(2500);

/* ORDER MATTERS. The throwing-subsystem test permanently disables the
   subsystem it breaks (that is the guarantee being asserted), and a disabled
   `placeObjects` means the per-prop NaN guard never runs — so it goes last. */
console.log('\n--- 1. non-finite prop is reset, warned once ---');
{
  await page.evaluate(() => {
    const o = window.__scene3d.state.objects.hd;
    o.anchor.position.set(NaN, NaN, NaN);
    o.group.scale.setScalar(NaN);
    o.spinY = Infinity;
  });
  await wait(1500);
  const after = await page.evaluate(() => {
    const o = window.__scene3d.state.objects.hd;
    return {
      anchor: [o.anchor.position.x, o.anchor.position.y, o.anchor.position.z],
      scale: [o.group.scale.x, o.group.scale.y, o.group.scale.z],
      spinY: o.spinY, opacity: o.opacity, running: window.__scene3d.state.running,
    };
  });
  const finite = [...after.anchor, ...after.scale, after.spinY, after.opacity]
    .every((v) => Number.isFinite(v));
  check('prop position/scale/spin/opacity all finite again', finite, JSON.stringify(after));
  check('loop still running', after.running === true);
  const warned = countMatching(/went non-finite/);
  check('non-finite warn logged once per prop', warned === 1, `${warned} warn line(s)`);
}

console.log('\n--- 2. loop survives a subsystem that throws every frame ---');
{
  const before = await page.evaluate(() => {
    const d = window.__scene3d;
    return { elapsed: d.state.elapsed, running: d.state.running };
  });
  /* Make `placeObjects` throw on every frame, from inside the page. */
  await page.evaluate(() => {
    const eng = window.__scene3d.state.engine;
    eng.__realLayout = eng.layout;
    eng.layout = () => { throw new Error('injected layout fault'); };
  });
  await wait(3000);
  const after = await page.evaluate(() => {
    const d = window.__scene3d;
    const S = d.state.subsystems.placeObjects;
    return {
      running: d.state.running, elapsed: d.state.elapsed,
      fails: S.fails, disabled: S.disabled, reported: S.reported,
      otherOk: !!(d.state.particles && d.state.particles.count),
    };
  });
  check('loop still running after an every-frame throw', after.running === true);
  check('frames kept advancing (elapsed moved)', after.elapsed > before.elapsed,
    `${before.elapsed.toFixed(2)} -> ${after.elapsed.toFixed(2)}`);
  check('faulting subsystem disabled after 3 consecutive failures',
    after.disabled === true && after.fails >= 3, `fails=${after.fails}`);
  const thrown = countMatching(/subsystem "placeObjects" threw/);
  const disabled = countMatching(/subsystem "placeObjects" failed 3 times/);
  check('throwing subsystem logged exactly ONCE (not every frame)', thrown === 1, `${thrown} log line(s)`);
  check('disable reported once', disabled === 1, `${disabled} log line(s)`);
  check('other subsystems untouched', after.otherOk === true);
  check('no pageerror from the injected fault', pageErrors.length === 0,
    pageErrors.slice(0, 2).join(' | '));
}

console.log('\n--- 3. resume + watchdog ---');
{
  /* stop() then a resume signal must bring it back. */
  const stopped = await page.evaluate(() => {
    const d = window.__scene3d;
    /* Reach the module's own stop through the debug handle's dispose-free path:
       simulate the browser dropping the frame by clearing the flag the way the
       visibilitychange handler does. */
    d.state.running = false;
    if (d.state.rafId) cancelAnimationFrame(d.state.rafId);
    d.state.rafId = 0;
    return d.state.running;
  });
  check('loop forced to a stop', stopped === false);
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await wait(800);
  const resumed = await page.evaluate(() => window.__scene3d.state.running);
  check('pageshow resumed the loop', resumed === true);

  /* The watchdog: pretend the last frame was ancient and confirm it restarts. */
  const restarted = await page.evaluate(async () => {
    const d = window.__scene3d;
    /* Wedge the loop: keep `running` true but stop frames from arriving by
       cancelling the pending rAF, then age lastFrameAt well past the bar. */
    if (d.state.rafId) cancelAnimationFrame(d.state.rafId);
    d.state.rafId = 0;
    d.state.lastFrameAt = performance.now() - 60000;
    return new Promise((resolve) => {
      setTimeout(() => resolve({ lastFrameAt: d.state.lastFrameAt, running: d.state.running }), 2500);
    });
  });
  check('watchdog restarted a loop whose frames stopped',
    restarted.lastFrameAt > performance.now() - 3000 && restarted.running === true,
    `age now ${Math.round(performance.now() - restarted.lastFrameAt)}ms`);

  const stallWarns = countMatching(/frame loop stalled/);
  check('stall restart logged at least once', stallWarns >= 1, `${stallWarns}`);
}

console.log('\n--- 4. webgl context loss / restore ---');
{
  const res = await page.evaluate(async () => {
    const d = window.__scene3d;
    const canvas = document.getElementById('scene3d-canvas');
    const gl = d.state.renderer.getContext();
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) return { supported: false };
    const before = { running: d.state.running };
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 900));
    const lost = { lost: d.state.contextLost, running: d.state.running };
    ext.restoreContext();
    await new Promise((r) => setTimeout(r, 2500));
    return {
      supported: true, before, lost,
      after: { lost: d.state.contextLost, running: d.state.running },
    };
  });
  if (!res.supported) {
    console.log('  SKIP  WEBGL_lose_context unsupported on this driver');
  } else {
    check('contextlost parked the loop', res.lost.lost === true && res.lost.running === false);
    check('contextrestored cleared the flag and resumed',
      res.after.lost === false && res.after.running === true, JSON.stringify(res.after));
    check('context loss logged', countMatching(/WebGL context lost/) >= 1);
    check('context restore logged', countMatching(/WebGL context restored/) >= 1);
  }
  check('no pageerror across the whole run', pageErrors.length === 0,
    pageErrors.slice(0, 3).join(' | '));
}

console.log(`\n${failed ? `${failed} check(s) FAILED` : 'all checks passed'}`);
await browser.close();
process.exitCode = failed ? 1 : 0;