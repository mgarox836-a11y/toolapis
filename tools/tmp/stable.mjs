import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 530 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8765', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => document.documentElement.classList.contains('intro-active'), null, {timeout:4000});
const rects = await p.evaluate(async () => {
  const out = [];
  const el = document.getElementById('intro-skip');
  const t0 = performance.now();
  while (performance.now() - t0 < 2400) {
    const r = el.getBoundingClientRect();
    out.push([Math.round(performance.now()-t0), Math.round(r.x*100)/100, Math.round(r.y*100)/100, Math.round(r.width*100)/100, Math.round(r.height*100)/100]);
    await new Promise(r2 => requestAnimationFrame(r2));
  }
  return out;
});
const uniq = [];
for (const r of rects) { const k = r.slice(1).join(','); if (!uniq.length || uniq[uniq.length-1][0] !== k) uniq.push([k, r[0]]); }
console.log('distinct rects (x,y,w,h -> first seen at ms):');
for (const u of uniq.slice(0, 20)) console.log('  ', u[0], '→', u[1]);
await b.close();
