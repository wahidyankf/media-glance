# Contributing to media-glance.nvim

Work on a branch and submit a pull request. Changes must pass the required CI before merging to `main`.
Keep personal configuration and workspace documents outside the repository.

## Tools and setup

Use Node.js 24.16.0, npm 11.11.0, Go 1.26.8, golangci-lint 2.11.3, Neovim 0.10 or later, ShellCheck, and shfmt.
The Node versions are recorded in `package.json`; JavaScript dependencies are pinned in `package-lock.json`.
The Go commands select the recorded toolchain. CI pins its Neovim and instrument downloads.

```sh
npm ci
npm run tools
npm run setup
npm run build
npm run browser:install
```

`setup` enables the tracked pre-push hook through `core.hooksPath`. Before pushing, the hook runs fresh unit tests
and the coverage gate, then format and lint checks. Never bypass it.

`tools` explicitly downloads checksum-verified development tools into the ignored `.deps` directory:
LuaCov 0.17.0, StyLua 2.5.2, and LuaLS 3.19.1. Checks do not download missing tools. They use Neovim's installed
runtime definitions when checking Lua. Install golangci-lint 2.11.3 on your development PATH.

Browser installation uses `.deps/playwright` and disables browser cache garbage collection. Tests use the same
project cache, preserving browsers used by other projects.

A source build prepares the pinned Mermaid graph, replaces its known math chunk with patched KaTeX, and embeds the
result in `build/media-glance`. Source builds need development tools; running the installed viewer does not.

## Checks

```sh
npm run test:js
npm run check:unit
npm run check:fast
npm run check:integration
npm run test:browser
npm run check:complete
```

`check:unit` regenerates reports and requires at least 99% independently for Go statements, Lua executable lines,
and JavaScript executable lines. Integration and end-to-end tests do not count toward that number. The gate includes
all authored production sources, including command entry points, installer, lifecycle, frontend, and build tooling.
Only vendor, generated output, fixtures, and test code are excluded. Missing, stale, empty, or incomplete reports fail.

`check:fast` checks formatting and lint. `check:integration` runs the Go race and integration suites, isolated Neovim
runtime tests, and a real Git fixture that proves the installed hook refuses failed coverage. Browser tests exercise
focused files, Mermaid, independent media zoom, external writes, sidebar position, and stale navigation responses.
`check:complete` builds the binary and runs all these gates.

Resource regression tests repeatedly open streams, change watcher sets, and render files. They require watcher and
file-descriptor cleanup, bounded settled goroutine counts, and post-GC retained heap within a 2 MiB growth budget.
Fixtures must not modify an existing workspace or stop a server owned by another session.

## Releases

```sh
npm run release:build
```

This builds four `CGO_ENABLED=0` executables in `dist`, plus `checksums.txt` and individual `.sha256` files:
macOS and Linux, each on arm64 and amd64. A release must pass the complete suite and an offline smoke test of the
binary copied away from the checkout. Keep the plugin tag and binary version in sync. Preserve dependency licenses
and review the expected Mermaid math chunk before updating renderer pins.
