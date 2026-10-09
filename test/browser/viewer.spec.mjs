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
    await expect.poll(diagramPalette).toEqual({
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
    await expect.poll(diagramPalette).toEqual({
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
    await expect(
      page
        .locator("dialog")
        .getByRole("button", { name: /^(Light|Dark) mode$/ }),
    ).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("dialog")).toBeVisible();
    await expect(page.locator("dialog output")).toHaveText(diagramZoom);
    await page.request.post(new URL("edit-diagram", ready.fixtureUrl).href);
    await expect(page.locator("dialog")).toContainText(
      "externally_updated_field",
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("dialog output")).toHaveText(diagramZoom);
    await expect(
      page
        .locator("dialog")
        .getByRole("button", { name: /^(Light|Dark) mode$/ }),
    ).toHaveCount(0);
    await page
      .locator("dialog")
      .getByRole("button", { name: "Close expanded view", exact: true })
      .click();
    await page.getByRole("button", { name: "Dark mode", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  } finally {
    const stopped = await fixture.stop();
    expect(stopped.code, stopped.stderr).toBe(0);
    expect(stopped.cleanup?.cleanup).toBe("complete");
  }
});

test("explicit ER fills and label colors remain readable while unstyled rows keep theme stripes", async ({
  page,
}) => {
  const fixture = createFixture(resolve("build/media-glance"));
  await page.emulateMedia({ colorScheme: "light" });
  try {
    const ready = await fixture.ready;
    const info = await (
      await page.request.get(new URL("info", ready.fixtureUrl).href)
    ).json();
    const address = new URL(info.viewerUrl);
    address.searchParams.set("file", "zz-selected/nested/er-styles.md");
    await page.goto(address.href);
    const colors = () =>
      page.locator(".mermaid svg").evaluateAll((svgs) =>
        svgs.map((svg) => {
          const node = svg.querySelector("g.node");
          const painted = (selector) =>
            [...node.querySelectorAll(selector)]
              .filter((path) => path.getAttribute("fill") !== "none")
              .map((path) => globalThis.getComputedStyle(path).fill);
          return {
            labels: [...node.querySelectorAll(".nodeLabel")].map(
              (label) => globalThis.getComputedStyle(label).color,
            ),
            rows: painted(".row-rect-odd path, .row-rect-even path"),
            odd: painted(".row-rect-odd path"),
            even: painted(".row-rect-even path"),
          };
        }),
      );
    for (const mode of ["light", "dark"]) {
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      await expect.poll(() => page.locator(".mermaid svg").count()).toBe(5);
      const expectedLabel =
        mode === "light" ? "rgb(51, 51, 51)" : "rgb(204, 204, 204)";
      await expect
        .poll(async () => (await colors())[3].labels[0])
        .toBe(expectedLabel);
      const samples = await colors();
      for (const [index, fill] of [
        "rgb(1, 115, 178)",
        "rgb(40, 100, 60)",
        "rgb(96, 64, 128)",
      ].entries()) {
        expect(samples[index].rows.length).toBeGreaterThan(0);
        expect(samples[index].labels.length).toBeGreaterThan(0);
        expect(samples[index].rows.every((value) => value === fill)).toBe(true);
        expect(
          samples[index].labels.every(
            (value) => value === "rgb(255, 255, 255)",
          ),
        ).toBe(true);
      }
      for (const sample of samples.slice(3)) {
        expect(sample.labels.length).toBeGreaterThan(0);
        expect(sample.odd[0]).not.toBe(sample.even[0]);
        expect(sample.labels.every((value) => value === expectedLabel)).toBe(
          true,
        );
      }
      if (mode === "light")
        await page
          .getByRole("button", { name: "Dark mode", exact: true })
          .click();
    }
  } finally {
    const stopped = await fixture.stop();
    expect(stopped.code, stopped.stderr).toBe(0);
    expect(stopped.cleanup?.cleanup).toBe("complete");
  }
});

test("fenced code copy preserves exact text and refreshes after outside saves", async ({
  page,
  context,
}) => {
  const fixture = createFixture(resolve("build/media-glance"));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  try {
    const ready = await fixture.ready;
    const info = await (
      await page.request.get(new URL("info", ready.fixtureUrl).href)
    ).json();
    const address = new URL(info.viewerUrl);
    address.searchParams.set("file", "zz-selected/nested/copy.md");
    await page.goto(address.href);
    const button = page.getByRole("button", { name: "Copy code", exact: true });
    await expect(button).toHaveCount(1);
    expect(await page.locator("p code").count()).toBe(1);
    await button.focus();
    await button.press("Space");
    await expect(page.locator("pre [role=status]")).toHaveText("Copied");
    expect(
      await page.evaluate(() => globalThis.navigator.clipboard.readText()),
    ).toBe('GET /notes?x=1&y=2\n\t{"label":"<safe>"}\n');
    const placement = await page.locator("pre").evaluate((pre) => {
      const parent = pre.getBoundingClientRect(),
        control = pre.querySelector("button").getBoundingClientRect(),
        code = pre.querySelector("code").getBoundingClientRect();
      return {
        topRight: control.top < code.top && control.right <= parent.right,
        clear: control.bottom <= code.top,
      };
    });
    expect(placement).toEqual({ topRight: true, clear: true });
    expect(
      await page
        .locator("pre code")
        .evaluate((code) => globalThis.getComputedStyle(code).fontFamily),
    ).toContain("Source Code Pro");
    await page.getByRole("button", { name: "Dark mode", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const darkPlacement = await page.locator("pre").evaluate((pre) => {
      const button = pre.querySelector("button"),
        control = button.getBoundingClientRect(),
        code = pre.querySelector("code").getBoundingClientRect();
      const style = globalThis.getComputedStyle(button);
      return {
        clear: control.bottom <= code.top,
        readable: style.color !== style.backgroundColor,
      };
    });
    expect(darkPlacement).toEqual({ clear: true, readable: true });
    await page.request.post(new URL("edit-code", ready.fixtureUrl).href);
    await expect(page.locator("pre code")).toContainText("external update");
    await button.click();
    await expect(page.locator("pre [role=status]")).toHaveText("Copied");
    expect(
      await page.evaluate(() => globalThis.navigator.clipboard.readText()),
    ).toBe('{\n\t"saved": "external update"\n}\n');
  } finally {
    const stopped = await fixture.stop();
    expect(stopped.code, stopped.stderr).toBe(0);
    expect(stopped.cleanup?.cleanup).toBe("complete");
  }
});

test("bundled free fonts load offline for prose, controls, code, Mermaid and native MathML", async ({
  page,
}) => {
  const fixture = createFixture(resolve("build/media-glance"));
  const outbound = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    outbound.push(url.hostname);
    return route.abort();
  });
  try {
    const ready = await fixture.ready;
    const info = await (
      await page.request.get(new URL("info", ready.fixtureUrl).href)
    ).json();
    const address = new URL(info.viewerUrl);
    address.searchParams.set("file", "zz-selected/nested/math.md");
    await page.goto(address.href);
    await requireNativeMathML(page);
    const fonts = await page.evaluate(async () => {
      const specs = [
        '400 16px "Source Serif 4"',
        '700 16px "Source Serif 4"',
        'italic 400 16px "Source Serif 4"',
        'italic 700 16px "Source Serif 4"',
        '400 14px "Source Sans 3"',
        '400 14px "Source Code Pro"',
        '400 16px "STIX Two Math"',
      ];
      const loaded = await Promise.all(
        specs.map(async (value) => {
          const faces = await globalThis.document.fonts.load(value);
          return (
            faces.length > 0 && faces.every((face) => face.status === "loaded")
          );
        }),
      );
      await globalThis.document.fonts.ready;
      return loaded;
    });
    expect(fonts).toEqual(Array(7).fill(true));
    const familiesHandle = await page.waitForFunction(() => {
      if (
        !globalThis.document.querySelector(".mermaid .media-viewer math") ||
        !globalThis.document.querySelector(".mermaid .nodeLabel")
      )
        return false;
      return {
        prose: globalThis.getComputedStyle(
          globalThis.document.querySelector("article"),
        ).fontFamily,
        ui: globalThis.getComputedStyle(
          globalThis.document.querySelector("#theme-toggle"),
        ).fontFamily,
        math: globalThis.getComputedStyle(
          globalThis.document.querySelector("math"),
        ).fontFamily,
        diagram: globalThis.getComputedStyle(
          globalThis.document.querySelector(".mermaid .nodeLabel"),
        ).fontFamily,
      };
    });
    const families = await familiesHandle.jsonValue();
    await familiesHandle.dispose();
    expect(families.prose).toContain("Source Serif 4");
    expect(families.ui).toContain("Source Sans 3");
    expect(families.math).toContain("STIX Two Math");
    expect(families.diagram).toContain("Source Sans 3");
    const geometry = (selector) =>
      page.locator(selector).evaluate((svg) => ({
        viewBox: svg.getAttribute("viewBox"),
        labels: [...svg.querySelectorAll(".nodeLabel")].map((label) => ({
          family: globalThis.getComputedStyle(label).fontFamily,
          width: label.offsetWidth,
        })),
        math: [...svg.querySelectorAll("math")].map(
          (node) => globalThis.getComputedStyle(node).fontFamily,
        ),
      }));
    const ordinary = await geometry(".mermaid svg");
    expect(ordinary.labels.length).toBeGreaterThan(0);
    expect(ordinary.math.length).toBeGreaterThan(0);
    await page
      .getByRole("button", { name: "Expand Mermaid diagram", exact: true })
      .click();
    const expanded = await geometry("dialog svg");
    expect(expanded.viewBox).toBe(ordinary.viewBox);
    expect(expanded.labels.map((label) => label.family)).toEqual(
      ordinary.labels.map((label) => label.family),
    );
    expect(expanded.math).toEqual(ordinary.math);
    expect(
      expanded.math.every((family) => family.includes("STIX Two Math")),
    ).toBe(true);
    // Expansion must retain label metrics, not just a font name declaration.
    for (const [index, label] of expanded.labels.entries()) {
      expect(label.width).toBeCloseTo(ordinary.labels[index].width, 1);
    }
    await expect(page.locator("dialog [data-theme-control]")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Close expanded view", exact: true })
      .click();
    expect((await geometry(".mermaid svg")).labels).toEqual(ordinary.labels);
    expect(outbound).toEqual([]);
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
