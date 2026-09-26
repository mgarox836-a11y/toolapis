import assert from "node:assert/strict";
import test from "node:test";
import { getSectionProgress } from "../src/scroll.ts";

const VIEWPORT = 800;

test("progress is zero when the element only just touches the bottom", () => {
  assert.equal(getSectionProgress(VIEWPORT, 500, VIEWPORT), 0);
});

test("progress is one once the element has cleared the top of the viewport", () => {
  assert.equal(getSectionProgress(-500, 500, VIEWPORT), 1);
});

test("progress climbs monotonically as the element rises through the screen", () => {
  let previous = -1;

  for (let top = VIEWPORT; top >= -500; top -= 10) {
    const progress = getSectionProgress(top, 500, VIEWPORT);

    assert.ok(progress >= 0 && progress <= 1, `out of range at top ${top}`);
    assert.ok(progress >= previous, `progress went backwards at top ${top}`);
    previous = progress;
  }
});

test("an element fully on screen at load is already past halfway", () => {
  // A 500px block whose top is at the top of an 800px viewport has travelled
  // 800 of its 1300px span, so it is well past the halfway point. This is the
  // case that would leave a pinned track showing the wrong panel on arrival.
  assert.ok(getSectionProgress(0, 500, VIEWPORT) > 0.5);
});

test("degenerate geometry reads as finished rather than dividing by zero", () => {
  assert.equal(getSectionProgress(0, 0, 0), 1);
  assert.equal(getSectionProgress(0, 0, VIEWPORT), 1);
});
