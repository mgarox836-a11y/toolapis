#!/usr/bin/env node
/* diagnose-intro-scroll.mjs — evidence pass for the blank-on-scroll-during-intro
   bug. Run it against the CURRENT tree; it changes nothing. */
import { chromium, devices } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.URL || 'http://127.0.0.1:8765';
const SHOTS = '/tmp/shots/intro-scroll';
fs.mkdirSync(SHOTS, { recursive: true });

const TIMINGS = [200, 1000, 2500, 4000];

const SCENARIOS = [
  { name: 'wheel',      mobile: false, run: async (p) => { for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 400); await p.waitForTimeout(40); } } },
  { name: 'space',      mobile: false, run: (p) => p.keyboard.press('Space') },
  { name: 'pagedown',   mobile: false, run: (p) => p.keyboard.press('PageDown') },
  { name: 'arrowdown',  mobile: false, run: async (p) => { for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowDown'); } },
  { name: 'end',        mobile: false, run: (p) => p.keyboard.press('End') },
  { name: 'dragscroll', mobile: false, run: async (p) => {
      await p.mouse.move(1360, 120);
      await p.mouse.down();
      await p.mouse.move(1360, 240, { steps: 12 });
      await p.mouse.up();
    } },
  { name: 'scrollto',   mobile: false, run: (p) => p.evaluate(() => window.scrollTo(0, 900)) },
  { name: 'swipe',      mobile: true,  run: async (p) => {
      await p.touchscreen.tap(195, 400).catch(() => {});
      const cdp = await p.context().newCDPSession(p);
      for (const dir of [1, 1]) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 700 }] });
        for (let y = 700; y > 100; y -= 60) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y }] });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await p.waitForTimeout(60);
      }
      void dir;
    } },
];

const PROBE = () => {
  const html = document.documentElement;
  const intro = document.getElementById('intro-overlay');
  const pt = document.getElementById('page-transition');
  const vw = innerWidth, vh = innerHeight;
  const style = (el) => (el ? getComputedStyle(el) : null);
  const s = style(intro);
  const centerEl = document.elementFromPoint(vw / 2, vh / 2);
  const hidden = [...document.querySelectorAll('[class*="reveal"], [data-reveal], h1, h2, p, .card, .bento > *')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < vh && r.width + r.height > 0
        && parseFloat(getComputedStyle(el).opacity) < 0.05;
    });
  return {
    scrollY: Math.round(scrollY),
    scrollMax: Math.round(document.documentElement.scrollHeight - innerHeight),
    htmlClass: html.className,
    htmlOverflow: getComputedStyle(html).overflow,
    bodyOverflow: getComputedStyle(document.body).overflow,
    introPresent: !!intro,
    introDisplay: s ? s.display : null,
    introOpacity: s ? s.opacity : null,
    introVisibility: s ? s.visibility : null,
    introPe: s ? s.pointerEvents : null,
    transitionOpacity: pt ? getComputedStyle(pt).opacity : null,
    transitionDisplay: pt ? getComputedStyle(pt).display : null,
    transitionClass: pt ? pt.className : null,
    centerEl: centerEl ? centerEl.tagName + '#' + centerEl.id + '.' + String(centerEl.className).slice(0, 40) : null,
    hiddenInView: hidden.length,
    hiddenTags: hidden.slice(0, 6).map((el) => el.tagName + '.' + String(el.className).slice(0, 28)),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    heroOpacity: (() => { const h = document.querySelector('#hero'); return h ? getComputedStyle(h).opacity : null; })(),
    navOpacity: (() => { const h = document.getElementById('navbar'); return h ? getComputedStyle(h).opacity : null; })(),
    restore: history.scrollRestoration,
  };
};

async function run() {
  const browser = await chromium.launch({ headless: true });
  const rows = [];
  for (const sc of SCENARIOS) {
    for (const t of TIMINGS) {
      const ctxOpts = sc.mobile
        ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 1366, height: 530 }, isMobile: false, hasTouch: false };
      const ctx = await browser.newContext(ctxOpts);
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
      page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 120)));
      const label = `${sc.name}@t${t}${sc.mobile ? ' (mob)' : ''}`;
      try {
        await page.goto(URL, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(t);
        const during = await page.evaluate(PROBE);
        await sc.run(page);
        await page.waitForTimeout(120);
        const after = await page.evaluate(PROBE);
        await page.waitForTimeout(6500);
        const final = await page.evaluate(PROBE);
        const shot = path.join(SHOTS, `before-${sc.name}-${sc.mobile ? 'mob' : 'desk'}-${t}.png`);
        await page.screenshot({ path: shot });
        rows.push({ label, errs, during, after, final });
        const flag = final.hiddenInView > 0 || /intro|page-transition/.test(final.centerEl || '') || !final.introPresent === false && final.introDisplay !== 'none';
        console.log(`${flag ? 'BLANK?' : '  ok  '} ${label.padEnd(22)} scrollY ${during.scrollY}->${after.scrollY}->${final.scrollY}/${final.scrollMax}  intro=${final.introPresent ? final.introDisplay : 'gone'} hidden=${final.hiddenInView} center=${(final.centerEl || '').slice(0, 34)}`);
        if (flag) console.log('        hidden:', final.hiddenTags.join(' | '));
      } catch (e) {
        console.log(`ERR   ${label}: ${e.message}`);
        rows.push({ label, error: e.message });
      }
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(SHOTS, 'diagnose.json'), JSON.stringify(rows, null, 2));
  console.log('\nshots -> ' + SHOTS);
}
run().catch((e) => { console.error(e); process.exit(1); });