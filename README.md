# media-glance.nvim

Preview your workspace in a browser from Neovim. Browse files in a sidebar, render Markdown and Mermaid diagrams,
open images and other media, and see updates made by your editor or another process.

The viewer uses one local Go server per workspace session. Browser assets are bundled, so previews work offline
once the binary is installed. Opening a preview requires no Node.js, Go toolchain, or development scheduler.

## Install

Requires Neovim 0.10 or later on macOS or Linux. Releases provide arm64 and amd64 binaries.

With lazy.nvim:

```lua
{
  "wahidyankf/media-glance",
  tag = "v0.1.0",
  config = function()
    require("media-glance").setup()
  end,
}
```

Run `:MediaGlanceInstall` once to install the binary matching the plugin release. Installation verifies its checksum
and version before publishing it to the Neovim cache. Open and list commands never install or build automatically.

For a local source build, use the contributor instructions and pass its absolute binary path through `setup`.
Windows is not supported in this release.

## Use

- `:MediaGlanceOpen`: start or reuse your session's viewer and open the currently focused, saved workspace file.
- `:MediaGlanceList`: choose a running viewer; Enter opens it focused on your current file when that file is in its root.
- `:MediaGlanceClose`: choose a running viewer; Enter stops the selected server.

The workspace root is Neovim's global working directory when the server starts. Its root remains fixed for that
server. Files outside that root, unnamed buffers, and directories fall back to a workspace README or the explorer.
The owning Neovim session stops its server on exit. You can also find and stop forgotten servers through the list.

The plugin does not set mappings. For example:

```lua
local media = require("media-glance")
vim.keymap.set("n", "<leader>mo", media.open, { desc = "Open workspace media" })
vim.keymap.set("n", "<leader>ml", media.list, { desc = "List workspace media" })
vim.keymap.set("n", "<leader>mx", media.close, { desc = "Close workspace media" })
```

Each server binds only to `127.0.0.1`, choosing the first available port in **57300–57399** by actually binding it.
Multiple sessions can run independently; occupied ports are skipped and exhaustion produces an error.

## Preview behavior

Markdown supports tables, code blocks, images, local links, Mermaid, and mathematical labels. Raw document HTML is
escaped. Ordinary images, SVG images, PDF, audio, video, and small text files can be previewed; other files can be
downloaded. Preview text is limited to 2 MiB.

Images and Mermaid diagrams have independent **−**, **+**, **Fit**, and **Expand** controls. Zoom ranges from 25% to
800% relative to fit; scrolling explores enlarged media. Escape closes the expanded view and returns keyboard focus.
Document text keeps its size, while the content column allows up to 123ch.

Filesystem watchers refresh saved changes, including external and atomic writes. Updates preserve document scroll
and existing media zoom. The sidebar reveals your focused file on opening; ordinary live updates preserve its scroll.
The tree loads folders as needed and skips `.git`, `node_modules`, `.cache`, and nested `worktrees` directories.

## Configuration and Lua API

```lua
require("media-glance").setup({
  -- root = function() return vim.fn.getcwd(-1, -1) end,
  -- binary = "/absolute/path/to/media-glance",
  -- state_dir = "/absolute/path/to/registry",
})
```

The module exposes `setup`, `open`, `list`, `close`, `shutdown`, and `install`.
Use `shutdown()` to stop only the server owned by the current session. Server selection uses `vim.ui.select`;
Telescope is optional.

## Development and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for build, coverage, hooks, and test commands. All three production runtimes
have separate 99% unit coverage gates. Integration tests exercise server lifecycle and resource cleanup; browser
end-to-end tests use synthetic files and stop their own servers.

The server authenticates its routes, validates host/origin headers, and confines files and symlinks to the workspace.
Only its intended browser asset graph is exposed. Do not share viewer URLs: they contain the session's access token.

[MIT license](LICENSE). Bundled dependency notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
