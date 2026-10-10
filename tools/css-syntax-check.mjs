#!/usr/bin/env node
/* ============================================================================
 * tools/css-syntax-check.mjs — is css/ actually parseable?
 * ----------------------------------------------------------------------------
 * Added after a single missing comment terminator in css/hero.css silently
 * swallowed every rule after it, including `.hero-title`, so the hero headline
 * fell back to the UA default h1 size (32px) on every viewport below 1024px.
 *
 * Nothing caught it. The build succeeded, the staleness check said the bundle
 * was current, and every Playwright assertion still passed: no overflow, no
 * console errors, every touch target 44px or more. The failure mode of an
 * unterminated CSS comment is not a broken page. It is a page that is quietly
 * missing half its stylesheet, which is considerably harder to notice.
 *
 * So these are the checks a stylesheet build cannot do:
 *
 *   1. every block comment is closed, in the right order
 *   2. braces balance across each source file
 *   3. every declaration inside a rule is `prop: value`, because a declaration
 *      the parser rejects shows up as an empty rule
 *   4. the shipped bundle is parsed by a REAL browser and the rule count it
 *      reports matches the rule count in the file
 *
 * (4) is the one that matters. Only a CSS parser knows what a browser knows.
 * ===========================================================================*/

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* The source list is build-css.mjs's SOURCES, not a second copy of it. This
 * file used to hardcode the same eight names, which is exactly the drift the
 * tool exists to catch: adding css/section-bg.css to the build left this
 * checker reading eight files and reporting eight passes while saying nothing
 * about the ninth. The browser parse below still covered the new file through
 * the bundle, so nothing shipped broken — but a checker that silently skips the
 * file you just added is a checker you stop trusting. One list, one owner. */
const { SOURCES } = await import('./build-css.mjs');
const SRC = SOURCES.map((n) => path.join(ROOT, 'css', n));

let failures = 0;
const fail = (file, msg) => { failures++; console.log(`  FAIL  ${path.basename(file)}: ${msg}`); };
const pass = (file, msg) => console.log(`  PASS  ${msg}`);

/* -- 1 & 2: comment balance and brace balance, per source file ---------------- */
console.log('\n=== css/ source files ===');
for (const file of SRC) {
  const s = readFileSync(file, 'utf8');
  const name = path.basename(file);

  // Comment balance, tracking order.
  const stack = [];
  let i = 0, line = 1;
  while (i < s.length) {
    if (s.startsWith('/*', i)) { stack.push(line); i += 2; continue; }
    if (s.startsWith('*/', i)) {
      if (!stack.length) { fail(name, `stray */ on line ${line}`); break; }
      stack.pop(); i += 2; continue;
    }
    if (s[i] === '\n') line++;
    i++;
  }
  if (stack.length) {
    fail(name, `unterminated /* opened on line ${stack[stack.length - 1]} — every rule after it is dropped by the parser`);
  }

  // Brace balance, ignoring braces inside comments.
  const noComments = s.replace(/\/\*[\s\S]*?\*\//g, '');
  const open = (noComments.match(/\{/g) || []).length;
  const close = (noComments.match(/\}/g) || []).length;
  if (open !== close) fail(name, `brace imbalance: ${open} { vs ${close} }`);
  else if (!stack.length) pass(name, `${open} rules, comments closed`);
}

/* -- 3: every declaration is `prop: value` ------------------------------------ */
console.log('\n=== declaration syntax ===');
for (const file of SRC) {
  const s = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const name = path.basename(file);
  let bad = 0;
  // Split top-level rule bodies. This is deliberately crude: it is looking for
  // declarations that lost their colon or their semicolon, which is the shape
  // a truncated or mis-pasted declaration takes.
  for (const m of s.matchAll(/\{([^{}]*)\}/g)) {
    const body = m[1];
    if (!body.trim()) continue;
    // at-rules and nested blocks are skipped by the [^{}] guard above; anything
    // left should be a run of `prop: value;` declarations.
    for (const decl of body.split(';')) {
      const d = decl.trim();
      if (!d) continue;
      if (d.startsWith('@')) continue;            // nested at-rule
      if (!d.includes(':')) { bad++; if (bad <= 3) fail(name, `declaration without a colon: "${d.slice(0, 60)}"`); }
    }
  }
  if (!bad) pass(name, 'every declaration is `prop: value`');
}

/* -- 4: the browser's own parse of the shipped bundle ------------------------- */
const bundle = readFileSync(path.join(ROOT, 'css', 'bundle.css'), 'utf8');
const expectedRules = (() => {
  /* Count rule blocks the way a parser does. A recursive scan rather than a
     regex, because ~a third of this bundle's rules live INSIDE `@media` blocks
     — a flat count that skipped at-rule bodies reported 410 against the
     browser's 488 and reported the difference as "78 rules dropped", which is
     the exact false alarm this check exists to avoid.

     On every `{`: whatever selector has accumulated since the last block is a
     rule unless it starts with `@` (an at-rule is a block, not a style rule).
     Then keep scanning INSIDE the body, so rules nested in `@media` are counted.

     Two at-rules are descended-into-never, because the browser does not report
     their contents as style rules either and counting them puts the two totals
     on different definitions:
       @keyframes  — the `from` / `to` / `0%` steps are CSSKeyframesRule
                     children, and none of them has a `selectorText`
       @property   — the block declares custom-property metadata, not a rule

     It also drops VENDOR-PREFIXED selectors, because Chromium parses
     `::-webkit-scrollbar` and `::-moz-range-thumb` differently: Chrome keeps
     the webkit one and discards the moz one, Firefox the reverse. Neither
     browser "dropped" them — they are addressed to an engine that supports
     them, and this project ships both on purpose. */
  const s = bundle.replace(/\/\*[\s\S]*?\*\//g, '');
  const VENDOR = /::?-(webkit|moz|ms|o)-/i;
  let n = 0, buf = '', i = 0;
  const skipBody = (from) => {
    let depth = 1; let j = from;
    while (j < s.length && depth > 0) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') depth--;
      j++;
    }
    return j;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '{') {
      const sel = buf.trim();
      buf = '';
      if (/^@(keyframes|-webkit-keyframes|property)/i.test(sel)) { i = skipBody(i + 1); continue; }
      if (sel && !sel.startsWith('@') && !VENDOR.test(sel)) n++;
      i++;
      continue;
    }
    if (c === '}') { buf = ''; i++; continue; }
    buf += c; i++;
  }
  return n;
})();

console.log('\n=== browser parse of css/bundle.css ===');
let chromium = null, exe = null;
for (const p of ['/usr/bin/brave', '/usr/bin/brave-browser', '/usr/bin/chromium',
                 '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome']) {
  try { readFileSync(p); exe = p; break; } catch { /* next */ }
}
if (exe) {
  try {
    const pw = (await import('playwright-core')).default;
    chromium = pw.chromium;
  } catch { chromium = null; }
}
if (chromium && exe) {
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  /* The bundle is INLINED rather than linked. A `file://` stylesheet is blocked
     from the `about:blank` origin that `setContent` produces, which reports as
     "0 rules parsed" and looks like a catastrophic failure rather than a
     harness bug. The bytes handed to the parser are identical either way —
     a `<style>` element and a linked sheet go through the same CSS parser. */
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${bundle}</style>`);
  const got = await page.evaluate((vendorSrc) => {
    const vendor = new RegExp(vendorSrc, 'i');
    let n = 0, dropped = [];
    /* NESTING AT-RULES. `CSSContainerRule` is in this list because
       css/components.css grew its first `@container` blocks in the fluid pass,
       and the walker knew only MEDIA and SUPPORTS — so every rule inside a
       container query was invisible to the count and the tool reported "7 were
       dropped by the parser" for a sheet that parses perfectly.

       That is the failure mode this whole tool exists to prevent, pointed at
       itself: a silent under-count reads as a broken stylesheet, and the only
       available response is to go looking for a syntax error that is not
       there. `CSSContainerRule` is looked up by NAME rather than by
       `CSSRule.CONTAINER_RULE` because on an engine without container queries
       the constant is undefined and the comparison would silently never match
       again. */
    const NESTED = ['media', 'supports', 'container', 'layer', 'scope'];
    const isNested = (r) => NESTED.some((k) => r.constructor && r.constructor.name.toLowerCase().endsWith(k + 'rule'));
    const walk = (rs) => { for (const r of rs) {
      if (isNested(r) && r.cssRules) { walk(r.cssRules); continue; }
      if (!r.selectorText) continue;
      if (vendor.test(r.selectorText)) continue;
      n++;
      if (r.style && r.style.length === 0) dropped.push(r.selectorText);
    } };
    for (const s of document.styleSheets) { try { walk(s.cssRules); } catch { /* blocked */ } }
    return { n, dropped };
  }, '::?-(webkit|moz|ms|o)-');
  if (got.n === 0) {
    fail('bundle.css', 'browser reported 0 rules — the sheet did not parse at all');
  } else if (got.n !== expectedRules) {
    fail('bundle.css', `browser parsed ${got.n} rules, file has ${expectedRules} — ${expectedRules - got.n} were dropped by the parser`);
  } else {
    pass('bundle.css', `browser parsed all ${got.n} rules`);
  }
  if (got.dropped.length) {
    fail('bundle.css', `${got.dropped.length} rule(s) parsed to an EMPTY style block (declaration syntax error): ${got.dropped.slice(0, 5).join(' , ')}`);
  }
  await browser.close();
} else {
  console.log('  SKIP  no browser available for the parse check');
}

console.log(failures ? `\n${failures} syntax failure(s)\n` : '\nall css/ sources parse cleanly\n');
process.exit(failures ? 1 : 0);