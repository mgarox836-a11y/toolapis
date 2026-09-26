import assert from "node:assert/strict";
import test from "node:test";
import { getEnterProgress, getOrbMetrics } from "../src/portal.ts";

const view = { width: 1600, height: 900 };
const wrap = { left: 200, top: 300 };

test("a centred orb at the box origin reports zero offsets", () => {
  const metrics = getOrbMetrics({ x: 0, y: 0 }, { x: 0, y: 0 }, view, wrap);

  assert.equal(metrics.dx, 600);
  assert.equal(metrics.dy, 150);
  assert.equal(metrics.r, 0);
});

test("offsets are measured from the headline box, not the viewport", () => {
  const centred = getOrbMetrics({ x: 0, y: 0 }, { x: 0, y: 0 }, view, wrap);
  const shifted = getOrbMetrics({ x: 0, y: 0 }, { x: 0, y: 0 }, view, { left: 600, top: 300 });

  assert.equal(shifted.dx - centred.dx, -400);
  assert.equal(shifted.dy, centred.dy);
});

test("NDC y is flipped: +1 is the top of the viewport, not the bottom", () => {
  const top = getOrbMetrics({ x: 0, y: 1 }, { x: 0, y: 1 }, view, wrap);
  const bottom = getOrbMetrics({ x: 0, y: -1 }, { x: 0, y: -1 }, view, wrap);

  assert.equal(top.dy, -300);
  assert.equal(bottom.dy, 600);
});

test("radius mixes both axes, so a wide viewport does not inflate it", () => {
  const square = getOrbMetrics({ x: 0, y: 0 }, { x: 0.2, y: 0.2 }, { width: 900, height: 900 }, { left: 0, top: 0 });
  const wide = getOrbMetrics({ x: 0, y: 0 }, { x: 0.2, y: 0.2 }, { width: 1600, height: 900 }, { left: 0, top: 0 });

  /* The x term triples and the y term is unchanged, so the radius grows but by
     much less than 3x. A single-axis radius would have tripled outright. */
  assert.ok(wide.r > square.r);
  assert.ok(wide.r < square.r * 3);
});

test("the entrance opens from a third scale to full and never overshoots", () => {
  assert.ok(getEnterProgress(0, false) < 0.01);
  assert.equal(getEnterProgress(1.27, false), 1);
  assert.equal(getEnterProgress(99, false), 1);

  let previous = 0;
  for (let step = 0; step <= 100; step += 1) {
    const value = getEnterProgress((step / 100) * 1.27, false);
    assert.ok(value >= 0 && value <= 1);
    assert.ok(value >= previous);
    previous = value;
  }
});

test("reduced motion opens the orb fully formed rather than at zero", () => {
  assert.equal(getEnterProgress(0, true), 1);
  assert.equal(getEnterProgress(Number.NaN, true), 1);
  assert.ok(Number.isFinite(getEnterProgress(Number.NaN, false)));
});
