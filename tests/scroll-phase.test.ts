import assert from "node:assert/strict";
import test from "node:test";
import { getScrollPhase } from "../src/portal.ts";

test("progress 0 is the untouched opening frame", () => {
  const phase = getScrollPhase(0);

  assert.deepEqual(phase, { centring: 0, approach: 0, departure: 0, pointerFade: 1, dissolve: 0 });
});

test("the four narrative windows are reached in order", () => {
  const centring = getScrollPhase(0.5);
  const departure = getScrollPhase(0.84);
  const dissolve = getScrollPhase(1);

  assert.equal(centring.centring, 1);
  assert.ok(centring.dissolve < 1);
  assert.ok(departure.departure > 0 && departure.departure < 1);
  assert.equal(dissolve.dissolve, 1);
  assert.equal(dissolve.pointerFade, 0);
});

test("every channel stays inside 0..1 and moves only one way", () => {
  const rising = ["centring", "approach", "departure", "dissolve"] as const;
  const falling = ["pointerFade"] as const;
  let previous = getScrollPhase(0);

  for (let step = 1; step <= 100; step += 1) {
    const phase = getScrollPhase(step / 100);
    const before = previous as Record<string, number>;

    for (const channel of [...rising, ...falling]) {
      const value = phase[channel];

      assert.ok(value >= 0 && value <= 1, `${channel} out of range at ${step / 100}`);
      assert.ok(rising.includes(channel as (typeof rising)[number]) ? value >= before[channel] - 1e-9 : value <= before[channel] + 1e-9, `${channel} moved the wrong way at ${step / 100}`);
    }

    previous = phase;
  }
});

test("out-of-range input from a browser is clamped, not extrapolated", () => {
  assert.deepEqual(getScrollPhase(-3), getScrollPhase(0));
  assert.deepEqual(getScrollPhase(1.8), getScrollPhase(1));
  assert.ok(Number.isFinite(getScrollPhase(Number.NaN).approach));
});
