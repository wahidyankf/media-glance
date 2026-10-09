import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { boot } from "../../web/app.js";
import { mediaViewers } from "../../web/media.js";

function fixture(files = {}, tree = []) {
  const dom = new JSDOM(
    '<header><b id="workspace"></b><span id="status"></span><button id="theme-toggle" type="button">Light mode</button></header><nav><div id="tree"></div></nav><main id="panel"></main>',
    { url: "http://127.0.0.1:57300/v/token/?file=doc.md" },
  );
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = function () {
    this.revealed = true;
  };
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
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
    f.w.document.querySelector("dialog [data-theme-control]"),
    null,
    "expanded assets must not contain theme selection",
  );
  assert.equal(f.w.document.querySelectorAll("[data-theme-control]").length, 1);
  assert.equal(f.w.document.documentElement.dataset.theme, "light");
  await app.refresh();
  await settle();
  assert.equal(f.w.document.querySelector("dialog [data-theme-control]"), null);
  assert.ok(
    f.w.document.querySelector("dialog"),
    "live refresh preserves expanded media",
  );
  f.w.document.querySelector('[aria-label="Close expanded view"]').click();
  f.w.document.getElementById("theme-toggle").click();
  await settle();
  assert.equal(f.w.document.documentElement.dataset.theme, "dark");
  f.w.document.querySelector('[aria-label="Expand Example"]').click();
  assert.equal(f.w.document.querySelector("dialog [data-theme-control]"), null);
  assert.equal(f.w.document.documentElement.dataset.theme, "dark");
  app.dispose();
  assert.equal(f.w.document.querySelector("dialog"), null);
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
  assert.equal(f.w.document.querySelector("pre").textContent, "literal <b>");
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
  assert.ok(f.w.document.querySelector("dialog"));
  assert.ok(state.expanded);
  f.w.document
    .querySelector("dialog")
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
  assert.equal(f.w.document.querySelectorAll("dialog").length, 1);
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
