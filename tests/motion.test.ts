import assert from "node:assert/strict";
import test from "node:test";
import { getMagneticOffset } from "../src/motion.ts";

test("magnetic displacement follows pointer distance", () => {
  assert.deepEqual(getMagneticOffset(20, 10, 0, 0, 0.25, 18), {
    x: 5,
    y: 2.5,
  });
});

test("magnetic displacement is capped radially", () => {
  const offset = getMagneticOffset(100, 50, 0, 0, 0.5, 18);

  assert.ok(offset.x > 0);
  assert.ok(offset.y > 0);
  assert.ok(Math.abs(Math.hypot(offset.x, offset.y) - 18) < 1e-12);
});

test("magnetic displacement returns to the element center", () => {
  assert.deepEqual(getMagneticOffset(100, 100, 100, 100, 0.3, 18), {
    x: 0,
    y: 0,
  });
});
