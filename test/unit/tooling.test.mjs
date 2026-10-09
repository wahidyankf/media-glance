import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inventory,
  checked,
  vendor,
  build,
  release,
  checkCoverage,
  dispatch,
  main,
} from "../../scripts/tooling.mjs";
const ok = () => ({ status: 0, stdout: "" });
function scratch(fn) {
  const dir = mkdtempSync(join(tmpdir(), "media-glance-unit-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function source(root) {
  for (const dir of [
    "scripts",
    "web",
    "lua",
    "internal",
    "node_modules",
    "test/lua",
  ])
    mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "web/app.js"), "");
  writeFileSync(join(root, "scripts/tool.mjs"), "");
  writeFileSync(join(root, "lua/init.lua"), "");
  writeFileSync(join(root, "main.go"), "");
  writeFileSync(join(root, "main_test.go"), "");
}
function reports(root, alter = {}) {
  mkdirSync(join(root, ".coverage/js"), { recursive: true });
  writeFileSync(
    join(root, ".coverage/go.out"),
    alter.go ??
      "mode: set\ngithub.com/wahidyankf/media-glance/main.go:1.1,1.2 100 1\n",
  );
  writeFileSync(
    join(root, ".coverage/lua.json"),
    JSON.stringify(
      alter.lua ?? { files: { "lua/init.lua": { covered: 99, total: 100 } } },
    ),
  );
  writeFileSync(
    join(root, ".coverage/js/coverage-summary.json"),
    JSON.stringify(
      alter.js ?? {
        total: {},
        [join(root, "web/app.js")]: { lines: { covered: 99, total: 100 } },
        [join(root, "scripts/tool.mjs")]: {
          lines: { covered: 100, total: 100 },
        },
      },
    ),
  );
}
function vendorFixture(root) {
  source(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      devDependencies: { mermaid: "11.16.1", katex: "0.18.3" },
    }),
  );
  for (const name of ["mermaid", "katex"]) {
    mkdirSync(join(root, "node_modules", name, "dist"), { recursive: true });
    writeFileSync(
      join(root, "node_modules", name, "package.json"),
      JSON.stringify({ version: name === "mermaid" ? "11.16.1" : "0.18.3" }),
    );
  }
  mkdirSync(join(root, "node_modules/mermaid/dist/chunks/mermaid.esm.min"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "node_modules/mermaid/dist/mermaid.esm.min.mjs"),
    "graph",
  );
  writeFileSync(
    join(
      root,
      "node_modules/mermaid/dist/chunks/mermaid.esm.min/katex-C5OPUE3Q.mjs",
    ),
    "old",
  );
  writeFileSync(
    join(root, "node_modules/katex/dist/katex.mjs"),
    'var version = "0.18.3";',
  );
}

test("coverage uses raw independent metrics and rejects every language below threshold", () =>
  scratch((root) => {
    source(root);
    reports(root);
    const result = checkCoverage(root, 0);
    assert.equal(result.lua.percent, 99);
    assert.equal(result.js.total, 200);
    for (const lang of ["go", "lua", "js"]) {
      const bad =
        lang === "go"
          ? {
              go: "mode: set\ngithub.com/wahidyankf/media-glance/main.go:1.1,1.2 98 1\ngithub.com/wahidyankf/media-glance/main.go:2.1,2.2 2 0\n",
            }
          : lang === "lua"
            ? {
                lua: { files: { "lua/init.lua": { covered: 98, total: 100 } } },
              }
            : {
                js: {
                  "web/app.js": { lines: { covered: 97, total: 100 } },
                  "scripts/tool.mjs": { lines: { covered: 100, total: 100 } },
                },
              };
      reports(root, bad);
      assert.throws(
        () => checkCoverage(root, 0),
        new RegExp(lang + " coverage below"),
      );
    }
  }));
test("coverage rejects stale, missing, malformed, zero and unloaded reports", () =>
  scratch((root) => {
    source(root);
    reports(root);
    assert.throws(() => checkCoverage(root, Date.now() + 1000), /stale/);
    reports(root, { go: "mode: set\nmalformed" });
    assert.throws(() => checkCoverage(root, 0), /Malformed/);
    reports(root, {
      go: "mode: set\ngithub.com/wahidyankf/media-glance/main.go:1.1,1.2 0 0\n",
    });
    assert.throws(() => checkCoverage(root, 0), /below/);
    reports(root, { lua: { files: {} } });
    assert.throws(() => checkCoverage(root, 0), /incomplete/);
    reports(root, {
      lua: { files: { "lua/init.lua": { covered: 101, total: 100 } } },
    });
    assert.throws(() => checkCoverage(root, 0), /Invalid/);
    reports(root, {
      js: { "unknown.js": { lines: { covered: 1, total: 1 } } },
    });
    assert.throws(() => checkCoverage(root, 0), /Unexpected/);
    reports(root);
    writeFileSync(join(root, "web/unloaded.js"), "");
    assert.throws(() => checkCoverage(root, 0), /inventory/);
    rmSync(join(root, ".coverage/go.out"));
    assert.throws(() => checkCoverage(root, 0), /ENOENT/);
  }));
test("inventory is recursive and ignores generated vendor; subprocesses fail closed", () =>
  scratch((root) => {
    source(root);
    mkdirSync(join(root, "web/vendor"));
    writeFileSync(join(root, "web/vendor/upstream.js"), "");
    mkdirSync(join(root, "web/nested"));
    writeFileSync(join(root, "web/nested/other.js"), "");
    assert.deepEqual(inventory(root, "web", /\.js$/), [
      "web/app.js",
      "web/nested/other.js",
    ]);
    assert.equal(checked("x", [], {}, ok).status, 0);
    assert.throws(
      () => checked("x", [], {}, () => ({ error: new Error("spawn") })),
      /spawn/,
    );
    assert.throws(
      () => checked("x", [], {}, () => ({ status: null })),
      /without a status/,
    );
  }));
test("vendor stages only the selected Mermaid graph with patched exact KaTeX", () =>
  scratch((root) => {
    vendorFixture(root);
    writeFileSync(
      join(
        root,
        "node_modules/mermaid/dist/chunks/mermaid.esm.min/debug.mjs.map",
      ),
      "large source map",
    );
    vendor(root);
    assert.throws(
      () =>
        readFileSync(
          join(root, "web/vendor/chunks/mermaid.esm.min/debug.mjs.map"),
        ),
      /ENOENT/,
    );
    assert.equal(
      readFileSync(
        join(root, "web/vendor/chunks/mermaid.esm.min/katex-C5OPUE3Q.mjs"),
        "utf8",
      ),
      'var version = "0.18.3";',
    );
    writeFileSync(
      join(root, "node_modules/katex/package.json"),
      '{"version":"0.0.0"}',
    );
    assert.throws(() => vendor(root), /exact pin/);
    writeFileSync(
      join(root, "node_modules/katex/package.json"),
      '{"version":"0.18.3"}',
    );
    writeFileSync(join(root, "node_modules/katex/dist/katex.mjs"), "wrong");
    assert.throws(() => vendor(root), /marker/);
    writeFileSync(
      join(root, "node_modules/katex/dist/katex.mjs"),
      'var version = "0.18.3";',
    );
    rmSync(
      join(
        root,
        "node_modules/mermaid/dist/chunks/mermaid.esm.min/katex-C5OPUE3Q.mjs",
      ),
    );
    assert.throws(() => vendor(root), /chunk changed/);
  }));
test("source and release builds select targets, checksums and stop on build failures", () =>
  scratch((root) => {
    const calls = [];
    const run = (command, args, opts) => {
      calls.push({ command, args, opts });
      if (args.includes("-o"))
        writeFileSync(args[args.indexOf("-o") + 1], "synthetic executable");
      return { status: 0 };
    };
    mkdirSync(join(root, "build"));
    build(root, run, "darwin", "x64");
    build(root, run, "linux", "arm64");
    release(root, run);
    assert.equal(calls[0].opts.env.GOARCH, "amd64");
    assert.equal(calls[1].opts.env.GOARCH, "arm64");
    const checksums = readFileSync(join(root, "dist/checksums.txt"), "utf8");
    assert.equal(checksums.trim().split("\n").length, 4);
    assert.match(checksums, /media-glance_v0.1.0_linux_arm64/);
    assert.throws(() => release(root, () => ({ status: 3 })), /exited 3/);
  }));
test("gate commands run in order with fresh reports and propagate format or command failures", () =>
  scratch((root) => {
    vendorFixture(root);
    const calls = [];
    const run = (command, args, opts) => {
      calls.push({ command, args, opts });
      if (args.includes("-o"))
        writeFileSync(args[args.indexOf("-o") + 1], "synthetic");
      if (
        command === "go" &&
        args[0] === "test" &&
        !args.includes("-tags=integration")
      )
        reports(root);
      return {
        status: 0,
        stdout: command === "nvim" ? "/synthetic/runtime" : "",
      };
    };
    for (const command of [
      "setup",
      "vendor",
      "build",
      "release",
      "fast",
      "unit",
      "integration",
      "browser",
      "browser-install",
      "complete",
    ]) {
      dispatch(command, root, run, undefined, () => 0);
    }
    assert.ok(calls.some((call) => call.command === "git"));
    assert.ok(calls.some((call) => call.args.includes("-race")));
    assert.ok(calls.some((call) => call.args.includes("test/lua/unit.lua")));
    assert.throws(
      () =>
        dispatch("fast", root, (cmd) => ({
          status: 0,
          stdout: cmd === "gofmt" ? "main.go" : "",
        })),
      /gofmt required/,
    );
    assert.throws(
      () => dispatch("fast", root, () => ({ status: 0, stdout: "" })),
      /runtime path was empty/,
    );
    let installed = false;
    dispatch("tools", root, run, undefined, Date.now, () => {
      installed = true;
    });
    assert.ok(installed);
    assert.throws(() => dispatch("missing", root, run), /Unknown/);
    assert.equal(main([], root).code, 1);
    assert.equal(main(["missing"], root).code, 1);
    assert.equal(main(["setup"], root, { run }).code, 0);
  }));

test("Go coverage merges duplicated package blocks and rejects inconsistent blocks or unexpected sources", () =>
  scratch((root) => {
    source(root);
    const row = "github.com/wahidyankf/media-glance/main.go:1.1,1.2";
    reports(root, { go: `mode: set\n${row} 100 0\n${row} 100 1\n` });
    assert.deepEqual(checkCoverage(root, 0).go, {
      covered: 100,
      total: 100,
      percent: 100,
    });
    reports(root, { go: `mode: set\n${row} 100 0\n${row} 99 1\n` });
    assert.throws(() => checkCoverage(root, 0), /Inconsistent/);
    reports(root, { go: "mode: invalid\n" });
    assert.throws(() => checkCoverage(root, 0), /mode/);
    reports(root, { go: "mode: set\nother.go:1.1,1.2 1 1\n" });
    assert.throws(() => checkCoverage(root, 0), /Unexpected/);
  }));
