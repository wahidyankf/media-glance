# Development tooling

`cli.mjs` exposes the package commands through `tooling.mjs`. `command.mjs` stops failed subprocesses.
`tools.mjs` explicitly installs checksum-verified development tools; checks never download or install automatically.

The unit gate generates fresh reports, validates their complete authored-source inventory, and enforces
99% independently for Go statements and Lua/JavaScript executable lines. The build stages pinned renderer modules
without source maps, isolates vendored Go source, and embeds assets into the server. Release builds create the four
macOS/Linux executables and checksum files. See the root contributor guide for commands and prerequisites.
