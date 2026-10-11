import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true });
for (const url of ['http://127.0.0.1:8765/', 'http://127.0.0.1:8765/?intro=off', 'http://127.0.0.1:8765/#features']) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 530 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    window.__t0 = performance.now();
    window.addEventListener('toolapis:intro-complete', (e) => { window.__reason = e.detail && e.detail.reason; });
  });
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  for (const at of [1200, 2500, 5500, 7000]) {
    await p.waitForTimeout(at === 1200 ? 1200 : 1300);
    const r = await p.evaluate(() => ({
      t: Math.round(performance.now() - window.__t0),
      reason: window.__reason || null,
      cls: document.documentElement.className,
      els: [...document.querySelectorAll('[data-load-reveal]')].map(e => e.tagName + '#' + (e.id||'-') + '.' + String(e.className).slice(0,18) + '=' + (+parseFloat(getComputedStyle(e).opacity).toFixed(2))),
    }));
    console.log(r.t + 'ms', (r.reason||'-').padEnd(10), r.els.join('  '));
  }
  console.log('---', url);
  await ctx.close();
}
await b.close();
