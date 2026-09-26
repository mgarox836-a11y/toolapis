import assert from "node:assert/strict";
import test from "node:test";
import { getResponsiveCameraConfig } from "../src/portal.ts";

test("desktop keeps the portal full scale and right-weighted", () => {
  const config = getResponsiveCameraConfig(1440, 900);

  assert.equal(config.fov, 44);
  assert.equal(config.cameraZ, 6);
  assert.equal(config.portalY, 0);
  assert.equal(config.portalScale, 1);
  assert.ok(config.portalX > 0.6 && config.portalX < 0.9);
});

test("portrait viewports widen the camera and pull the portal above copy", () => {
  const config = getResponsiveCameraConfig(390, 844);

  assert.equal(config.fov, 62);
  assert.equal(config.cameraZ, 6.7);
  assert.equal(config.portalX, 0);
  assert.equal(config.portalY, 1.25);
  assert.ok(config.portalScale < 0.8);
});

test("short landscape and low-power devices stay bounded", () => {
  const landscape = getResponsiveCameraConfig(844, 390);
  const lowPower = getResponsiveCameraConfig(1440, 900, true);

  assert.equal(landscape.fov, 47);
  assert.equal(landscape.portalScale, 0.82);
  assert.equal(lowPower.pixelRatioCap, 1.15);
  assert.ok(Number.isFinite(getResponsiveCameraConfig(0, 0).fov));
});
