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
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

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
  const hook = resolve(".githooks/pre-push");
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
