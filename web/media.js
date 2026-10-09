// Fit defines the baseline; zoom changes only the media's real scrollable dimensions.
export function mediaLayout(intrinsic, viewport, zoom) {
  const fit = Math.min(
    1,
    viewport.width / intrinsic.width,
    viewport.height / intrinsic.height,
  );
  return {
    width: intrinsic.width * fit * zoom,
    height: intrinsic.height * fit * zoom,
  };
}

export function mediaViewers(state, host = globalThis, createThemeControl) {
  const {
    document,
    location,
    HTMLImageElement,
    ResizeObserver,
    AbortController,
  } = host;
  const controllers = [];
  const occurrences = new Map();
  const present = new Set();
  const lifetime = new AbortController();
  let alive = true;
  let expanded;

  function attach(media, identity, label) {
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    const key = `${identity}\n${occurrence}`;
    present.add(key);
    const saved = state.items.get(key) ?? { zoom: 1, left: 0, top: 0 };
    state.items.set(key, saved);
    const wrapper = document.createElement("div");
    wrapper.className = "media-viewer";
    const toolbar = document.createElement("div");
    toolbar.className = "media-toolbar";
    toolbar.setAttribute("role", "group");
    toolbar.setAttribute("aria-label", `${label} zoom controls`);
    const viewport = document.createElement("div");
    viewport.className = "media-viewport";
    viewport.tabIndex = 0;
    viewport.setAttribute("role", "region");
    viewport.setAttribute("aria-label", `${label} — scroll to explore`);
    const canvas = document.createElement("div");
    canvas.className = "media-canvas";
    // Keep linked images linked, but place controls outside their link.
    const link = media.closest("a");
    const payload =
      link?.querySelectorAll("img").length === 1 && !link.textContent.trim()
        ? link
        : media;
    payload.replaceWith(wrapper);
    canvas.append(payload);
    viewport.append(canvas);
    wrapper.append(toolbar, viewport);
    media.classList.add("zoom-media");
    let dimensions;
    let dialog;
    let placeholder;
    let themeControl;

    function button(text, name, action) {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = text;
      element.setAttribute("aria-label", name);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        action();
      });
      toolbar.append(element);
      return element;
    }
    const less = button("−", `Zoom out ${label}`, () =>
      zoom(saved.zoom / 1.25),
    );
    const percent = document.createElement("output");
    percent.setAttribute("aria-label", "Zoom relative to fit");
    percent.setAttribute("aria-live", "polite");
    toolbar.append(percent);
    const more = button("+", `Zoom in ${label}`, () => zoom(saved.zoom * 1.25));
    button("Fit", `Fit ${label}`, () => {
      saved.left = 0;
      saved.top = 0;
      zoom(1, false);
    });
    const expand = button("Expand", `Expand ${label}`, () =>
      dialog ? close() : open(),
    );

    function intrinsic() {
      if (media instanceof HTMLImageElement)
        return { width: media.naturalWidth, height: media.naturalHeight };
      const box = media.viewBox.baseVal;
      if (box.width > 0 && box.height > 0)
        return { width: box.width, height: box.height };
      return {
        width: media.width.baseVal.value,
        height: media.height.baseVal.value,
      };
    }
    function layout() {
      if (!alive || !media.isConnected) return;
      const size = intrinsic();
      if (!(size.width > 0 && size.height > 0)) return;
      const width = viewport.clientWidth;
      const height = dialog
        ? viewport.clientHeight
        : Math.max(120, host.innerHeight * 0.7);
      dimensions = mediaLayout(size, { width, height }, saved.zoom);
      media.style.width = `${dimensions.width}px`;
      media.style.height = `${dimensions.height}px`;
      percent.textContent = `${Math.round(saved.zoom * 100)}%`;
      less.disabled = saved.zoom <= 0.25;
      more.disabled = saved.zoom >= 8;
      viewport.scrollLeft = saved.left;
      viewport.scrollTop = saved.top;
    }
    function zoom(value, center = true) {
      const next = Math.max(0.25, Math.min(8, value));
      if (center && dimensions) {
        const ratio = next / saved.zoom;
        saved.left = Math.max(
          0,
          (viewport.scrollLeft + viewport.clientWidth / 2) * ratio -
            viewport.clientWidth / 2,
        );
        saved.top = Math.max(
          0,
          (viewport.scrollTop + viewport.clientHeight / 2) * ratio -
            viewport.clientHeight / 2,
        );
      }
      saved.zoom = next;
      layout();
    }
    function close(restoreFocus = true, preserve = false) {
      if (!dialog) return;
      const current = dialog;
      dialog = undefined;
      themeControl?.remove();
      themeControl = undefined;
      placeholder.replaceWith(wrapper);
      placeholder = undefined;
      current.close();
      current.remove();
      wrapper.classList.remove("is-expanded");
      expand.textContent = "Expand";
      expand.setAttribute("aria-label", `Expand ${label}`);
      expanded = undefined;
      if (!preserve) state.expanded = null;
      layout();
      if (restoreFocus) expand.focus({ preventScroll: true });
    }
    function open() {
      expanded?.close(false);
      placeholder = document.createComment("expanded media");
      wrapper.replaceWith(placeholder);
      dialog = document.createElement("dialog");
      dialog.className = "media-dialog";
      dialog.setAttribute("aria-label", `${label} — expanded view`);
      dialog.append(wrapper);
      if (createThemeControl) {
        themeControl = createThemeControl();
        toolbar.append(themeControl);
      }
      document.body.append(dialog);
      wrapper.classList.add("is-expanded");
      expand.textContent = "Close";
      expand.setAttribute("aria-label", "Close expanded view");
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        close();
      });
      dialog.showModal();
      expanded = { close };
      state.expanded = key;
      layout();
      expand.focus({ preventScroll: true });
    }
    viewport.addEventListener("scroll", () => {
      saved.left = viewport.scrollLeft;
      saved.top = viewport.scrollTop;
    });
    const resize = new ResizeObserver(layout);
    resize.observe(viewport);
    function ready() {
      if (!alive || !media.isConnected) return;
      layout();
      if (state.expanded === key) open();
    }
    if (media instanceof HTMLImageElement && !media.complete) {
      media.addEventListener("load", ready, {
        once: true,
        signal: lifetime.signal,
      });
    } else ready();
    controllers.push({ resize, close });
  }

  function image(media) {
    const address = new URL(media.src, location.href);
    address.searchParams.delete("revision");
    attach(media, `image:${address.href}`, media.alt || "Image");
  }

  return {
    image,
    diagram: (media, index) =>
      attach(media, `mermaid:${index}`, "Mermaid diagram"),
    complete() {
      for (const key of state.items.keys())
        if (!present.has(key)) state.items.delete(key);
      if (!present.has(state.expanded)) state.expanded = null;
    },
    dispose(preserve = false) {
      alive = false;
      lifetime.abort();
      for (const controller of controllers) {
        controller.resize.disconnect();
        controller.close(false, preserve);
      }
    },
  };
}
