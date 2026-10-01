#!/usr/bin/env node
/* no-undef check for the browser modules.
 *
 * Parses each file with @babel/parser (sourceType: module) and walks every
 * identifier reference with @babel/traverse's scope analysis. Anything that is
 * not bound in an enclosing scope and is not a known global is reported.
 *
 *   node tools/no-undef.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const traverseMod = require('@babel/traverse');
const traverse = traverseMod.default || traverseMod;

/* ES2022 + browser globals, plus the two libs the page loads from a CDN tag.
   Anything not in here and not bound locally is an undeclared identifier. */
const GLOBALS = new Set([
  /* ES */
  'globalThis', 'undefined', 'NaN', 'Infinity', 'eval', 'isFinite', 'isNaN',
  'parseFloat', 'parseInt', 'decodeURI', 'decodeURIComponent', 'encodeURI',
  'encodeURIComponent', 'Object', 'Function', 'Boolean', 'Symbol', 'Error',
  'AggregateError', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'TypeError', 'URIError', 'Number', 'BigInt', 'Math', 'Date', 'String',
  'RegExp', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet', 'JSON', 'Proxy',
  'Reflect', 'Promise', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array',
  'Float64Array', 'BigInt64Array', 'BigUint64Array', 'ArrayBuffer', 'DataView',
  'Intl', 'WeakRef', 'FinalizationRegistry', 'SharedArrayBuffer', 'Atomics',
  /* console */
  'console',
  /* timers / scheduling */
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask', 'requestAnimationFrame',
  'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
  /* DOM / window */
  'window', 'document', 'navigator', 'location', 'history', 'screen', 'devicePixelRatio',
  'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'scrollX', 'scrollY',
  'pageXOffset', 'pageYOffset', 'scroll', 'scrollTo', 'scrollBy', 'matchMedia',
  'getComputedStyle', 'requestAnimationFrame', 'performance', 'fetch', 'Headers',
  'Request', 'Response', 'AbortController', 'URL', 'URLSearchParams', 'FormData',
  'Blob', 'File', 'FileReader', 'TextDecoder', 'TextEncoder', 'structuredClone',
  'localStorage', 'sessionStorage', 'indexedDB', 'customElements', 'frames',
  'parent', 'top', 'self', 'visualViewport', 'speechSynthesis', 'ResizeObserver',
  'IntersectionObserver', 'MutationObserver', 'CSS', 'Image', 'Audio', 'Event',
  'CustomEvent', 'EventTarget', 'Node', 'Element', 'HTMLElement', 'SVGElement',
  'getSelection', 'alert', 'confirm', 'prompt', 'open', 'close', 'postMessage',
  'addEventListener', 'removeEventListener', 'dispatchEvent', 'crypto',
  /* Web Animations API — the Animation/CSSAnimation/KeyframeEffect trio the
     intro module feature-detects before touching. */
  'Animation', 'CSSAnimation', 'CSSTransition', 'KeyframeEffect',
  /* loaded from CDN script tags in index.html */
  'Motion', 'PhosphorIcons',
  /* tailwindcss.com CDN sets window.tailwind before its config read in
     script.js (loaded with defer, so the CDN tag has already run). */
  'tailwind',
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  'js/config.js', 'js/intro.js', 'js/objects.js', 'js/reveal.js',
  'js/scene3d.js', 'js/scroll.js', 'script.js',
];

/* `script.js` is a classic script (loaded without type=module), so top-level
   `const` lives on the global lexical scope and every other file's module scope
   is separate. It still parses fine as sourceType: script. */
const SOURCE_TYPE = { 'script.js': 'script' };

let total = 0;
for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  let ast;
  try {
    ast = parse(readFileSync(file, 'utf8'), {
      sourceType: SOURCE_TYPE[rel] || 'module',
      allowReturnOutsideFunction: SOURCE_TYPE[rel] === 'script',
    });
  } catch (err) {
    console.error(`${rel}: parse error: ${err.message}`);
    process.exitCode = 1;
    continue;
  }

  const seen = new Map();
  traverse(ast, {
    ReferencedIdentifier(p) {
      const name = p.node.name;
      if (GLOBALS.has(name)) return;
      if (p.scope.hasBinding(name, /* noGlobals */ true)) return;
      if (!seen.has(name)) seen.set(name, p.node.loc.start.line);
    },
  });

  for (const [name, line] of seen) {
    console.log(`${rel}:${line}  '${name}' is not defined.`);
    total++;
  }
}

if (total) {
  console.log(`\n${total} undeclared identifier${total === 1 ? '' : 's'}.`);
  process.exitCode = 1;
} else {
  console.log('no-undef: clean');
}