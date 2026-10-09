import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import {
  captureMediaSnapshot,
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

test("external Markdown links open safe new contexts while local navigation stays in the viewer", async ({
  page,
  context,
}) => {
  const fixture = createFixture(resolve("build/media-glance"));
  const referrers = [];
  await context.route("https://example.test/**", async (route) => {
    referrers.push(route.request().headers().referer ?? "");
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>External guide fixture</title><h1>External fixture</h1>",
    });
  });
  try {
    const ready = await fixture.ready;
    const info = await (
      await page.request.get(new URL("info", ready.fixtureUrl).href)
    ).json();
    const address = new URL(info.viewerUrl);
    address.searchParams.set("file", "zz-selected/nested/links.md");
    await page.goto(address.href);
    const before = page.url();
    for (const selector of [
      'article a[href="https://example.test/guide"]',
      'article a[href="https://example.test/auto"]',
      '.media-canvas a[href="https://example.test/image"]',
    ]) {
      const link = page.locator(selector);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      const opened = context.waitForEvent("page");
      await link.click();
      const other = await opened;
      await other.waitForLoadState("domcontentloaded");
      expect(
        await other.evaluate(() => ({
          openerIsNull: window.opener === null,
          referrer: globalThis.document.referrer,
        })),
      ).toEqual({ openerIsNull: true, referrer: "" });
      expect(page.url()).toBe(before);
      await expect(
        page.getByRole("heading", { name: "Link behavior", exact: true }),
      ).toBeVisible();
      await other.close();
    }
    expect(referrers).toEqual(["", "", ""]);
    await expect(
      page.locator('article a[href^="mailto:"]'),
    ).not.toHaveAttribute("target", "_blank");
    await page
      .getByRole("link", { name: "Local document", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Second document", exact: true }),
    ).toBeVisible();
    expect(context.pages()).toEqual([page]);
  } finally {
    const stopped = await fixture.stop();
    expect(stopped.code, stopped.stderr).toBe(0);
    expect(stopped.cleanup?.cleanup).toBe("complete");
  }
});

test("system theme, manual persistence, diagram rendering and expanded media survive mode changes and external saves", async ({
  page,
  context,
}) => {
  const fixture = createFixture(resolve("build/media-glance"));
  await page.emulateMedia({ colorScheme: "dark" });
  try {
    const ready = await fixture.ready;
    const info = await (
      await page.request.get(new URL("info", ready.fixtureUrl).href)
    ).json();
    await page.goto(info.viewerUrl);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(
      page.getByRole("button", { name: "Light mode", exact: true }),
    ).toBeVisible();
    const colors = () =>
      page.evaluate(() => {
        const style = globalThis.getComputedStyle(
          globalThis.document.documentElement,
        );
        return {
          page: style.getPropertyValue("--page").trim(),
          ink: style.getPropertyValue("--ink").trim(),
          sidebar: style.getPropertyValue("--sidebar").trim(),
        };
      });
    expect(await colors()).toEqual({
      page: "#182331",
      ink: "#e0e8f2",
      sidebar: "#202e3e",
    });
    await expect.poll(() => page.evaluate(mediaFitReady)).toBeTruthy();
    const icon = await page.evaluate(async () => {
      const link = globalThis.document.querySelector('link[rel="icon"]');
      const response = await globalThis.fetch(link.href);
      const svg = new globalThis.DOMParser().parseFromString(
        await response.text(),
        "image/svg+xml",
      );
      const image = new globalThis.Image();
      image.src = link.href;
      await image.decode();
      return {
        status: response.status,
        mime: response.headers.get("content-type"),
        viewBox: svg.documentElement.getAttribute("viewBox"),
        scripts: svg.querySelectorAll("script, parsererror").length,
        decoded: image.naturalWidth > 0,
      };
    });
    expect(icon).toEqual({
      status: 200,
      mime: "image/svg+xml",
      viewBox: "0 0 32 32",
      scripts: 0,
      decoded: true,
    });
    const diagramPalette = () =>
      page.locator(".mermaid svg").evaluate((svg) => ({
        background: globalThis
          .getComputedStyle(globalThis.document.documentElement)
          .getPropertyValue("--page")
          .trim(),
        text: globalThis.getComputedStyle(svg.querySelector(".nodeLabel"))
          .color,
      }));
    const darkDiagram = await diagramPalette();
    expect(darkDiagram).toEqual({
      background: "#182331",
      text: "rgb(204, 204, 204)",
    });
    const initialFile = page.url();
    await page.evaluate(() => {
      globalThis.document.querySelector("#panel").scrollTop = 120;
      globalThis.document.querySelector("nav").scrollTop = 80;
    });
    const image = page
      .locator(".media-viewer")
      .filter({ has: page.locator("img") })
      .first();
    await image.getByRole("button", { name: /^Zoom in / }).click();
    const zoom = await image.locator("output").textContent();
    await page.evaluate(() => {
      globalThis.document.querySelector("#panel").scrollTop = 120;
      globalThis.document.querySelector("nav").scrollTop = 80;
    });
    const positions = await page.evaluate(() => ({
      document: globalThis.document.querySelector("#panel").scrollTop,
      explorer: globalThis.document.querySelector("nav").scrollTop,
    }));
    await page.getByRole("button", { name: "Light mode", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect.poll(() => page.locator(".mermaid svg").count()).toBe(1);
    expect(await colors()).toEqual({
      page: "#fffefc",
      ink: "#37352f",
      sidebar: "#f7f7f5",
    });
    await expect
      .poll(diagramPalette)
      .toEqual({ background: "#fffefc", text: "rgb(51, 51, 51)" });
    const lightDiagram = await diagramPalette();
    expect(lightDiagram).toEqual({
      background: "#fffefc",
      text: "rgb(51, 51, 51)",
    });
    expect(
      await image
        .locator("img")
        .evaluate((img) => globalThis.getComputedStyle(img).filter),
    ).toBe("none");
    expect(page.url()).toBe(initialFile);
    await expect(image.locator("output")).toHaveText(zoom);
    expect(
      await page.evaluate(() => ({
        document: globalThis.document.querySelector("#panel").scrollTop,
        explorer: globalThis.document.querySelector("nav").scrollTop,
      })),
    ).toEqual(positions);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const other = await context.newPage();
    await other.goto(info.viewerUrl);
    await expect(other.locator("html")).toHaveAttribute("data-theme", "light");
    await other.close();
    await expect.poll(() => page.evaluate(mediaFitReady)).toBeTruthy();
    const diagram = page
      .locator(".media-viewer")
      .filter({ has: page.locator("svg") })
      .first();
    await diagram
      .getByRole("button", { name: "Zoom in Mermaid diagram", exact: true })
      .click();
    const diagramZoom = await diagram.locator("output").textContent();
    await diagram
      .getByRole("button", { name: "Expand Mermaid diagram", exact: true })
      .click();
    const control = page
      .locator("dialog")
      .getByRole("button", { name: "Dark mode", exact: true });
    await control.focus();
    await control.press("Space");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("dialog")).toBeVisible();
    await expect(page.locator("dialog output")).toHaveText(diagramZoom);
    await expect(
      page
        .locator("dialog")
        .getByRole("button", { name: "Light mode", exact: true }),
    ).toBeFocused();
    await page.request.post(new URL("edit-diagram", ready.fixtureUrl).href);
    await expect(page.locator("dialog")).toContainText(
      "externally_updated_field",
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("dialog output")).toHaveText(diagramZoom);
    await page
      .locator("dialog")
      .getByRole("button", { name: "Close expanded view", exact: true })
      .click();
    await page.getByRole("button", { name: "Light mode", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  } finally {
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
      globalThis.holdImageFits = () => {
        globalThis.releaseImageFits = () => {
          globalThis.releaseImageFits = undefined;
          for (const callback of queued.splice(0)) callback();
        };
      };
      globalThis.holdImageFits();
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
      await page.evaluate(mediaFitReady, { requireFit: true }),
      JSON.stringify(pending),
    ).toBe(false);
    expect(pending.style).toBe("");
    expect(pending.fit).toBe("");
    await page.evaluate(() => globalThis.releaseImageFits());
    await page.waitForFunction(
      mediaFitReady,
      { requireFit: true },
      { timeout: 10000 },
    );
    const waitForFunction = page.waitForFunction.bind(page);
    let refreshed = false;
    // Force a real redraw after polling returns, while the replacement images await fitting.
    page.waitForFunction = async (...args) => {
      const value = await waitForFunction(...args);
      if (args[0] === mediaFitReady && !refreshed) {
        refreshed = true;
        await page.evaluate(() => globalThis.holdImageFits());
        const changed = await page.request.post(
          new URL("edit-prose", ready.fixtureUrl).href,
        );
        expect(changed.ok()).toBe(true);
        await page
          .getByText("External sidebar-refresh marker.", { exact: true })
          .waitFor();
        await waitForFunction(() => {
          const images = [...globalThis.document.querySelectorAll("img")];
          return (
            globalThis.document.querySelector(".mermaid svg") &&
            images.length === 2 &&
            images.every((image) => image.complete && image.naturalWidth > 0) &&
            images[0].style.width === ""
          );
        });
      }
      return value;
    };
    let baseline;
    try {
      baseline = await captureMediaSnapshot(page);
    } finally {
      page.waitForFunction = waitForFunction;
    }
    expect(refreshed).toBe(true);
    expect(baseline.imageFit).toBe("100%");
    expect(baseline.imageStyle).not.toBe("");
    await page.evaluate(() => globalThis.releaseImageFits());
    await page.waitForFunction(
      mediaFitReady,
      { requireFit: true },
      { timeout: 10000 },
    );
    const before = baseline.imageWidth;
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
