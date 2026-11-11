import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { boot } from "../../web/app.js";
import { mediaViewers } from "../../web/media.js";

function fixture(files = {}, tree = []) {
  const dom = new JSDOM(
    '<header><button id="sidebar-toggle" type="button" aria-controls="sidebar" aria-expanded="true">Hide sidebar</button><b id="workspace"></b><span id="status"></span><button id="search-files" type="button">Search files</button><button id="theme-toggle" type="button">Light mode</button></header><dialog id="file-finder" aria-labelledby="file-finder-title"><h2 id="file-finder-title">Search files</h2><label for="file-finder-query">File name or path</label><input id="file-finder-query" type="search" aria-controls="file-finder-results" /><p id="file-finder-status" role="status"></p><div id="file-finder-results" role="listbox" aria-label="Files"></div><button id="file-finder-close" type="button">Close</button></dialog><div class="layout"><nav id="sidebar"><div id="tree"></div></nav><div id="sidebar-resizer" role="separator" aria-orientation="vertical" aria-controls="sidebar" aria-label="Resize sidebar" aria-valuemin="176" aria-valuemax="640" aria-valuenow="272" tabindex="0"></div><main id="panel"></main></div>',
    { url: "http://127.0.0.1:57300/v/token/?file=doc.md" },
  );
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = function () {
    this.revealed = true;
  };
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
    this.querySelector("input")?.focus();
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.CSS = { escape: (v) => v };
  w.matchMedia = () => ({ matches: false });
  let requests = [],
    streams = [],
    timers = [],
    disconnects = 0;
  w.ResizeObserver = class {
    constructor(fn) {
      this.fn = fn;
    }
    observe() {
      this.fn();
    }
    disconnect() {
      disconnects++;
    }
  };
  w.fetch = async (route) => {
    requests.push(route);
    const url = new URL(route, w.location.href);
    const path = url.searchParams.get("path");
    const result = url.pathname.endsWith("/info")
      ? { root: "/synthetic/workspace" }
      : url.pathname.endsWith("/tree")
        ? { entries: typeof tree === "function" ? tree(path) : tree }
        : files[path];
    if (result instanceof Error)
      return { ok: false, text: async () => result.message };
    if (typeof result === "function") return result();
    return { ok: true, json: async () => result };
  };
  w.EventSource = class {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      streams.push(this);
    }
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    }
    close() {
      this.closed = true;
    }
    async emit(name, data) {
      this.listeners[name]?.({ data });
      await settle();
    }
  };
  w.setTimeout = (fn) => {
    timers.push(fn);
    return timers.length;
  };
  w.clearTimeout = () => {};
  w.loadMermaid = async () => ({
    default: {
      initialize() {},
      async render(id, source) {
        if (source === "bad") throw new Error("syntax");
        return { svg: '<svg viewBox="0 0 100 100"></svg>' };
      },
    },
  });
  w.mediaViewers = () => ({
    image() {},
    diagram() {},
    complete() {},
    dispose() {},
  });
  return {
    w,
    dom,
    requests,
    streams,
    timers,
    advanceTimers: async () => {
      for (const fn of timers.splice(0)) {
        fn();
        await settle();
      }
    },
    get disconnects() {
      return disconnects;
    },
  };
}
async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}
const markdown = (html) => ({
  path: "doc.md",
  kind: "markdown",
  html,
  url: "api/raw?path=doc.md",
});

test("external HTTP links request a separate context safely, preserving local and mailto links", async () => {
  const f = fixture({
    "doc.md": markdown(
      '<a id="http" href="http://example.test/read">HTTP</a>' +
        '<a id="https" href="https://example.test/read">HTTPS</a>' +
        '<a id="auto" href="https://example.test/auto">https://example.test/auto</a>' +
        '<a id="linked" href="https://example.test/image"><img src="api/raw?path=a.png"></a>' +
        '<a id="local" data-file="next.md" href="http://127.0.0.1:57300/v/token/?file=next.md">Local</a>' +
        '<a id="mail" href="mailto:reader@example.test">Email</a>' +
        '<a id="anchor" href="#section">Section</a>' +
        '<a id="relative" href="?file=next.md">Relative</a>',
    ),
  });
  const app = await boot(f.w);
  for (const id of ["http", "https", "auto", "linked"]) {
    const link = f.w.document.getElementById(id);
    assert.equal(
      link.target,
      "_blank",
      `${id} should request a separate browsing context`,
    );
    assert.equal(
      link.rel,
      "noopener noreferrer",
      `${id} should protect the opener and referrer`,
    );
  }
  for (const id of ["local", "mail", "anchor", "relative"])
    assert.equal(
      f.w.document.getElementById(id).target,
      "",
      `${id} must keep its existing navigation semantics`,
    );
  assert.equal(f.w.location.search, "?file=doc.md");
  app.dispose();
  f.dom.window.close();
});

test("theme follows the system initially, persists manual choices and tolerates invalid or denied storage", async () => {
  for (const scenario of [
    { systemDark: true, saved: null, initial: "dark" },
    { systemDark: false, saved: null, initial: "light" },
    { systemDark: false, saved: "dark", initial: "dark" },
    { systemDark: true, saved: "light", initial: "light" },
    { systemDark: true, saved: "invalid", initial: "dark" },
    { systemDark: false, denied: true, initial: "light" },
    { systemDark: true, deniedWrite: true, initial: "dark" },
  ]) {
    const f = fixture({ "doc.md": markdown("Theme fixture") });
    f.w.matchMedia = () => ({ matches: scenario.systemDark });
    if (scenario.saved)
      f.w.localStorage.setItem("media-glance.theme", scenario.saved);
    if (scenario.denied)
      Object.defineProperty(f.w, "localStorage", {
        get() {
          throw new Error("storage denied");
        },
      });
    if (scenario.deniedWrite)
      Object.defineProperty(f.w, "localStorage", {
        value: {
          getItem() {
            return null;
          },
          setItem() {
            throw new Error("storage quota");
          },
        },
      });
    const app = await boot(f.w);
    assert.equal(f.w.document.documentElement.dataset.theme, scenario.initial);
    f.w.document.dispatchEvent(new f.w.MouseEvent("click", { bubbles: true }));
    assert.equal(f.w.document.documentElement.dataset.theme, scenario.initial);
    const button = f.w.document.getElementById("theme-toggle");
    const next = scenario.initial === "dark" ? "light" : "dark";
    assert.equal(
      button.textContent,
      `${next === "light" ? "Light" : "Dark"} mode`,
    );
    button.click();
    await settle();
    assert.equal(f.w.document.documentElement.dataset.theme, next);
    if (!scenario.denied && !scenario.deniedWrite)
      assert.equal(f.w.localStorage.getItem("media-glance.theme"), next);
    app.dispose();
    button.click();
    assert.equal(
      f.w.document.documentElement.dataset.theme,
      next,
      "disposed theme control must stop reacting",
    );
    f.dom.window.close();
  }
});

test("theme changes re-render Mermaid and preserve file, document scroll, explorer scroll and media state", async () => {
  const f = fixture({
    "doc.md": markdown('<div class="mermaid" data-diagram="good"></div>'),
  });
  f.w.matchMedia = () => ({ matches: true });
  const themes = [],
    states = [],
    preservation = [];
  f.w.loadMermaid = async () => ({
    default: {
      initialize(options) {
        themes.push(options.theme);
      },
      async render() {
        return { svg: '<svg viewBox="0 0 100 100"></svg>' };
      },
    },
  });
  f.w.mediaViewers = (state) => {
    states.push(state);
    if (states.length === 1) {
      state.items.set("saved", { zoom: 2, left: 10, top: 20 });
      state.expanded = "saved";
    }
    return {
      image() {},
      diagram() {},
      complete() {},
      dispose(preserve) {
        preservation.push(preserve);
      },
    };
  };
  const app = await boot(f.w);
  const address = f.w.location.href;
  f.w.document.getElementById("panel").scrollTop = 80;
  f.w.document.querySelector("nav").scrollTop = 60;
  f.w.document.getElementById("theme-toggle").click();
  await settle();
  assert.deepEqual(themes, ["dark", "default"]);
  assert.equal(f.w.location.href, address);
  assert.equal(f.w.document.getElementById("panel").scrollTop, 80);
  assert.equal(f.w.document.querySelector("nav").scrollTop, 60);
  assert.equal(states.at(-1), states[0]);
  assert.equal(states.at(-1).items.get("saved").zoom, 2);
  assert.equal(states.at(-1).expanded, "saved");
  assert.equal(preservation[0], true);
  assert.equal(f.w.document.querySelectorAll("[data-theme-control]").length, 1);
  app.dispose();
  f.dom.window.close();
});

test("expanded media has no theme selector and preserves the header-selected mode through refresh", async () => {
  const f = fixture({
    "doc.md": markdown('<img alt="Example" src="api/raw?path=image.svg">'),
  });
  delete f.w.mediaViewers;
  Object.defineProperties(f.w.HTMLImageElement.prototype, {
    naturalWidth: {
      get() {
        return 1600;
      },
    },
    naturalHeight: {
      get() {
        return 800;
      },
    },
    complete: {
      get() {
        return true;
      },
    },
  });
  Object.defineProperty(f.w.HTMLElement.prototype, "clientWidth", {
    get() {
      return 600;
    },
  });
  Object.defineProperty(f.w.HTMLElement.prototype, "clientHeight", {
    get() {
      return 400;
    },
  });
  const app = await boot(f.w);
  f.w.document.querySelector('[aria-label="Expand Example"]').click();
  assert.equal(
    f.w.document.querySelector(".media-dialog [data-theme-control]"),
    null,
    "expanded assets must not contain theme selection",
  );
  assert.equal(f.w.document.querySelectorAll("[data-theme-control]").length, 1);
  assert.equal(f.w.document.documentElement.dataset.theme, "light");
  await app.refresh();
  await settle();
  assert.equal(
    f.w.document.querySelector(".media-dialog [data-theme-control]"),
    null,
  );
  assert.ok(
    f.w.document.querySelector(".media-dialog"),
    "live refresh preserves expanded media",
  );
  f.w.document.querySelector('[aria-label="Close expanded view"]').click();
  f.w.document.getElementById("theme-toggle").click();
  await settle();
  assert.equal(f.w.document.documentElement.dataset.theme, "dark");
  f.w.document.querySelector('[aria-label="Expand Example"]').click();
  assert.equal(
    f.w.document.querySelector(".media-dialog [data-theme-control]"),
    null,
  );
  assert.equal(f.w.document.documentElement.dataset.theme, "dark");
  app.dispose();
  assert.equal(f.w.document.querySelector(".media-dialog"), null);
  f.dom.window.close();
});

test("code copy uses exact rendered code, reports results and ignores obsolete pending controls", async () => {
  const code = 'GET /notes?x=1&y=2\n\t{"label":"<safe>"}\n';
  const f = fixture({
    "doc.md": markdown(
      "<p><code>inline</code></p><pre><code>GET /notes?x=1&amp;y=2\n\t{&quot;label&quot;:&quot;&lt;safe&gt;&quot;}\n</code></pre>",
    ),
  });
  const copies = [];
  Object.defineProperty(f.w.navigator, "clipboard", {
    configurable: true,
    value: {
      async writeText(text) {
        copies.push(text);
      },
    },
  });
  const app = await boot(f.w);
  const button = f.w.document.querySelector("[data-copy-code]");
  assert.ok(button, "fenced code needs an accessible copy action");
  assert.equal(button.getAttribute("aria-label"), "Copy code");
  assert.equal(
    f.w.document.querySelectorAll("[data-copy-code]").length,
    1,
    "inline code gets no copy action",
  );
  button.click();
  await settle();
  assert.deepEqual(copies, [code]);
  assert.equal(
    f.w.document.querySelector("pre [role=status]").textContent,
    "Copied",
  );
  assert.equal(button.disabled, false);
  f.w.navigator.clipboard.writeText = async () => {
    throw new Error("denied");
  };
  button.click();
  await settle();
  assert.equal(
    f.w.document.querySelector("pre [role=status]").textContent,
    "Copy failed",
  );
  Object.defineProperty(f.w.navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  button.click();
  await settle();
  assert.equal(
    f.w.document.querySelector("pre [role=status]").textContent,
    "Copy failed",
  );
  let resolve;
  Object.defineProperty(f.w.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText() {
        return new Promise((done) => {
          resolve = done;
        });
      },
    },
  });
  button.click();
  await settle();
  assert.equal(button.disabled, true);
  await app.refresh();
  await settle();
  const fresh = f.w.document.querySelector("[data-copy-code]");
  resolve();
  await settle();
  assert.notEqual(fresh, button);
  assert.equal(f.w.document.querySelector("pre [role=status]").textContent, "");
  fresh.click();
  await settle();
  app.dispose();
  resolve();
  await settle();
  assert.equal(
    fresh.disabled,
    true,
    "disposed page must not mutate pending copy controls",
  );
  f.dom.window.close();
});

test("viewer waits for bundled UI/math fonts before fitting media or rendering Mermaid", async () => {
  const f = fixture({
    "doc.md": markdown('<div class="mermaid" data-diagram="good"></div>'),
  });
  let release,
    rendered = 0;
  const loaded = [];
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  Object.defineProperty(f.w.document, "fonts", {
    value: {
      load(face) {
        loaded.push(face);
        return wait;
      },
      ready: wait,
    },
  });
  f.w.loadMermaid = async () => ({
    default: {
      initialize(config) {
        assert.equal(config.fontFamily, "Source Sans 3");
        assert.equal(config.themeVariables.fontFamily, "Source Sans 3");
        assert.match(config.themeCSS, /\.nodeLabel/);
        assert.match(config.themeCSS, /font-weight:600/);
        assert.deepEqual(config.sequence, {
          actorFontFamily: "Source Sans 3",
          noteFontFamily: "Source Sans 3",
          messageFontFamily: "Source Sans 3",
        });
        assert.deepEqual(config.journey, {
          taskFontFamily: "Source Sans 3",
          titleFontFamily: "Source Sans 3",
        });
        assert.equal(config.timeline.taskFontFamily, "Source Sans 3");
        assert.equal(Object.keys(config.c4).length, 22);
        assert.ok(
          Object.values(config.c4).every((value) => value === "Source Sans 3"),
        );
      },
      async render() {
        rendered++;
        return { svg: '<svg viewBox="0 0 100 100"></svg>' };
      },
    },
  });
  const pending = boot(f.w);
  await settle();
  assert.ok(
    loaded.some((face) => face.includes("Source Sans 3")),
    "UI font must load before Mermaid geometry",
  );
  assert.ok(
    loaded.some((face) => face.includes("STIX Two Math")),
    "native math font must load before Mermaid geometry",
  );
  assert.equal(rendered, 0);
  release();
  const app = await pending;
  assert.equal(rendered, 1);
  app.dispose();
  f.dom.window.close();
});

test("disposing during pending font readiness cannot attach media or diagrams", async () => {
  const f = fixture({
    "doc.md": markdown('<div class="mermaid" data-diagram="good"></div>'),
  });
  let release,
    renders = 0;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  Object.defineProperty(f.w.document, "fonts", {
    value: {
      load() {
        return wait;
      },
      ready: wait,
    },
  });
  f.w.loadMermaid = async () => {
    renders++;
    throw new Error("disposed renderer loaded");
  };
  const pending = boot(f.w);
  await settle();
  f.w.dispatchEvent(new f.w.Event("pagehide"));
  release();
  await pending;
  assert.equal(renders, 0);
  assert.equal(f.w.document.querySelector(".media-viewer"), null);
  f.dom.window.close();
});

test("latest theme wins during delayed Mermaid rendering and disposed pending loads cannot update the page", async () => {
  const f = fixture({
    "doc.md": markdown('<div class="mermaid" data-diagram="good"></div>'),
  });
  let current,
    hold = false;
  const renders = [];
  f.w.loadMermaid = async () => ({
    default: {
      initialize(options) {
        current = options.theme;
      },
      async render() {
        const result = {
          svg: `<svg data-rendered-theme="${current}" viewBox="0 0 100 100"></svg>`,
        };
        if (!hold) return result;
        return new Promise((resolve) => renders.push(() => resolve(result)));
      },
    },
  });
  const app = await boot(f.w);
  hold = true;
  f.w.document.getElementById("theme-toggle").click();
  await settle();
  f.w.document.getElementById("theme-toggle").click();
  await settle();
  assert.equal(renders.length, 2);
  renders[1]();
  await settle();
  renders[0]();
  await settle();
  assert.equal(f.w.document.documentElement.dataset.theme, "light");
  assert.equal(
    f.w.document.querySelector("svg").dataset.renderedTheme,
    "default",
  );
  app.dispose();
  f.dom.window.close();

  const other = fixture({
    "doc.md": markdown('<div class="mermaid" data-diagram="good"></div>'),
  });
  let release,
    initialized = 0;
  other.w.loadMermaid = () =>
    new Promise((resolve) => {
      release = () =>
        resolve({
          default: {
            initialize() {
              initialized++;
            },
            render() {
              throw new Error("disposed render reached");
            },
          },
        });
    });
  const pending = boot(other.w);
  await settle();
  other.w.dispatchEvent(new other.w.Event("pagehide"));
  release();
  await pending;
  assert.equal(initialized, 0);
  assert.equal(other.w.document.querySelector("svg"), null);
  other.dom.window.close();
});

test("boot renders selected markdown, revises local assets, follows internal links and cleans up", async () => {
  const f = fixture(
    {
      "doc.md": markdown(
        '<h1 id="top">Hello</h1><img src="api/raw?path=a.png"><img src="https://example.com/a.png"><a data-file="text.txt" href="?file=text.txt#top">Next</a>',
      ),
      "text.txt": {
        path: "text.txt",
        kind: "text",
        text: "literal <b>",
        url: "raw",
      },
    },
    [
      { name: "doc.md", path: "doc.md", kind: "file" },
      { name: "text.txt", path: "text.txt", kind: "file" },
    ],
  );
  const app = await boot(f.w);
  assert.equal(f.w.document.title, "workspace · Workspace media");
  assert.match(f.w.document.querySelector("img").src, /revision=/);
  assert.equal(
    f.w.document.querySelectorAll("img")[1].src,
    "https://example.com/a.png",
  );
  const link = f.w.document.querySelector("a[data-file]");
  link.dispatchEvent(
    new f.w.MouseEvent("click", {
      bubbles: true,
      ctrlKey: true,
      cancelable: true,
    }),
  );
  assert.ok(f.w.document.querySelector("h1"));
  link.dispatchEvent(
    new f.w.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  await settle();
  assert.equal(
    f.w.document.querySelector("pre > code").textContent,
    "literal <b>",
  );
  f.w.history.replaceState(null, "", "?file=doc.md#top");
  f.w.dispatchEvent(new f.w.PopStateEvent("popstate"));
  await settle();
  assert.ok(f.w.document.querySelector("#top").revealed);
  f.w.dispatchEvent(new f.w.Event("pagehide"));
  assert.ok(f.streams.at(-1).closed);
  app.dispose();
  f.dom.window.close();
});

test("all standalone preview types, empty selection and file errors produce appropriate content", async () => {
  const f = fixture({ "doc.md": markdown("x") });
  const app = await boot(f.w);
  for (const kind of ["image", "pdf", "audio", "video", "binary"]) {
    f.w.fetch = async () => {}; // boot captures fetch; mutate files through the original reference below in a new fixture.
    const other = fixture({
      "doc.md": {
        path: "doc.md",
        kind,
        name: "asset",
        url: "api/raw?path=asset",
      },
    });
    const viewer = await boot(other.w);
    const selector = {
      image: "img",
      pdf: "iframe",
      audio: "audio",
      video: "video",
      binary: "p",
    }[kind];
    assert.ok(other.w.document.querySelector(selector));
    viewer.dispose();
    other.dom.window.close();
  }
  await app.navigate("");
  assert.match(
    f.w.document.querySelector("#panel").textContent,
    /Choose a file/,
  );
  await app.navigate("missing");
  assert.match(f.w.document.querySelector(".error").textContent, /undefined/);
  app.dispose();
  f.dom.window.close();
});

test("recursive tree expands, collapses descendants, selects files and surfaces unreadable folders", async () => {
  const files = {
    "doc.md": markdown("Hello"),
    "nested/doc.md": { ...markdown("Nested"), path: "nested/doc.md" },
  };
  let fail = false;
  const f = fixture(files, (path) => {
    if (path === "nested" && fail) throw new Error("denied");
    return path === ""
      ? [
          { name: "nested", path: "nested", kind: "directory" },
          { name: "doc.md", path: "doc.md", kind: "file" },
        ]
      : [{ name: "doc.md", path: "nested/doc.md", kind: "file" }];
  });
  const app = await boot(f.w);
  const click = async (selector) => {
    f.w.document.querySelector(selector).click();
    await settle();
  };
  await click(".folder");
  assert.equal(
    f.w.document.querySelector(".folder").getAttribute("aria-expanded"),
    "true",
  );
  await click(".children .entry");
  assert.equal(
    f.w.document.querySelector(".file-title").textContent,
    "nested/doc.md",
  );
  fail = true;
  await app.refresh();
  assert.match(
    f.w.document.querySelector("#tree .error").textContent,
    /denied/,
  );
  await click(".folder");
  assert.equal(
    f.w.document.querySelector(".folder").getAttribute("aria-expanded"),
    "false",
  );
  app.dispose();
  f.dom.window.close();
});

test("SSE recovers errors, ignores stale streams, coalesces refreshes and preserves status", async () => {
  const f = fixture({ "doc.md": markdown("Hello") });
  const app = await boot(f.w);
  const first = f.streams[0];
  app.subscribe();
  assert.equal(f.streams.length, 1);
  await first.emit("watch-error", JSON.stringify({ message: "failed" }));
  assert.equal(f.w.document.querySelector("#status").textContent, "failed");
  await first.emit("watch-error", "invalid");
  assert.match(
    f.w.document.querySelector("#status").textContent,
    /watcher failed/,
  );
  await first.emit("error");
  assert.ok(first.closed);
  await f.timers[0]();
  await first.emit("open");
  await first.emit("error");
  assert.equal(f.streams.length, 2);
  const second = f.streams[1];
  await second.emit("open");
  assert.equal(f.w.document.querySelector("#status").textContent, "Live");
  second.listeners.change();
  second.listeners.change();
  await settle();
  assert.ok(f.requests.length > 5);
  app.dispose();
  f.dom.window.close();
});

test("mermaid success, syntax failure and loader failure are isolated to diagrams", async () => {
  for (const mode of ["success", "syntax", "loader"]) {
    const f = fixture({
      "doc.md": markdown(
        '<div class="mermaid" data-diagram="' +
          (mode === "syntax" ? "bad" : "good") +
          '"></div>',
      ),
    });
    let drawn = 0;
    f.w.mediaViewers = () => ({
      image() {},
      diagram() {
        drawn++;
      },
      complete() {},
      dispose() {},
    });
    if (mode === "loader")
      f.w.loadMermaid = async () => {
        throw new Error("load failed");
      };
    const app = await boot(f.w);
    if (mode === "success") assert.equal(drawn, 1);
    else assert.ok(f.w.document.querySelector(".mermaid .error"));
    app.dispose();
    f.dom.window.close();
  }
});

test("startup failure and out of order navigation cannot replace current content", async () => {
  const f = fixture({ "doc.md": markdown("initial") });
  f.w.fetch = async () => ({ ok: false, text: async () => "unavailable" });
  const app = await boot(f.w);
  assert.equal(
    f.w.document.querySelector("#status").textContent,
    "Unavailable",
  );
  app.dispose();
  f.dom.window.close();
  let release;
  const g = fixture({
    "doc.md": markdown("initial"),
    "old.md": () =>
      new Promise((resolve) => {
        release = () =>
          resolve({ ok: true, json: async () => markdown("OLD") });
      }),
  });
  const viewer = await boot(g.w);
  const pending = viewer.navigate("old.md");
  await settle();
  await viewer.navigate("doc.md");
  release();
  await pending;
  assert.ok(!g.w.document.querySelector("#panel").textContent.includes("OLD"));
  viewer.dispose();
  g.dom.window.close();
});

function mediaFixture() {
  const f = fixture();
  const d = f.w.document;
  const image = d.createElement("img");
  image.src = "api/raw?path=image&revision=2";
  image.alt = "Example";
  Object.defineProperties(image, {
    naturalWidth: { value: 1600 },
    naturalHeight: { value: 800 },
    complete: { value: true },
  });
  d.querySelector("#panel").append(image);
  Object.defineProperty(f.w.HTMLElement.prototype, "clientWidth", {
    get() {
      return 600;
    },
  });
  Object.defineProperty(f.w.HTMLElement.prototype, "clientHeight", {
    get() {
      return 400;
    },
  });
  f.image = image;
  return f;
}

test("media controls change only media dimensions, clamp limits, preserve pan and modal state", () => {
  const f = mediaFixture();
  const state = { items: new Map(), expanded: null };
  const viewers = mediaViewers(state, f.w);
  viewers.image(f.image);
  viewers.complete();
  const button = (name) => f.w.document.querySelector(`[aria-label="${name}"]`);
  button("Zoom in Example").click();
  assert.equal(f.w.document.querySelector("output").textContent, "125%");
  const viewport = f.w.document.querySelector(".media-viewport");
  viewport.scrollLeft = 100;
  viewport.scrollTop = 20;
  viewport.dispatchEvent(new f.w.Event("scroll"));
  assert.equal([...state.items.values()][0].left, 100);
  for (let n = 0; n < 20; n++) button("Zoom in Example").click();
  assert.equal(f.w.document.querySelector("output").textContent, "800%");
  for (let n = 0; n < 30; n++) button("Zoom out Example").click();
  assert.equal(f.w.document.querySelector("output").textContent, "25%");
  button("Fit Example").click();
  assert.equal(viewport.scrollLeft, 0);
  button("Expand Example").click();
  assert.ok(f.w.document.querySelector(".media-dialog"));
  assert.ok(state.expanded);
  f.w.document
    .querySelector(".media-dialog")
    .dispatchEvent(new f.w.Event("cancel", { cancelable: true }));
  assert.equal(state.expanded, null);
  button("Expand Example").click();
  button("Close expanded view").click();
  assert.equal(f.w.document.activeElement, button("Expand Example"));
  button("Expand Example").click();
  viewers.dispose(true);
  assert.ok(state.expanded);
  assert.equal(f.disconnects, 1);
  f.dom.window.close();
});

test("SVG fallback, linked images, deferred loads, stale media and pruning clean up", () => {
  const f = mediaFixture();
  const state = { items: new Map([["stale", { zoom: 3 }]]), expanded: "stale" };
  const link = f.w.document.createElement("a");
  f.image.replaceWith(link);
  link.append(f.image);
  const viewers = mediaViewers(state, f.w);
  viewers.image(f.image);
  assert.equal(f.w.document.querySelector(".media-canvas a"), link);
  const svg = f.w.document.createElementNS("http://www.w3.org/2000/svg", "svg");
  Object.defineProperties(svg, {
    width: { value: { baseVal: { value: 500 } } },
    height: { value: { baseVal: { value: 250 } } },
  });
  f.w.document.querySelector("#panel").append(svg);
  viewers.diagram(svg, 0);
  const svg2 = svg.cloneNode();
  svg2.setAttribute("viewBox", "0 0 100 50");
  f.w.document.querySelector("#panel").append(svg2);
  viewers.diagram(svg2, 1);
  const loading = f.w.document.createElement("img");
  Object.defineProperty(loading, "complete", { value: false });
  f.w.document.querySelector("#panel").append(loading);
  viewers.image(loading);
  loading.dispatchEvent(new f.w.Event("load"));
  viewers.complete();
  assert.ok(!state.items.has("stale"));
  assert.equal(state.expanded, null);
  const expand = f.w.document.querySelector(
    '[aria-label="Expand Mermaid diagram"]',
  );
  expand.click();
  f.w.document.querySelector('[aria-label="Expand Example"]').click();
  assert.equal(f.w.document.querySelectorAll(".media-dialog").length, 1);
  viewers.dispose();
  loading.dispatchEvent(new f.w.Event("load"));
  f.dom.window.close();
});

test("unreadable root tree leaves the selected preview usable and shows the directory error", async () => {
  const f = fixture({ "doc.md": markdown("<h1>Visible preview</h1>") }, () => {
    throw new Error("directory denied");
  });
  const app = await boot(f.w);
  assert.match(
    f.w.document.querySelector("#tree").textContent,
    /directory denied/,
  );
  assert.equal(f.w.document.querySelector("h1").textContent, "Visible preview");
  app.dispose();
  f.dom.window.close();
});

test("dispose during pending navigation cannot reopen streams or change the document", async () => {
  let release;
  const f = fixture({
    "doc.md": markdown("current"),
    "delayed.md": () =>
      new Promise((resolve) => {
        release = () =>
          resolve({ ok: true, json: async () => markdown("late") });
      }),
  });
  const app = await boot(f.w);
  const pending = app.navigate("delayed.md");
  await settle();
  const before = f.w.document.querySelector("#panel").innerHTML;
  app.dispose();
  release();
  await pending;
  assert.equal(f.streams.length, 1);
  assert.ok(f.streams.every((stream) => stream.closed));
  assert.equal(f.w.document.querySelector("#panel").innerHTML, before);
  await app.navigate("doc.md");
  await app.refresh();
  app.subscribe(true);
  assert.equal(f.streams.length, 1);
  f.dom.window.close();
});
test("pagehide during pending startup cannot render content or create a subscription", async () => {
  let release;
  const f = fixture({ "doc.md": markdown("late") });
  const original = f.w.fetch;
  f.w.fetch = (route) =>
    route === "api/info"
      ? new Promise((resolve) => {
          release = () =>
            resolve({
              ok: true,
              json: async () => ({ root: "/late/workspace" }),
            });
        })
      : original(route);
  const pending = boot(f.w);
  await settle();
  f.w.dispatchEvent(new f.w.Event("pagehide"));
  release();
  const app = await pending;
  assert.equal(f.streams.length, 0);
  assert.equal(f.w.document.querySelector("#workspace").textContent, "");
  assert.equal(f.w.document.querySelector("#panel").innerHTML, "");
  app.dispose();
  f.dom.window.close();
});

test("live tree replacement preserves scrolling performed while its directory request is pending", async () => {
  let pause = false,
    release;
  const f = fixture({ "doc.md": markdown("current") });
  const original = f.w.fetch;
  f.w.fetch = (route, options) =>
    pause && route.startsWith("api/tree?")
      ? new Promise((resolve) => {
          release = () =>
            resolve({ ok: true, json: async () => ({ entries: [] }) });
        })
      : original(route, options);
  const app = await boot(f.w);
  const nav = f.w.document.querySelector("nav");
  nav.scrollTop = 40;
  pause = true;
  const pending = app.refresh();
  await settle();
  nav.scrollTop = 90;
  release();
  await pending;
  assert.equal(nav.scrollTop, 90);
  app.dispose();
  f.dom.window.close();
});
test("disposing pending Mermaid imports and renders ignores late resolution and errors", async () => {
  for (const mode of ["load", "render"]) {
    let release,
      initialize = 0;
    const f = fixture({
      "doc.md": markdown('<div class="mermaid" data-diagram="good"></div>'),
    });
    const renderer = {
      initialize() {
        initialize++;
      },
      render: () =>
        new Promise((_, reject) => {
          release = () => reject(new Error("late syntax"));
        }),
    };
    f.w.loadMermaid =
      mode === "load"
        ? () =>
            new Promise((resolve) => {
              release = () => resolve({ default: renderer });
            })
        : async () => ({ default: renderer });
    const pending = boot(f.w);
    await settle();
    f.w.dispatchEvent(new f.w.Event("pagehide"));
    const before = f.w.document.querySelector("#panel").innerHTML;
    release();
    const app = await pending;
    assert.equal(f.w.document.querySelector("#panel").innerHTML, before);
    assert.equal(f.streams.length, 0);
    assert.equal(initialize, mode === "load" ? 0 : 1);
    app.dispose();
    f.dom.window.close();
  }
});

test("highlighted text renders trusted token markup and keeps exact source for copy", async () => {
  const text = 'def answer():\n\treturn "test"\n';
  const tokens =
    '<span class="k">def</span> answer():\n\t<span class="k">return</span> <span class="s">"test"</span>\n';
  const html = `<pre class="chroma"><code class="language-python">${tokens}</code></pre>`;
  const f = fixture({
    "doc.md": {
      path: "doc.md",
      kind: "text",
      text,
      html,
      url: "api/raw?path=doc.md",
    },
  });
  const copies = [];
  Object.defineProperty(f.w.navigator, "clipboard", {
    configurable: true,
    value: {
      async writeText(value) {
        copies.push(value);
      },
    },
  });
  const app = await boot(f.w);
  const code = f.w.document.querySelector("#panel pre > code");
  assert.ok(code, "text previews use a code element for highlighted tokens");
  assert.equal(code.parentElement.classList.contains("chroma"), true);
  assert.equal(code.innerHTML, tokens);
  assert.equal(code.textContent, text);
  f.w.document.querySelector("[data-copy-code]").click();
  await settle();
  assert.deepEqual(copies, [text]);
  app.dispose();
  f.dom.window.close();
});

test("text without highlighted HTML stays escaped plaintext with exact whitespace", async () => {
  const text = '<script>\n\tprint("plain")\n</script>\n';
  const f = fixture({
    "doc.md": {
      path: "doc.md",
      kind: "text",
      text,
      url: "api/raw?path=doc.md",
    },
  });
  const app = await boot(f.w);
  const code = f.w.document.querySelector("#panel pre > code");
  assert.ok(code, "unhighlighted source remains a code block");
  assert.equal(code.textContent, text);
  assert.equal(code.querySelector("script"), null);
  app.dispose();
  f.dom.window.close();
});

test("Ctrl+K and the visible trigger open the finder and focus its query, while Meta+K does nothing", async () => {
  for (const init of [
    { metaKey: true },
    { metaKey: true, ctrlKey: true },
    { metaKey: true, shiftKey: true },
  ]) {
    const f = fixture({ "doc.md": markdown("Finder fixture") });
    const app = await boot(f.w);
    const event = new f.w.KeyboardEvent("keydown", {
      key: "k",
      bubbles: true,
      cancelable: true,
      ...init,
    });
    f.w.document.dispatchEvent(event);
    assert.equal(
      f.w.document.getElementById("file-finder").open,
      false,
      `${JSON.stringify(init)} must not open the finder`,
    );
    assert.equal(event.defaultPrevented, false);
    app.dispose();
    f.dom.window.close();
  }
  for (const open of [
    (document) =>
      document.dispatchEvent(
        new document.defaultView.KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    (document) => document.querySelector("#search-files").click(),
  ]) {
    const f = fixture({ "doc.md": markdown("Finder fixture") });
    const app = await boot(f.w);
    open(f.w.document);
    const dialog = f.w.document.querySelector("#file-finder");
    assert.equal(dialog.open, true);
    assert.equal(
      f.w.document.activeElement,
      f.w.document.querySelector("#file-finder-query"),
    );
    f.w.document.querySelector("#file-finder-close").click();
    app.dispose();
    f.dom.window.close();
  }
});

test("finder prompts on an empty query, reports partial matches, and navigates by keyboard", async () => {
  const f = fixture({
    "doc.md": markdown("Finder fixture"),
    "hidden-folder/deep.py": {
      path: "hidden-folder/deep.py",
      kind: "text",
      text: "print('found')\n",
      url: "api/raw?path=hidden-folder/deep.py",
    },
  });
  const requests = [];
  const originalFetch = f.w.fetch;
  f.w.fetch = async (route, options) => {
    if (route.startsWith("api/search?")) {
      requests.push({ route, signal: options.signal });
      return {
        ok: true,
        json: async () => ({
          entries: [{ name: "deep.py", path: "hidden-folder/deep.py" }],
          incomplete: true,
        }),
      };
    }
    return originalFetch(route, options);
  };
  const app = await boot(f.w);
  f.w.document.querySelector("#search-files").click();
  const status = f.w.document.querySelector("#file-finder-status");
  assert.match(status.textContent, /type/i);
  const input = f.w.document.querySelector("#file-finder-query");
  input.value = "x".repeat(257);
  input.dispatchEvent(new f.w.Event("input", { bubbles: true }));
  await f.advanceTimers();
  assert.match(status.textContent, /256/);
  assert.equal(
    requests.length,
    0,
    "overlong searches are rejected before fetch",
  );
  input.value = "😀".repeat(256);
  input.dispatchEvent(new f.w.Event("input", { bubbles: true }));
  await f.advanceTimers();
  assert.equal(requests.length, 1, "256 Unicode runes fit the server limit");
  assert.equal(
    new URL(requests[0].route, f.w.location.href).searchParams.get("q"),
    "😀".repeat(256),
  );
  input.value = "😀".repeat(257);
  input.dispatchEvent(new f.w.Event("input", { bubbles: true }));
  await f.advanceTimers();
  assert.match(status.textContent, /256/);
  assert.equal(requests.length, 1, "257 Unicode runes are rejected");
  input.value = "deep";
  input.dispatchEvent(new f.w.Event("input", { bubbles: true }));
  await f.advanceTimers();
  assert.equal(requests.length, 2);
  assert.equal(
    new URL(requests[1].route, f.w.location.href).searchParams.get("q"),
    "deep",
  );
  const result = f.w.document.querySelector('[role="option"]');
  assert.match(result.textContent, /deep\.py/);
  assert.match(status.textContent, /incomplete|partial/i);
  input.dispatchEvent(
    new f.w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  input.dispatchEvent(
    new f.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  await settle();
  assert.equal(f.w.location.search, "?file=hidden-folder%2Fdeep.py");
  assert.equal(f.w.document.querySelector("#file-finder").open, false);
  app.dispose();
  f.dom.window.close();
});

test("finder debounces and ignores an obsolete response, while errors stay in the dialog", async () => {
  let releaseOld;
  const f = fixture({ "doc.md": markdown("Finder fixture") });
  const originalFetch = f.w.fetch;
  const calls = [];
  f.w.fetch = async (route, options) => {
    if (!route.startsWith("api/search?")) return originalFetch(route, options);
    const query = new URL(route, f.w.location.href).searchParams.get("q");
    calls.push({ query, signal: options.signal });
    if (query === "old")
      return new Promise((resolve) => {
        releaseOld = () =>
          resolve({
            ok: true,
            json: async () => ({
              entries: [{ name: "old.py", path: "old.py" }],
              incomplete: false,
            }),
          });
      });
    if (query === "missing")
      return {
        ok: true,
        json: async () => ({ entries: [], incomplete: false }),
      };
    if (query === "failure")
      return { ok: false, text: async () => "search denied" };
    return {
      ok: true,
      json: async () => ({
        entries: [{ name: "new.go", path: "new.go" }],
        incomplete: false,
      }),
    };
  };
  const app = await boot(f.w);
  f.w.document.querySelector("#search-files").click();
  const input = f.w.document.querySelector("#file-finder-query");
  input.value = "old";
  input.dispatchEvent(new f.w.Event("input", { bubbles: true }));
  assert.equal(calls.length, 0, "the finder waits for the 150 ms debounce");
  await f.advanceTimers();
  assert.equal(calls.length, 1);
  input.value = "new";
  input.dispatchEvent(new f.w.Event("input", { bubbles: true }));
  await f.advanceTimers();
  assert.equal(calls[0].signal.aborted, true);
  releaseOld();
  await settle();
  assert.equal(
    f.w.document.querySelector('[role="option"]').textContent,
    "new.go",
  );
  input.value = "missing";
  input.dispatchEvent(new f.w.Event("input", { bubbles: true }));
  await f.advanceTimers();
  assert.match(
    f.w.document.querySelector("#file-finder-status").textContent,
    /no matching/i,
  );
  assert.equal(f.w.document.querySelectorAll('[role="option"]').length, 0);
  input.value = "failure";
  input.dispatchEvent(new f.w.Event("input", { bubbles: true }));
  await f.advanceTimers();
  assert.match(
    f.w.document.querySelector("#file-finder-status").textContent,
    /search denied/,
  );
  app.dispose();
  f.dom.window.close();
});

test("Enter on a finder control does not activate the query selection", async () => {
  const f = fixture({
    "doc.md": markdown("Finder fixture"),
    "alpha.py": {
      path: "alpha.py",
      kind: "text",
      text: 'print("alpha")\n',
      url: "api/raw?path=alpha.py",
    },
  });
  const originalFetch = f.w.fetch;
  f.w.fetch = async (route, options) => {
    if (route.startsWith("api/search?"))
      return {
        ok: true,
        json: async () => ({
          entries: [{ name: "alpha.py", path: "alpha.py" }],
          incomplete: false,
        }),
      };
    return originalFetch(route, options);
  };
  const app = await boot(f.w);
  const originalSearch = f.w.location.search;
  f.w.document.querySelector("#search-files").click();
  const input = f.w.document.querySelector("#file-finder-query");
  input.value = "alpha";
  input.dispatchEvent(new f.w.Event("input", { bubbles: true }));
  await f.advanceTimers();
  await settle();
  const close = f.w.document.querySelector("#file-finder-close");
  close.focus();
  close.dispatchEvent(
    new f.w.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  await settle();
  assert.equal(
    f.w.document.querySelector("#file-finder").open,
    true,
    "the document handler leaves focused dialog controls to their native action",
  );
  assert.equal(f.w.location.search, originalSearch);
  app.dispose();
  f.dom.window.close();
});

test("Escape closes the finder and restores focus to its opener", async () => {
  const f = fixture({ "doc.md": markdown("Finder fixture") });
  const opener = f.w.document.querySelector("#search-files");
  const app = await boot(f.w);
  opener.focus();
  opener.click();
  const dialog = f.w.document.querySelector("#file-finder");
  assert.equal(dialog.open, true, "the visible trigger opens the dialog");
  dialog.dispatchEvent(
    new f.w.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(dialog.open, false);
  assert.equal(f.w.document.activeElement, opener);
  app.dispose();
  f.dom.window.close();
});

test("late finder responses cannot update a closed or disposed dialog", async () => {
  for (const closeWith of ["button", "escape", "dispose"]) {
    let releaseResponse;
    let requestSignal;
    const f = fixture({ "doc.md": markdown("Finder fixture") });
    const originalFetch = f.w.fetch;
    f.w.fetch = async (route, options) => {
      if (!route.startsWith("api/search?")) return originalFetch(route);
      requestSignal = options.signal;
      return new Promise((resolve) => {
        releaseResponse = () =>
          resolve({
            ok: true,
            json: async () => ({
              entries: [{ name: "late.py", path: "late.py" }],
              incomplete: false,
            }),
          });
      });
    };

    const app = await boot(f.w);
    const dialog = f.w.document.querySelector("#file-finder");
    const input = f.w.document.querySelector("#file-finder-query");
    f.w.document.querySelector("#search-files").click();
    input.value = "late";
    input.dispatchEvent(new f.w.Event("input", { bubbles: true }));
    await f.advanceTimers();
    assert.equal(typeof releaseResponse, "function");
    assert.equal(
      f.w.document.querySelector("#file-finder-status").textContent,
      "Searching…",
    );

    if (closeWith === "button")
      f.w.document.querySelector("#file-finder-close").click();
    else if (closeWith === "escape")
      dialog.dispatchEvent(
        new f.w.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    else app.dispose();

    assert.equal(
      requestSignal.aborted,
      true,
      `${closeWith} aborts the request`,
    );
    assert.equal(dialog.open, false, `${closeWith} closes the finder`);

    if (closeWith !== "dispose") {
      f.w.document.querySelector("#search-files").click();
      assert.equal(
        dialog.open,
        true,
        "the finder can reopen before the old response arrives",
      );
    }
    const expectedStatus = f.w.document.querySelector(
      "#file-finder-status",
    ).textContent;
    releaseResponse();
    await settle();
    await settle();

    assert.equal(dialog.open, closeWith !== "dispose");
    assert.equal(
      f.w.document.querySelector("#file-finder-status").textContent,
      expectedStatus,
      `${closeWith} ignores the late response status`,
    );
    assert.equal(
      f.w.document.querySelectorAll('[role="option"]').length,
      0,
      `${closeWith} ignores late result entries`,
    );
    app.dispose();
    f.dom.window.close();
  }
});

function sidebarState(w) {
  return w.document.querySelector(".layout").dataset.sidebar;
}
function keyboard(w, init) {
  return new w.KeyboardEvent("keydown", {
    key: "b",
    bubbles: true,
    cancelable: true,
    ...init,
  });
}
function setPlatform(w, platform) {
  Object.defineProperty(w.navigator, "platform", { value: platform });
}
const sidebarPlatforms = [
  { platform: "MacIntel", acting: "metaKey", ignored: "ctrlKey" },
  { platform: "Win32", acting: "ctrlKey", ignored: "metaKey" },
];

test("sidebar restores a saved hidden or shown choice and defaults to shown without usable storage", async () => {
  for (const scenario of [
    {
      saved: "hidden",
      state: "collapsed",
      label: "Show sidebar",
      expanded: "false",
    },
    { saved: "shown", state: "shown", label: "Hide sidebar", expanded: "true" },
    { saved: null, state: "shown", label: "Hide sidebar", expanded: "true" },
    {
      saved: "collapsed",
      state: "shown",
      label: "Hide sidebar",
      expanded: "true",
    },
    { denied: true, state: "shown", label: "Hide sidebar", expanded: "true" },
  ]) {
    const f = fixture({ "doc.md": markdown("Sidebar fixture") });
    if (scenario.saved)
      f.w.localStorage.setItem("media-glance.sidebar", scenario.saved);
    if (scenario.denied)
      Object.defineProperty(f.w, "localStorage", {
        get() {
          throw new Error("storage denied");
        },
      });
    const app = await boot(f.w);
    const button = f.w.document.getElementById("sidebar-toggle");
    assert.equal(sidebarState(f.w), scenario.state);
    assert.equal(button.textContent, scenario.label);
    assert.equal(button.getAttribute("aria-expanded"), scenario.expanded);
    app.dispose();
    f.dom.window.close();
  }
});

test("the sidebar button toggles, persists the choice across reloads, and keeps working when writes are denied", async () => {
  for (const scenario of [{ deniedWrite: false }, { deniedWrite: true }]) {
    const f = fixture({ "doc.md": markdown("Sidebar fixture") });
    if (scenario.deniedWrite)
      Object.defineProperty(f.w, "localStorage", {
        value: {
          getItem() {
            return null;
          },
          setItem() {
            throw new Error("storage quota");
          },
        },
      });
    const app = await boot(f.w);
    const button = f.w.document.getElementById("sidebar-toggle");
    button.click();
    await settle();
    assert.equal(sidebarState(f.w), "collapsed");
    assert.equal(button.textContent, "Show sidebar");
    assert.equal(button.getAttribute("aria-expanded"), "false");
    if (!scenario.deniedWrite)
      assert.equal(f.w.localStorage.getItem("media-glance.sidebar"), "hidden");
    button.click();
    assert.equal(sidebarState(f.w), "shown");
    assert.equal(button.textContent, "Hide sidebar");
    assert.equal(button.getAttribute("aria-expanded"), "true");
    if (!scenario.deniedWrite)
      assert.equal(f.w.localStorage.getItem("media-glance.sidebar"), "shown");
    button.click();
    app.dispose();
    const reopened = await boot(f.w);
    assert.equal(
      sidebarState(f.w),
      scenario.deniedWrite ? "shown" : "collapsed",
      "a saved hidden choice survives a reload",
    );
    reopened.dispose();
    f.dom.window.close();
  }
});

test("Cmd+B on macOS and Ctrl+B elsewhere toggle the sidebar and prevent default only when they act", async () => {
  for (const { platform, acting, ignored } of sidebarPlatforms) {
    const f = fixture({ "doc.md": markdown("Sidebar fixture") });
    setPlatform(f.w, platform);
    const app = await boot(f.w);
    const wrong = keyboard(f.w, { [ignored]: true });
    f.w.document.dispatchEvent(wrong);
    assert.equal(sidebarState(f.w), "shown", `${platform} ignores ${ignored}`);
    assert.equal(wrong.defaultPrevented, false);
    const event = keyboard(f.w, { [acting]: true });
    f.w.document.dispatchEvent(event);
    assert.equal(
      sidebarState(f.w),
      "collapsed",
      `${platform} acts on ${acting}`,
    );
    assert.equal(event.defaultPrevented, true);
    f.w.document.dispatchEvent(keyboard(f.w, { [acting]: true }));
    assert.equal(sidebarState(f.w), "shown");
    app.dispose();
    f.dom.window.close();
  }
});

test("the sidebar shortcut ignores other modifiers and other keys", async () => {
  for (const { platform, acting } of sidebarPlatforms) {
    const f = fixture({ "doc.md": markdown("Sidebar fixture") });
    setPlatform(f.w, platform);
    const app = await boot(f.w);
    for (const init of [
      {},
      { [acting]: true, altKey: true },
      { [acting]: true, shiftKey: true },
      { metaKey: true, ctrlKey: true },
      { [acting]: true, key: "x" },
    ]) {
      const event = keyboard(f.w, init);
      f.w.document.dispatchEvent(event);
      assert.equal(sidebarState(f.w), "shown", JSON.stringify(init));
      assert.equal(event.defaultPrevented, false, JSON.stringify(init));
    }
    app.dispose();
    f.dom.window.close();
  }
});

test("the sidebar shortcut yields to an open file finder and to editable text", async () => {
  const f = fixture({ "doc.md": markdown("Sidebar fixture") });
  const app = await boot(f.w);
  f.w.document.dispatchEvent(
    new f.w.KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(f.w.document.getElementById("file-finder").open, true);
  const finderEvent = keyboard(f.w, { ctrlKey: true });
  f.w.document.dispatchEvent(finderEvent);
  assert.equal(sidebarState(f.w), "shown");
  assert.equal(finderEvent.defaultPrevented, false);
  f.w.document.getElementById("file-finder-close").click();
  const textarea = f.w.document.createElement("textarea");
  const editable = f.w.document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  const locked = f.w.document.createElement("div");
  locked.setAttribute("contenteditable", "false");
  f.w.document.body.append(textarea, editable, locked);
  for (const target of [
    f.w.document.getElementById("file-finder-query"),
    textarea,
    editable,
  ]) {
    const event = keyboard(f.w, { ctrlKey: true });
    target.dispatchEvent(event);
    assert.equal(sidebarState(f.w), "shown");
    assert.equal(event.defaultPrevented, false);
  }
  const lockedEvent = keyboard(f.w, { ctrlKey: true });
  locked.dispatchEvent(lockedEvent);
  assert.equal(sidebarState(f.w), "collapsed", "non-editable content acts");
  assert.equal(lockedEvent.defaultPrevented, true);
  app.dispose();
  f.dom.window.close();
});

test("disposed sidebar controls cannot toggle, persist, or prevent shortcuts", async () => {
  const f = fixture({ "doc.md": markdown("Sidebar fixture") });
  const app = await boot(f.w);
  app.dispose();
  f.w.document.getElementById("sidebar-toggle").click();
  assert.equal(
    sidebarState(f.w),
    "shown",
    "disposed button must stop reacting",
  );
  assert.equal(f.w.localStorage.getItem("media-glance.sidebar"), null);
  const event = keyboard(f.w, { ctrlKey: true });
  f.w.document.dispatchEvent(event);
  assert.equal(
    sidebarState(f.w),
    "shown",
    "disposed shortcut must stop reacting",
  );
  assert.equal(event.defaultPrevented, false);
  f.dom.window.close();
});

const widthKey = "media-glance.sidebar-width";
function resizerWidth(w) {
  return w.document
    .querySelector(".layout")
    .style.getPropertyValue("--sidebar-width");
}
function pointerEvent(w, type, init = {}) {
  return new w.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    isPrimary: true,
    button: 0,
    ...init,
  });
}
function keyEvent(w, key, init = {}) {
  return new w.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
}
function stubPointerCapture(w, { releaseThrows = false } = {}) {
  const log = { captured: [], released: [] };
  w.HTMLElement.prototype.setPointerCapture = function (id) {
    log.captured.push(id);
  };
  w.HTMLElement.prototype.releasePointerCapture = function (id) {
    if (releaseThrows) throw new Error("NotFoundError");
    log.released.push(id);
  };
  return log;
}
async function resizerApp({
  saved,
  denied = false,
  narrow = false,
  releaseThrows = false,
} = {}) {
  const f = fixture({ "doc.md": markdown("Resizer fixture") });
  const capture = stubPointerCapture(f.w, { releaseThrows });
  if (saved !== undefined) f.w.localStorage.setItem(widthKey, saved);
  if (denied)
    Object.defineProperty(f.w, "localStorage", {
      get() {
        throw new Error("storage denied");
      },
    });
  if (narrow)
    f.w.matchMedia = (query) => ({ matches: query === "(max-width: 700px)" });
  const app = await boot(f.w);
  return {
    f,
    app,
    capture,
    w: f.w,
    layout: f.w.document.querySelector(".layout"),
    handle: f.w.document.getElementById("sidebar-resizer"),
  };
}

test("sidebar resizer restores a saved width within the limits and uses the default for invalid values", async () => {
  for (const scenario of [
    { saved: "300", width: "300px", now: "300" },
    { saved: "9999", width: "614px", now: "614" },
    { saved: "5", width: "176px", now: "176" },
    { saved: "wide", width: "", now: "272" },
    { width: "", now: "272" },
  ]) {
    const { f, app, handle } = await resizerApp({ saved: scenario.saved });
    assert.equal(resizerWidth(f.w), scenario.width, `saved ${scenario.saved}`);
    assert.equal(handle.getAttribute("aria-valuenow"), scenario.now);
    assert.equal(handle.getAttribute("aria-valuemin"), "176");
    assert.equal(handle.getAttribute("aria-valuemax"), "614");
    app.dispose();
    f.dom.window.close();
  }
});

test("sidebar resizer reports the 11rem default on narrow viewports when no width is saved", async () => {
  const { f, app, handle } = await resizerApp({ narrow: true });
  assert.equal(resizerWidth(f.w), "");
  assert.equal(handle.getAttribute("aria-valuenow"), "176");
  app.dispose();
  f.dom.window.close();
});

test("sidebar resizer keeps working for this tab when storage is denied", async () => {
  const { f, app, handle } = await resizerApp({ denied: true });
  const w = f.w;
  assert.equal(resizerWidth(w), "");
  handle.dispatchEvent(pointerEvent(w, "pointerdown", { clientX: 272 }));
  handle.dispatchEvent(pointerEvent(w, "pointermove", { clientX: 300 }));
  handle.dispatchEvent(pointerEvent(w, "pointerup", { clientX: 300 }));
  assert.equal(resizerWidth(w), "300px");
  app.dispose();
  f.dom.window.close();
});

test("sidebar resizer follows a pointer drag, marks the layout while dragging, and saves the width on release", async () => {
  const { f, app, handle, layout, capture } = await resizerApp();
  const w = f.w;
  handle.dispatchEvent(pointerEvent(w, "pointerdown", { clientX: 272 }));
  assert.equal(layout.dataset.resizing, "", "a drag marks the layout");
  handle.dispatchEvent(pointerEvent(w, "pointermove", { clientX: 332 }));
  assert.equal(resizerWidth(w), "332px");
  assert.equal(handle.getAttribute("aria-valuenow"), "332");
  handle.dispatchEvent(pointerEvent(w, "pointerup", { clientX: 332 }));
  assert.equal(layout.hasAttribute("data-resizing"), false);
  assert.deepEqual(capture.captured, [7]);
  assert.deepEqual(capture.released, [7]);
  assert.equal(w.localStorage.getItem(widthKey), "332");
  app.dispose();
  f.dom.window.close();
});

test("sidebar resizer ends a cancelled drag, ignores later moves, and still saves when the capture is already released", async () => {
  const { f, app, handle, layout } = await resizerApp({ releaseThrows: true });
  const w = f.w;
  handle.dispatchEvent(pointerEvent(w, "pointerdown", { clientX: 272 }));
  handle.dispatchEvent(pointerEvent(w, "pointermove", { clientX: 300 }));
  handle.dispatchEvent(pointerEvent(w, "pointercancel", { clientX: 300 }));
  assert.equal(layout.hasAttribute("data-resizing"), false);
  handle.dispatchEvent(pointerEvent(w, "pointermove", { clientX: 400 }));
  assert.equal(resizerWidth(w), "300px");
  assert.equal(w.localStorage.getItem(widthKey), "300");
  app.dispose();
  f.dom.window.close();
});

test("sidebar resizer ignores secondary buttons, non-primary pointers, and pointers that did not start the drag", async () => {
  const { f, app, handle, layout } = await resizerApp();
  const w = f.w;
  handle.dispatchEvent(pointerEvent(w, "pointermove", { clientX: 400 }));
  handle.dispatchEvent(pointerEvent(w, "pointerup", { clientX: 400 }));
  assert.equal(resizerWidth(w), "", "moves without a drag change nothing");
  assert.equal(
    w.localStorage.getItem(widthKey),
    null,
    "a release without a drag saves nothing",
  );
  handle.dispatchEvent(
    pointerEvent(w, "pointerdown", { clientX: 272, button: 2 }),
  );
  handle.dispatchEvent(
    pointerEvent(w, "pointerdown", { clientX: 272, isPrimary: false }),
  );
  assert.equal(layout.hasAttribute("data-resizing"), false);
  handle.dispatchEvent(pointerEvent(w, "pointerdown", { clientX: 272 }));
  handle.dispatchEvent(
    pointerEvent(w, "pointermove", { clientX: 400, pointerId: 9 }),
  );
  assert.equal(
    resizerWidth(w),
    "",
    "another pointer does not move the sidebar",
  );
  handle.dispatchEvent(
    pointerEvent(w, "pointerup", { clientX: 400, pointerId: 9 }),
  );
  assert.equal(layout.dataset.resizing, "", "another pointer does not end it");
  handle.dispatchEvent(pointerEvent(w, "pointerup", { clientX: 300 }));
  assert.equal(layout.hasAttribute("data-resizing"), false);
  app.dispose();
  f.dom.window.close();
});

test("sidebar resizer drag clamps the width at both the minimum and the maximum", async () => {
  const { f, app, handle } = await resizerApp();
  const w = f.w;
  handle.dispatchEvent(pointerEvent(w, "pointerdown", { clientX: 272 }));
  handle.dispatchEvent(pointerEvent(w, "pointermove", { clientX: 2000 }));
  assert.equal(resizerWidth(w), "614px");
  assert.equal(handle.getAttribute("aria-valuenow"), "614");
  handle.dispatchEvent(pointerEvent(w, "pointermove", { clientX: -2000 }));
  assert.equal(resizerWidth(w), "176px");
  handle.dispatchEvent(pointerEvent(w, "pointerup", { clientX: -2000 }));
  app.dispose();
  f.dom.window.close();
});

test("sidebar resizer keyboard keys step the width, Shift steps further, Home and End reach the limits, and other keys are ignored", async () => {
  const { f, app, handle } = await resizerApp();
  const w = f.w;
  for (const [key, shiftKey, expected] of [
    ["ArrowRight", false, "288px"],
    ["ArrowRight", true, "352px"],
    ["ArrowLeft", false, "336px"],
    ["ArrowLeft", true, "272px"],
    ["Home", false, "176px"],
    ["End", false, "614px"],
  ]) {
    const event = keyEvent(w, key, { shiftKey });
    handle.dispatchEvent(event);
    assert.equal(
      resizerWidth(w),
      expected,
      `${shiftKey ? "Shift+" : ""}${key}`,
    );
    assert.equal(event.defaultPrevented, true, `${key} is handled`);
  }
  assert.equal(w.localStorage.getItem(widthKey), "614");
  const other = keyEvent(w, "a");
  handle.dispatchEvent(other);
  assert.equal(resizerWidth(w), "614px");
  assert.equal(other.defaultPrevented, false);
  app.dispose();
  f.dom.window.close();
});

test("sidebar resizer double-click resets to the default width and forgets the saved width", async () => {
  const { f, app, handle } = await resizerApp();
  const w = f.w;
  handle.dispatchEvent(keyEvent(w, "Home"));
  assert.equal(w.localStorage.getItem(widthKey), "176");
  handle.dispatchEvent(new w.MouseEvent("dblclick", { bubbles: true }));
  assert.equal(resizerWidth(w), "");
  assert.equal(handle.getAttribute("aria-valuenow"), "272");
  assert.equal(w.localStorage.getItem(widthKey), null);
  app.dispose();
  f.dom.window.close();
});

test("sidebar resizer re-clamps a dragged width when the window narrows and leaves the default alone", async () => {
  const { f, app, handle } = await resizerApp();
  const w = f.w;
  handle.dispatchEvent(keyEvent(w, "End"));
  w.innerWidth = 500;
  w.dispatchEvent(new w.Event("resize"));
  assert.equal(resizerWidth(w), "300px");
  assert.equal(handle.getAttribute("aria-valuemax"), "300");
  app.dispose();
  f.dom.window.close();
  const next = await resizerApp();
  next.w.innerWidth = 500;
  next.w.dispatchEvent(new next.w.Event("resize"));
  assert.equal(resizerWidth(next.w), "");
  assert.equal(next.handle.getAttribute("aria-valuemax"), "300");
  next.app.dispose();
  next.f.dom.window.close();
});

test("sidebar resizer is hidden and out of the tab order while collapsed, and keeps its width on expand", async () => {
  const { f, app, handle } = await resizerApp();
  const w = f.w;
  const toggle = w.document.getElementById("sidebar-toggle");
  handle.dispatchEvent(keyEvent(w, "Home"));
  toggle.click();
  await settle();
  assert.equal(handle.hidden, true);
  assert.equal(handle.getAttribute("tabindex"), "-1");
  toggle.click();
  await settle();
  assert.equal(handle.hidden, false);
  assert.equal(handle.getAttribute("tabindex"), "0");
  assert.equal(resizerWidth(w), "176px");
  app.dispose();
  f.dom.window.close();
});

test("sidebar resizer stops reacting to keys, pointers, double-clicks, and window resizes after dispose", async () => {
  const { f, app, handle } = await resizerApp();
  const w = f.w;
  app.dispose();
  handle.dispatchEvent(keyEvent(w, "Home"));
  handle.dispatchEvent(pointerEvent(w, "pointerdown", { clientX: 272 }));
  handle.dispatchEvent(pointerEvent(w, "pointermove", { clientX: 400 }));
  handle.dispatchEvent(new w.MouseEvent("dblclick", { bubbles: true }));
  w.innerWidth = 500;
  w.dispatchEvent(new w.Event("resize"));
  assert.equal(resizerWidth(w), "");
  assert.equal(handle.getAttribute("aria-valuemax"), "614");
  assert.equal(w.localStorage.getItem(widthKey), null);
  f.dom.window.close();
});

const historyPage = (path) => ({
  path,
  kind: "markdown",
  html: `<p>Body of ${path}</p>`,
  url: `api/raw?path=${path}`,
});
function historyFixture(initial = "a.md") {
  const files = Object.fromEntries(
    ["a.md", "b.md", "c.md", "d.md"].map((path) => [path, historyPage(path)]),
  );
  const f = fixture(files);
  f.files = files;
  f.w.history.replaceState(null, "", `?file=${initial}`);
  return f;
}
function openedFile(f) {
  return f.w.document.querySelector(".file-title").textContent;
}
async function pressHistoryKey(f, key, init = {}) {
  const event = keyboard(f.w, { key, ctrlKey: true, ...init });
  f.w.document.dispatchEvent(event);
  await settle();
  return event;
}
function deferredFile() {
  let release;
  const response = new Promise((resolve) => {
    release = resolve;
  });
  return { response, release };
}

test("Ctrl+O and Ctrl+I step through opened files in the order A to B to C", async () => {
  const f = historyFixture("a.md");
  const app = await boot(f.w);
  await app.navigate("b.md");
  await app.navigate("c.md");
  assert.equal(openedFile(f), "c.md");
  const back = await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "b.md");
  assert.equal(f.w.location.search, "?file=b.md");
  assert.equal(
    back.defaultPrevented,
    true,
    "the browser's Ctrl+O must not fire",
  );
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "a.md");
  await pressHistoryKey(f, "i");
  assert.equal(openedFile(f), "b.md");
  await pressHistoryKey(f, "i");
  assert.equal(openedFile(f), "c.md");
  assert.equal(f.w.location.search, "?file=c.md");
  app.dispose();
  f.dom.window.close();
});

test("going back and then opening a new file drops the forward entries", async () => {
  const f = historyFixture("a.md");
  const app = await boot(f.w);
  await app.navigate("b.md");
  await app.navigate("c.md");
  await pressHistoryKey(f, "o");
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "a.md");
  await app.navigate("d.md");
  await pressHistoryKey(f, "i");
  assert.equal(openedFile(f), "d.md", "B and C are gone");
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "a.md");
  await pressHistoryKey(f, "i");
  assert.equal(openedFile(f), "d.md");
  app.dispose();
  f.dom.window.close();
});

test("Ctrl+O and Ctrl+I at the ends of the history stay put and are still consumed", async () => {
  const f = historyFixture("a.md");
  const app = await boot(f.w);
  const back = await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "a.md");
  assert.equal(back.defaultPrevented, true);
  const requests = f.requests.length;
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "a.md");
  assert.equal(
    f.requests.length,
    requests,
    "no file is requested at the start",
  );
  await app.navigate("c.md");
  await pressHistoryKey(f, "i");
  await pressHistoryKey(f, "i");
  assert.equal(openedFile(f), "c.md");
  app.dispose();
  f.dom.window.close();
});

test("re-opening the current file adds no entry", async () => {
  const f = historyFixture("a.md");
  const app = await boot(f.w);
  await app.navigate("a.md");
  await app.navigate("b.md");
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "a.md");
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "a.md");
  await pressHistoryKey(f, "i");
  assert.equal(openedFile(f), "b.md");
  app.dispose();
  f.dom.window.close();
});

test("a file that can no longer be opened is dropped and the next entry in the same direction is used", async () => {
  const f = historyFixture("a.md");
  const app = await boot(f.w);
  await app.navigate("b.md");
  await app.navigate("c.md");
  f.files["b.md"] = new Error("file vanished");
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "a.md", "the missing B is skipped");
  assert.ok(f.requests.includes("api/file?path=b.md"));
  await pressHistoryKey(f, "i");
  assert.equal(openedFile(f), "c.md", "B was dropped from forward history");
  app.dispose();
  f.dom.window.close();
});

test("a missing forward entry is skipped going forward, and the position stays when nothing opens", async () => {
  const f = historyFixture("a.md");
  const app = await boot(f.w);
  await app.navigate("b.md");
  await app.navigate("c.md");
  await pressHistoryKey(f, "o");
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "a.md");
  f.files["b.md"] = new Error("file vanished");
  await pressHistoryKey(f, "i");
  assert.equal(openedFile(f), "c.md", "the missing B is skipped going forward");
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "a.md");
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "a.md", "nothing older remains");
  app.dispose();
  f.dom.window.close();
});

test("when every earlier entry is missing, Ctrl+O stays on the current file", async () => {
  const f = historyFixture("a.md");
  const app = await boot(f.w);
  await app.navigate("b.md");
  f.files["a.md"] = new Error("file vanished");
  const probesBefore = f.requests.filter((r) => r === "api/file?path=a.md");
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "b.md");
  assert.equal(f.w.location.search, "?file=b.md");
  assert.equal(
    f.requests.filter((r) => r === "api/file?path=a.md").length,
    probesBefore.length + 1,
    "the missing entry is probed once",
  );
  await pressHistoryKey(f, "i");
  assert.equal(openedFile(f), "b.md");
  app.dispose();
  f.dom.window.close();
});

test("Ctrl+O and Ctrl+I are ignored while the finder dialog is open", async () => {
  const f = historyFixture("a.md");
  const app = await boot(f.w);
  await app.navigate("b.md");
  f.w.document.dispatchEvent(
    new f.w.KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(f.w.document.getElementById("file-finder").open, true);
  const event = await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "b.md");
  assert.equal(event.defaultPrevented, false);
  f.w.document.getElementById("file-finder-close").click();
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "a.md");
  app.dispose();
  f.dom.window.close();
});

test("Ctrl+O and Ctrl+I are ignored in editable text and act on non-editable content", async () => {
  const f = historyFixture("a.md");
  const app = await boot(f.w);
  await app.navigate("b.md");
  const textarea = f.w.document.createElement("textarea");
  const editable = f.w.document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  const locked = f.w.document.createElement("div");
  locked.setAttribute("contenteditable", "false");
  f.w.document.body.append(textarea, editable, locked);
  for (const target of [
    f.w.document.getElementById("file-finder-query"),
    textarea,
    editable,
  ]) {
    const event = keyboard(f.w, { key: "o", ctrlKey: true });
    target.dispatchEvent(event);
    await settle();
    assert.equal(openedFile(f), "b.md");
    assert.equal(event.defaultPrevented, false);
  }
  const lockedEvent = keyboard(f.w, { key: "o", ctrlKey: true });
  locked.dispatchEvent(lockedEvent);
  await settle();
  assert.equal(openedFile(f), "a.md", "non-editable content acts");
  assert.equal(lockedEvent.defaultPrevented, true);
  app.dispose();
  f.dom.window.close();
});

test("Meta, Alt, Shift and Ctrl+Shift combinations are ignored, and Ctrl+O works the same on macOS and elsewhere", async () => {
  for (const platform of ["MacIntel", "Win32"]) {
    const f = historyFixture("a.md");
    setPlatform(f.w, platform);
    const app = await boot(f.w);
    await app.navigate("b.md");
    for (const init of [
      { key: "o", metaKey: true },
      { key: "o", altKey: true, ctrlKey: true },
      { key: "o", shiftKey: true, ctrlKey: true },
      { key: "o", ctrlKey: true, metaKey: true },
      { key: "o" },
      { key: "x", ctrlKey: true },
    ]) {
      const event = keyboard(f.w, init);
      f.w.document.dispatchEvent(event);
      await settle();
      assert.equal(
        openedFile(f),
        "b.md",
        `${platform} ${JSON.stringify(init)}`,
      );
      assert.equal(event.defaultPrevented, false, JSON.stringify(init));
    }
    await pressHistoryKey(f, "O");
    assert.equal(openedFile(f), "a.md", `${platform} Caps Lock Ctrl+O acts`);
    app.dispose();
    f.dom.window.close();
  }
});

test("popstate to the previous or next entry moves the position without recording a visit", async () => {
  const f = historyFixture("a.md");
  const app = await boot(f.w);
  await app.navigate("b.md");
  await app.navigate("c.md");
  await pressHistoryKey(f, "o");
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "a.md");
  f.w.history.replaceState(null, "", "?file=b.md");
  f.w.dispatchEvent(new f.w.PopStateEvent("popstate"));
  await settle();
  assert.equal(openedFile(f), "b.md");
  await pressHistoryKey(f, "i");
  assert.equal(openedFile(f), "c.md", "the forward entry survived popstate");
  f.w.history.replaceState(null, "", "?file=b.md");
  f.w.dispatchEvent(new f.w.PopStateEvent("popstate"));
  await settle();
  assert.equal(openedFile(f), "b.md");
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "a.md");
  await pressHistoryKey(f, "i");
  await pressHistoryKey(f, "i");
  assert.equal(openedFile(f), "c.md");
  app.dispose();
  f.dom.window.close();
});

test("popstate to an unrelated file records a normal visit and drops the forward entries", async () => {
  const f = historyFixture("a.md");
  const app = await boot(f.w);
  await app.navigate("b.md");
  await app.navigate("c.md");
  await pressHistoryKey(f, "o");
  f.w.history.replaceState(null, "", "?file=d.md");
  f.w.dispatchEvent(new f.w.PopStateEvent("popstate"));
  await settle();
  assert.equal(openedFile(f), "d.md");
  await pressHistoryKey(f, "i");
  assert.equal(openedFile(f), "d.md");
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "b.md");
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "a.md");
  app.dispose();
  f.dom.window.close();
});

test("anchor-only navigation in the same file records nothing", async () => {
  const f = historyFixture("a.md");
  const app = await boot(f.w);
  await app.navigate("b.md");
  await app.navigate("b.md", "section");
  await pressHistoryKey(f, "o");
  assert.equal(openedFile(f), "a.md", "the anchor did not add a B entry");
  f.w.history.replaceState(null, "", "?file=a.md#other");
  f.w.dispatchEvent(new f.w.PopStateEvent("popstate"));
  await settle();
  await pressHistoryKey(f, "i");
  assert.equal(openedFile(f), "b.md");
  app.dispose();
  f.dom.window.close();
});

test("dispose removes the history shortcut", async () => {
  const f = historyFixture("a.md");
  const app = await boot(f.w);
  await app.navigate("b.md");
  app.dispose();
  const requests = f.requests.length;
  const event = keyboard(f.w, { key: "o", ctrlKey: true });
  f.w.document.dispatchEvent(event);
  await settle();
  assert.equal(f.w.location.search, "?file=b.md");
  assert.equal(f.requests.length, requests);
  assert.equal(event.defaultPrevented, false);
  f.dom.window.close();
});

test("a history step cannot move the viewer once the controller is disposed", async () => {
  for (const succeeds of [true, false]) {
    const f = historyFixture("a.md");
    const app = await boot(f.w);
    await app.navigate("b.md");
    const pending = deferredFile();
    f.files["a.md"] = () => pending.response;
    await pressHistoryKey(f, "o");
    app.dispose();
    pending.release(
      succeeds
        ? { ok: true, json: async () => historyPage("a.md") }
        : { ok: false, text: async () => "gone" },
    );
    await settle();
    assert.equal(f.w.location.search, "?file=b.md");
    f.dom.window.close();
  }
});

test("a history step re-reads the history when it resolves, after another visit", async () => {
  const f = historyFixture("a.md");
  const app = await boot(f.w);
  await app.navigate("b.md");
  await app.navigate("c.md");
  const pending = deferredFile();
  f.files["b.md"] = () => pending.response;
  await pressHistoryKey(f, "o");
  await app.navigate("d.md");
  pending.release({ ok: true, json: async () => historyPage("b.md") });
  await settle();
  assert.equal(openedFile(f), "c.md");
  app.dispose();
  f.dom.window.close();
});
