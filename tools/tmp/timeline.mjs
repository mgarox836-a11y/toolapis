import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 530 } });
const p = await ctx.newPage();
p.on('console', m => console.log('  [console]', m.type(), m.text().slice(0,140)));
await p.addInitScript(() => {
  window.__log = [];
  const t0 = performance.now();
  const mark = (s) => window.__log.push([Math.round(performance.now() - t0), s, document.documentElement.className]);
  window.addEventListener('toolapis:intro-complete', (e) => mark('intro-complete:' + (e.detail && e.detail.reason)));
  const mo = new MutationObserver(() => mark('class:' + document.documentElement.className));
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  setTimeout(() => mark('t2000'), 2000);
  setTimeout(() => mark('t6000'), 6000);
});
await p.goto('http://127.0.0.1:8765', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6500);
console.log(await p.evaluate(() => window.__log));
await b.close();
