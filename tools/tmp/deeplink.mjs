import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true });
for (const base of ['http://127.0.0.1:8766','http://127.0.0.1:8765']) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 530 } });
  const p = await ctx.newPage();
  await p.goto(base + '/#features', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6500);
  console.log(base, await p.evaluate(() => ({
    scrollY: Math.round(scrollY),
    heroTop: Math.round(document.getElementById('hero').getBoundingClientRect().top),
    heroH: Math.round(document.getElementById('hero').getBoundingClientRect().height),
    heroCls: document.getElementById('hero').className,
    h1: (() => { const r = document.querySelector('h1.hero-title').getBoundingClientRect(); return {top: Math.round(r.top), bottom: Math.round(r.bottom), op: getComputedStyle(document.querySelector('h1.hero-title')).opacity}; })(),
  })));
  await ctx.close();
}
await b.close();
