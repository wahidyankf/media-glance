# Documentation assets

`demo.gif` records the actual browser interface served by the current media-glance.nvim 0.4.0 source build. The
isolated `media-glance-demo` workspace contains an invented Markdown diagram, small Python and Go examples, and a
local SVG. The browser viewport was 1060 × 700 pixels. The recording lasts 39.4 seconds. The looping GIF samples it
into 70 frames at 6 frames per second, so it lasts 11.67 seconds and plays at about one-third of the original speed
for readability. It is resized to 800 × 528 pixels and uses a 96-color palette. No frames or interface elements are
composited.

## What the recording shows

1. The `docs/design.md` file opens in the dark theme with a Mermaid flowchart and the **Hide sidebar** header button.
2. **Hide sidebar** collapses the explorer, and the button becomes **Show sidebar**; clicking it restores the explorer.
3. The browser file finder opens with **⌘K** on macOS; a search for `hello.py` finds `examples/hello.py` and opens it.
4. The Python source is syntax-highlighted. **Copy** copies its source and displays **Copied**.
5. The finder returns to `docs/design.md`; **Expand** opens the diagram, and Escape closes it.
6. The visible **Light mode** control changes the page and diagram to the light theme.

The browser uses the real viewer and its controls. The recording shows only the page, not the browser chrome, URL,
desktop, or user profile. Frame sampling, GIF resizing, playback timing, and palette conversion are the only changes to
the captured video.

## Sample data and privacy

All file names, source code, Markdown text, diagram labels, and SVG artwork were created for this recording. The
temporary workspace has only `README.md`, `docs/design.md`, `examples/hello.py`, `examples/hello.go`, and
`assets/preview.svg`. No repository documents, personal paths, usernames, credentials, or live user files are
included. The browser context closes, the local server exits, and the temporary workspace and state directory are
removed after capture. For an accessible step-by-step equivalent, use the
[first-preview tutorial](../tutorials/preview-your-first-document.md).

## Screenshots

`dark-mode.png` and `light-mode.png` show the same invented Mermaid flow in their respective themes. `file-finder.png`
shows a filename search; `code-copy.png` shows highlighted Python and its successful copy status. These four were
recaptured at 1060 × 700 pixels from the current build, after the header gained its **Hide sidebar** button, in an
invented `media-glance-demo` workspace with the same five files.

`expanded-diagram.png` omits the page header and remains from the v0.2.0 candidate binary. `demo.gif` was recaptured
from the current build, so its header shows the **Hide sidebar** button. Its `docs/design.md` has different diagram
text from the screenshots' request-flow diagram.

`er-styles.png` is an earlier v0.1.3 candidate screenshot of explicit ER diagram fills and white labels. It remains a
separate historical example and does not use the v0.2.0 demo workspace.
