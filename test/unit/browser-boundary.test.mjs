import assert from "node:assert/strict";
import test from "node:test";
import { validateFixture } from "../browser/journey.mjs";
const valid = {
  type: "owned-media-viewer-browser-fixture",
  version: 1,
  runId: "12345678-1234-1234-1234-123456789abc",
  viewerUrl:
    "http://127.0.0.1:57300/v/" +
    "a".repeat(64) +
    "/?file=zz-selected%2Fnested%2Fcurrent.md",
  initialFile: "zz-selected/nested/current.md",
};
test("fixture URL preserves exactly its declared focused file and rejects additional query parameters", () => {
  const fixture = new URL("http://127.0.0.1:12345/");
  validateFixture(valid, fixture);
  for (const search of [
    "",
    "?file=wrong.md",
    "?file=zz-selected%2Fnested%2Fcurrent.md&extra=1",
    "?file=zz-selected%2Fnested%2Fcurrent.md&file=duplicate",
  ]) {
    const url = new URL(valid.viewerUrl);
    url.search = search;
    assert.throws(
      () => validateFixture({ ...valid, viewerUrl: url.href }, fixture),
      /invalid/,
    );
  }
  assert.throws(
    () => validateFixture(valid, new URL("https://example.invalid/")),
    /loopback/,
  );
});
