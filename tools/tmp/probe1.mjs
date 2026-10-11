import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 530 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8765', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(200);
for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 400); await p.waitForTimeout(40); }
await p.waitForTimeout(6500);
console.log(await p.evaluate(() => {
  const html = document.documentElement;
  const cs = getComputedStyle(html);
  return {
    opacity: cs.opacity, visibility: cs.visibility, display: cs.display,
    filter: cs.filter, transform: cs.transform, animation: cs.animationName,
    bodyOpacity: getComputedStyle(document.body).opacity,
    bodyFilter: getComputedStyle(document.body).filter,
    htmlAnims: html.getAnimations().map(a => ({ n: a.animationName || a.constructor.name, st: a.playState, t: a.currentTime })),
    bodyAnims: document.body.getAnimations().map(a => ({ n: a.animationName || a.constructor.name, st: a.playState })),
    canvasBg: cs.backgroundColor,
    scrollY: Math.round(scrollY),
  };
}));
await b.close();
