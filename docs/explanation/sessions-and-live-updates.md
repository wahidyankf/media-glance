# How sessions and live updates work

A terminal editor can show Markdown source, but diagrams and large images need a different reading surface.
media-glance.nvim keeps editing in Neovim and uses the browser for rich previews of the saved workspace.

## A small runtime with an explicit install

Lua integrates with buffers, commands, and editor lifecycle. A Go process serves workspace files and filesystem
updates. Browser JavaScript renders Mermaid and controls media layout. The Go binary embeds the interface and
pinned renderer graph, so it does not need a source checkout, Node.js process, or Go toolchain at runtime.

Installation is a separate, explicit action with network access and verification. Opening a document uses the
already installed binary. This keeps an ordinary preview from turning into an unexpected download or build.
Bundled assets support offline local previews; a document's remote images still depend on their hosts.

## Neovim owns the process

Each editor session starts at most one server with an immutable workspace root and an ownership pipe. Normal exit
sends a stop and closes that pipe. Pipe EOF and an owner-process check also cover owner death; a suspended but living
editor remains an owner. The server stops its active connections and releases watcher and process resources on exit.

A browser tab can disappear without ending the editing session, so closing the tab does not stop the server.
Selecting another session's viewer opens a browser URL without transferring ownership. Explicit stop uses a
validated server identity, avoiding a request to kill whatever process happens to reuse an old PID.

Loopback ports 57300–57399 allow multiple sessions. Each process actually binds a candidate port before choosing
it; a separate probe would leave a race between checking and starting. Exhaustion returns an error rather than
replacing an unrelated service.

## Saved files are the common input

The server watches disk, so Neovim, another editor, a shell command, or an agent can update the same document.
No editor-specific change event is required. Atomic writes and directory replacements matter because many editors
and tools replace a file instead of editing its existing inode.

Watching follows the selected file, its local referenced assets, and the expanded explorer rather than every
nested file in the workspace. Parent-directory subscriptions catch replacements; watcher reconciliation follows
relevant directory and symlink changes. A bounded watch set limits resource growth, with the 256-path limit
explained in the [preview reference](../reference/preview-behavior.md#explorer-and-live-updates).

The browser captures your position and matching media state during refresh. An external save should update what
you read without constantly moving the sidebar, changing document text size, or resetting image zoom.

## Local access has a defined boundary

The viewer binds only to loopback and authenticates routes with a per-session token. Host/origin checks prevent
accepting a different hostname or foreign origin, and rooted file operations prevent reads from escaping the
workspace through traversal or changing symlinks. Markdown HTML is escaped and document scripts do not execute.

The token authorizes workspace reads; it is not a permission system for individual files. Hidden explorer folders
are navigation omissions, not secret-file protection. Keep URLs and registry files private, and choose the workspace
root deliberately. The service is intended for local reading rather than publishing or sharing private documents.

Lifecycle and resource regression tests check repeated streams, watcher changes, and settled cleanup. Those tests
provide evidence for exercised sequences; they do not establish a universal memory-leak guarantee for every
workspace, filesystem, or browser session. See [contributor checks](../../CONTRIBUTING.md#checks) for their scope.
