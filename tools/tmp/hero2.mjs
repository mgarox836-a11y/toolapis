import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true });
const url = process.argv[2] + (process.argv[3] || '/');
const ctx = await b.newContext({ viewport: { width: 1366, height: 530 } });
const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6500);
console.log(process.argv[3] || '/', await p.evaluate(() => ({
  cls: document.documentElement.className,
  els: [...document.querySelectorAll('[data-load-reveal]')].map(e => e.tagName + '=' + (+parseFloat(getComputedStyle(e).opacity).toFixed(2)) + '/anim=' + getComputedStyle(e).animationName + '/d=' + getComputedStyle(e).animationDelay + '/fill=' + getComputedStyle(e).animationFillMode + '/ps=' + getComputedStyle(e).animationPlayState),
})));
await b.close();
