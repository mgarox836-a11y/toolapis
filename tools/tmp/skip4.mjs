import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 530 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8765', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => document.documentElement.classList.contains('intro-active'), null, {timeout:4000});
await p.waitForTimeout(2200);
console.log(await p.evaluate(() => ({
  btn: !!document.getElementById('intro-skip'),
  overlay: !!document.getElementById('intro-overlay'),
  cls: document.documentElement.className,
})));
await b.close();
