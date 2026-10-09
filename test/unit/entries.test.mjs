import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("browser module entry initializes and releases the native window controller", async () => {
  const dom = new JSDOM(
    '<b id="workspace"></b><span id="status"></span><button id="theme-toggle" type="button">Light mode</button><nav><div id="tree"></div></nav><main id="panel"></main>',
    { url: "http://127.0.0.1:57300/v/token/" },
  );
  const w = dom.window;
  w.matchMedia = () => ({ matches: false });
  w.fetch = async (route) => ({
    ok: true,
    json: async () =>
      route === "api/info" ? { root: "/fixture" } : { entries: [] },
  });
  w.EventSource = class {
    addEventListener() {}
    close() {}
  };
  globalThis.window = w;
  try {
    await import("../../web/start.js");
    assert.match(
      w.document.querySelector("#panel").textContent,
      /Choose a file/,
    );
    w.dispatchEvent(new w.Event("pagehide"));
  } finally {
    delete globalThis.window;
    dom.window.close();
  }
});
test("CLI invalid usage produces failure status and diagnostic", async () => {
  const argv = process.argv;
  const code = process.exitCode;
  const error = console.error;
  let message;
  process.argv = ["node", "cli"];
  console.error = (value) => {
    message = value;
  };
  try {
    await import("../../scripts/cli.mjs");
    assert.equal(process.exitCode, 1);
    assert.match(message, /Usage/);
  } finally {
    process.argv = argv;
    process.exitCode = code;
    console.error = error;
  }
});
