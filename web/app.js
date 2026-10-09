import { mediaViewers } from "./media.js";

export async function boot(host) {
  const {
    document,
    location,
    history,
    fetch,
    EventSource,
    window,
    CSS,
    matchMedia,
    setTimeout,
    clearTimeout,
  } = host;
  const makeViewers =
    host.mediaViewers ?? ((state) => mediaViewers(state, host));
  const loadMermaid =
    host.loadMermaid ?? (() => import("./vendor/mermaid.esm.min.mjs"));
  const lifetime = new host.AbortController();

  const tree = document.querySelector("#tree");
  const panel = document.querySelector("#panel");
  const status = document.querySelector("#status");
  const expanded = new Set([""]);
  let selected = new URL(location.href).searchParams.get("file") ?? "";
  let source;
  let subscription = "";
  let generation = 0;
  let mermaid;
  let refreshing = false;
  let refreshAgain = false;
  let watchFailure = "";
  let reconnectTimer;
  let reconnectDelay = 1000;
  let viewers;
  let mediaState = { items: new Map(), expanded: null };
  let renderedFile = "";
  let treeRevision = 0;
  let disposed = false;

  async function api(route) {
    const response = await fetch(`api/${route}`, {
      cache: "no-store",
      signal: lifetime.signal,
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  function message(text, error = false) {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    if (error) paragraph.className = "error";
    return paragraph;
  }

  async function directory(path, container) {
    if (disposed) return;
    const result = await api(`tree?path=${encodeURIComponent(path)}`);
    if (disposed) return;
    const fragment = document.createDocumentFragment();
    for (const entry of result.entries) {
      const button = document.createElement("button");
      button.className = "entry";
      button.textContent = entry.name;
      const wrapper = document.createElement("div");
      wrapper.append(button);
      if (entry.kind === "directory") {
        button.classList.add("folder");
        button.setAttribute("aria-expanded", String(expanded.has(entry.path)));
        if (expanded.has(entry.path)) {
          const children = document.createElement("div");
          children.className = "children";
          try {
            await directory(entry.path, children);
          } catch (error) {
            children.append(message(error.message, true));
          }
          wrapper.append(children);
        }
        button.addEventListener(
          "click",
          async () => {
            if (expanded.has(entry.path)) {
              for (const value of expanded)
                if (value === entry.path || value.startsWith(`${entry.path}/`))
                  expanded.delete(value);
            } else expanded.add(entry.path);
            await refreshTree();
            if (disposed) return;
            subscribe();
            tree.querySelectorAll(".folder").forEach((folder) => {
              if (folder.textContent === entry.name) folder.focus();
            });
          },
          { signal: lifetime.signal },
        );
      } else {
        if (entry.path === selected)
          button.setAttribute("aria-current", "page");
        button.addEventListener("click", () => navigate(entry.path), {
          signal: lifetime.signal,
        });
      }
      fragment.append(wrapper);
    }
    if (!disposed) container.replaceChildren(fragment);
  }

  async function refreshTree(reveal = false) {
    if (disposed) return;
    const revision = ++treeRevision;
    if (reveal) {
      const ancestors = selected.split("/").slice(0, -1);
      ancestors.forEach((_, index) =>
        expanded.add(ancestors.slice(0, index + 1).join("/")),
      );
    }
    const content = document.createElement("div");
    try {
      await directory("", content);
    } catch (error) {
      content.replaceChildren(message(error.message, true));
    }
    if (revision !== treeRevision) return;
    const scroll = tree.parentElement.scrollTop;
    tree.replaceChildren(...content.childNodes);
    tree.parentElement.scrollTop = scroll;
    if (reveal)
      tree
        .querySelector('[aria-current="page"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  async function diagrams(container, revision) {
    const nodes = [...container.querySelectorAll(".mermaid")];
    if (!nodes.length) return;
    try {
      if (!mermaid) {
        mermaid = (await loadMermaid()).default;
        if (disposed || revision !== generation) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "default",
          suppressErrorRendering: true,
        });
      }
      for (const [index, node] of nodes.entries()) {
        if (revision !== generation) return;
        try {
          const { svg } = await mermaid.render(
            `diagram-${revision}-${index}`,
            node.dataset.diagram,
          );
          if (revision === generation) {
            node.innerHTML = svg;
            viewers.diagram(node.querySelector("svg"), index);
          }
        } catch (error) {
          if (disposed || revision !== generation) return;
          node.replaceChildren(
            message(`Diagram could not be rendered: ${error.message}`, true),
            message(node.dataset.diagram),
          );
        }
      }
    } catch (error) {
      if (disposed || revision !== generation) return;
      for (const node of nodes)
        node.replaceChildren(message(error.message, true));
    }
  }

  async function display(preserve = false, anchor = "") {
    if (disposed) return;
    const revision = ++generation;
    const scroll = preserve ? panel.scrollTop : 0;
    const container = document.createElement("div");
    container.className = "document";
    if (!selected) {
      viewers?.dispose();
      viewers = undefined;
      renderedFile = "";
      mediaState = { items: new Map(), expanded: null };
      container.append(message("Choose a file from the sidebar."));
      panel.replaceChildren(container);
      panel.scrollTop = 0;
      return;
    }
    try {
      const file = await api(`file?path=${encodeURIComponent(selected)}`);
      if (revision !== generation) return;
      const title = document.createElement("div");
      title.className = "file-title";
      title.textContent = file.path;
      container.append(title);
      if (file.kind === "markdown") {
        const content = document.createElement("article");
        content.innerHTML = file.html;
        const rawPath = new URL("api/raw", location.href).pathname;
        for (const image of content.querySelectorAll("img")) {
          const asset = new URL(image.getAttribute("src"), location.href);
          if (asset.origin === location.origin && asset.pathname === rawPath) {
            asset.searchParams.set("revision", String(revision));
            image.src = asset.href;
          }
        }
        container.append(content);
      } else if (file.kind === "text") {
        const pre = document.createElement("pre");
        pre.textContent = file.text ?? "";
        container.append(pre);
      } else if (["image", "pdf", "audio", "video"].includes(file.kind)) {
        const element = document.createElement(
          { image: "img", pdf: "iframe", audio: "audio", video: "video" }[
            file.kind
          ],
        );
        element.src = `${file.url}&revision=${revision}`;
        if (file.kind === "image") element.alt = file.name;
        if (file.kind === "pdf") element.title = file.name;
        if (file.kind === "audio" || file.kind === "video")
          element.controls = true;
        container.append(element);
      } else {
        container.append(message("This file is available to download."));
      }
      const download = document.createElement("a");
      download.href = `${file.url}&download=1`;
      download.textContent = "Download file";
      container.append(download);
      const keepMedia = preserve && renderedFile === file.path;
      viewers?.dispose(keepMedia);
      if (!keepMedia) mediaState = { items: new Map(), expanded: null };
      renderedFile = file.path;
      panel.replaceChildren(container);
      viewers = makeViewers(mediaState);
      for (const image of container.querySelectorAll("img"))
        viewers.image(image);
      panel.scrollTop = scroll;
      await diagrams(container, revision);
      if (revision === generation) {
        viewers.complete();
        panel.scrollTop = scroll;
        if (anchor)
          container
            .querySelector(`[id="${CSS.escape(anchor)}"]`)
            ?.scrollIntoView();
      }
    } catch (error) {
      if (revision !== generation) return;
      viewers?.dispose();
      viewers = undefined;
      container.append(message(error.message, true));
      panel.replaceChildren(container);
      panel.scrollTop = scroll;
    }
  }

  async function navigate(path, anchor = "", push = true) {
    if (disposed) return;
    selected = path;
    if (push) {
      const address = new URL(location.href);
      address.searchParams.set("file", selected);
      address.hash = anchor;
      history.pushState(null, "", address);
    }
    await Promise.all([display(false, anchor), refreshTree(true)]);
    subscribe();
  }

  async function refresh() {
    if (disposed) return;
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    try {
      do {
        refreshAgain = false;
        await Promise.all([refreshTree(), display(true)]);
      } while (refreshAgain && !disposed);
    } finally {
      refreshing = false;
    }
  }

  function subscribe(force = false) {
    if (disposed) return;
    const query = new URLSearchParams({
      dirs: JSON.stringify([...expanded]),
      path: selected,
    });
    if (query.toString() === subscription && !force) return;
    subscription = query.toString();
    clearTimeout(reconnectTimer);
    source?.close();
    const stream = new EventSource(`api/events?${query}`);
    source = stream;
    stream.addEventListener("open", () => {
      if (disposed || source !== stream) return;
      clearTimeout(reconnectTimer);
      reconnectDelay = 1000;
      watchFailure = "";
      status.textContent = "Live";
      refresh();
    });
    stream.addEventListener("change", () => {
      if (!disposed && source === stream) refresh();
    });
    stream.addEventListener("watch-error", (event) => {
      if (disposed || source !== stream) return;
      try {
        watchFailure = JSON.parse(event.data).message;
      } catch {
        watchFailure = "Live update watcher failed; reconnecting";
      }
      status.textContent = watchFailure;
    });
    stream.addEventListener("error", () => {
      if (disposed || source !== stream) return;
      status.textContent = watchFailure || "Reconnecting…";
      stream.close();
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => subscribe(true), reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 5000);
    });
  }

  panel.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest("a[data-file]");
      if (
        !link ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      navigate(
        link.dataset.file,
        decodeURIComponent(new URL(link.href).hash.slice(1)),
      );
    },
    { signal: lifetime.signal },
  );
  window.addEventListener(
    "popstate",
    () =>
      navigate(
        new URL(location.href).searchParams.get("file") ?? "",
        decodeURIComponent(location.hash.slice(1)),
        false,
      ),
    { signal: lifetime.signal },
  );
  function dispose() {
    if (disposed) return;
    disposed = true;
    lifetime.abort();
    generation++;
    treeRevision++;
    clearTimeout(reconnectTimer);
    source?.close();
    source = null;
    viewers?.dispose();
  }
  window.addEventListener("pagehide", dispose, { signal: lifetime.signal });

  const controller = { dispose, navigate, refresh, subscribe };
  try {
    const info = await api("info");
    if (disposed) return controller;
    document.querySelector("#workspace").textContent = info.root
      .split("/")
      .filter(Boolean)
      .at(-1);
    document.title = `${info.root.split("/").filter(Boolean).at(-1)} · Workspace media`;
    await Promise.all([
      refreshTree(true),
      display(false, decodeURIComponent(location.hash.slice(1))),
    ]);
    subscribe();
  } catch (error) {
    if (disposed) return controller;
    status.textContent = "Unavailable";
    panel.replaceChildren(message(error.message, true));
  }

  return controller;
}
