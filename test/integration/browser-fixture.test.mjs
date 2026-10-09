import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFixture } from "../browser/process.mjs";

test("fixture exit before readiness rejects startup and cleanup finishes without waiting for another exit", async () => {
  const root = mkdtempSync(join(tmpdir(), "media-glance-startup-"));
  const script = join(root, "exit.mjs");
  writeFileSync(script, "process.exitCode=3;\n");
  const started = Date.now();
  const fixture = createFixture("unused", {
    script,
    timeout: 1000,
    termWait: 20,
    killWait: 40,
    deadline: 200,
  });
  try {
    await assert.rejects(fixture.ready, /before readiness/);
    const stopped = await fixture.stop();
    assert.equal(stopped.code, 3);
    assert.ok(Date.now() - started < 1000);
    await fixture.stop();
  } finally {
    await fixture.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
test("an unresponsive owned fixture receives bounded escalation and leaves no running process", async () => {
  const root = mkdtempSync(join(tmpdir(), "media-glance-hung-"));
  const script = join(root, "hung.mjs");
  writeFileSync(
    script,
    'process.on("SIGTERM",()=>{});console.log(JSON.stringify({fixtureUrl:"http://127.0.0.1:1/"}));setInterval(()=>{},1000);\n',
  );
  const fixture = createFixture("unused", {
    script,
    timeout: 1000,
    termWait: 20,
    killWait: 40,
    deadline: 200,
  });
  try {
    await fixture.ready;
    const stopped = await fixture.stop();
    assert.equal(stopped.signal, "SIGKILL");
    assert.equal(fixture.child.signalCode, "SIGKILL");
  } finally {
    await fixture.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
