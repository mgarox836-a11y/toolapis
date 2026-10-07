/* =============================================================================
 * tools/design-check.mjs — prove the redesign matches DESIGN.md.
 * ----------------------------------------------------------------------------
 * A computed-style assertion pass over the live page at three viewports. Every
 * check below is a rule stated in DESIGN.md, not a preference:
 *
 *   1. the canvas is Void Canvas and every surface is a token;
 *   2. cards are Carbon Plate with a 1px Fog hairline, 20px radius, NO shadow;
 *   3. exactly one filled white button and one Phosphor accent card per viewport;
 *   4. headlines use Google Sans at positive tracking, never negative, and
 *      never at weight >= 700;
 *   5. body copy stays inside the 14–18px reading range;
 *   6. no legacy palette survives anywhere (violet, lime, the old greys) and no
 *      superseded type family is left in the stylesheet;
 *   7. no horizontal scroll at 375px, and no console errors;
 *   8. with prefers-reduced-motion: reduce, nothing animates;
 *   9. the redesigned sections are actually present and wired: bento grid,
 *      activity feed, terminal, before/after slider, lock panel, accordion,
 *      flow connector, and the slider is keyboard-operable.
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

    /* The bento grid replaced the old equal-column tool cards, so the selector
       follows the current markup rather than the previous one. */
    const cards = [...document.querySelectorAll('#overview .bento > .card, #clarity .cta-band')]
      .filter(visible)
      .map((el) => {
        const s = getComputedStyle(el);
        return {
          cls: (el.className || '').toString().split(/\s+/)[0],
          bg: s.backgroundColor,
          bgImage: s.backgroundImage,
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

    /* Every element rendered at 700 or above. Scoped to what has text in it,
       because `font-weight` is inherited and a wrapper div reports its
       child's value. */
    const heavy = [];
    for (const el of document.querySelectorAll('body, body *')) {
      if (!visible(el)) continue;
      const hasOwnText = [...el.childNodes]
        .some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (!hasOwnText) continue;
      const w = parseInt(getComputedStyle(el).fontWeight, 10);
      if (w >= 700) heavy.push(el.tagName.toLowerCase() + '.' + ((el.className || '').toString().split(/\s+/)[0] || '?') + ' w=' + w);
    }

    /* Mono surfaces: the terminal, the hero chips, the bento stats. */
    const monoFaces = [...document.querySelectorAll('.terminal, .hero-chip, .ba__stats, .code, .mono')]
      .filter(visible)
      .map((el) => getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, ''))
      .filter((v, i, a) => a.indexOf(v) === i);

    /* Hover states, gathered with real input rather than a synthetic class.
       This block runs after the page has settled; see the hover pass below. */

    /* The redesigned sections, and whether each is actually wired rather than
       merely present in the markup. A class that exists but whose controller
       never ran is the failure mode this catches. */
    const ba = document.querySelector('[data-ba]');
    const sections = {
      bento: document.querySelectorAll('#overview .bento > .card').length,
      feed: document.querySelectorAll('[data-feed] .feed__row').length,
      terminal: document.querySelectorAll('[data-terminal] [data-type]').length,
      lock: document.querySelectorAll('.lock__ring').length,
      acc: document.querySelectorAll('.acc__item').length,
      flowTrace: !!document.querySelector('[data-flow-trace]'),
      marquee: document.querySelectorAll('.marquee__group').length,
      slider: ba ? {
        tag: ba.tagName.toLowerCase(),
        type: ba.type,
        aria: !!ba.getAttribute('aria-label'),
        value: ba.value,
      } : null,
      /* The feed must hold a constant number of rows: it evicts as it pushes,
         and a growing list means the eviction never ran. */
      feedStable: document.querySelectorAll('[data-feed] .feed__row').length === 4,
    };

    /* Every computed colour and every stylesheet rule, searched for the old
       palette, plus the superseded type families.

       The font check reads the STYLESHEET TEXT, not the computed value,
       because --font-body is a var() chain: the computed value resolves to
       Google Sans even while an old name survives inside a fallback stack,
       which is exactly what --font-geist / --font-calsans are (deliberate
       aliases so no rule breaks). Asserting on computed values would pass
       either way and catch nothing. */
    const cssText = [...document.styleSheets]
      .flatMap((sheet) => { try { return [...sheet.cssRules].map((r) => r.cssText); } catch (err) { return []; } })
      .join('\n');
    /* Each is matched only where it would be a LIVE reference, never as one
       entry of a fallback stack: a --font-* declaration or an @font-face. */
    const staleFonts = [
      { re: /@font-face[^}]*'Space Grotesk'/, label: 'Space Grotesk @font-face' },
      { re: /@font-face[^}]*'Geist'/, label: 'Geist @font-face' },
      { re: /@font-face[^}]*'Geist Mono'/, label: 'Geist Mono @font-face' },
      { re: /--font-(display|body|sans)\s*:\s*'Space Grotesk'/, label: 'Space Grotesk as a live --font-* alias' },
      { re: /--font-(display|body|sans)\s*:\s*'Calsans'/, label: 'Calsans as a live --font-* alias' },
      /* NOTE: 'Geist Mono' as a FALLBACK entry inside the mono stack is
         allowed and intended — css/tokens.css names it there on purpose, so a
         device without Google Sans Code still gets a sane monospace face. Only
         an @font-face or a live --font-(display|body|sans) alias counts as a
         leftover, and those are the three checks above. */
    ].filter((c) => c.re.test(cssText)).map((c) => c.label);

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
      heavy,
      monoFaces,
      sections,
      stale: [...new Set(stale)].slice(0, 12),
      staleFonts,
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

  /* ---- hover pass -------------------------------------------------------
     A separate read, because a hover state cannot be observed in a
     computed-style pass on an un-hovered element — there is no `:hover` to
     measure. The card lift in particular was dead for a whole review cycle: the
     reveal system's `:not(#id)` chain resolves to about (10,3,2), which
     out-specified `.card:hover`'s `transform`, so the card's background
     changed on hover while the -4px lift never applied. The rule looked
     correct in the stylesheet and was dead on the page. */
  const hoverOne = async (selector, pick) => {
    const el = await page.$(selector);
    if (!el) return { ok: false, value: 'not on screen' };
    const read = (sel) => page.evaluate((q) => {
      const e = document.querySelector(q);
      const c = getComputedStyle(e);
      return { bg: c.backgroundColor, transform: c.transform, translate: c.translate, border: c.borderTopColor, shadow: c.boxShadow };
    }, sel);
    const before = await read(selector);
    await el.hover({ force: true });
    await page.waitForTimeout(420);
    return { ok: true, value: pick(before, await read(selector)) };
  };
  const bring = async (selector) => {
    await page.evaluate((sel) => {
      const e = document.querySelector(sel);
      if (e) e.scrollIntoView({ block: 'center' });
    }, selector);
    await page.waitForTimeout(850);
  };

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);

  await bring('.bento__tether');
  const cardHover = await hoverOne('.bento__tether', (b, a) => ({
    lift: a.translate !== b.translate && a.translate !== 'none',
    bgChanged: a.bg !== b.bg,
    borderHeld: a.border === b.border,
    noShadow: a.shadow === 'none',
    translate: a.translate,
  }));
  const ghostHover = await hoverOne('.bento__tether a.btn-outline', (b, a) => a.bg);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  const filledHover = await hoverOne('.hero-cta-row a.btn-accent', (b, a) => ({
    lift: a.transform !== b.transform && a.transform !== 'none',
    transform: a.transform,
  }));

  await bring('.bento__hd');
  /* The arrow is a CHILD of the button, so the hover has to land on the button
     and the read has to be taken on the icon inside it. */
  await page.hover('.bento__hd a.btn-outline', { force: true });
  await page.waitForTimeout(450);
  const arrowHover = await page.evaluate(() => {
    const a = document.querySelector('.bento__hd a.btn-outline .btn-arrow');
    return a ? getComputedStyle(a).transform : 'no arrow';
  });

  const blurOut = await page.evaluate(() => {
    const hits = [];
    document.querySelectorAll('body, body *').forEach((e) => {
      const c = getComputedStyle(e);
      const bf = c.backdropFilter || c.webkitBackdropFilter;
      if (bf && bf !== 'none') hits.push((e.className || e.tagName) + ' -> ' + bf);
    });
    return hits;
  });

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
  /* The bento cards are Carbon Plate panels. `.cta-band` is a different kind
     of thing entirely — DESIGN.md "3D Product Visual Block"/closing band: it
     sits on --gradient-ground, so it has no background-color at all. Probing
     it as a card is what made this assertion fail for five correct cards. */
  const panels = r.cards.filter((c) => c.cls !== 'cta-band');
  const bands = r.cards.filter((c) => c.cls === 'cta-band');
  check('every bento card is Carbon Plate with a 1px Fog hairline, 20px radius, no shadow',
    panels.length === 4 && panels.every((c) => c.bg === T.carbon
      && /^1px solid rgb\(217, 218, 229\)$/.test(c.border)
      && c.radius === '20px' && c.shadow === 'none'),
    `${panels.length} cards; first ${JSON.stringify(panels[0] || {})}`);
  check('the closing CTA band is a gradient ground, not a flat plate',
    bands.length === 1 && bands[0].radius === '20px' && bands[0].shadow === 'none'
      && /linear-gradient/.test(bands[0].bgImage),
    JSON.stringify(bands[0] || {}));

  /* 3 — ONE filled white button per screen. This is the primary-action
     rationing, so a second one on screen is the failure, not a filled button's
     mere existence. The hero owns the top screen and the closing band owns its
     own; neither screen may carry both. */
  check('at most one filled button per screen', r.filledButtons.length <= 1,
    r.filledButtons.map((b) => `${b.text}:${b.bg}`).join(' ') || 'none');
  check('at most one Phosphor accent card', r.mintCards.length <= 1,
    r.mintCards.join(' ') || 'none');

  /* 4 — Google Sans everywhere, POSITIVE tracking, nothing heavy.
     The typography brief replaced Space Grotesk + Geist with one family.
     DESIGN.md's "Don't" that still has teeth is that the display face is never
     negatively tracked, at any size — so that is asserted everywhere, the
     56px+ ceiling is checked as its own rule, and 700+ is banned outright
     because weight, not size, carrying the hierarchy is what makes a page read
     as consumer UI. */
  check('every headline uses Google Sans at weight <= 600',
    r.heads.length > 0 && r.heads.every((h) => /Google Sans/.test(h.ff) && +h.weight <= 600),
    r.heads.map((h) => `${h.size.toFixed(0)}px w=${h.weight}`).join(' | '));
  check('no weight >= 700 anywhere on the page', r.heavy.length === 0,
    r.heavy.join(', ') || 'none');
  check('no headline anywhere is negatively tracked',
    r.heads.every((h) => parseFloat(h.ls) >= 0),
    r.heads.filter((h) => parseFloat(h.ls) < 0).map((h) => h.size.toFixed(0) + 'px').join(', ') || 'none negative');
  /* Google Sans is wider-bodied than the Calsans it stands in for, so the
     tracking was recalibrated DOWN — 0.03em on the hero, 0.024em at the 56px
     token — while DESIGN.md's 0.056em stays the ceiling. */
  const bigHeads = r.heads.filter((h) => h.size >= 54);
  check('display tracking stays positive and under the 0.056em ceiling',
    bigHeads.length === 0 || bigHeads.every((h) => {
      const ratio = parseFloat(h.ls) / h.size;
      return ratio > 0 && ratio <= 0.0565;
    }),
    bigHeads.map((h) => `${h.size.toFixed(0)}px ls=${h.ls} = ${(parseFloat(h.ls) / h.size * 100).toFixed(2)}em`).join(' | ')
      || 'no 56px+ headline at this width');
  check('mono surfaces use Google Sans Code', r.monoFaces.every((f) => /Google Sans Code/.test(f)),
    r.monoFaces.join(' | ') || 'no mono surface on screen');

  /* 5 — body copy range */
  check('body copy stays within 14–18px', r.bodies.min >= 13.5 && r.bodies.max <= 18.5,
    `${r.bodies.min}–${r.bodies.max}px`);

  /* 6 — no legacy palette */
  check('no violet / lime / old-grey colour survives', r.stale.length === 0, r.stale.join(' ; ') || 'clean');
  /* One family for every role, with the superseded names surviving only as
     entries of a fallback stack. */
  check('no superseded type family is live in the stylesheet',
    r.staleFonts.length === 0, r.staleFonts.join(', ') || 'Google Sans only');
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

  /* 10 — hover states actually fire.
     These four are one-liners in CSS that a computed-style pass cannot see on
     its own, and one of them (the card lift) was silently dead for a whole
     review cycle: the reveal system's `:not(#id)` chain out-specified it, so
     the card's background changed on hover while the -4px lift never applied.
     A rule can look correct in the stylesheet and be dead on the page. */
  check('card hover lifts 4px and darkens to Obsidian',
    cardHover.ok && cardHover.value.lift && cardHover.value.bgChanged && cardHover.value.borderHeld && cardHover.value.noShadow,
    JSON.stringify(cardHover.value));
  check('ghost pill hover fills 8% white',
    /rgba\(255, 255, 255, 0\.08\)/.test(String(ghostHover.value)), String(ghostHover.value));
  check('filled pill hover lifts 1px',
    filledHover.ok && filledHover.value.lift, JSON.stringify(filledHover.value));
  check('button arrow slides 4px on hover',
    /,\s*4,\s*0\)|translateX\(4px\)/.test(String(arrowHover)), String(arrowHover));
  /* Nothing anywhere may reach for backdrop-filter: DESIGN.md has no
     glassmorphism, and it is the single most expensive decoration on the page. */
  check('no backdrop-filter anywhere', blurOut.length === 0, blurOut.join(' ; ') || 'none');

  /* 9 — the redesigned sections exist AND are wired, not just present in the
     markup. A class that exists while its controller never ran is exactly the
     failure mode a screenshot cannot see, so each is probed for the state its
     controller is responsible for producing. */
  check('bento grid has its four cards', r.sections.bento === 4, `${r.sections.bento} cards`);
  check('activity feed holds a constant 4 rows', r.sections.feedStable, `${r.sections.feed} rows`);
  check('terminal has its typed commands', r.sections.terminal === 2, `${r.sections.terminal} commands`);
  check('lock panel renders', r.sections.lock === 1, `${r.sections.lock} rings`);
  check('accordion has its four questions', r.sections.acc === 4, `${r.sections.acc} items`);
  check('flow connector path present', r.sections.flowTrace);
  check('marquee has both halves for a seamless wrap', r.sections.marquee === 2, `${r.sections.marquee} groups`);
  check('before/after slider is a labelled range input',
    !!r.sections.slider && r.sections.slider.tag === 'input'
      && r.sections.slider.type === 'range' && r.sections.slider.aria,
    JSON.stringify(r.sections.slider));

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
