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
  return { attr: html.getAttribute('style'), cls: html.className,
    bodyAttr: document.body.getAttribute('style'), bodyCls: document.body.className };
}));
const cdp = await ctx.newCDPSession(p);
const r = await cdp.send('CSS.enable');
const m = await cdp.send('CSS.getMatchedStylesForNode', { nodeId: (await cdp.send('DOM.getDocument')).root.nodeId });
for (const e of m.matchedCSSRules || []) {
  const decls = e.rule.style.cssProperties.filter(x => /opacity|display|transform|background/.test(x.name));
  if (decls.length) console.log(e.rule.selectorList.text, '=>', decls.map(d => d.name + ':' + d.value).join('; '), 'media:', JSON.stringify(e.rule.media||[]));
}
for (const s of m.inlineStyle || []) {
  console.log('INLINE =>', s.cssProperties.map(d=>d.name+':'+d.value).join('; '));
}
await b.close();
