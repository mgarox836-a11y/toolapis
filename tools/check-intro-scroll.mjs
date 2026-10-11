#!/usr/bin/env node
/* ============================================================================
 * tools/check-intro-scroll.mjs — `npm run check:intro-scroll`
 * ----------------------------------------------------------------------------
 * WHAT THIS EXISTS FOR
 * A visitor pressed F5, scrolled before the entrance had finished, and the page
 * went blank: a flat #121212 with no content on it, for the rest of the session.
 * The cause was js/intro.js writing the class `intro-skip` onto <html> to
 * compress the hero's schedule, where css/intro.css also gave the Skip BUTTON a
 * `.intro-skip` skin starting at `opacity: 0`. A class selector matches <html>
 * when <html> carries that class, so the whole document element went invisible
 * and the only thing left on screen was the user-agent canvas. (Read
 * "THE STATE CLASSES" in css/intro.css.)
 *
 * That class of bug — an entrance that fails in a way no screenshot of the
 * finished page would ever show — is not something a happy-path check finds. So
 * this tool attacks it from every direction a visitor can come from.
 *
 * WHAT IT ASSERTS, FOR EVERY SCENARIO
 *   - nothing is invisible in the viewport: `hiddenInView === 0`, where the set
 *     includes every `[class*=reveal]`, `.rv`, h1, h2, p and bento child;
 *   - neither full-viewport layer is on top: `elementFromPoint` at five points
 *     is never `#intro-overlay` or `#page-transition`;
 *   - `html` carries no `intro-active`, `overflow` is back to normal, nothing is
 *     `inert`, and scrolling works again (a wheel moves the document);
 *   - the screenshot is not blank: pixel variance above the threshold, and every
 *     key element (navbar, any h1/h2 crossing the viewport) at opacity >= 0.99;
 *   - while the entrance still owns the screen, `scrollY` is 0 — the lock holds.
 *     A scrollbar drag is the one exception the spec allows: it may move the
 *     document, and it must come back and not blank.
 *   - the entrance is 5.0s ± 0.15s, CLS < 0.02, and zero console errors.
 *
 * It is validated against the defect, not only against the fix — see HANDOFF.md.
 * ==========================================================================*/

import { chromium, devices } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (k) => argv.includes('--' + k);
const BASE = (argv.indexOf('--url') + 1 > 0 && argv[argv.indexOf('--url') + 1]) || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOT_DIR || '/tmp/shots/intro-scroll';
mkdirSync(SHOTS, { recursive: true });

const VIEW = { width: 1366, height: 530 };          /* the owner's own window */
const MOBILE = devices['iPhone 13'];
const TIMES = [200, 1000, 2500, 4000];              /* ms after load */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* TWO MODES, because the full matrix cannot live in `npm run check`.
   Measured on this machine the 60-run matrix costs ~21s a run — roughly 22 to 25
   minutes — which is a gate nobody runs, so a gate nobody runs is a gate that is
   not a gate. `--full` is that matrix and stays the default for a deliberate run.

   The subset keeps all four gesture SHAPES, because they exercise different
   layers of the lock and dropping any one of them loses a class of bug:
     - `wheel` and `space` are the inputs layer 2 can `preventDefault()`;
     - `end` is a jump large enough to matter and far enough to leave the first
       screen behind, which is where stranded reveals show up;
     - `dragscroll` is the one input that bypasses layer 2 completely and can
       only be answered by the `scroll` listener.
   And it keeps the two timings this file already treats as the interesting ones
   (`worst`, below: the one before the entrance owns the screen, and the one
   immediately after it stops). `extras()` runs in BOTH modes — that is where the
   invariants are: the 5.0s ± 0.15s entrance, all four Skip paths, both
   re-refreshes, bfcache, the hidden tab, `?intro=off`, a deep link and motion. */
const FULL = has('full');
const QUICK_INPUTS = ['wheel', 'space', 'end', 'dragscroll'];
const QUICK_TIMES = [200, 2500];

let pass = 0;
const failures = [];
const notes = [];
const rows = [];

function check(label, ok, detail) {
  if (ok) { pass += 1; return true; }
  failures.push(`${label} — ${detail}`);
  return false;
}

/* ------------------------------------------------------------------ probes */

/* The five points a stuck overlay has to be caught at. The centre alone is what
   the original report used and it is not enough: a layer that has started to
   fade can sit at 0.4 opacity over the middle and nothing at the edges. They
   live INSIDE the probe, because Playwright serialises the function body and
   anything captured in a closure around it arrives in the page undefined. */
const probe = () => {
  const SAMPLE_POINTS = [[0.5, 0.5], [0.5, 0.12], [0.5, 0.88], [0.08, 0.5], [0.92, 0.5]];
  const d = document.documentElement;
  const intro = document.getElementById('intro-overlay');
  const pt = document.getElementById('page-transition');
  const vw = innerWidth, vh = innerHeight;
  const cs = intro ? getComputedStyle(intro) : null;

  const sel = '[class*="reveal"], [data-reveal], .rv, h1, h2, p, .card, .bento > *';
  const hidden = [...document.querySelectorAll(sel)].filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width + r.height === 0) return false;
    if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return false;
    return parseFloat(getComputedStyle(el).opacity) < 0.05;
  });

  const covering = [];
  for (const [fx, fy] of SAMPLE_POINTS) {
    const el = document.elementFromPoint(Math.round(vw * fx), Math.round(vh * fy));
    if (el && (el.id === 'intro-overlay' || el.id === 'page-transition')) {
      covering.push(el.id + '@' + fx + ',' + fy);
    }
  }

  /* Every key element that crosses the viewport has to be opaque. A hero that
     landed at 0.6 reads as "the page is there but empty" and is invisible to a
     count of hidden blocks, because the block itself is the one that faded. */
  const keyEls = [...document.querySelectorAll('#navbar, h1, h2')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width + r.height > 0 && r.bottom > 0 && r.top < vh;
    })
    .map((el) => ({
      tag: el.tagName + (el.id ? '#' + el.id : ''),
      opacity: parseFloat(getComputedStyle(el).opacity),
    }));

  return {
    scrollY: Math.round(scrollY),
    htmlClass: d.className,
    htmlOverflow: getComputedStyle(d).overflow,
    bodyOverflow: getComputedStyle(document.body).overflow,
    htmlOpacity: parseFloat(getComputedStyle(d).opacity),
    htmlDisplay: getComputedStyle(d).display,
    introPresent: !!intro,
    introDisplay: cs ? cs.display : 'absent',
    introOpacity: cs ? parseFloat(cs.opacity) : 0,
    transitionDisplay: pt ? getComputedStyle(pt).display : 'absent',
    transitionOpacity: pt ? parseFloat(getComputedStyle(pt).opacity) : 0,
    covering,
    hiddenInView: hidden.length,
    hiddenTags: hidden.slice(0, 5).map((el) => el.tagName + '.' + String(el.className).slice(0, 26)),
    inert: !!document.querySelector('[inert]'),
    keyEls,
    scrollable: d.scrollHeight > innerHeight + 4,
  };
};

/* Pixel variance of a PNG screenshot, decoded in the page rather than in Node:
   a screenshot that is one flat colour has near-zero variance, which is the
   signature of every blank this tool is looking for. */
async function pixelStats(page) {
  const buf = await page.screenshot();
  const b64 = buf.toString('base64');
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + data;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 240; c.height = 120;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 240, 120);
    const px = g.getImageData(0, 0, 240, 120).data;
    let n = 0, sum = 0, sum2 = 0, min = 255, max = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      sum += l; sum2 += l * l; n += 1;
      if (l < min) min = l;
      if (l > max) max = l;
    }
    const mean = sum / n;
    return { mean: +mean.toFixed(2), variance: +(sum2 / n - mean * mean).toFixed(2), range: +(max - min).toFixed(2) };
  }, b64);
}

/* ------------------------------------------------------------------ inputs */

const INPUTS = [
  { name: 'wheel', drag: false, run: async (p) => {
      for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 500); await wait(45); } } },
  { name: 'space', drag: false, run: (p) => p.keyboard.press('Space') },
  { name: 'pagedown', drag: false, run: (p) => p.keyboard.press('PageDown') },
  { name: 'arrowdown', drag: false, run: async (p) => {
      for (let i = 0; i < 4; i++) await p.keyboard.press('ArrowDown'); } },
  { name: 'end', drag: false, run: (p) => p.keyboard.press('End') },
  { name: 'dragscroll', drag: true, run: async (p, vw) => {
      await p.mouse.move(vw - 6, 60);
      await p.mouse.down();
      await p.mouse.move(vw - 6, 260, { steps: 14 });
      await p.mouse.up();
      await p.mouse.move(vw - 6, 40, { steps: 10 });
      await p.mouse.up().catch(() => {}); } },
  { name: 'scrollto', drag: true, run: (p) => p.evaluate(() => window.scrollTo(0, 900)) },
  { name: 'swipe', drag: true, run: async (p) => {
      const cdp = await p.context().newCDPSession(p);
      for (let s = 0; s < 2; s++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 720 }] });
        for (let y = 720; y > 90; y -= 60) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y }] });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await wait(50);
      }
    } },
];

async function newContext(browser, kind, extra) {
  const opts = kind === 'mobile'
    ? { ...MOBILE, isMobile: true, hasTouch: true }
    : { viewport: VIEW, isMobile: false, hasTouch: false };
  const ctx = await browser.newContext({ ...opts, ...extra });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 160)));
  return { ctx, page, errors };
}

/* Has the entrance's choreography actually finished?
   Read from the animations themselves, not from "is the opacity over 0.99":
   `load-rise` is `ease-out-quint`, so it is visually indistinguishable from its
   end state while it is still running, and a threshold would have called a 4.0s
   entrance a 5.0s one. An animation counts as done when it is not running, or
   when it is one of the page's deliberate infinite loops — those are motion, not
   a schedule, and they never finish. */
const SETTLED = () => {
  const els = document.querySelectorAll('[data-load-reveal], .word-reveal, .reveal, .rv');
  for (const el of els) {
    const anims = el.getAnimations ? el.getAnimations() : [];
    for (const a of anims) {
      if (a.playState !== 'running') continue;
      let iterations = 1;
      try { iterations = a.effect.getComputedTiming().iterations; } catch (e) {}
      if (iterations === Infinity) continue;
      return false;
    }
  }
  return true;
};

async function settle(page, ms = 12000) {
  await page.waitForFunction(SETTLED, null, { timeout: ms }).catch(() => {});
}

/* Wait for the entrance to be over, by whichever of the two signals fires:
   the terminal class, or the overlay being gone from the document. */
const OVER = () => document.documentElement.classList.contains('intro-done')
  || !document.getElementById('intro-overlay');

/* The end of the *phase*, not the end of the teardown: the overlay has stopped
   owning the screen the moment `intro-active` comes off, and the exit fade that
   follows is 600ms of decoration. "How fast does Skip work" is the first of
   those two numbers; `OVER` is the second, and the guarantee the brief makes is
   about the first. */
const HANDOVER = () => !document.documentElement.classList.contains('intro-active')
  && !document.getElementById('intro-overlay');

/* ------------------------------------------------------------------ runs */

async function runInputMatrix(browser) {
  for (const kind of FULL ? ['desktop', 'mobile'] : ['desktop']) {
    const w = kind === 'mobile' ? MOBILE.viewport.width : VIEW.width;
    for (const input of INPUTS) {
      if (!FULL && !QUICK_INPUTS.includes(input.name)) continue;
      /* A swipe is a touch gesture; a desktop drag is a mouse gesture. Run each
         on its own device so neither is faked. */
      const kinds = kind === 'mobile'
        ? (input.name === 'swipe' ? ['mobile'] : ['mobile'])
        : (input.name === 'swipe' ? [] : ['desktop']);
      for (const k of kinds) {
        for (const t of (FULL ? TIMES : QUICK_TIMES)) {
          await one(browser, k, input, t, w);
        }
      }
    }
  }
}

async function one(browser, kind, input, t, vw) {
  const label = `[${kind}] ${input.name} @t=${t}`;
  const { ctx, page, errors } = await newContext(browser, kind);
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      window.__cls = 0;
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
      } catch (e) {}
    });
    await wait(t);

    const during = await page.evaluate(probe);
    await input.run(page, vw);
    await wait(160);
    const justAfter = await page.evaluate(probe);
    const stillHeld = /intro-active/.test(justAfter.htmlClass);

    /* The lock's own claim: while the entrance still owns the screen the
       document has not moved. A drag or a scripted `scrollTo` is allowed to
       move it (nothing can prevent those before the scroll listener sees them),
       but it has to come back and it must not blank. */
    if (!input.drag) {
      check(`${label} · scrollY held at 0 while the entrance owns the screen`,
        stillHeld ? justAfter.scrollY === 0 : justAfter.scrollY === 0 || !stillHeld,
        `scrollY=${justAfter.scrollY} introActive=${stillHeld}`);
    }

    await page.waitForFunction(OVER, null, { timeout: 15000 }).catch(() => {});
    await settle(page);
    await wait(1500);

    const after = await page.evaluate(probe);
    const px = await pixelStats(page);

    /* Does it scroll again? From the top, because `End` leaves the document at
       the bottom and a wheel there cannot move — which says nothing about
       whether the lock was released. */
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(250);
    const before = await page.evaluate(() => Math.round(scrollY));
    await page.mouse.wheel(0, 500);
    await wait(450);
    const moved = await page.evaluate(() => Math.round(scrollY));

    check(`${label} · the entrance released`, !/intro-active|intro-exit/.test(after.htmlClass), after.htmlClass);
    check(`${label} · no full-viewport layer is on top`, after.covering.length === 0, after.covering.join(' '));
    check(`${label} · #intro-overlay is gone`, !after.introPresent || after.introDisplay === 'none',
      `${after.introDisplay} op=${after.introOpacity}`);
    check(`${label} · #page-transition is not covering`, after.transitionDisplay === 'none' || after.transitionOpacity < 0.05,
      `display=${after.transitionDisplay} op=${after.transitionOpacity}`);
    check(`${label} · nothing is invisible in the viewport`, after.hiddenInView === 0,
      `${after.hiddenInView}: ${after.hiddenTags.join(', ')}`);
    check(`${label} · <html> is not transparent`, after.htmlOpacity >= 0.99 && after.htmlDisplay !== 'none',
      `opacity=${after.htmlOpacity} display=${after.htmlDisplay}`);
    check(`${label} · key elements are opaque`,
      after.keyEls.every((k) => k.opacity >= 0.99),
      after.keyEls.map((k) => k.tag + '=' + k.opacity).join(' '));
    check(`${label} · overflow is back to normal`,
      after.htmlOverflow !== 'hidden' && after.bodyOverflow !== 'hidden',
      `html=${after.htmlOverflow} body=${after.bodyOverflow}`);
    check(`${label} · nothing is left inert`, !after.inert, 'an inert element is still in the document');
    check(`${label} · the page scrolls again`,
      !after.scrollable || Math.abs(moved - before) > 20,
      `${before} -> ${moved}`);
    check(`${label} · the screenshot is not a flat fill`,
      px.variance > 25 && px.range > 20, `mean=${px.mean} var=${px.variance} range=${px.range}`);
    check(`${label} · console errors`, errors.length === 0, errors.join(' | '));

    const cls = await page.evaluate(() => window.__cls || 0);
    check(`${label} · CLS < 0.02`, cls < 0.02, String(+cls.toFixed(4)));

    const worst = t === 200 || t === 2500;
    if (worst) {
      writeFileSync(path.join(SHOTS, `after-${kind}-${input.name}-t${t}.png`), await page.screenshot());
    }

    rows.push({ label, blank: after.hiddenInView > 0 || after.covering.length > 0
      || after.htmlOpacity < 0.99 || px.variance <= 25,
      during: during.scrollY, after: justAfter.scrollY, final: after.scrollY,
      hidden: after.hiddenInView, var: px.variance, cls: +cls.toFixed(4) });
  } catch (e) {
    check(`${label} · ran at all`, false, e.message);
    rows.push({ label, blank: null, error: e.message });
  } finally {
    await ctx.close();
  }
}

/* The scenarios that are not "an input at a time". Each is the whole point of
   one of the layers, so each gets its own assertions. */
async function extras(browser) {
  /* --- 1. the entrance, untouched: 5.0s ± 0.15s, and it lands ------------ */
  {
    const { ctx, page, errors } = await newContext(browser, 'desktop');
    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.classList.contains('intro-active'), null, { timeout: 6000 });
      /* The entrance is 5 seconds END TO END, and the overlay is only the first
         3.1 of them: the hero's own choreography is authored against the same
         zero and its last block lands at 4950ms. So "did the entrance last five
         seconds" is answered by the LAST HERO BLOCK, not by the overlay
         disappearing — measuring the overlay would have called a 3.3s entrance
         a pass.

         And it is measured on the PAGE'S clock, not the tool's: `startTime` and
         `endTime` are document-timeline values, so their difference is the
         entrance exactly as CSS authored it. Anchoring on anything the harness
         can see — navigation, DOMContentLoaded, the moment `intro-active` was
         noticed — bills the measurement for however long the server took to
         answer, and on a loaded machine that is several hundred milliseconds
         either way. This is the same reasoning as `firstPaintOffset()` in
         js/intro.js, and it is why the overlay lifts at the right moment.

         `[data-load-reveal]` and not `.word-reveal` as well, and the reason is
         worth stating because the difference is 750ms and it is NOT drift: the
         hero's headline words carry `tl-display-settle` with their stagger on
         `animation-delay`, and the animation is created by js/motion-fx.js when
         it boots — about 750ms after first paint. Their delays are therefore
         measured from there, not from the page's zero. The entrance's authored
         clock is `--intro-total: 5000ms` and the five hero blocks run to 4950ms
         of it; that is what is being asserted, and the words are separately
         required to have landed before any screenshot is taken (`SETTLED`). */
      const ms = await page.waitForFunction(() => {
        const els = [...document.querySelectorAll('[data-load-reveal]')];
        if (!els.length) return false;
        let first = Infinity;
        let last = -Infinity;
        let running = false;
        for (const el of els) {
          for (const a of el.getAnimations()) {
            let timing;
            try { timing = a.effect.getComputedTiming(); } catch (e) { continue; }
            if (timing.iterations === Infinity) continue;
            if (!Number.isFinite(a.startTime)) { continue; }
            first = Math.min(first, a.startTime);
            last = Math.max(last, a.startTime + (Number.isFinite(timing.endTime) ? timing.endTime : 0));
            if (a.playState === 'running') running = true;
          }
        }
        if (!Number.isFinite(first) || !Number.isFinite(last)) return false;
        return running ? false : Math.round(last - first);
      }, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => -1);
      check('[intro] the entrance runs 5.0s ± 0.15s end to end', Math.abs(ms - 5000) <= 150, ms + 'ms');
      const blocks = await page.evaluate(() => document.querySelectorAll('[data-load-reveal]').length);
      await page.waitForFunction(OVER, null, { timeout: 6000 }).catch(() => {});
      notes.push(`entrance ${ms}ms end to end on the page clock, ${blocks} hero blocks`);
      check('[intro] no console errors on the plain path', errors.length === 0, errors.join(' | '));
    } catch (e) { check('[intro] the plain load ran', false, e.message); }
    await ctx.close();
  }

  /* --- 2. Skip: the button, and Esc/Enter/Space, all under 0.5s ------------ */
  for (const how of ['button', 'Escape', 'Enter', 'Space']) {
    const { ctx, page, errors } = await newContext(browser, 'desktop');
    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.classList.contains('intro-active'), null, { timeout: 4000 });
      await wait(300);
      const t0 = Date.now();
      if (how === 'button') {
        /* `force: true` and the reason is worth writing down. Playwright's
           actionability check refuses to click anything whose box changes
           between two frames, and this button is mid-`intro-fade-up` for 600ms
           after a 1300ms delay — so a plain `.click()` here spends its whole
           budget retrying and reports a timeout that has nothing to do with the
           entrance. The gesture is what is under test, not Playwright's
           readiness heuristics, and `force` still dispatches a real press
           through the browser's input pipeline. */
        await page.locator('#intro-skip').click({ force: true, timeout: 4000 });
      } else {
        await page.keyboard.press(how);
      }
      const ms = Date.now() - t0;
      check(`[skip · ${how}] the entrance ends within 0.5s of the gesture`, ms <= 500, ms + 'ms');
      await settle(page);
      await wait(600);
      const s = await page.evaluate(probe);
      check(`[skip · ${how}] nothing is left hidden`, s.hiddenInView === 0, `${s.hiddenInView}: ${s.hiddenTags.join(',')}`);
      check(`[skip · ${how}] no layer is on top`, s.covering.length === 0, s.covering.join(' '));
      check(`[skip · ${how}] <html> is not transparent`, s.htmlOpacity >= 0.99, String(s.htmlOpacity));
      const px = await pixelStats(page);
      check(`[skip · ${how}] the screenshot is not a flat fill`, px.variance > 25, `var=${px.variance}`);
      check(`[skip · ${how}] no console errors`, errors.length === 0, errors.join(' | '));
      writeFileSync(path.join(SHOTS, `after-skip-${how}.png`), await page.screenshot());
    } catch (e) { check(`[skip · ${how}] ran`, false, e.message); }
    await ctx.close();
  }

  /* --- 3. F5 while the page is already scrolled far down ------------------
     This is the one the owner's report is really about: Chrome restores the
     pre-refresh scroll position, and the entrance used to run on top of a
     restored document. */
  for (const kind of ['desktop', 'mobile']) {
    const { ctx, page, errors } = await newContext(browser, kind);
    try {
      /* The plain page, scrolled far down, and then F5. The reload has to be of
         the URL that actually HAS an entrance — reloading `?intro=off` would
         have tested the one path where there is nothing to restore. */
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForFunction(OVER, null, { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => window.scrollTo(0, 3000));
      await wait(400);
      const deep = await page.evaluate(() => Math.round(scrollY));
      check(`[rerefresh · ${kind}] the page really was scrolled before the reload`, deep > 500, String(deep));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await wait(300);
      const mid = await page.evaluate(probe);
      check(`[rerefresh · ${kind}] the entrance owns the screen on arrival`,
        /intro-active/.test(mid.htmlClass), mid.htmlClass);
      check(`[rerefresh · ${kind}] the restored position was not honoured during the entrance`,
        mid.scrollY === 0, 'scrollY=' + mid.scrollY);
      await page.waitForFunction(OVER, null, { timeout: 15000 }).catch(() => {});
      await settle(page);
      await wait(1500);
      const after = await page.evaluate(probe);
      const px = await pixelStats(page);
      check(`[rerefresh · ${kind}] nothing invisible after the restore`, after.hiddenInView === 0,
        `${after.hiddenInView}: ${after.hiddenTags.join(',')}`);
      check(`[rerefresh · ${kind}] no layer on top`, after.covering.length === 0, after.covering.join(' '));
      check(`[rerefresh · ${kind}] <html> is not transparent`, after.htmlOpacity >= 0.99, String(after.htmlOpacity));
      check(`[rerefresh · ${kind}] the screenshot is not a flat fill`, px.variance > 25, `var=${px.variance}`);
      check(`[rerefresh · ${kind}] no console errors`, errors.length === 0, errors.join(' | '));
      writeFileSync(path.join(SHOTS, `after-rerefresh-${kind}.png`), await page.screenshot());
    } catch (e) { check(`[rerefresh · ${kind}] ran`, false, e.message); }
    await ctx.close();
  }

  /* --- 4. bfcache: Back, then Forward -------------------------------------
     A restored page must not replay a five-second entrance in the middle of
     itself, and must not come back with `intro-active` still on <html>. */
  {
    const { ctx, page, errors } = await newContext(browser, 'desktop');
    try {
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForFunction(OVER, null, { timeout: 15000 }).catch(() => {});
      await page.goto(BASE + '#clarity', { waitUntil: 'load' });
      await wait(600);
      await page.goBack({ waitUntil: 'load' });
      await page.waitForFunction(OVER, null, { timeout: 4000 }).catch(() => {});
      await settle(page);
      await wait(600);
      const s = await page.evaluate(probe);
      check('[bfcache] the restored page is not left intro-active', !/intro-active/.test(s.htmlClass), s.htmlClass);
      check('[bfcache] nothing invisible after the restore', s.hiddenInView === 0, `${s.hiddenInView}: ${s.hiddenTags.join(',')}`);
      check('[bfcache] no layer on top', s.covering.length === 0, s.covering.join(' '));
      check('[bfcache] <html> is not transparent', s.htmlOpacity >= 0.99, String(s.htmlOpacity));
      const px = await pixelStats(page);
      check('[bfcache] the screenshot is not a flat fill', px.variance > 25, `var=${px.variance}`);

      await page.goForward({ waitUntil: 'load' });
      await settle(page);
      await wait(600);
      const f = await page.evaluate(probe);
      check('[bfcache] the forward restore is clean too',
        !/intro-active/.test(f.htmlClass) && f.covering.length === 0 && f.hiddenInView === 0,
        `${f.htmlClass} covering=${f.covering.length} hidden=${f.hiddenInView}`);
      check('[bfcache] no console errors', errors.length === 0, errors.join(' | '));
    } catch (e) { check('[bfcache] ran', false, e.message); }
    await ctx.close();
  }

  /* --- 4b. the bfcache branch, dispatched by hand -------------------------
     The block above cannot test this, and the reason is worth writing down
     because it is the difference between a green assertion and a real one.
     Measured on this machine, `goBack()` produces a SINGLE `pageshow` with
     `persisted === false`: the page is reloaded, not restored from cache. So
     `if (e && e.persisted) finishIntro('restored')` in index.html is never
     entered by any test in this file, and every Back assertion above is really
     asserting that a fresh load behaves. A real cache restore cannot be forced
     from Playwright — but the EVENT the handler reads can be, `PageTransitionEvent`
     is constructible in the page and `persisted` is exactly the field the branch
     branches on.

     Two cases, because they assert opposite things:

       - AFTER the entrance, the restore must change NOTHING. The scroll position
         is the whole point: it is what distinguishes a restore from a reload, and
         a `scrollTo(0,0)` on this path would put a visitor who was reading the
         fourth section back at the top of the page.
       - MID-ENTRANCE, the restore must release EVERYTHING, or the visitor comes
         back to a full-viewport overlay, a locked document and an inert page
         behind it — which is the exact failure this file exists to catch, and the
         exact shape of the blank screen it was written for. */
  {
    const { ctx, page, errors } = await newContext(browser, 'desktop');
    try {
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForFunction(OVER, null, { timeout: 15000 }).catch(() => {});
      await settle(page);
      await wait(500);
      await page.evaluate(() => window.scrollTo(0, 2500));
      await wait(400);
      const before = await page.evaluate(() => Math.round(scrollY));
      const dispatched = await page.evaluate(() => {
        if (typeof PageTransitionEvent !== 'function') return false;
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        return true;
      });
      check('[bfcache:event] the synthetic restore could be dispatched', dispatched,
        'PageTransitionEvent is not constructible here');
      await wait(600);
      const s = await page.evaluate(probe);
      /* `>= 2000` rather than `=== before`. What is under test is that the restore
         did not reposition the document; exact equality would fail on a layout
         change instead of on a defect, and a gate that fails for the wrong reason
         is a gate that gets ignored. */
      check('[bfcache:event] a restore after the entrance keeps the scroll position',
        s.scrollY >= 2000, `before=${before} after=${s.scrollY}`);
      check('[bfcache:event] a restore after the entrance re-ran nothing',
        !/intro-active|intro-exit/.test(s.htmlClass) && s.htmlOverflow !== 'hidden'
        && !s.introPresent && !s.inert,
        `class="${s.htmlClass}" ovf=${s.htmlOverflow} intro=${s.introPresent} inert=${s.inert}`);
      check('[bfcache:event] nothing invisible after the restore', s.hiddenInView === 0,
        `${s.hiddenInView}: ${s.hiddenTags.join(',')}`);
      check('[bfcache:event] no layer on top after the restore', s.covering.length === 0, s.covering.join(' '));
      check('[bfcache:event] no console errors', errors.length === 0, errors.join(' | '));
    } catch (e) { check('[bfcache:event] after the entrance ran', false, e.message); }
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await newContext(browser, 'desktop');
    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.classList.contains('intro-active'), null, { timeout: 8000 }).catch(() => {});
      await wait(400);
      const during = await page.evaluate(() => document.documentElement.classList.contains('intro-active'));
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await page.waitForFunction(OVER, null, { timeout: 6000 }).catch(() => {});
      /* `settle()` and the 1500ms are load-bearing, and they are load-bearing
         everywhere else in this file for the same reason: measured without them
         this state still reports 10 blocks under opacity 0.05, because the
         handover event has been dispatched but the reveal cascade and its 420ms
         ceiling have not finished. That is a measurement artefact, not a defect,
         and the only honest answer is to wait for the thing to settle. */
      await settle(page);
      await wait(1500);
      const s = await page.evaluate(probe);
      check('[bfcache:event] mid-entrance the entrance really was running', during,
        'intro-active was not set when the restore arrived');
      check('[bfcache:event] mid-entrance the restore released the entrance',
        !/intro-active|intro-exit/.test(s.htmlClass) && !s.introPresent,
        `class="${s.htmlClass}" intro=${s.introPresent}`);
      check('[bfcache:event] mid-entrance the scroll lock was released',
        s.htmlOverflow !== 'hidden' && s.bodyOverflow !== 'hidden',
        `html=${s.htmlOverflow} body=${s.bodyOverflow}`);
      check('[bfcache:event] mid-entrance nothing was left inert', !s.inert, 'an inert element survived');
      check('[bfcache:event] mid-entrance nothing invisible afterwards', s.hiddenInView === 0,
        `${s.hiddenInView}: ${s.hiddenTags.join(',')}`);
      check('[bfcache:event] mid-entrance <html> is not transparent', s.htmlOpacity >= 0.99, String(s.htmlOpacity));
      check('[bfcache:event] mid-entrance no layer on top', s.covering.length === 0, s.covering.join(' '));
      const px = await pixelStats(page);
      check('[bfcache:event] mid-entrance the screenshot is not a flat fill', px.variance > 25, `var=${px.variance}`);
      check('[bfcache:event] mid-entrance no console errors', errors.length === 0, errors.join(' | '));
    } catch (e) { check('[bfcache:event] mid-entrance ran', false, e.message); }
    await ctx.close();
  }

  /* --- 5. a hidden tab during the entrance -------------------------------- */
  {
    const { ctx, page, errors } = await newContext(browser, 'desktop');
    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.classList.contains('intro-active'), null, { timeout: 4000 });
      await wait(400);
      /* Playwright has no tab-switch, but it can hide the page the way a
         backgrounded tab is hidden, which is what `visibilitychange` hears. */
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        setTimeout(() => {
          Object.defineProperty(document, 'hidden', { value: false, configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
        }, 120);
      });
      await page.waitForFunction(OVER, null, { timeout: 4000 }).catch(() => {});
      /* The entrance ended early, so the hero's schedule was compressed to ~18%
         and lands in well under a second — but the reveal cascade under it has
         its own 420ms ceiling plus a 900ms transition. */
      await settle(page);
      await wait(600);
      const s = await page.evaluate(probe);
      check('[hidden-tab] the entrance ended on the tab switch', !/intro-active/.test(s.htmlClass), s.htmlClass);
      check('[hidden-tab] nothing invisible afterwards', s.hiddenInView === 0, `${s.hiddenInView}: ${s.hiddenTags.join(',')}`);
      check('[hidden-tab] no layer on top', s.covering.length === 0, s.covering.join(' '));
      check('[hidden-tab] <html> is not transparent', s.htmlOpacity >= 0.99, String(s.htmlOpacity));
      const px = await pixelStats(page);
      check('[hidden-tab] the screenshot is not a flat fill', px.variance > 25, `var=${px.variance}`);
      check('[hidden-tab] no console errors', errors.length === 0, errors.join(' | '));
      writeFileSync(path.join(SHOTS, 'after-hidden-tab.png'), await page.screenshot());
    } catch (e) { check('[hidden-tab] ran', false, e.message); }
    await ctx.close();
  }

  /* --- 6. `?intro=off`, and a deep link ------------------------------------
     Both skip the overlay; neither of them skips the hero's own 5s arrival,
     which is authored on the same clock and is `both`-filled, so the page is
     deliberately not finished when the entrance panel would have been. The
     waits here are for the choreography, not for the panel — reading opacity
     at 900ms would be measuring the delay the design asks for and calling it a
     blank. */
  for (const [name, url] of [['?intro=off', BASE + '?intro=off'], ['hash #features', BASE + '#features']]) {
    const { ctx, page, errors } = await newContext(browser, 'desktop');
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await wait(900);
      const early = await page.evaluate(probe);
      check(`[${name}] the entrance never took the screen`, !/intro-active/.test(early.htmlClass), early.htmlClass);
      check(`[${name}] <html> is not transparent straight away`, early.htmlOpacity >= 0.99, String(early.htmlOpacity));
      check(`[${name}] no console errors`, errors.length === 0, errors.join(' | '));

      await settle(page);
      const s = await page.evaluate(probe);
      check(`[${name}] nothing invisible once the hero has arrived`, s.hiddenInView === 0,
        `${s.hiddenInView}: ${s.hiddenTags.join(',')}`);
      check(`[${name}] <html> is not transparent`, s.htmlOpacity >= 0.99, String(s.htmlOpacity));
      check(`[${name}] no layer on top`, s.covering.length === 0, s.covering.join(' '));
      const px = await pixelStats(page);
      check(`[${name}] the screenshot is not a flat fill`, px.variance > 25, `var=${px.variance}`);
    } catch (e) { check(`[${name}] ran`, false, e.message); }
    await ctx.close();
  }

  /* --- 7. the operating system says "reduce motion", and so does the visitor.
     The policy is that the OS is IGNORED and the animations run anyway; what is
     being asserted here is that neither changes the page's visibility. ------- */
  for (const [name, extra] of [
    ['reducedMotion:reduce', { reducedMotion: 'reduce' }],
    ['Reduce motion pressed', null],
  ]) {
    const { ctx, page, errors } = await newContext(browser, 'desktop', extra || {});
    try {
      if (!extra) {
        await page.goto(BASE + '?motion=off', { waitUntil: 'load' });
        await settle(page);
        await wait(400);
      } else {
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(OVER, null, { timeout: 15000 }).catch(() => {});
        await settle(page);
        await wait(400);
        const anims = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
        check(`[${name}] the animations are alive anyway`, anims > 0, `${anims} running`);
      }
      const s = await page.evaluate(probe);
      check(`[${name}] nothing invisible`, s.hiddenInView === 0, `${s.hiddenInView}: ${s.hiddenTags.join(',')}`);
      check(`[${name}] <html> is not transparent`, s.htmlOpacity >= 0.99, String(s.htmlOpacity));
      check(`[${name}] no layer on top`, s.covering.length === 0, s.covering.join(' '));
      const px = await pixelStats(page);
      check(`[${name}] the screenshot is not a flat fill`, px.variance > 25, `var=${px.variance}`);
      check(`[${name}] no console errors`, errors.length === 0, errors.join(' | '));
    } catch (e) { check(`[${name}] ran`, false, e.message); }
    await ctx.close();
  }
}

/* ------------------------------------------------------------------- main */

const exe = ['/usr/bin/brave', '/usr/bin/brave-browser', '/usr/bin/chromium',
             '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'].find(Boolean);
const browser = await chromium.launch({ headless: true, executablePath: exe || undefined });
console.log(`check:intro-scroll — ${BASE}`);
console.log(`mode: ${FULL ? 'FULL (all inputs, desktop + mobile, 4 timings)' : 'quick (4 inputs, desktop, 2 timings)'}\n`);

if (!has('no-inputs')) await runInputMatrix(browser);
await extras(browser);

await browser.close();

writeFileSync(path.join(SHOTS, 'check-intro-scroll.json'), JSON.stringify({ pass, failures, rows, notes }, null, 2));

console.log('\n  scenario                                    blank?  scrollY   hidden  variance  CLS');
for (const r of rows) {
  if (r.error) { console.log(`  ${r.label.padEnd(44)} ERROR  ${r.error}`); continue; }
  console.log(`  ${r.label.padEnd(44)} ${r.blank ? 'BLANK' : 'ok   '}   ${String(r.during).padStart(4)}→${String(r.after).padStart(4)}→${String(r.final).padStart(4)}  ${String(r.hidden).padStart(4)}   ${String(r.var).padStart(6)}  ${r.cls}`);
}
notes.forEach((n) => console.log('  · ' + n));
console.log(`\n  ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('');
  for (const f of failures) console.log('  FAIL  ' + f);
}
console.log('\n  screenshots → ' + SHOTS);
process.exit(failures.length ? 1 : 0);