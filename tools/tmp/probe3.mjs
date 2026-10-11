import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 530 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8765', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(200);
for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 400); await p.waitForTimeout(40); }
await p.waitForTimeout(6500);
const cdp = await ctx.newCDPSession(p);
await cdp.send('DOM.enable');
await cdp.send('CSS.enable');
const doc = await cdp.send('DOM.getDocument');
const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'html' });
const m = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
for (const e of m.matchedCSSRules || []) {
  const decls = e.rule.style.cssProperties.filter(x => /^(opacity|display|transform|background-color)$/.test(x.name));
  if (decls.length) console.log(e.rule.selectorList.text, '=>', decls.map(d => d.name + ':' + d.value).join('; '));
}
for (const s of m.inlineStyle || []) console.log('INLINE =>', s.cssProperties.map(d=>d.name+':'+d.value).join('; '));
await b.close();
