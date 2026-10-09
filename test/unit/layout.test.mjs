import assert from "node:assert/strict";
import test from "node:test";
import { mediaLayout } from "../../web/media.js";

test("fit shrinks a large diagram to the viewport, preserving its aspect ratio", () => {
  assert.deepEqual(
    mediaLayout({ width: 2400, height: 1200 }, { width: 600, height: 400 }, 1),
    {
      width: 600,
      height: 300,
    },
  );
});

test("media zoom expands real dimensions beyond the fitted viewport", () => {
  assert.deepEqual(
    mediaLayout({ width: 2400, height: 1200 }, { width: 600, height: 400 }, 3),
    {
      width: 1800,
      height: 900,
    },
  );
});

test("fit keeps small images sharp and fits tall diagrams by height", () => {
  assert.deepEqual(
    mediaLayout({ width: 100, height: 50 }, { width: 600, height: 400 }, 1),
    {
      width: 100,
      height: 50,
    },
  );
  assert.deepEqual(
    mediaLayout({ width: 400, height: 1600 }, { width: 600, height: 400 }, 1),
    {
      width: 100,
      height: 400,
    },
  );
});

test("expanded and narrow views independently fit the same media and retain requested zoom", () => {
  const intrinsic = { width: 2400, height: 1200 };
  assert.deepEqual(mediaLayout(intrinsic, { width: 1200, height: 700 }, 2), {
    width: 2400,
    height: 1200,
  });
  assert.deepEqual(mediaLayout(intrinsic, { width: 200, height: 400 }, 2), {
    width: 400,
    height: 200,
  });
});
