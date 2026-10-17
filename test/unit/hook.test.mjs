import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("pre-push runs unit then fast, and stops for failed coverage in any runtime", () => {
  const root = mkdtempSync(join(tmpdir(), "media-glance-hook path-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "git"),
    '#!/usr/bin/env bash\nif [[ "$1" == rev-parse ]]; then printf "%s\\n" "$FIXTURE_ROOT"; else exit 2; fi\n',
    { mode: 0o700 },
  );
  writeFileSync(
    join(bin, "npm"),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$FIXTURE_LOG"\nif [[ "$2" == check:unit && -n "$FAIL_LANGUAGE" ]]; then printf "%s coverage below 99%%\\n" "$FAIL_LANGUAGE" >&2; exit 1; fi\nif [[ "$2" == check:fast && "$FAIL_FAST" == 1 ]]; then exit 2; fi\n',
    { mode: 0o700 },
  );
  const log = join(root, "log");
  const hook = resolve(".husky/pre-push");
  try {
    for (const lang of ["go", "lua", "js", ""]) {
      writeFileSync(log, "");
      const result = spawnSync("bash", [hook], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: bin + ":" + process.env.PATH,
          FIXTURE_ROOT: root,
          FIXTURE_LOG: log,
          FAIL_LANGUAGE: lang,
          FAIL_FAST: "0",
        },
      });
      assert.equal(result.status, lang ? 1 : 0);
      assert.equal(
        readFileSync(log, "utf8"),
        lang ? "run check:unit\n" : "run check:unit\nrun check:fast\n",
      );
      if (lang)
        assert.match(result.stderr, new RegExp(lang + " coverage below"));
    }
    writeFileSync(log, "");
    const bad = spawnSync("bash", [hook], {
      env: {
        ...process.env,
        PATH: bin + ":" + process.env.PATH,
        FIXTURE_ROOT: root,
        FIXTURE_LOG: log,
        FAIL_LANGUAGE: "",
        FAIL_FAST: "1",
      },
    });
    assert.equal(bad.status, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pre-commit lints staged files through lint-staged and propagates failures", () => {
  const root = mkdtempSync(join(tmpdir(), "media-glance-precommit-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "git"),
    '#!/usr/bin/env bash\nif [[ "$1" == rev-parse ]]; then printf "%s\\n" "$FIXTURE_ROOT"; else exit 2; fi\n',
    { mode: 0o700 },
  );
  writeFileSync(
    join(bin, "npx"),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$FIXTURE_LOG"\nif [[ "$FAIL_LINT" == 1 ]]; then exit 3; fi\n',
    { mode: 0o700 },
  );
  const log = join(root, "log");
  const hook = resolve(".husky/pre-commit");
  const base = {
    ...process["env"],
    PATH: bin + ":" + process["env"].PATH,
    FIXTURE_ROOT: root,
    FIXTURE_LOG: log,
  };
  try {
    writeFileSync(log, "");
    const result = spawnSync("bash", [hook], {
      encoding: "utf8",
      env: { ...base, FAIL_LINT: "0" },
    });
    assert.equal(result.status, 0);
    assert.equal(readFileSync(log, "utf8"), "--no-install lint-staged\n");
    writeFileSync(log, "");
    const bad = spawnSync("bash", [hook], {
      encoding: "utf8",
      env: { ...base, FAIL_LINT: "1" },
    });
    assert.equal(bad.status, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lint-staged pins husky tooling and checks staged sources with biome", () => {
  const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
  for (const name of ["husky", "lint-staged", "@biomejs/biome"])
    assert.ok(
      pkg.devDependencies[name],
      `${name} must be a pinned devDependency`,
    );
  assert.ok(!pkg.devDependencies.eslint, "eslint must be replaced by biome");
  assert.ok(
    pkg.devDependencies.prettier,
    "prettier must stay pinned for documents biome cannot format",
  );
  const staged = pkg["lint-staged"];
  assert.ok(staged, "package.json must declare a lint-staged map");
  assert.ok(
    staged["*.{js,mjs,cjs,json,css,html}"].some((command) =>
      command.includes("biome check --write"),
    ),
    "staged sources must be checked with biome",
  );
  assert.ok(
    staged["*.{md,yml,yaml}"].some((command) =>
      command.includes("prettier --write"),
    ),
    "staged documents must be formatted with prettier",
  );
  for (const [pattern, commands] of Object.entries(staged)) {
    if (pattern.includes("md") || pattern.includes("yaml")) continue;
    assert.ok(
      commands.every((command) => !command.includes("prettier")),
      `prettier must only own documents: ${pattern}`,
    );
  }
  assert.ok(
    staged["*.go"].some((command) => command.includes("gofmt -w")),
    "staged go sources must be formatted with gofmt",
  );
  assert.ok(
    staged["*.sh"].some((command) => command.includes("shfmt -w")),
    "staged shell scripts must be formatted with shfmt",
  );
  for (const hook of [".husky/pre-commit", ".husky/pre-push"])
    assert.ok(
      staged[hook].some((command) => command.includes("shfmt -w")),
      `extensionless hook ${hook} must be formatted with shfmt`,
    );
  assert.ok(
    staged["go.mod"].some((command) => command.includes("go mod edit -fmt")),
    "staged go module files must be formatted with go mod edit",
  );
  assert.ok(
    staged["*.lua"].some((command) => command.includes("stylua")),
    "staged lua sources must be formatted with stylua",
  );
});

test("commit-msg lints the message file through commitlint and refuses failures", () => {
  const root = mkdtempSync(join(tmpdir(), "media-glance-commitmsg-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "git"),
    '#!/usr/bin/env bash\nif [[ "$1" == rev-parse ]]; then printf "%s\\n" "$FIXTURE_ROOT"; else exit 2; fi\n',
    { mode: 0o700 },
  );
  writeFileSync(
    join(bin, "npx"),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$FIXTURE_LOG"\nif [[ "$FAIL_LINT" == 1 ]]; then exit 3; fi\n',
    { mode: 0o700 },
  );
  const log = join(root, "log");
  const message = join(root, "COMMIT_EDITMSG");
  writeFileSync(message, "feat: add conventional commit enforcement\n");
  const hook = resolve(".husky/commit-msg");
  const base = {
    ...process["env"],
    PATH: bin + ":" + process["env"].PATH,
    FIXTURE_ROOT: root,
    FIXTURE_LOG: log,
  };
  try {
    writeFileSync(log, "");
    const result = spawnSync("bash", [hook, message], {
      encoding: "utf8",
      env: { ...base, FAIL_LINT: "0" },
    });
    assert.equal(result.status, 0);
    assert.equal(
      readFileSync(log, "utf8"),
      `--no-install commitlint --edit ${message}\n`,
    );
    writeFileSync(log, "");
    const bad = spawnSync("bash", [hook, message], {
      encoding: "utf8",
      env: { ...base, FAIL_LINT: "1" },
    });
    assert.equal(bad.status, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commitlint pins conventional config for commit messages", () => {
  const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
  for (const name of ["@commitlint/cli", "@commitlint/config-conventional"])
    assert.ok(
      pkg.devDependencies[name],
      `${name} must be a pinned devDependency`,
    );
  assert.match(
    readFileSync(resolve("commitlint.config.mjs"), "utf8"),
    /@commitlint\/config-conventional/,
    "commitlint must extend the conventional config",
  );
});
