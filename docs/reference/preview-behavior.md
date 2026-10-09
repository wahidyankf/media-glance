# Preview behavior and limits

The browser shows a workspace explorer and a selected file. It reads saved filesystem content; Neovim's unsaved
buffer contents do not enter the preview.

## Supported files

| File type                                           | Preview                                       |
| --------------------------------------------------- | --------------------------------------------- |
| `.md`, `.markdown`                                  | Markdown preview.                             |
| PNG, JPEG, GIF, WebP, SVG, AVIF, ICO, BMP           | Image preview with independent zoom controls. |
| PDF                                                 | Embedded browser PDF view.                    |
| MP3, WAV, OGG, M4A, FLAC                            | Browser audio controls.                       |
| MP4, WebM, MOV, M4V                                 | Browser video controls.                       |
| Other UTF-8 files without NUL bytes, up to 2 MiB    | Plain text preview.                           |
| Larger text/Markdown, binary data, or invalid UTF-8 | Download view.                                |

Markdown supports tables, strikethrough, task lists, headings, links, images, and code fences.

Extensions match case-insensitively. Browser support determines whether a listed image, PDF, audio, or video format
can actually decode. Image/media formats do not use the 2 MiB text-preview limit. Raw files stream from the server
with HTTP range support; a supported extension does not guarantee a browser codec.

A fenced `mermaid` block renders through bundled Mermaid. Mathematical labels use the Mermaid renderer's supported
syntax; ordinary Markdown has no independent math renderer. Raw Markdown HTML is escaped rather than executed.
HTML files preview as text when they meet the text rules, and their raw route serves them as plain text.

## Links and images

Relative links and image paths resolve from the selected Markdown file's directory. A leading slash resolves from
the workspace root, not the operating system's filesystem root. Local file links open inside the viewer; local
images load through its authenticated raw route. Path traversal and symlinks outside the workspace are refused.

External HTTP/HTTPS links, including autolinks and linked images, use native `target="_blank"` with
`rel="noopener noreferrer"`. The viewer stays open; the new context receives no viewer referrer or opener. Browser
preferences determine whether it opens as a tab or window. Email links retain their `mailto` behavior. Remote
HTTP/HTTPS images can make network requests to
their hosts. The bundled renderer and local files need no network after installation; remote document assets do.

## Media controls

Images and Mermaid diagrams receive their own controls:

- **− / +:** multiply zoom by 1/1.25 or 1.25, bounded to 25%–800% relative to fit.
- **Fit:** restore 100% of the fitted size and reset that media's scroll position.
- **Expand:** open a modal view; **Close** or Escape returns to the document and restores focus.
- **Scroll:** pan inside media larger than its visible area.

Fit preserves aspect ratio and does not enlarge media beyond its intrinsic size. Zoom changes media dimensions,
not document font size. The document column has a maximum width of 123ch. Live refresh preserves media state for
matching images and diagram positions in the same selected document; navigating to another file resets it.

## Appearance

The initial theme follows the system’s light/dark preference unless this browser origin has a saved manual choice.
**Light mode** / **Dark mode** changes the appearance and saves that choice in browser local storage. A valid saved
choice takes priority over the system preference. Invalid saved values fall back to the system; blocked storage still
allows changing the mode in the current tab. A different server port is a different origin and can have its own choice.

The control is also available inside expanded media. Theme changes re-render Mermaid with matching colors while
preserving the selected file, explorer and document scroll, zoom, media pan, and expanded view. Images are not
inverted. Saved external edits continue to refresh the themed preview. The bundled eye favicon works offline.

## Explorer and live updates

The explorer loads directory contents as needed, with directories first and names sorted case-insensitively.
It skips entries named `.git`, `node_modules`, `.cache`, and `worktrees`; other hidden directories can appear.
Those omissions affect navigation, not permission to access a known file path.

Opening reveals the focused file and expands its ancestor folders. Ordinary live refresh preserves sidebar scroll
and document scroll instead of recentering the explorer on every update.

Each browser event stream watches the root, expanded directories and their ancestors, the selected file's parent,
and local referenced assets' parents, including in-workspace symlink targets. It watches at most **256 directory
paths**. It does not recursively subscribe to every file in the workspace. Excess paths can fall outside the watch
set; reduce expanded folders or reload when working across unusually many directories.

Saved edits, atomic replacements, and relevant directory changes trigger refreshed reads. A broken stream retries;
watcher failures surface in the browser status and server diagnostics. Live updates do not expose unsaved buffers.

## Sessions and access

One Neovim session owns at most one server. The server root is canonical and fixed after startup. Independent
sessions bind the first available `127.0.0.1` port in 57300–57399; the port range is fixed in this release.

Normal editor exit, ownership-pipe EOF, owner death, or an explicit stop ends the server. Suspending a living owner
keeps it alive. Browser tabs do not own servers, so closing a tab does not stop one. List selection does not transfer
ownership. Discovery is limited to servers in the same configured state registry.

Authenticated routes require a token carried in the viewer URL. The server validates host/origin headers and uses
rooted file operations to contain workspace reads even across symlink changes. Document scripts cannot run through
the preview. Keep URL tokens and registry files private, and choose a root whose contents you intend to expose to
that local viewer. This is local viewing, not a network sharing service or an access boundary between documents in
the same workspace.
