import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 530 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8765', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(200);
for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 400); await p.waitForTimeout(40); }
await p.waitForTimeout(6500);
await p.screenshot({ path: '/tmp/shots/intro-scroll/BLANK-wheel-t200.png' });
const buf = await p.screenshot();
console.log('shot bytes', buf.length);
await b.close();
