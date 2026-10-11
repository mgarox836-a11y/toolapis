import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 530 } });
const p = await ctx.newPage();
await p.addInitScript(() => {
  window.__log = [];
  const t0 = performance.now();
  window.addEventListener('toolapis:intro-complete', (e) => {
    window.__log.push({ t: Math.round(performance.now() - t0), ev: 'complete:' + (e.detail && e.detail.reason), cls: document.documentElement.className });
  });
  const tick = () => {
    const d = document.documentElement;
    const o = document.getElementById('intro-overlay');
    const rec = { t: Math.round(performance.now() - t0), cls: d.className, overlay: o ? getComputedStyle(o).display + '/' + getComputedStyle(o).opacity : 'gone' };
    const prev = window.__log[window.__log.length - 1];
    if (!prev || prev.cls !== rec.cls || prev.overlay !== rec.overlay) window.__log.push(rec);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await p.goto('http://127.0.0.1:8765', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(7000);
const log = await p.evaluate(() => window.__log);
for (const r of log) console.log(String(r.t).padStart(6), (r.ev||'').padEnd(20), (r.cls||'').padEnd(52), r.overlay||'');
await b.close();
