import assert from "node:assert/strict";
import test from "node:test";
import { getSectionProgress, getStickyProgress } from "../src/scroll.ts";

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

/* ── The sticky window ──────────────────────────────────────────────────── */

/* A 300vh runway with a 100vh stage: 200vh of travel, two panel transitions. */
const RUNWAY = VIEWPORT * 3;
const TRAVEL = RUNWAY - VIEWPORT;

test("the pin engages at zero, not at a quarter of the way across", () => {
  // The exact failure this function exists to avoid. At the moment the section
  // reaches the top of the screen the stage has not moved, so the rail must
  // still read zero.
  assert.equal(getStickyProgress(0, RUNWAY, VIEWPORT), 0);
  assert.equal(
    getSectionProgress(0, RUNWAY, VIEWPORT),
    0.25,
    "the generic mapping is a quarter done before the pin even engages",
  );
});

test("the pin releases at one, halfway through the runway it is not moving", () => {
  assert.equal(getStickyProgress(-TRAVEL, RUNWAY, VIEWPORT), 1);
  // The generic mapping calls this only 0.75 done, which leaves the last panel
  // a quarter unreached and then a stretch of dead scroll.
  assert.ok(Math.abs(getSectionProgress(-TRAVEL, RUNWAY, VIEWPORT) - 0.75) < 1e-9);
});

test("sticky progress is half way at half the travel", () => {
  assert.equal(getStickyProgress(-TRAVEL / 2, RUNWAY, VIEWPORT), 0.5);
});

test("before the pin and after the release both clamp to the ends", () => {
  assert.equal(getStickyProgress(VIEWPORT, RUNWAY, VIEWPORT), 0, "not arrived yet");
  assert.equal(getStickyProgress(-RUNWAY, RUNWAY, VIEWPORT), 1, "long gone");
});

test("sticky progress climbs monotonically", () => {
  let previous = -1;
  for (let top = VIEWPORT; top >= -RUNWAY; top -= 20) {
    const p = getStickyProgress(top, RUNWAY, VIEWPORT);
    assert.ok(p >= 0 && p <= 1, `out of range at top ${top}`);
    assert.ok(p >= previous, `went backwards at top ${top}`);
    previous = p;
  }
});

test("a runway with no travel reports finished rather than dividing by zero", () => {
  // No runway means no pin is possible. The carousel fallback is what makes that
  // state usable, so reporting 1 here keeps the rail from pretending otherwise.
  assert.equal(getStickyProgress(0, VIEWPORT, VIEWPORT), 1);
  assert.equal(getStickyProgress(0, VIEWPORT / 2, VIEWPORT), 1);
});

