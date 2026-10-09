import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloads, installTools, sha256 } from "../../scripts/tools.mjs";
const body = Buffer.from("synthetic archive");
const entries = [
  {
    name: "source",
    url: "https://example.invalid/source",
    sha: sha256(body),
    type: "tar",
    strip: true,
    destination: "luacov",
  },
  {
    name: "server",
    url: "https://example.invalid/server",
    sha: sha256(body),
    type: "tar",
    strip: false,
    destination: "lua-language-server",
  },
  {
    name: "style",
    url: "https://example.invalid/style",
    sha: sha256(body),
    type: "zip",
    destination: "bin",
  },
];
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "media-glance-tools-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
function runner(calls) {
  return (command, args) => {
    calls.push({ command, args });
    if (command === "curl") writeFileSync(args.at(-1), body);
    if (command === "unzip")
      writeFileSync(join(args.at(-1), "stylua"), "synthetic binary");
    return { status: 0 };
  };
}
test("development tool manifests cover the four supported platforms with pinned SHA checksums", () => {
  for (const [platform, arch] of [
    ["linux", "x64"],
    ["linux", "arm64"],
    ["darwin", "x64"],
    ["darwin", "arm64"],
  ])
    for (const entry of downloads(platform, arch)) {
      assert.match(entry.sha, /^[a-f0-9]{64}$/);
      assert.match(entry.url, /^https:/);
    }
  assert.throws(() => downloads("win32", "x64"), /Unsupported/);
  assert.equal(
    sha256("a"),
    "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
  );
});
test("explicit development setup verifies bytes before extracting and always cleans its staging directory", () =>
  fixture((root) => {
    const calls = [];
    const location = installTools(root, { entries, run: runner(calls) });
    assert.equal(location, join(root, ".deps"));
    assert.ok(existsSync(join(location, "bin/stylua")));
    assert.equal(calls.filter((c) => c.command === "curl").length, 3);
    assert.ok(calls.some((c) => c.args.includes("--strip-components=1")));
  }));
test("setup fails closed for bad downloads, extraction, spawn and unsupported hosts", () =>
  fixture((root) => {
    const calls = [];
    assert.throws(
      () =>
        installTools(root, {
          entries: [{ ...entries[0], sha: "wrong" }],
          run: runner(calls),
        }),
      /checksum/,
    );
    assert.equal(calls.length, 1);
    assert.throws(
      () =>
        installTools(root, {
          entries,
          run: () => ({ error: new Error("spawn failure") }),
        }),
      /spawn failure/,
    );
    assert.throws(
      () => installTools(root, { entries, run: () => ({ status: null }) }),
      /without a status/,
    );
    const success = runner([]);
    assert.throws(
      () =>
        installTools(root, {
          entries,
          run: (command, args) =>
            command === "tar" ? { status: 2 } : success(command, args),
        }),
      /tar exited 2/,
    );
    assert.throws(
      () => installTools(root, { platform: "win32", arch: "x64" }),
      /Unsupported/,
    );
    mkdirSync(join(root, ".deps/bin"), { recursive: true });
    writeFileSync(join(root, ".deps/bin/stylua"), "existing");
    assert.equal(
      installTools(root, { entries: [], run: success }),
      join(root, ".deps"),
    );
  }));
