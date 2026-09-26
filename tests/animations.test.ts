import assert from "node:assert/strict";
import test from "node:test";
import {
  easeOutCubic,
  getMarqueeDirection,
  getMarqueeSpeed,
} from "../src/scripts/animations.ts";

test("the ticker only speeds up, and never past the 6s floor", () => {
  assert.equal(getMarqueeSpeed(0), 22);
  assert.equal(getMarqueeSpeed(5), 17.5);
  assert.equal(getMarqueeSpeed(-5), 17.5, "direction must not affect speed");
  assert.equal(getMarqueeSpeed(20), 6);
  assert.equal(getMarqueeSpeed(400), 6);
});

test("only a decisive upward flick reverses the ticker", () => {
  assert.equal(getMarqueeDirection(0), "normal");
  assert.equal(getMarqueeDirection(-2), "normal", "the threshold itself stays forward");
  assert.equal(getMarqueeDirection(-2.1), "reverse");
  assert.equal(getMarqueeDirection(40), "normal");
});

test("the counter easing starts at zero, lands on one, and never dips", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);

  let previous = 0;
  for (let step = 0; step <= 100; step += 1) {
    const value = easeOutCubic(step / 100);
    assert.ok(value >= 0 && value <= 1);
    assert.ok(value >= previous, `easing went backwards at ${step / 100}`);
    previous = value;
  }
});
