# Media rendering

`files.go` classifies previewable files. `render.go` renders Markdown with Goldmark,
rewrites local links and asset URLs, and identifies referenced assets for live updates.

The package renders supplied content without opening workspace files. The server anchors file access to its workspace
capability. Unit tests cover rendering, refusal cases, and failure handling; root integration tests exercise actual
files, symlink retargeting, HTTP, and filesystem watches.
