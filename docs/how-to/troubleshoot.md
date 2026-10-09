# Troubleshoot a preview

Read the Neovim notification and `:messages` first. Diagnose installation, server startup, and browser rendering
separately so that a renderer problem does not lead you to replace a working binary.

## Command or binary is unavailable

If `:MediaGlanceOpen` is unknown, check that your plugin manager installed media-glance.nvim and ran its setup.
The root README's lazy.nvim spec loads it at startup. For manual loading, call `require("media-glance").setup()`.

If the notification says the binary is unavailable, run `:MediaGlanceInstall`. A custom `binary` option must point
to an executable at its absolute path; installation fills the release cache and does not change that override.

## Installation fails

- **Unsupported platform:** use macOS or Linux on arm64/amd64. Windows has no supported release binary.
- **Missing curl or checksum tool:** install `curl` and `shasum` or `sha256sum` on your PATH, then retry.
- **Download fails:** check access to GitHub release downloads and the matching plugin tag. The command applies
  connection and download timeouts rather than waiting indefinitely.
- **Checksum or version/protocol fails:** stop using the failed download. Confirm the plugin tag and release match,
  then retry. Report a repeatable failure with the asset name and error, without bypassing verification.
- **Installation is locked:** follow the [interrupted-install recovery](install-and-upgrade.md) steps after confirming
  no installer is active.

## The wrong workspace or file opens

Print `vim.fn.getcwd(-1, -1)` in Neovim and compare it with the picker workspace. An existing server keeps its original
root. Stop it and reopen after changing your global directory. A file outside that root, an unnamed buffer, or a
missing file falls back to the root README or explorer. Save the intended file before opening it.

## The server cannot start

Confirm the root callback returns an existing directory and your state/cache directories are writable. A startup
error can name occupied ports, unavailable files, an unusable executable, or readiness failure. If ports 57300–57399
are all occupied, stop an unneeded viewer rather than killing an unrelated process. The plugin stops a server that
has not reported readiness within 30 seconds.

If Neovim reports that it could not open the browser, the server may still be running. Check your desktop's browser
opener, then use `:MediaGlanceList` to try again. Opening uses Neovim's `vim.ui.open`.

## Saved changes do not appear

The viewer reads disk, not an unsaved Neovim buffer. Save the file and inspect the browser's live status. A broken
stream reports reconnecting; a watcher error also appears in server diagnostics. Reload the browser after the
filesystem or connection recovers.

Live watching follows visible folders, the selected file, and local referenced assets. It is bounded to 256 directory
paths per browser stream, so a workspace with many expanded directories or asset locations can exceed its watch set.
Collapse unneeded folders or reload the selected document. Symlinks outside the workspace are unavailable by design.

## A diagram, image, or media file fails

Mermaid diagrams need a fenced block with the `mermaid` language and valid Mermaid syntax. Render errors appear in
the preview. Ordinary Markdown math is not a separate supported renderer; mathematical labels belong to Mermaid
syntax supported by the bundled renderer.

Check local asset paths relative to the Markdown document, or use a leading slash for a workspace-relative path.
An asset outside the workspace cannot load through the viewer. Remote images need their remote host to be available,
even though the local interface and Mermaid renderer are bundled.

PDF, audio, and video preview depend on the browser's built-in support and codecs. Unsupported media can be
downloaded. Markdown and ordinary UTF-8 text larger than 2 MiB use the download view. Use the per-item **+** or
**Expand** controls for small images and diagrams instead of changing the whole page's zoom.

## Report a reproducible problem

Open [GitHub Issues](https://github.com/wahidyankf/media-glance/issues) with your operating system/architecture,
Neovim version, plugin tag, error message, and steps using a small synthetic workspace. Include whether the issue
occurs on installation, startup, an external save, or browser rendering. Do not include viewer URLs, tokens,
registry files, credentials, or private workspace documents.
