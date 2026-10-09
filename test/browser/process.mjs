import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export function createFixture(
  binary,
  {
    script = fileURLToPath(new URL("./fixture.mjs", import.meta.url)),
    timeout = 10000,
    termWait = 5000,
    killWait = 10000,
    deadline = 15000,
  } = {},
) {
  const child = spawn(process.execPath, [script, "--binary", binary], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "",
    cleanup,
    closed = false;
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const lines = createInterface({ input: child.stdout });
  const complete = new Promise((resolve) =>
    child.once("close", () => {
      closed = true;
      resolve();
    }),
  );
  let startupTimer;
  const ready = new Promise((resolve, reject) => {
    lines.on("line", (line) => {
      try {
        const data = JSON.parse(line);
        if (data.fixtureUrl) {
          clearTimeout(startupTimer);
          resolve(data);
        }
        if (data.cleanup) cleanup = data;
      } catch (error) {
        reject(error);
      }
    });
    child.once("exit", () =>
      reject(new Error(stderr || "Fixture exited before readiness")),
    );
    child.once("error", reject);
    startupTimer = setTimeout(
      () => reject(new Error("Fixture startup deadline exceeded")),
      timeout,
    );
  });
  const result = () => ({
    code: child.exitCode,
    signal: child.signalCode,
    cleanup,
    stderr,
  });
  return {
    child,
    ready,
    async stop() {
      clearTimeout(startupTimer);
      if (closed) {
        lines.close();
        return result();
      }
      const running =
        typeof child.pid === "number" &&
        child.exitCode === null &&
        child.signalCode === null;
      let terminate, kill, limit;
      try {
        if (running) {
          child.stdin.end();
          terminate = setTimeout(() => child.kill("SIGTERM"), termWait);
          kill = setTimeout(() => child.kill("SIGKILL"), killWait);
        }
        await Promise.race([
          complete,
          new Promise((_, reject) => {
            limit = setTimeout(
              () =>
                reject(new Error("Owned fixture shutdown deadline exceeded")),
              deadline,
            );
          }),
        ]);
        return result();
      } finally {
        clearTimeout(terminate);
        clearTimeout(kill);
        clearTimeout(limit);
        lines.close();
      }
    },
  };
}
