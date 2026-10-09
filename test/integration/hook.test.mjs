import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function command(name, args, cwd, env = process.env) {
  const result = spawnSync(name, args, { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
test("installed pre-push hook refuses real local Git pushes for each runtime coverage failure", () => {
  for (const language of ["go", "lua", "js"]) {
    const root = mkdtempSync(join(tmpdir(), "media-glance-git path-"));
    const repo = join(root, "repo");
    const remote = join(root, "remote.git");
    const bin = join(root, "bin");
    mkdirSync(repo);
    mkdirSync(bin);
    mkdirSync(join(repo, "scripts"));
    mkdirSync(join(repo, ".githooks"));
    try {
      command("git", ["init", "--bare", "--initial-branch=main", remote], root);
      command("git", ["init", "--initial-branch=main"], repo);
      command("git", ["config", "user.name", "Synthetic fixture"], repo);
      command("git", ["config", "user.email", "fixture@example.invalid"], repo);
      cpSync(resolve("scripts"), join(repo, "scripts"), { recursive: true });
      cpSync(resolve(".githooks/pre-push"), join(repo, ".githooks/pre-push"));
      writeFileSync(join(repo, "README.md"), "Synthetic hook fixture.\n");
      command("git", ["add", "."], repo);
      command("git", ["commit", "-m", "Synthetic fixture"], repo);
      command("git", ["remote", "add", "origin", remote], repo);
      command(process.execPath, ["scripts/cli.mjs", "setup"], repo);
      assert.equal(
        command("git", ["config", "core.hooksPath"], repo),
        ".githooks",
      );
      writeFileSync(
        join(bin, "npm"),
        '#!/usr/bin/env bash\nprintf "%s coverage below 99%%\\n" "$FAIL_LANGUAGE" >&2\nexit 1\n',
        { mode: 0o700 },
      );
      const result = spawnSync("git", ["push", "origin", "main"], {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: bin + ":" + process.env.PATH,
          FAIL_LANGUAGE: language,
        },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(language + " coverage below"));
      assert.equal(
        command("git", ["ls-remote", "origin", "refs/heads/main"], repo),
        "",
      );
      writeFileSync(join(bin, "npm"), "#!/usr/bin/env bash\nexit 0\n", {
        mode: 0o700,
      });
      command("git", ["push", "origin", "main"], repo, {
        ...process.env,
        PATH: bin + ":" + process.env.PATH,
      });
      assert.match(
        command("git", ["ls-remote", "origin", "refs/heads/main"], repo),
        /refs\/heads\/main/,
      );
      assert.match(
        readFileSync(join(repo, ".githooks/pre-push"), "utf8"),
        /set -euo pipefail/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
