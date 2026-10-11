import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 530 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8765', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(7000);
console.log(await p.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('[data-load-reveal], .word-reveal')) {
    for (const a of el.getAnimations()) {
      const t = a.effect.getComputedTiming();
      out.push([a.animationName, el.tagName + '.' + String(el.className).slice(0,20), 'start=' + Math.round(a.startTime), 'dur=' + t.duration, 'delay=' + Math.round(t.delay||0), 'end=' + Math.round(a.startTime + t.endTime)]);
    }
  }
  return out.sort((x,y)=>x[5]-y[5]);
}));
await b.close();
