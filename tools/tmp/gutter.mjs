import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 530 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8765', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6500);
const read = () => p.evaluate(() => {
  const d = document.documentElement;
  const shell = document.querySelector('.shell');
  const r = shell ? shell.getBoundingClientRect() : null;
  return { clientW: d.clientWidth, innerW: innerWidth, overflow: getComputedStyle(d).overflow,
    gutter: getComputedStyle(d).scrollbarGutter,
    shellLeft: r && Math.round(r.left), shellW: r && Math.round(r.width),
    centreOff: r ? Math.round((r.left + r.width/2) - innerWidth/2) : null };
});
console.log('baseline           ', await read());
await p.addStyleTag({ content: 'html{overflow:hidden !important}' });
await p.waitForTimeout(120);
console.log('overflow:hidden    ', await read());
await p.addStyleTag({ content: 'html{scrollbar-gutter:stable}' });
await p.waitForTimeout(120);
console.log('hidden+gutter:stab ', await read());
await p.addStyleTag({ content: 'html{overflow:auto !important}' });
await p.waitForTimeout(120);
console.log('auto+gutter:stable ', await read());
await p.addStyleTag({ content: 'html{overflow:hidden !important}' });
await p.waitForTimeout(120);
console.log('hidden+gutter again', await read());
await b.close();
