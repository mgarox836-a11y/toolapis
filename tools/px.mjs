#!/usr/bin/env node
/* ============================================================================
 * tools/px.mjs — read pixels out of a PNG, no dependencies.
 * ----------------------------------------------------------------------------
 * Used to PROVE there is no hard line between the hero and the section under
 * it: a "no visible seam" claim is a measurement, not a judgement call, so this
 * decodes a screenshot and reports, for one vertical column, the per-row colour
 * and the delta between consecutive rows. A hard edge is a single row whose
 * delta spikes; a gradient is many rows each a step or two.
 *
 *   node tools/px.mjs shot.png 700 760 --step 10
 *   node tools/px.mjs shot.png 0 900 --cols 60,720,1380 --max 400
 *
 * Supports what Chromium's screenshot actually emits: 8-bit truecolour, with or
 * without an alpha channel, non-interlaced.
 * ==========================================================================*/

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const argv = process.argv.slice(2);
const file = argv[0];
const from = Number(argv[1] ?? 0);
const to = Number(argv[2] ?? 0);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const step = Number(arg('step', 1));
const cols = String(arg('cols', '')).split(',').filter(Boolean).map(Number);
const max = Number(arg('max', 200));

if (!file) { console.error('usage: px.mjs <png> <fromRow> <toRow> [--step n] [--cols a,b] [--max n]'); process.exit(1); }

const buf = readFileSync(file);

/* ---- chunk walk ------------------------------------------------------- */
let pos = 8;
let ihdr = null;
const idat = [];
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString('ascii', pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + len);
  if (type === 'IHDR') {
    ihdr = {
      width: data.readUInt32BE(0),
      height: data.readUInt32BE(4),
      depth: data[8],
      colorType: data[9],
      interlace: data[12],
    };
  } else if (type === 'IDAT') idat.push(data);
  else if (type === 'IEND') break;
  pos += 12 + len;
}

if (!ihdr) { console.error('no IHDR'); process.exit(1); }
if (ihdr.depth !== 8) { console.error('only 8-bit supported, got ' + ihdr.depth); process.exit(1); }
if (ihdr.interlace !== 0) { console.error('interlaced PNG not supported'); process.exit(1); }

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType];
if (!CHANNELS) { console.error('unsupported colour type ' + ihdr.colorType); process.exit(1); }

const raw = inflateSync(Buffer.concat(idat));
const { width, height } = ihdr;
const stride = width * CHANNELS;
const px = Buffer.alloc(height * stride);

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/* ---- un-filter, one scanline at a time --------------------------------- */
let ri = 0;
for (let y = 0; y < height; y++) {
  const filter = raw[ri++];
  const line = raw.subarray(ri, ri + stride);
  ri += stride;
  const out = px.subarray(y * stride, (y + 1) * stride);
  const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
  for (let x = 0; x < stride; x++) {
    const a = x >= CHANNELS ? out[x - CHANNELS] : 0;
    const b = prev ? prev[x] : 0;
    const c = prev && x >= CHANNELS ? prev[x - CHANNELS] : 0;
    const v = line[x];
    switch (filter) {
      case 0: out[x] = v; break;
      case 1: out[x] = (v + a) & 0xff; break;
      case 2: out[x] = (v + b) & 0xff; break;
      case 3: out[x] = (v + ((a + b) >> 1)) & 0xff; break;
      case 4: out[x] = (v + paeth(a, b, c)) & 0xff; break;
      default: console.error('bad filter ' + filter + ' on row ' + y); process.exit(1);
    }
  }
}

/* ---- sample ------------------------------------------------------------ */
const at = (x, y) => {
  const i = y * stride + x * CHANNELS;
  return [px[i], px[i + 1] + 0, px[i + 2]];
};

const COLS = cols.length ? cols : [Math.floor(width / 2)];

console.log(`${file}  ${width}x${height}  colourType=${ihdr.colorType}`);
console.log(`column(s): ${COLS.join(', ')}   rows ${from}..${to} step ${step}`);

let prev = null;
const rows = [];
for (let y = from; y <= Math.min(to, height - 1); y += step) {
  const colsRGB = COLS.map((x) => {
    const c = at(Math.max(0, Math.min(width - 1, x)), y);
    return c;
  });
  const mean = colsRGB.reduce((a, c) => a + (c[0] + c[1] + c[2]) / 3, 0) / colsRGB.length;
  if (prev !== null) {
    const d = colsRGB.map((c, i) => Math.abs(c[0] - prev[i][0]) + Math.abs(c[1] - prev[i][1]) + Math.abs(c[2] - prev[i][2]));
    rows.push({ y, mean: +mean.toFixed(2), d });
  }
  prev = colsRGB;
  if (step === 1 || y === from || y === Math.min(to, height - 1)) {
    const s = colsRGB.map((c) => `rgb(${c.join(',')})`).join('  ');
    console.log(`y=${String(y).padStart(5)}  ${s}  mean=${mean.toFixed(1)}`);
  }
}

if (rows.length) {
  const worst = rows.slice().sort((a, b) => Math.max(...b.d) - Math.max(...a.d))[0];
  console.log('\n-- biggest row-to-row jumps in the sampled range --');
  rows.slice().sort((a, b) => Math.max(...b.d) - Math.max(...a.d)).slice(0, 8)
    .forEach((r) => console.log(`y=${r.y}  maxDelta=${Math.max(...r.d)}  (per-col ${r.d.join('/')})`));
  console.log(`\nworst single-row jump: ${Math.max(...worst.d)} at y=${worst.y}`);
}