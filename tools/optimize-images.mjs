#!/usr/bin/env node
/* Build the two WebP sizes the enhancer card asks for.
 * ImageMagick is already installed; this script adds no dependency.
 *
 *   node tools/optimize-images.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'assets/pexels-ericjo-31973399.jpg');
const MAGICK = existsSync('/usr/bin/magick') ? '/usr/bin/magick' : 'convert';

const VARIANTS = [
  { name: 'enhance-demo-800.webp', width: 800, quality: 76, maxBytes: 100_000 },
  { name: 'enhance-demo-1200.webp', width: 1200, quality: 80, maxBytes: 250_000 },
];

if (!existsSync(SOURCE)) {
  console.error(`missing source: ${SOURCE}`);
  process.exit(1);
}

let failed = false;

for (const { name, width, quality, maxBytes } of VARIANTS) {
  const out = path.join(ROOT, 'assets', name);
  execFileSync(MAGICK, [
    SOURCE,
    '-auto-orient',
    '-strip',
    '-resize', `${width}x`,
    '-colorspace', 'sRGB',
    '-quality', String(quality),
    '-define', 'webp:method=6',
    out,
  ]);

  const size = statSync(out).size;
  const dims = execFileSync(MAGICK, ['identify', '-format', '%wx%h', out], { encoding: 'utf8' });
  const expected = `${width}x${width * 3 / 4}`;
  const okSize = size <= maxBytes;
  const okDims = dims === expected;
  if (!okDims) failed = true;
  if (!okSize) failed = true;

  console.log(
    `${name}: ${dims}, ${size.toLocaleString('en-US')} bytes ` +
    `(${(size / 1000).toFixed(1)} KB) — ${okDims ? 'dimensions ok' : `expected ${expected}`}, ` +
    `${okSize ? 'within' : 'OVER'} ${(maxBytes / 1000).toFixed(0)} KB`,
  );
}

process.exitCode = failed ? 1 : 0;
