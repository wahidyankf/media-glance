import assert from "node:assert/strict";
import test from "node:test";
import {
  clampWidth,
  nextWidth,
  parseSavedWidth,
  SIDEBAR_WIDTH_KEY,
  widthLimits,
} from "../../web/sidebar-width.js";

test("sidebar width storage key is the documented media-glance key", () => {
  assert.equal(SIDEBAR_WIDTH_KEY, "media-glance.sidebar-width");
});

test("sidebar width limits span 11rem to the smaller of 40rem and 60 percent of the viewport, defaulting to 17rem", () => {
  assert.deepEqual(widthLimits(1024), { min: 176, max: 614, fallback: 272 });
  assert.deepEqual(widthLimits(1600), { min: 176, max: 640, fallback: 272 });
  assert.deepEqual(widthLimits(1000, 20), {
    min: 220,
    max: 600,
    fallback: 340,
  });
  assert.deepEqual(widthLimits(200), { min: 176, max: 176, fallback: 272 });
});

test("clamping keeps a width inside the limits and rounds it to whole pixels", () => {
  const limits = widthLimits(1024);
  assert.equal(clampWidth(100, limits), 176);
  assert.equal(clampWidth(900, limits), 614);
  assert.equal(clampWidth(300.4, limits), 300);
  assert.equal(clampWidth(300.6, limits), 301);
});

test("a saved width is restored when numeric, clamped when out of range, and ignored when not numeric", () => {
  const limits = widthLimits(1024);
  assert.equal(parseSavedWidth(null, limits), null);
  assert.equal(parseSavedWidth("", limits), null);
  assert.equal(parseSavedWidth("wide", limits), null);
  assert.equal(parseSavedWidth("1e3", limits), null);
  assert.equal(parseSavedWidth("300", limits), 300);
  assert.equal(parseSavedWidth("250.4", limits), 250);
  assert.equal(parseSavedWidth("9999", limits), 614);
  assert.equal(parseSavedWidth("-5", limits), 176);
});

test("keyboard keys step the width by 16px, by 64px with Shift, and jump to the limits on Home and End", () => {
  const limits = widthLimits(1024);
  assert.equal(nextWidth(272, "ArrowRight", false, limits), 288);
  assert.equal(nextWidth(272, "ArrowLeft", false, limits), 256);
  assert.equal(nextWidth(272, "ArrowRight", true, limits), 336);
  assert.equal(nextWidth(272, "ArrowLeft", true, limits), 208);
  assert.equal(nextWidth(180, "ArrowLeft", true, limits), 176);
  assert.equal(nextWidth(600, "ArrowRight", true, limits), 614);
  assert.equal(nextWidth(272, "Home", false, limits), 176);
  assert.equal(nextWidth(272, "End", false, limits), 614);
  assert.equal(nextWidth(272, "a", false, limits), null);
  assert.equal(nextWidth(272, "constructor", false, limits), null);
});
