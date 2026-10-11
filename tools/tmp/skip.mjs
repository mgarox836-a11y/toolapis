import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true });
for (const how of ['button','Escape','Enter','Space']) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 530 } });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8765', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.documentElement.classList.contains('intro-active'), null, {timeout:4000});
  await p.waitForTimeout(300);
  const box = await p.locator('#intro-skip').boundingBox().catch(()=>null);
  const t0 = Date.now();
  if (how === 'button') await p.locator('#intro-skip').click({ timeout: 4000 });
  else await p.keyboard.press(how);
  const clicked = Date.now() - t0;
  await p.waitForFunction(() => !document.documentElement.classList.contains('intro-active'), null, {timeout:4000}).catch(()=>{});
  console.log(how.padEnd(9), 'input took', String(clicked).padStart(5)+'ms', '→ handover', String(Date.now()-t0).padStart(5)+'ms', 'box', JSON.stringify(box));
  await ctx.close();
}
await b.close();
