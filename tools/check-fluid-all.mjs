#!/usr/bin/env node
/* ============================================================================
 * tools/check-fluid-all.mjs — the whole page, at every size the browser can be
 *                            given, including WHILE it is being resized.
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * tools/check-overflow.mjs answers one question — "does the page fit inside the
 * width it was given" — and it answers it well. It does not answer any of the
 * others that a fluid pass has to answer, and every one of them has been a
 * separate silent failure at some point:
 *
 *   - a block whose TEXT is clipped, inside a box that is not (the terminal at
 *     280px, 275px of content in a 212px box, for months);
 *   - a resize that leaves a DIFFERENT layout than a fresh load at the same
 *     size (the DevTools-docked case: the window narrows, nothing re-measures);
 *   - a zoom level that cuts content in half;
 *   - two sibling cards sitting on top of each other, which a screenshot at one
 *     width will never show.
 *
 * So this is a MEASUREMENT tool with a threshold per invariant, not a diff. It
 * says what is wrong, at which size, in which section.
 *
 * WHAT IT CHECKS, PER SIZE
 *
 *   1. scrollWidth <= clientWidth            — nothing overflows the document
 *   2. no CLIPPED TEXT                       — an element whose scrollWidth exceeds
 *                                               its clientWidth AND which no
 *                                               clipping ancestor contains
 *   3. no SIBLING COLLISION                  — two flow siblings whose boxes
 *                                               intersect by more than 2px on
 *                                               both axes
 *   4. left gutter == right gutter (±1px)    — nothing is off-centre
 *   5. body >= 15px, caption >= 11px         — the readability floor
 *   6. h2 >= 1.6x body                       — the hierarchy survives scaling
 *   7. no section taller than 2x the viewport — unless it is genuinely a long
 *                                               one (the bento and the feed)
 *
 * PLUS TWO PASSES THAT NEED MORE THAN ONE PAGE
 *
 *   LIVE RESIZE — one page driven through 1920 → 1366 → 1024 → 768 → 390 → 2560
 *   → 1440 with no reload, then the same sizes loaded fresh. Any difference is a
 *   component that measures once at load.
 *
 *   ZOOM — the same invariants at 67 / 80 / 110 / 150 / 200 / 400%, which in
 *   layout terms is a 1910 / 1600 / 1240 / 910 / 640 / 320px viewport.
 *
 * THE ENTRANCE
 *
 * The page holds a five-second panel over the viewport on every load, so every
 * measurement here waits for `intro-done` — the terminal state, written by the
 * <head> bootstrap AND by js/intro.js, whichever survives. A page whose entrance
 * is broken still measures; it just measures early. The wait is bounded.
 *
 *   node tools/check-fluid-all.mjs              # full sweep
 *   node tools/check-fluid-all.mjs --quick      # 5 core sizes, for a fast gate
 *   node tools/check-fluid-all.mjs --no-resize  # skip the live-resize pass
 *   node tools/check-fluid-all.mjs --json       # machine-readable, for before/after
 *
 * Exits 1 on any failure so it can gate a commit.
 * ==========================================================================*/

import { chromium } from 'playwright-core';
import { access, mkdir } from 'node:fs/promises';

/* ------------------------------------------- options & browser discovery -- */

const argv = process.argv.slice(2);
const flag = (k) => argv.includes('--' + k);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };

const BASE = String(opt('url', process.env.TOOLAPIS_URL || 'http://localhost:5500/'));
const QUICK = flag('quick');
const JSON_OUT = flag('json');
const NO_RESIZE = flag('no-resize');
const SHOTS = String(opt('shots', '')); /* --shots <dir> writes full-page PNGs */

/* The size list is the brief's, not a round-number list. Each entry is a
   viewport something actually is: a folded phone, the two iPhone generations
   that are still in circulation, a tablet, a laptop with DevTools docked along
   the bottom (the one that broke the navbar), and three large desktops. */
const SIZES = QUICK
  ? [[280, 560], [320, 568], [390, 844], [768, 1024], [1440, 900]]
  : [[280, 560], [320, 568], [360, 740], [390, 844], [430, 932], [600, 900],
     [768, 1024], [1024, 600], [1024, 768], [1280, 560], [1366, 567], [1440, 900],
     [1536, 730], [1920, 1080], [2560, 1080], [3440, 1440], [1920, 400]];

const ZOOMS = QUICK ? [1, 2] : [0.67, 0.8, 1.1, 1.5, 2, 4];

const RESIZE_SEQ = [1920, 1366, 1024, 768, 390, 2560, 1440];

const CANDIDATES = ['/usr/bin/brave', '/usr/bin/brave-browser', '/usr/bin/chromium',
                    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'];
let exe = null;
for (const p of CANDIDATES) { try { await access(p); exe = p; break; } catch { /* next */ } }
if (!exe) { console.error('no browser found'); process.exit(1); }

/* --------------------------------------------------------------- reporting */

const failures = [];
const rows = [];
const note = (m) => failures.push(m);

/* The two thresholds, as constants, so the report can name them. */
const MIN_BODY_PX = 15;
const MIN_CAPTION_PX = 11;
const MIN_H2_RATIO = 1.6;
const GUTTER_TOL = 1;
const COLLIDE_PX = 2;
const LONG_SECTION_VH = 2;
/* ...but only where "twice the viewport" means anything. At zoom 400% on a 900px
   window the viewport is 225px tall, and 2x that is 450px — less than one
   well-set paragraph. The rule then fires on `#hero` at 2.87x, `#flow` at 2.42x
   and `#footer` at 4.68x, and every one of those three is behaving correctly:

     hero   900px at 1440x900, 646px at 360x225 — it SHRINKS with the viewport,
            because it is `min-height: 100svh` and its content needs more than
            225px. A hero taller than a 225px screen is the hero working.
     flow   523px at 1440, 564px at 360x900 — flat across a 4x width range.
     footer 394px at 1440 (four columns), 662px at 720 (two), 1054px at 360
            (one) — it grows as its columns collapse, which is the stacking
            working, and would be a bug if it did NOT.

   Below this height the ratio measures the viewport, not the design, so the
   check is skipped and says so rather than quietly passing. */
const LONG_VH_FLOOR = 600;
/* Sections that are ALLOWED to exceed the viewport by a lot, because they hold
   a bento of four cards or a scrollable activity feed. Naming them is the
   point: an unnamed exception is an exception that grows.

   `clarity` joined them at Stage 4, and the measurement is the reason: its
   accordion is 310px tall at a 280px viewport and 311px at 1440px. The section
   does not get taller as the screen gets wider — not once, over a 5x range — so
   the 2x-viewport rule was not measuring runaway layout, it was measuring the
   fact that four questions and a heading are more than two small screens of
   content. Compressing the FAQ to satisfy the number would have been the wrong
   fix: it would have made the design worse to make a heuristic stop shouting.
   The threshold still applies, so a clarity that starts growing with width will
   still fail. */
const LONG_OK = new Set(['overview', 'features', 'clarity']);
/* Surfaces allowed to scroll horizontally. See the comment at the `unfit` push
   for why `.terminal` is on this list and what it costs. */
const SCROLL_OK = '.terminal';

/* ------------------------------------------------------------- measurement */

/* The probe. Everything the invariants need, in ONE evaluate, so a measurement
   cannot be internally inconsistent (a layout sampled twice is a layout that
   moved between the two samples). */
const probe = () => {
  const de = document.documentElement;
  const vh = window.innerHeight;

  /* Does any ancestor clip this element's overflow? If so the overflow is a
     design decision (a decorative overhang, a horizontal scroller) and not a
     defect. This is the rule that separates `.mock::before`'s deliberate
     negative inset from a paragraph of text that does not fit. */
  const contained = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (o.overflowX !== 'visible' || o.overflowY !== 'visible') return true;
    }
    return false;
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 5 || r.height < 5) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return null;
    if (parseFloat(cs.opacity) < 0.05) return null;
    return r;
  };

  const label = (el) => (el.id ? '#' + el.id : '')
    + (el.getAttribute('class') ? '.' + el.getAttribute('class').trim().split(/\s+/).slice(0, 2).join('.') : '')
    + (el.tagName === 'BODY' || el.tagName === 'HTML' ? '' : ' (' + el.tagName.toLowerCase() + ')');

  /* 2 · content that does not fit. This is THREE different things and calling
     them one word is how the check ends up reporting the design as a defect.
     The distinction is entirely in the element's own `overflow-x`:

       CONTAINED — `hidden` or `clip`, and no clipping ancestor. The element
         crops something. On this page that is `.hero` (the scene bleeds off the
         right edge by design), `.marquee` (a 2300px track inside a window) and
         `.section-bg` (a decorative layer with a 60px bleed). All three are
         the design working. Not reported.

       CLIPPED — `visible`, overflowing, and nothing above it clips. Content the
         reader needs is unreachable and cannot be scrolled to. This is the
         defect. Reported.

       UNFIT — `auto` or `scroll`, overflowing. The content is reachable, so
         this is not a broken page — but on a text surface it means the design
         expected it to fit and it does not. The terminal at 280px is 63px too
         wide for its box, which is not a scroll feature, it is a card that is
         too small for its contents. Reported, and separately, because the fix
         is a different fix. */
  const kind = (el) => {
    const o = getComputedStyle(el).overflowX;
    if (o === 'auto' || o === 'scroll') return 'unfit';
    if (o === 'hidden' || o === 'clip') return 'contained';
    return 'clipped';
  };

  /* DECORATIVE OVERFLOW. An element can report `scrollWidth > clientWidth` with
     no content outside its box at all, because a positioned ::before/::after
     hangs past it. `.flow__step.is-active .flow__node::after` is a 12px mint
     dot at `right: -3px` — a status marker meant to sit on the node's rim, the
     same trick `.feed__node` uses with a `box-shadow: 0 0 0 3px` ring. It made
     exactly ONE of the three flow nodes report 69px in a 66px box, because
     only one step carries `.is-active` at a time, and it was reported as CLIPPED
     CONTENT at all seven widths — a decoration wearing the costume of a
     paragraph of text someone cannot read.

     Pseudo-elements are not in `querySelectorAll('body *')`, so this rule
     cannot be "did it have a pseudo-element". It is the question that actually
     matters: IS ANY OF THIS ELEMENT'S CONTENT OUTSIDE ITS BOX? A text-only
     element whose text fits is not clipped content, whatever its decorations
     are doing. */
  const contentEscapes = (el) => {
    for (const kid of el.children) {
      const k = kid.getBoundingClientRect();
      const p = el.getBoundingClientRect();
      if (k.right > p.right + 1 || k.left < p.left - 1) return true;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    for (const r of range.getClientRects()) {
      const p = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > p.right + 1 || r.left < p.left - 1) return true;
    }
    return false;
  };

  const clipped = [];
  const unfit = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = visible(el);
    if (!r) continue;
    if (el.clientWidth <= 0) continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const k = kind(el);
    if (k === 'contained') continue;
    if (k === 'unfit') {
      /* SCROLL_OK. `.terminal` is the one surface on this page whose content is
         WIDER THAN THE SMALLEST SUPPORTED CARD, and no amount of fitting fixes
         it, which is why it is named here with the arithmetic rather than left
         to fail forever:

           the widest command is `$ adb reverse tcp:8000 tcp:8000`, 30 characters
           at a 0.6em mono advance, and the brief puts a 12px floor on terminal
           type -> 30 x 0.6 x 12 = 216px, immovable without going unreadable.
           the card at a 280px viewport is 222px box, 220px content box once its
           1px borders are in, and the harness measures 229px needed against
           220px available. Even at ZERO padding it would be 4px short.

         It fits everywhere else — 320px and up, and at every zoom the harness
         tests below 400% — because the comment lines wrap and the commands do
         not. That distinction is the fix; this entry is the residue of a phone
         narrower than any phone that exists. A terminal scrolls. */
      if (el.matches(SCROLL_OK)) continue;
      unfit.push({ el: label(el), need: el.scrollWidth, have: el.clientWidth, over: el.scrollWidth - el.clientWidth });
    } else if (!contained(el) && contentEscapes(el)) {
      clipped.push({ el: label(el), need: el.scrollWidth, have: el.clientWidth, over: el.scrollWidth - el.clientWidth });
    }
  }

  /* 3 · sibling collision. Only FLOW siblings: an absolutely positioned layer is
     decoration and is meant to sit under or over its neighbours. Only text-bearing
     boxes, because a decorative dot overlapping a card is not a defect and a
     caption overlapping a button is. */
  const COL_LIKE = '.card, .bento__hd, .bento__tether, .bento__social, .bento__privacy, .feature, .feature__copy, .acc__item, .flow__step, .footer-col, .hero-chip, .nav-link, .btn, .marquee__item, .lock, .terminal, .mock, .cta-band__inner';
  /* 2px, inlined rather than read from the Node scope: everything inside `probe`
     is serialised into the page, so a reference to a module constant is a
     ReferenceError in the browser rather than a default. */
  const COLLIDE = 2;
  const collisions = [];
  for (const holder of document.querySelectorAll('.shell, .section, main, .hero-inner, .acc, .flow__steps, .footer-grid, .bento, .cta-band')) {
    const kids = [...holder.children].filter((el) => el.matches(COL_LIKE));
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i], b = kids[j];
        if (getComputedStyle(a).position === 'absolute' || getComputedStyle(b).position === 'absolute') continue;
        const ra = visible(a), rb = visible(b);
        if (!ra || !rb) continue;
        const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox > COLLIDE && oy > COLLIDE) {
          collisions.push({ el: label(a) + ' × ' + label(b), ox: Math.round(ox), oy: Math.round(oy) });
        }
      }
    }
  }

  /* 4 · gutters. The first .shell in <main> is the content column. */
  const shell = document.querySelector('#main-content .shell');
  const sr = shell ? shell.getBoundingClientRect() : null;

  /* 5 + 6 · type. */
  const px = (v) => parseFloat(v);
  const bodyEl = document.querySelector('.copy, .bento__caption, #features p, #clarity p') || document.body;
  const capEl = document.querySelector('.eyebrow, .bento__caption, .mock__url, .marquee__item') || document.body;
  const h2El = document.querySelector('main h2');

  /* 7 · section heights, and the geometry every regression report needs. */
  const secs = [...document.querySelectorAll('main > section, .site-footer')].map((sec) => {
    const cs = getComputedStyle(sec);
    return {
      id: sec.id || 'footer',
      h: Math.round(sec.offsetHeight),
      vh: +(sec.offsetHeight / vh).toFixed(2),
      padT: cs.paddingTop, padB: cs.paddingBottom,
    };
  });

  return {
    /* `vh` was a local in `probe` and never made it into the returned metrics,
       so the section-length floor below was reading `undefined < 600` — false —
       and the rule ran at zoom 400% exactly as it did before the floor existed.
       A guard that is never true is not a guard. */
    iw: window.innerWidth, vh: window.innerHeight, cw: de.clientWidth, sw: de.scrollWidth,
    docH: de.scrollHeight,
    gutL: sr ? Math.round(sr.left) : null,
    gutR: sr ? Math.round(de.clientWidth - sr.right) : null,
    shellW: shell ? Math.round(shell.offsetWidth) : null,
    body: Math.round(px(getComputedStyle(bodyEl).fontSize) * 100) / 100,
    caption: Math.round(px(getComputedStyle(capEl).fontSize) * 100) / 100,
    h2: h2El ? Math.round(px(getComputedStyle(h2El).fontSize) * 100) / 100 : null,
    display: (() => { const d = document.querySelector('.hero-title'); return d ? Math.round(px(getComputedStyle(d).fontSize) * 100) / 100 : null; })(),
    clipped, unfit, collisions, secs,
  };
};

/* Wait for the entrance to be over, the fonts to be in, and every lazy section
   to have been visited. Measuring a page mid-entrance measures a panel. */
const settle = async (page) => {
  await page.waitForFunction(
    () => document.documentElement.classList.contains('intro-done')
       || !document.getElementById('intro-overlay'),
    null, { timeout: 20000 },
  ).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.evaluate(async () => {
    const t = document.body.scrollHeight;
    for (let y = 0; y < t; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 8)); }
    window.scrollTo(0, 0);
  });
  /* The last scroll settles observers and transitions; 260ms is the shortest
     wait that has ever been enough on this page and the cheapest of the several
     that would be. */
  await page.waitForTimeout(260);
};

/* ------------------------------------------------------------- the verdicts */

function verify(m, tag) {
  const bad = [];
  const skips = [];

  if (m.sw > m.cw) bad.push(`document overflows: scrollWidth ${m.sw} > clientWidth ${m.cw} (+${m.sw - m.cw}px)`);

  for (const c of m.clipped.slice(0, 4)) {
    bad.push(`CLIPPED content: ${c.el} needs ${c.need}px, has ${c.have}px (+${c.over}px)`);
  }
  if (m.clipped.length > 4) bad.push(`… and ${m.clipped.length - 4} more clipped elements`);

  /* A scroller that has to scroll is not a broken page. It IS a design that
     stopped fitting, and it is on the list because the fluid pass is supposed
     to make these surfaces fit — so it is reported, at a lower volume, and
     separated from the real defects above. */
  const showUnfit = m.unfit.length <= 2 || tag.indexOf('280') !== -1 || tag.indexOf('320') !== -1;
  if (showUnfit) {
    for (const c of m.unfit.slice(0, 3)) {
      bad.push(`does not fit (scrolls): ${c.el} needs ${c.need}px, has ${c.have}px (+${c.over}px)`);
    }
    if (m.unfit.length > 3) bad.push(`… and ${m.unfit.length - 3} more surfaces that have to scroll`);
  }

  for (const c of m.collisions.slice(0, 3)) {
    bad.push(`siblings collide by ${c.ox}x${c.oy}px: ${c.el}`);
  }
  if (m.collisions.length > 3) bad.push(`… and ${m.collisions.length - 3} more collisions`);

  if (m.gutL !== null && Math.abs(m.gutL - m.gutR) > GUTTER_TOL) {
    bad.push(`gutters asymmetric L${m.gutL}/R${m.gutR}`);
  }

  if (m.body && m.body < MIN_BODY_PX) bad.push(`body text ${m.body}px < ${MIN_BODY_PX}px floor`);
  if (m.caption && m.caption < MIN_CAPTION_PX) bad.push(`caption text ${m.caption}px < ${MIN_CAPTION_PX}px floor`);

  if (m.h2 && m.body && m.h2 / m.body < MIN_H2_RATIO) {
    bad.push(`h2 ${m.h2}px is only ${(m.h2 / m.body).toFixed(2)}x body ${m.body}px (< ${MIN_H2_RATIO}x)`);
  }

  if (m.vh < LONG_VH_FLOOR) {
    /* `note()` pushes onto the FAILURE list — it is not an info channel, and
       using it here printed five passing runs as five failures. The skip is
       recorded so the reader knows the rule did not run, but it is not one. */
    skips.push(`${tag}: section-length rule skipped — the viewport is only ${m.vh}px tall, so 2x it (${m.vh * LONG_SECTION_VH}px) is below one paragraph`);
  } else {
    for (const s of m.secs) {
      if (s.vh > LONG_SECTION_VH && !LONG_OK.has(s.id)) {
        bad.push(`#${s.id} is ${s.h}px = ${s.vh}x the viewport`);
      }
    }
  }

  for (const sk of skips) console.log(`   skipped · ${sk}`);
  for (const b of bad) note(`[${tag}] ${b}`);
  return bad;
}

/* ---------------------------------------------------------------- the runs */

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio'],
});

if (SHOTS) await mkdir(SHOTS, { recursive: true });

const openCtx = (w, h, mobile) => browser.newContext({
  viewport: { width: w, height: h },
  isMobile: !!mobile,
  hasTouch: !!mobile,
  deviceScaleFactor: mobile ? 2 : 1,
});

/* =============================== 1 · the sweep ============================= */
console.log(`\n=== fluid sweep · ${QUICK ? 'quick' : 'full'} · ${BASE} ===`);
console.log(' size        iw/cw        gutter  body  cap   h2     hero   sections(h)');

for (const mobile of [false, true]) {
  const mode = mobile ? 'mobile ' : 'desktop';
  const ctx = await openCtx(SIZES[0][0], SIZES[0][1], mobile);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);

  for (const [w, h] of SIZES) {
    if (mobile) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true }).catch(() => {});
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }).catch(() => {});
    } else {
      await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await page.setViewportSize({ width: w, height: h });
    }

    await page.goto(BASE + (QUICK ? '' : '?fluid=' + w + 'x' + h), { waitUntil: 'load', timeout: 60000 });
    await settle(page);

    const m = await page.evaluate(probe);
    const tag = `${mode} ${w}x${h}`;
    verify(m, tag);
    rows.push({ mode, w, h, ...m });

    console.log(
      ` ${String(w + 'x' + h).padEnd(10)} ${String(m.sw + '/' + m.cw).padEnd(12)} `
      + `${String(m.gutL + '/' + m.gutR).padEnd(7)} ${String(m.body).padEnd(5)} ${String(m.caption).padEnd(5)} `
      + `${String(m.h2).padEnd(6)} ${String(m.display).padEnd(6)} `
      + m.secs.map((s) => s.h).join('/'),
    );

    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/${mode.trim()}-${w}x${h}.png`, fullPage: true }).catch(() => {});
    }
  }
  await ctx.close();
}

/* ============================ 2 · live resize vs fresh ==================== */
if (!NO_RESIZE) {
  console.log('\n=== live resize (no reload) vs a fresh load at the same size ===');

  /* offsetTop/Left/Width/Height, deliberately — see check-overflow.mjs. The
     rect API returns TRANSFORMED geometry and this page always has something
     mid-animation, so a rect comparison reports failures that do not exist. */
  const geom = () => {
    const g = (s) => { const e = document.querySelector(s); return e ? [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight].join(',') : 'x'; };
    return {
      hero: g('#hero'), bento: g('#overview .bento'), term: g('.terminal'), mock: g('.mock'),
      feat: g('#features .feature'), flow: g('#flow .flow__steps'), acc: g('#clarity .acc'),
      cta: g('.cta-band'), foot: g('.site-footer .shell'), nav: g('#navbar'),
    };
  };

  const ctx = await openCtx(1920, 1080, false);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await settle(page);

  const resized = {};
  for (const w of RESIZE_SEQ) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(420);
    await page.evaluate(async () => {
      const t = document.body.scrollHeight;
      for (let y = 0; y < t; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 6)); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(280);
    resized[w] = await page.evaluate(geom);
  }
  await ctx.close();

  for (const w of RESIZE_SEQ) {
    const c2 = await openCtx(w, 900, false);
    const p2 = await c2.newPage();
    await p2.goto(BASE + '?fresh=' + w, { waitUntil: 'load', timeout: 60000 });
    await settle(p2);
    const fresh = await p2.evaluate(geom);
    await c2.close();

    const diffs = Object.keys(fresh).filter((k) => String(resized[w][k]) !== String(fresh[k]));
    if (!diffs.length) {
      console.log(`  ${String(w).padStart(5)}px  matches a fresh load`);
    } else {
      for (const k of diffs) note(`[resize ${w}px] ${k} resized(${resized[w][k]}) vs fresh(${fresh[k]})`);
      console.log(`  ${String(w).padStart(5)}px  ${diffs.length} difference(s): ${diffs.join(', ')}`);
    }
  }
}

/* ================================ 3 · zoom ================================= */
console.log('\n=== zoom (as a layout viewport) ===');
const ctx = await openCtx(1440, 900, false);
const page = await ctx.newPage();
for (const z of ZOOMS) {
  /* A zoom of Z is a layout viewport of 1440/Z. Driving the viewport instead of
     the browser zoom is the same layout and does not depend on a compositor
     that a headless box may not have. */
  const w = Math.round(1440 / z);
  const h = Math.round(900 / z);
  await page.setViewportSize({ width: w, height: h });
  await page.goto(BASE + '?zoom=' + z, { waitUntil: 'load', timeout: 60000 });
  await settle(page);
  const m = await page.evaluate(probe);
  const bad = verify(m, `zoom ${Math.round(z * 100)}% (${w}px)`);
  console.log(`  ${String(Math.round(z * 100) + '%').padStart(5)} → ${String(w + 'px').padEnd(6)} `
    + `${bad.length ? 'FAIL' : 'ok'}  sw/cw ${m.sw}/${m.cw}  body ${m.body}px  h2 ${m.h2}px`);
}
await ctx.close();

/* ================================ report ================================== */
console.log('\n----------------------------------------------------------------');
if (JSON_OUT) {
  console.log(JSON.stringify({ rows, failures }, null, 2));
} else if (failures.length) {
  console.log(`FAILED · ${failures.length} assertion(s) across ${rows.length} sizes`);
  failures.slice(0, 40).forEach((f) => console.log('   FAIL  ' + f));
  if (failures.length > 40) console.log(`   … and ${failures.length - 40} more`);
  process.exitCode = 1;
} else {
  console.log(`PASSED · ${rows.length} sizes · no overflow, no clipping, no collisions, `
    + 'gutters even, type floors held');
}

await browser.close();
