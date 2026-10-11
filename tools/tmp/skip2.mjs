import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true });
for (const [how, delay] of [['button',2200],['button',300]]) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 530 } });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8765', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.documentElement.classList.contains('intro-active'), null, {timeout:4000});
  await p.waitForTimeout(delay);
  const t0 = Date.now();
  try {
    if (how === 'button') await p.locator('#intro-skip').click({ timeout: 3000 });
    else await p.keyboard.press(how);
  } catch (e) { console.log(how, delay, 'CLICK FAILED', e.message.split('\n')[0]); await ctx.close(); continue; }
  const took = Date.now() - t0;
  await p.waitForFunction(() => !document.documentElement.classList.contains('intro-active'), null, {timeout:4000}).catch(()=>{});
  console.log(how, delay, 'input', took+'ms', 'handover', (Date.now()-t0)+'ms');
  await ctx.close();
}
await b.close();
