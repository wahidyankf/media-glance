export function createFileFinder({
  document,
  window,
  fetch,
  navigate,
  setTimeout,
  clearTimeout,
  AbortController,
  signal,
}) {
  const opener = document.querySelector("#search-files");
  const dialog = document.querySelector("#file-finder");
  const input = document.querySelector("#file-finder-query");
  const status = document.querySelector("#file-finder-status");
  const results = document.querySelector("#file-finder-results");
  const closeButton = document.querySelector("#file-finder-close");
  let active = -1;
  let entries = [];
  let openerToRestore;
  let debounce;
  let request;
  let generation = 0;
  let disposed = false;

  function cancelSearch() {
    clearTimeout(debounce);
    debounce = undefined;
    request?.abort();
    request = undefined;
  }

  function clearResults() {
    entries = [];
    active = -1;
    results.replaceChildren();
    input.removeAttribute("aria-activedescendant");
  }

  function close(restoreFocus = true) {
    if (!dialog.open) return;
    cancelSearch();
    generation++;
    dialog.close();
    if (restoreFocus && openerToRestore?.isConnected)
      openerToRestore.focus({ preventScroll: true });
    openerToRestore = undefined;
  }

  function open() {
    if (disposed) return;
    if (dialog.open) {
      input.focus({ preventScroll: true });
      return;
    }
    openerToRestore = document.activeElement;
    if (!openerToRestore || openerToRestore === document.body)
      openerToRestore = opener;
    input.value = "";
    clearResults();
    status.textContent = "Type to search files.";
    dialog.showModal();
    input.focus({ preventScroll: true });
  }

  function markActive(next) {
    if (!entries.length) return;
    active = (next + entries.length) % entries.length;
    for (const [index, result] of [
      ...results.querySelectorAll("[role=option]"),
    ].entries())
      result.setAttribute("aria-selected", String(index === active));
    const selected = results.querySelectorAll("[role=option]")[active];
    input.setAttribute("aria-activedescendant", selected.id);
    input.focus({ preventScroll: true });
    selected.scrollIntoView?.({ block: "nearest" });
  }

  async function choose(path) {
    close(false);
    await navigate(path);
    const selected = document.querySelector('[aria-current="page"]');
    (selected ?? document.querySelector("#panel"))?.focus({
      preventScroll: true,
    });
  }

  function showEntries(found, incomplete) {
    entries = found;
    active = -1;
    input.removeAttribute("aria-activedescendant");
    const fragment = document.createDocumentFragment();
    for (const [index, entry] of entries.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = `file-finder-option-${generation}-${index}`;
      button.className = "finder-result";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");
      button.dataset.path = entry.path;
      const name = document.createElement("span");
      name.className = "finder-result-name";
      name.textContent = entry.name;
      button.append(name);
      if (entry.path !== entry.name) {
        const path = document.createElement("span");
        path.className = "finder-result-path";
        path.textContent = entry.path;
        button.append(path);
      }
      button.addEventListener("click", () => choose(entry.path), { signal });
      fragment.append(button);
    }
    results.replaceChildren(fragment);
    if (!entries.length)
      status.textContent = incomplete
        ? "No matching files in the scanned portion; results may be incomplete."
        : "No matching files.";
    else {
      const count = `${entries.length} file${entries.length === 1 ? "" : "s"} found`;
      status.textContent = incomplete
        ? `${count}; results may be incomplete.`
        : `${count}.`;
    }
  }

  async function search(query, current) {
    request = new AbortController();
    status.textContent = "Searching…";
    try {
      const response = await fetch(
        `api/search?q=${encodeURIComponent(query)}`,
        { cache: "no-store", signal: request.signal },
      );
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      if (disposed || current !== generation || request.signal.aborted) return;
      if (!result || !Array.isArray(result.entries))
        throw new Error("Invalid file search response");
      showEntries(result.entries.slice(0, 50), Boolean(result.incomplete));
    } catch (error) {
      if (
        disposed ||
        current !== generation ||
        request.signal.aborted ||
        error.name === "AbortError"
      )
        return;
      clearResults();
      status.textContent = error.message || "File search failed.";
      status.classList.add("error");
    }
  }

  function changed() {
    cancelSearch();
    const current = ++generation;
    clearResults();
    status.classList.remove("error");
    const query = input.value.trim();
    if (!query) {
      status.textContent = "Type to search files.";
      return;
    }
    if ([...query].length > 256) {
      status.textContent = "Search queries can contain at most 256 characters.";
      status.classList.add("error");
      return;
    }
    status.textContent = "Waiting to search…";
    debounce = setTimeout(() => {
      debounce = undefined;
      void search(query, current);
    }, 150);
  }

  function keydown(event) {
    if (
      event.key.toLowerCase() === "k" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      open();
    }
    if (!dialog.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (
      event.target === input &&
      event.key === "ArrowDown" &&
      entries.length
    ) {
      event.preventDefault();
      markActive(active + 1);
    } else if (
      event.target === input &&
      event.key === "ArrowUp" &&
      entries.length
    ) {
      event.preventDefault();
      markActive(active < 0 ? entries.length - 1 : active - 1);
    } else if (
      event.target === input &&
      event.key === "Enter" &&
      entries.length
    ) {
      event.preventDefault();
      void choose(entries[active < 0 ? 0 : active].path);
    }
  }

  opener.addEventListener("click", open, { signal });
  closeButton.addEventListener("click", () => close(), { signal });
  input.addEventListener("input", changed, { signal });
  document.addEventListener("keydown", keydown, { signal });
  dialog.addEventListener(
    "cancel",
    (event) => {
      event.preventDefault();
      close();
    },
    { signal },
  );
  dialog.addEventListener(
    "close",
    () => {
      if (openerToRestore?.isConnected)
        openerToRestore.focus({ preventScroll: true });
      openerToRestore = undefined;
    },
    { signal },
  );

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelSearch();
      generation++;
      if (dialog.open) dialog.close();
      openerToRestore = undefined;
    },
  };
}
