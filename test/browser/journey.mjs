export function validateFixture(info, fixture) {
  if (fixture.hostname !== "127.0.0.1")
    throw new Error("Expected loopback synthetic fixture");
  const viewer = new URL(info.viewerUrl);
  if (
    info.type !== "owned-media-viewer-browser-fixture" ||
    info.version !== 1 ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(info.runId) ||
    viewer.protocol !== "http:" ||
    viewer.hostname !== "127.0.0.1" ||
    Number(viewer.port) < 57300 ||
    Number(viewer.port) > 57399 ||
    !/^\/v\/[0-9a-f]{64}\/$/.test(viewer.pathname) ||
    [...viewer.searchParams.keys()].length !== 1 ||
    viewer.searchParams.get("file") !== info.initialFile ||
    viewer.hash ||
    info.initialFile !== "zz-selected/nested/current.md"
  ) {
    throw new Error("Fixture ownership or viewer boundary invalid");
  }
}

export function mediaFitReady({ requireFit = false, snapshot = false } = {}) {
  const ready =
    document.querySelectorAll(".media-viewer").length === 3 &&
    [...document.querySelectorAll("img")].every((image) => {
      const wrapper = image.closest(".media-viewer");
      const percent = wrapper?.querySelector("output").textContent;
      const width = Number.parseFloat(image.style.width);
      const height = Number.parseFloat(image.style.height);
      if (
        !image.complete ||
        !image.naturalWidth ||
        !percent ||
        !(width > 0 && height > 0)
      )
        return false;
      if (!requireFit) return true;
      const viewport = wrapper.querySelector(".media-viewport");
      const fit = Math.min(
        1,
        viewport.clientWidth / image.naturalWidth,
        Math.max(120, window.innerHeight * 0.7) / image.naturalHeight,
      );
      const fittedStyle = document.createElement("div").style;
      fittedStyle.width = `${image.naturalWidth * fit}px`;
      fittedStyle.height = `${image.naturalHeight * fit}px`;
      return (
        percent === "100%" &&
        image.style.width === fittedStyle.width &&
        image.style.height === fittedStyle.height
      );
    });
  if (!ready || !snapshot) return ready;

  const selected = document.querySelector('[aria-current="page"]');
  const nav = document.querySelector("nav");
  const item = selected.getBoundingClientRect();
  const bounds = nav.getBoundingClientRect();
  return {
    selected: selected.textContent,
    visible: item.top >= bounds.top && item.bottom <= bounds.bottom,
    sidebarScroll: nav.scrollTop,
    panelScroll: document.querySelector("#panel").scrollTop,
    font: getComputedStyle(document.querySelector("article")).fontSize,
    maxWidth: getComputedStyle(document.querySelector(".document")).maxWidth,
    declaredWidth: [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .find((rule) => rule.selectorText === ".document").style.maxWidth,
    imageWidth: document.querySelector("img").getBoundingClientRect().width,
    imageStyle: document.querySelector("img").style.width,
    imageFit: document
      .querySelector("img")
      .closest(".media-viewer")
      .querySelector("output").textContent,
    diagramWidth: document.querySelector(".mermaid svg").getBoundingClientRect()
      .width,
  };
}

export async function captureMediaSnapshot(page) {
  // Capture in the readiness poll: SSE can replace fitted media before a separate read.
  const snapshot = await page.waitForFunction(
    mediaFitReady,
    { requireFit: true, snapshot: true },
    { timeout: 10000 },
  );
  try {
    return await snapshot.jsonValue();
  } finally {
    await snapshot.dispose();
  }
}

export async function requireNativeMathML(page) {
  await page.locator(".mermaid math").first().waitFor({
    state: "attached",
    timeout: 10000,
  });
}

export async function mediaViewerBrowserSpec(page) {
  // The supplied tab must point at our synthetic fixture controller, never a user's workspace.
  const fixture = new URL(page.url());
  if (fixture.hostname !== "127.0.0.1")
    throw new Error("Expected loopback synthetic fixture tab");
  const infoResponse = await page.request.get(new URL("info", fixture).href);
  if (!infoResponse.ok())
    throw new Error("Synthetic fixture controller unavailable");
  const info = await infoResponse.json();
  validateFixture(info, fixture);
  const context = await page
    .context()
    .browser()
    .newContext({ viewport: { width: 1640, height: 1100 } });
  const test = await context.newPage();
  const outcomes = [];
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const address = (file) => {
    const url = new URL(info.viewerUrl);
    url.searchParams.set("file", `zz-selected/nested/${file}`);
    return url.href;
  };
  const button = (name) => test.getByRole("button", { name, exact: true });
  const mutate = async (operation) => {
    const response = await context.request.post(
      new URL(operation, fixture).href,
    );
    assert(response.ok(), `Fixture mutation failed: ${operation}`);
  };
  const ready = async (requireFit = false) => {
    await button("Zoom in Mermaid diagram").waitFor();
    await test.waitForFunction(
      mediaFitReady,
      { requireFit },
      { timeout: 10000 },
    );
  };
  try {
    await test.goto(info.viewerUrl);
    const initial = await captureMediaSnapshot(test);
    assert(
      initial.selected === "current.md" &&
        initial.visible &&
        initial.sidebarScroll > 0,
      "Initial current file must be revealed in nested sidebar",
    );
    assert(
      initial.panelScroll === 0 &&
        initial.font === "16px" &&
        initial.declaredWidth === "123ch",
      "Content width/font or initial document position changed",
    );
    for (let index = 0; index < 5; index++)
      await button("Zoom in Mermaid diagram").click();
    const zoom = await test.evaluate(() => {
      const viewport = document.querySelector(".mermaid .media-viewport");
      viewport.scrollLeft = viewport.scrollWidth;
      viewport.scrollTop = viewport.scrollHeight;
      return {
        width: viewport.querySelector("svg").getBoundingClientRect().width,
        left: viewport.scrollLeft,
        maximumLeft: viewport.scrollWidth - viewport.clientWidth,
        top: viewport.scrollTop,
        maximumTop: viewport.scrollHeight - viewport.clientHeight,
        font: getComputedStyle(document.querySelector("article")).fontSize,
        imageWidth: document.querySelector("img").getBoundingClientRect().width,
        imageStyle: document.querySelector("img").style.width,
      };
    });
    assert(
      zoom.width > initial.diagramWidth * 3 &&
        zoom.left > 0 &&
        zoom.left === zoom.maximumLeft &&
        zoom.top === zoom.maximumTop,
      "Enlarged diagram must grow and expose its far edges",
    );
    assert(
      zoom.font === initial.font && zoom.imageWidth === initial.imageWidth,
      `Diagram zoom changed other content: ${JSON.stringify({ initial, zoom })}`,
    );
    await button("Zoom out Mermaid diagram").click();
    assert(
      (await test.locator(".mermaid output").textContent()) === "244%",
      "Zoom out must reduce actual zoom",
    );
    await button("Fit Mermaid diagram").click();
    const fitted = await test
      .locator(".mermaid .media-viewport")
      .evaluate((viewport) => ({
        percent:
          viewport.previousElementSibling.querySelector("output").textContent,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
        width: viewport.querySelector("svg").getBoundingClientRect().width,
        viewportWidth: viewport.clientWidth,
      }));
    assert(
      fitted.percent === "100%" &&
        fitted.left === 0 &&
        fitted.top === 0 &&
        fitted.width <= fitted.viewportWidth + 1,
      "Fit must reset scale and pan",
    );
    for (let index = 0; index < 12; index++) {
      if (await button("Zoom out Mermaid diagram").isDisabled()) break;
      await button("Zoom out Mermaid diagram").click();
    }
    assert(
      (await button("Zoom out Mermaid diagram").isDisabled()) &&
        (await test.locator(".mermaid output").textContent()) === "25%",
      "Minimum zoom must stop at 25 percent",
    );
    for (let index = 0; index < 20; index++) {
      if (await button("Zoom in Mermaid diagram").isDisabled()) break;
      await button("Zoom in Mermaid diagram").click();
    }
    assert(
      (await button("Zoom in Mermaid diagram").isDisabled()) &&
        (await test.locator(".mermaid output").textContent()) === "800%",
      "Maximum zoom must stop at 800 percent",
    );
    await button("Fit Mermaid diagram").click();
    outcomes.push({
      charter: "Specific-media zoom and pan",
      outcome: "passed",
      initial,
      zoom,
    });

    await test.locator("#panel").evaluate((panel) => {
      panel.scrollTop = 350;
    });
    const scrollBefore = await test
      .locator("#panel")
      .evaluate((panel) => panel.scrollTop);
    await button("Expand Wide PNG").click();
    assert(
      (await test.getByRole("dialog").count()) === 1,
      "Expand must show one modal dialog",
    );
    assert(
      (await test.evaluate(() =>
        document.activeElement.getAttribute("aria-label"),
      )) === "Close expanded view",
      "Expanded view must receive keyboard focus",
    );
    await test.keyboard.press("Tab");
    assert(
      await test.evaluate(() =>
        document.querySelector("dialog").contains(document.activeElement),
      ),
      "Tab must remain in expanded dialog",
    );
    await test.keyboard.press("Escape");
    assert(
      (await test.getByRole("dialog").count()) === 0,
      "Escape must dismiss expanded view",
    );
    assert(
      (await test.evaluate(() =>
        document.activeElement.getAttribute("aria-label"),
      )) === "Expand Wide PNG",
      "Close must return focus to invoking control",
    );
    assert(
      (await test.locator("#panel").evaluate((panel) => panel.scrollTop)) ===
        scrollBefore,
      "Expand and close must preserve document scroll",
    );
    await button("Zoom in Wide PNG").click();
    await button("Expand Wide PNG").click();
    await mutate("edit-image");
    await test.waitForFunction(() => {
      const image = document.querySelector("dialog img");
      if (!image?.complete || !image.naturalWidth) return false;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const drawing = canvas.getContext("2d");
      drawing.drawImage(image, 0, 0, 1, 1);
      return drawing.getImageData(0, 0, 1, 1).data[0] === 187;
    });
    assert(
      (await test.locator("dialog output").textContent()) === "125%",
      "Expanded image refresh must preserve zoom",
    );
    await button("Close expanded view").click();
    await button("Zoom in Mermaid diagram").click();
    await button("Expand Mermaid diagram").click();
    await mutate("edit-diagram");
    await test.waitForFunction(() =>
      document
        .querySelector("dialog svg")
        ?.textContent.includes("externally_updated_field"),
    );
    assert(
      (await test.locator("dialog output").textContent()) === "125%",
      "Edited expanded diagram must preserve zoom",
    );
    await test.keyboard.press("Escape");
    await test.locator("nav").evaluate((nav) => {
      nav.scrollTop = 0;
    });
    const keptZoom = await test.locator(".mermaid output").textContent();
    await mutate("edit-prose");
    await test
      .getByText("External sidebar-refresh marker.", { exact: true })
      .waitFor();
    await ready();
    assert(
      (await test.locator("nav").evaluate((nav) => nav.scrollTop)) === 0,
      "Live refresh must not pull sidebar back to selected file",
    );
    assert(
      (await test.locator(".mermaid output").textContent()) === keptZoom,
      "Prose save must preserve existing diagram zoom",
    );
    outcomes.push({
      charter: "Expanded keyboard lifecycle and external saved files",
      outcome: "passed",
      preservedZoom: keptZoom,
      scrollBefore,
    });

    for (const file of ["large.svg", "large.png", "second.md"]) {
      await test.goto(address(file));
      const label = file === "second.md" ? "Second image" : file;
      await button(`Zoom in ${label}`).waitFor();
      await test.waitForFunction(
        () => document.querySelector("img")?.naturalWidth > 0,
      );
      await button(`Zoom in ${label}`).click();
      await button(`Expand ${label}`).click();
      await test.keyboard.press("Escape");
      await button(`Fit ${label}`).click();
      assert(
        (await test.locator('[aria-current="page"]').textContent()) === file,
        "Reopened same server must select requested focused file",
      );
    }
    await test.goto(address("math.md"));
    await button("Zoom in Mermaid diagram").waitFor();
    await requireNativeMathML(test);
    await test.goto(address("broken.md"));
    await test.getByText(/Diagram could not be rendered:/).waitFor();
    assert(
      (await test.locator(".media-viewer").count()) === 0,
      "Invalid diagram must not leave zoom controls",
    );
    await test.goto(address("current.md"));
    await ready();
    let release;
    let intercepted;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const seen = new Promise((resolve) => {
      intercepted = resolve;
    });
    const secondRoute = "**/api/file?path=zz-selected%2Fnested%2Fsecond.md";
    await test.route(secondRoute, async (route) => {
      intercepted();
      await gate;
      await route.continue();
    });
    await button("second.md").click();
    await Promise.race([
      seen,
      test.waitForTimeout(5000).then(() => {
        throw new Error(
          "Delayed navigation was not intercepted within 5 seconds",
        );
      }),
    ]);
    await button("current.md").click();
    await ready();
    const response = test.waitForResponse((url) =>
      url.url().includes("api/file?path=zz-selected%2Fnested%2Fsecond.md"),
    );
    release();
    await response;
    await test.unroute(secondRoute);
    assert(
      (await test.locator(".file-title").textContent()) ===
        "zz-selected/nested/current.md",
      "Delayed old navigation response must not replace current file",
    );
    assert(
      (await test.locator(".media-viewer").count()) === 3 &&
        (await test.getByRole("dialog").count()) === 0,
      "Navigation must remove stale controls/modal",
    );
    outcomes.push({
      charter: "Standalone assets, errors, and out-of-order navigation",
      outcome: "passed",
    });

    await test.setViewportSize({ width: 600, height: 800 });
    const narrow = await test.evaluate(() => ({
      body: document.body.scrollWidth,
      viewport: innerWidth,
      buttons: [...document.querySelectorAll(".media-toolbar button")].map(
        (control) => ({
          width: control.getBoundingClientRect().width,
          height: control.getBoundingClientRect().height,
        }),
      ),
      font: getComputedStyle(document.querySelector("article")).fontSize,
    }));
    assert(
      narrow.body === narrow.viewport && narrow.font === "16px",
      "Narrow screen must keep document within viewport and font size",
    );
    assert(
      narrow.buttons.every(
        (control) => control.width >= 44 && control.height >= 44,
      ),
      "Media controls need accessible target sizes",
    );
    await button("Expand Mermaid diagram").click();
    assert(
      (await test
        .getByRole("dialog")
        .evaluate((dialog) => dialog.getBoundingClientRect().width)) <= 600,
      "Expanded media must fit narrow viewport",
    );
    await test.keyboard.press("Escape");
    outcomes.push({
      charter: "Responsive content and controls",
      outcome: "passed",
      narrow,
    });
    return { verdict: "passed", outcomes };
  } finally {
    await context.close();
  }
}
