# Documentation assets

`demo.gif` records the actual browser interface served by the media-glance.nvim v0.1.0 release binary. It uses a
temporary, invented workspace named `demo-workspace`; it does not record a personal workspace or the desktop.
The browser viewport is 1060 × 700 pixels. The looping GIF contains 89 frames at 6 frames per second, lasting
about 15 seconds.

## What the recording shows

1. The selected `docs/design.md` document opens with its file highlighted in the explorer and a rendered Mermaid
   flowchart.
2. The diagram's own zoom controls enlarge it without enlarging the document text. **Expand** opens its dialog;
   Escape closes it, and **Fit** restores the fitted size.
3. A separate filesystem write atomically replaces the Markdown file. **Live update: saved by another process.**
   appears in the existing preview.
4. A relative link opens `assets/preview.svg`, a locally generated illustration, in the viewer.

The browser is driven through its real controls. The recording starts an isolated native server with the initial
file selected; it demonstrates the browser experience rather than recording the Neovim command itself. Screenshots
capture only the page viewport, excluding the address bar, authentication URL, browser profile, and desktop.
No interface elements or update results are composited into the frames. Only GIF palette conversion is applied.

## Sample data and privacy

All file names, Markdown text, diagram labels, and SVG artwork were created for this demo. The diagram reads
**Neovim → Saved file → Go server → Browser**. The SVG reads **Local media** and **Fit · Zoom · Expand**.
No repository documents, personal paths, usernames, credentials, or live user files are included.

The recording process verifies the selected file, rendered diagram, expanded dialog, external update, and loaded
image. It then closes its browser context and server, checks an empty server registry and closed listener, and
removes its temporary workspace. For an accessible step-by-step equivalent, use the
[first-preview tutorial](../tutorials/preview-your-first-document.md).
