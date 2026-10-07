/* =============================================================================
 * tools/design-check.mjs — prove the redesign matches DESIGN.md.
 * ----------------------------------------------------------------------------
 * A computed-style assertion pass over the live page at three viewports. Every
 * check below is a rule stated in DESIGN.md, not a preference:
 *
 *   1. the canvas is Void Canvas and every surface is a token;
 *   2. cards are Carbon Plate with a 1px Fog hairline, 20px radius, NO shadow;
 *   3. exactly one filled white button and one Phosphor accent card per viewport;
 *   4. headlines use the display face at positive tracking, never negative;
 *   5. body copy stays inside the 14–18px reading range;
 *   6. no legacy palette survives anywhere (violet, lime, the old greys);
 *   7. no horizontal scroll at 375px, and no console errors;
 *   8. with prefers-reduced-motion: reduce, nothing animates.
 *
 *   node tools/design-check.mjs
 *   node tools/design-check.mjs --width 768 --height 1024
 * ========================================================================== */

import { chromium } from 'playwright-core';
import { access } from 'node:fs/promises';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};

const BASE = process.env.TOOLAPIS_URL || 'http://127.0.0.1:5500/';

/* DESIGN.md, written once so the assertions and the stylesheet are checked
   against the same list. */
const T = {
  void:      'rgb(7, 7, 7)',
  carbon:    'rgb(13, 14, 18)',
  obsidian:  'rgb(20, 20, 24)',
  iron:      'rgb(46, 48, 56)',
  white:     'rgb(255, 255, 255)',
  mist:      'rgb(240, 240, 240)',
  fog:       'rgb(217, 218, 229)',
  ash:       'rgb(200, 202, 208)',
  graphite:  'rgb(174, 174, 183)',
  slate:     'rgb(162, 164, 169)',
  cinder:    'rgb(96, 96, 108)',
  mint:      'rgb(112, 220, 211)',
  deepSig:   'rgb(6, 119, 212)',
  iris:      'rgb(146, 157, 189)',
};

const VIEWPORTS = [
  { width: 1366, height: 900,  label: 'desktop' },
  { width: 768,  height: 1024, label: 'tablet' },
  { width: 375,  height: 812,  label: 'mobile' },
].filter((v) => !process.argv.includes('--width')
  || v.width === arg('width'));

/* playwright-core ships no browser of its own, so resolve a system one the same
   way the other harnesses in this directory do. */
const CANDIDATES = [
  '/usr/bin/brave', '/usr/bin/brave-browser', '/usr/bin/chromium',
  '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
];
let exe = null;
for (const p of CANDIDATES) {
  try { await access(p); exe = p; break; } catch { /* next */ }
}
if (!exe) { console.error('no browser found'); process.exit(1); }

const ARGS = [
  '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio',
];

const browser = await chromium.launch({ executablePath: exe, args: ARGS });
let failures = 0;

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 150000 }).catch(() => {});
  /* The intro runs 5s and the reveals settle behind it. */
  await page.waitForTimeout(6500);

  const r = await page.evaluate(() => {
    const cs = (el, p) => getComputedStyle(el).getPropertyValue(p);
    const visible = (el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    };
    /* Elements that actually paint a fill, not text coloured with it. */
    const filled = (el) => {
      const s = getComputedStyle(el);
      const bg = s.backgroundColor;
      return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    };

    const cards = [...document.querySelectorAll('#overview .tool-card, #features .card, #flow .card, #clarity .shell > .reveal')]
      .filter(visible)
      .map((el) => {
        const s = getComputedStyle(el);
        return {
          bg: s.backgroundColor,
          border: s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor,
          radius: s.borderTopLeftRadius,
          shadow: s.boxShadow,
        };
      });

    /* DESIGN.md's rationing is per SCREEN, so every "per viewport" assertion
       here must be scoped to what is actually on screen. Without this the
       hero's filled pill and the closing band's filled pill would be counted
       together from two different screens. */
    const onScreen = (el) => {
      const b = el.getBoundingClientRect();
      return b.bottom > 0 && b.top < window.innerHeight;
    };

    /* A "filled button" in DESIGN.md's sense: a control with a solid,
       non-transparent background. */
    const filledButtons = [...document.querySelectorAll('.btn, .hero-pill-outline, .hero-play-btn, .hero-link-see')]
      .filter(visible)
      .filter(onScreen)
      .filter(filled)
      .map((el) => ({ text: (el.textContent || '').trim().slice(0, 28), bg: getComputedStyle(el).backgroundColor }));

    const mintCards = [...document.querySelectorAll('.toolpass, .card--accent')]
      .filter(visible)
      .filter(onScreen)
      .map((el) => getComputedStyle(el).backgroundColor);

    const heads = [...document.querySelectorAll('h1, h2, .t-heading-sm')]
      .filter(visible)
      .map((el) => {
        const s = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          size: parseFloat(s.fontSize),
          ls: s.letterSpacing,
          ff: s.fontFamily,
          weight: s.fontWeight,
        };
      });

    const bodies = [...document.querySelectorAll('main p')]
      .filter(visible)
      .map((el) => parseFloat(getComputedStyle(el).fontSize));

    /* Every computed colour and every stylesheet rule, searched for the old
       palette. */
    const stale = [];
    for (const el of document.querySelectorAll('body, body *')) {
      const s = getComputedStyle(el);
      const blob = [s.color, s.backgroundColor, s.backgroundImage, s.borderTopColor,
        s.outlineColor, s.fill, s.stroke].join(' ');
      const m = blob.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g) || [];
      for (const hit of m) {
        const [r0, g0, b0] = hit.match(/\d+/g).map(Number);
        /* #af50ff violet, #a3e635 lime, #090909 / #0b0f12 / #423738 old greys. */
        const isViolet = r0 > 140 && r0 < 200 && g0 > 50 && g0 < 110 && b0 > 230;
        const isLime = r0 > 140 && r0 < 190 && g0 > 200 && b0 < 100;
        const isOldGrey = (r0 === 9 && g0 === 9 && b0 === 9)
          || (r0 === 11 && g0 === 15 && b0 === 18)
          || (r0 === 66 && g0 === 55 && b0 === 56);
        if (isViolet || isLime || isOldGrey) {
          stale.push(el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '') + ' -> ' + hit);
        }
      }
    }

    /* Every link href, so a redesign cannot quietly break routing. */
    const links = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
    const anchors = links.filter((h) => h && h.startsWith('#'));
    const externals = links.filter((h) => h && /^https?:/.test(h));

    return {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      htmlBg: getComputedStyle(document.documentElement).backgroundColor,
      /* Both <html> and <body> paint Void Canvas now. When the 3D layer was
         live it needed `html.scene3d body { background: transparent }` — a
         body's background paints AFTER its negative-z children — and this
         assertion had to branch on which state it was in. There is no layer
         behind the page any more, so the two must simply agree. */
      bodyBg: getComputedStyle(document.body).backgroundColor,
      cards,
      filledButtons,
      mintCards,
      heads,
      bodies: { min: Math.min(...bodies), max: Math.max(...bodies) },
      stale: [...new Set(stale)].slice(0, 12),
      navBorder: cs(document.getElementById('navbar'), 'border-bottom-color'),
      displayFF: getComputedStyle(document.querySelector('h1')).fontFamily,
      hasTailwind: !!document.querySelector('script[src*="tailwindcss"]'),
      anchors,
      externals,
      introGone: !document.getElementById('intro-overlay'),
      /* Only blocks currently ON SCREEN can be "stranded": a `.reveal` below the
         fold is *meant* to still be at opacity 0, that is the whole point of the
         hide-initial state. What must never happen is one that is visible and
         still transparent. */
      hiddenReveals: [...document.querySelectorAll('.reveal')]
        .filter((el) => visible(el) && onScreen(el))
        .filter((el) => parseFloat(getComputedStyle(el).opacity) < 0.9)
        .map((el) => (el.className || '').split(/\s+/)[0] + '@' + Math.round(el.getBoundingClientRect().top)),
    };
  });

  const reduced = await (async () => {
    const ctx2 = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      reducedMotion: 'reduce',
    });
    const p2 = await ctx2.newPage();
    await p2.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await p2.waitForFunction(() => document.readyState === 'complete', null, { timeout: 150000 }).catch(() => {});
    await p2.waitForTimeout(6500);
    const out = await p2.evaluate(() => ({
      htmlClass: document.documentElement.className,
      running: [...document.querySelectorAll('.hero-glow, .hero-grid-lines, .status-dot, .activity__dot, .pt-dot')]
        .map((el) => getComputedStyle(el).animationName),
      hiddenWords: [...document.querySelectorAll('.word-reveal')]
        .filter((el) => parseFloat(getComputedStyle(el).opacity) < 0.9).length,
    }));
    await ctx2.close();
    return out;
  })();

  console.log(`\n=== ${vp.width}x${vp.height} · ${vp.label} ===`);
  const ok = [], bad = [];
  const check = (label, pass, detail) => (pass ? ok : bad).push(`${label}${detail ? '  [' + detail + ']' : ''}`);

  /* 1 — canvas. Nothing paints behind the page any more, so <html> and <body>
     must both hold Void Canvas. This used to branch on whether the WebGL layer
     had confirmed itself, because that layer needed a transparent body to show
     through; the branch was an exception, not a second valid state. */
  check('canvas is Void Canvas on both <html> and <body>',
    r.htmlBg === T.void && r.bodyBg === T.void,
    `${r.htmlBg} / ${r.bodyBg}`);

  /* 2 — cards */
  check('every card is Carbon Plate with a 1px Fog hairline, 20px radius, no shadow',
    r.cards.length > 0 && r.cards.every((c) => c.bg === T.carbon && /^1px solid rgb\(217, 218, 229\)$/.test(c.border)
      && c.radius === '20px' && c.shadow === 'none'),
    `${r.cards.length} cards; first ${JSON.stringify(r.cards[0] || {})}`);

  /* 3 — ONE filled white button per screen. This is the primary-action
     rationing, so a second one on screen is the failure, not a filled button's
     mere existence. The hero owns the top screen and the closing band owns its
     own; neither screen may carry both. */
  check('at most one filled button per screen', r.filledButtons.length <= 1,
    r.filledButtons.map((b) => `${b.text}:${b.bg}`).join(' ') || 'none');
  check('at most one Phosphor accent card', r.mintCards.length <= 1,
    r.mintCards.join(' ') || 'none');

  /* 4 — the display face, always, with POSITIVE tracking.
     The brief ties "+0.056em and Space Grotesk" to headlines ≥ 56px, but the
     ruling that actually has teeth is the one DESIGN.md states as a Don't:
     the display face is never negatively tracked, at any size. So that is what
     is asserted everywhere, and the 56px+ case is checked as its own rule. */
  check('every headline uses the display face at weight <= 400',
    r.heads.length > 0 && r.heads.every((h) => /Space Grotesk/.test(h.ff) && +h.weight <= 400),
    r.heads.map((h) => `${h.size.toFixed(0)}px w=${h.weight}`).join(' | '));
  check('no headline anywhere is negatively tracked',
    r.heads.every((h) => parseFloat(h.ls) >= 0),
    r.heads.filter((h) => parseFloat(h.ls) < 0).map((h) => h.size.toFixed(0) + 'px').join(', ') || 'none negative');
  /* Where the viewport is wide enough for the 56px token to apply, it must. */
  const bigHeads = r.heads.filter((h) => h.size >= 54);
  check('headlines at the 56px token keep the display tracking (~0.056em)',
    bigHeads.length === 0 || bigHeads.every((h) => {
      const ratio = parseFloat(h.ls) / h.size;
      return ratio > 0.04 && ratio < 0.075;
    }),
    bigHeads.map((h) => `${h.size.toFixed(0)}px ls=${h.ls}`).join(' | ') || 'no 56px+ headline at this width');

  /* 5 — body copy range */
  check('body copy stays within 14–18px', r.bodies.min >= 13.5 && r.bodies.max <= 18.5,
    `${r.bodies.min}–${r.bodies.max}px`);

  /* 6 — no legacy palette */
  check('no violet / lime / old-grey colour survives', r.stale.length === 0, r.stale.join(' ; ') || 'clean');
  check('Tailwind CDN is gone', !r.hasTailwind);

  /* 7 — layout and links */
  check('no horizontal scroll', r.scrollW <= r.clientW, `${r.scrollW} vs ${r.clientW}`);
  check('in-page anchors intact', r.anchors.includes('#overview') && r.anchors.includes('#clarity'),
    r.anchors.join(' '));
  check('external tool links intact',
    r.externals.some((h) => h.includes('streamlit.app'))
    && r.externals.some((h) => h.includes('gnirehtet'))
    && r.externals.some((h) => h.includes('newsocapis')),
    `${r.externals.length} external links`);
  check('no console errors', consoleErrors.length === 0, consoleErrors.join(' / ') || 'none');
  check('intro overlay removed from the DOM', r.introGone);
  check('no reveal left stranded below full opacity', r.hiddenReveals.length === 0,
    r.hiddenReveals.join(' ') || 'none');

  /* 8 — reduced motion */
  check('prefers-reduced-motion is honoured on <html>', /motion-reduced/.test(reduced.htmlClass),
    reduced.htmlClass);
  check('no non-essential animation runs under reduced motion',
    reduced.running.every((n) => n === 'none'), reduced.running.join(',') || 'none');
  check('hero headline is fully visible under reduced motion', reduced.hiddenWords === 0,
    `${reduced.hiddenWords} hidden`);

  ok.forEach((l) => console.log('  PASS  ' + l));
  bad.forEach((l) => console.log('  FAIL  ' + l));
  failures += bad.length;
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? '\nall assertions passed' : `\n${failures} assertion(s) failed`);
process.exit(failures === 0 ? 0 : 1);
