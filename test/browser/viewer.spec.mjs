import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import {
  mediaFitReady,
  mediaViewerBrowserSpec,
  requireNativeMathML,
} from "./journey.mjs";
import { createFixture } from "./process.mjs";

test("focused workspace media, external saves, zoom and lifecycle", async ({
  page,
}) => {
  const fixture = createFixture(resolve("build/media-glance"));
  const watchdog = setTimeout(() => fixture.child.kill("SIGTERM"), 115000);
  try {
    const ready = await fixture.ready;
    await page.goto(ready.fixtureUrl);
    const outcome = await mediaViewerBrowserSpec(page);
    expect(outcome.verdict).toBe("passed");
  } finally {
    clearTimeout(watchdog);
    const stopped = await fixture.stop();
    expect(stopped.code, stopped.stderr).toBe(0);
    expect(stopped.cleanup?.cleanup).toBe("complete");
  }
});

test("native MathML readiness survives an initial SSE refresh between renders", async ({
  page,
}) => {
  const fixture = createFixture(resolve("build/media-glance"));
  try {
    const ready = await fixture.ready;
    const info = await (
      await page.request.get(new URL("info", ready.fixtureUrl).href)
    ).json();
    await page.addInitScript(() => {
      const Source = globalThis.EventSource;
      const pending = [];
      let holdOpen = true;
      globalThis.releaseInitialOpen = () => {
        holdOpen = false;
        for (const callback of pending.splice(0)) callback();
      };
      globalThis.EventSource = class extends Source {
        addEventListener(type, listener, options) {
          super.addEventListener(
            type,
            type === "open"
              ? (event) => {
                  const apply = () => listener.call(this, event);
                  if (holdOpen) {
                    pending.push(apply);
                    globalThis.initialOpenQueued = true;
                  } else apply();
                }
              : listener,
            options,
          );
        }
      };
      let renders = 0;
      globalThis.loadMermaid = async () => {
        const { default: mermaid } = await import(
          new URL("./vendor/mermaid.esm.min.mjs", globalThis.location.href).href
        );
        return {
          default: {
            initialize: (config) => mermaid.initialize(config),
            render: async (...args) => {
              const result = await mermaid.render(...args);
              if (++renders === 2)
                await new Promise((resolve) => {
                  globalThis.releaseSecondMathRender = resolve;
                });
              return result;
            },
          },
        };
      };
    });
    const address = new URL(info.viewerUrl);
    address.searchParams.set("file", "zz-selected/nested/math.md");
    await page.goto(address.href);
    await page
      .getByRole("button", { name: "Zoom in Mermaid diagram", exact: true })
      .waitFor();
    await requireNativeMathML(page);
    await page.waitForFunction(() => globalThis.initialOpenQueued, undefined, {
      timeout: 10000,
    });
    await page.evaluate(() => globalThis.releaseInitialOpen());
    await page.waitForFunction(
      () => typeof globalThis.releaseSecondMathRender === "function",
      undefined,
      { timeout: 10000 },
    );
    expect(await page.locator(".mermaid math").count()).toBe(0);
    const outcome = requireNativeMathML(page).then(
      () => null,
      (error) => error,
    );
    await page.evaluate(() => globalThis.releaseSecondMathRender());
    expect(await outcome).toBeNull();
    expect(await page.locator(".mermaid math").count()).toBeGreaterThan(0);
  } finally {
    const stopped = await fixture.stop();
    expect(stopped.code, stopped.stderr).toBe(0);
    expect(stopped.cleanup?.cleanup).toBe("complete");
  }
});

test("downloaded images are not ready until their fit callbacks have applied", async ({
  page,
}) => {
  const fixture = createFixture(resolve("build/media-glance"));
  try {
    const ready = await fixture.ready;
    await page.goto(ready.fixtureUrl);
    const info = await (
      await page.request.get(new URL("info", ready.fixtureUrl).href)
    ).json();
    await page.addInitScript(() => {
      const queued = [];
      globalThis.releaseImageFits = () => {
        globalThis.releaseImageFits = undefined;
        for (const callback of queued.splice(0)) callback();
      };
      const Observer = globalThis.ResizeObserver;
      globalThis.ResizeObserver = class extends Observer {
        constructor(callback) {
          super((entries, observer) => {
            const apply = () => callback(entries, observer);
            if (
              globalThis.releaseImageFits &&
              entries.some((entry) => entry.target.querySelector("img"))
            )
              queued.push(apply);
            else apply();
          });
        }
      };
      const add = globalThis.HTMLImageElement.prototype.addEventListener;
      globalThis.HTMLImageElement.prototype.addEventListener = function (
        type,
        listener,
        options,
      ) {
        const wrapped =
          type === "load"
            ? (event) => {
                const apply = () => listener.call(this, event);
                if (globalThis.releaseImageFits) queued.push(apply);
                else apply();
              }
            : listener;
        return add.call(this, type, wrapped, options);
      };
    });
    await page.goto(info.viewerUrl);
    await page
      .getByRole("button", { name: "Zoom in Mermaid diagram", exact: true })
      .waitFor();
    await page.waitForFunction(() =>
      [...globalThis.document.querySelectorAll("img")].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    const pending = await page
      .locator("img")
      .first()
      .evaluate((image) => ({
        width: image.getBoundingClientRect().width,
        style: image.style.width,
        fit: image.closest(".media-viewer").querySelector("output").textContent,
      }));
    expect(
      await page.evaluate(mediaFitReady, true),
      JSON.stringify(pending),
    ).toBe(false);
    expect(pending.style).toBe("");
    expect(pending.fit).toBe("");
    await page.evaluate(() => globalThis.releaseImageFits());
    await page.waitForFunction(mediaFitReady, true, { timeout: 10000 });
    const before = await page
      .locator("img")
      .first()
      .evaluate((image) => image.getBoundingClientRect().width);
    for (let index = 0; index < 5; index++)
      await page
        .getByRole("button", { name: "Zoom in Mermaid diagram", exact: true })
        .click();
    expect(
      await page
        .locator("img")
        .first()
        .evaluate((image) => image.getBoundingClientRect().width),
    ).toBe(before);
  } finally {
    const stopped = await fixture.stop();
    expect(stopped.code, stopped.stderr).toBe(0);
    expect(stopped.cleanup?.cleanup).toBe("complete");
  }
});
