# media-glance.nvim Contributor Instructions

This repository owns the Neovim plugin, the Go viewer server, the browser interface, and their build and test tooling.
Keep platform configuration and personal workspace documents outside this repository.

## Development and Delivery

- Read the affected source and check Git status before changing files. Preserve unrelated changes.
- Use a task branch in a worktree at `{repository}/worktrees/<task>`; keep `/worktrees/` ignored. Deliver through a pull
  request, pass required CI, and merge to `main`. After merge, remove only clean task-owned worktrees and branches.
- Keep changes focused and document public API, configuration, installation, and behavior changes in the same change.
- Use the repository's native checks. Do not require an external governance catalog or resource scheduler to contribute.
- Run `npm run setup` to configure the tracked hooks. Never bypass a failing pre-push hook.

## Checks and Coverage

- Run `npm run check:unit` and `npm run check:fast` before pushing. The pre-push hook runs both: fresh unit tests and
  coverage, then format/lint checks.
- Run `npm run check:complete` before declaring a change complete. CI also requires integration, Neovim runtime, and
  browser end-to-end tests.
- Maintain at least **99% independently** for Go statement coverage, Lua executable-line coverage, and JavaScript
  executable-line coverage. Do not average the runtimes or count integration/end-to-end tests toward the unit gate.
- Include every authored production source in the coverage inventory, including CLI, lifecycle, installer, frontend,
  and build/gate tooling. Exclude only vendor code, generated output, fixtures, and test code.
- Reject empty, incomplete, or stale coverage reports. Do not lower thresholds, omit uncovered source, disable tests,
  or add exclusions to make a gate pass.
- Test behavior at its owning boundary. Use meaningful unit tests for decisions and error paths; use isolated host,
  HTTP, filesystem, and browser tests for runtime interactions. Add a regression test for a behavior defect.
- For lifecycle changes, verify cleanup of servers, streams, watchers, goroutines, file descriptors, and retained memory.
  Test fixtures must stop only their own processes and must never modify a contributor's live workspace.

## Runtime Contract

- Support Neovim 0.10 and later on macOS and Linux; release binaries target arm64 and amd64. Do not claim Windows
  support without its implementation and tests.
- Keep the user runtime to Lua, a prebuilt Go binary, and a browser. Opening the viewer must not build, download,
  require Node.js or a Go toolchain, or acquire a development resource reservation.
- Bundle pinned browser assets into the binary. Keep preview rendering available offline after installation.
- Install explicitly from the plugin's matching release, verify binary checksums and binary version/protocol, and
  publish the installed binary atomically.
- Preserve focused-file opening, external filesystem updates, media zoom, multiple-server isolation, and server
  shutdown when its owning editor exits.

## Security and Documentation

- Bind only to loopback. Preserve authenticated routes, host/origin validation, and canonical workspace containment,
  including symlink boundaries. Render untrusted Markdown and media without executing document scripts or raw HTML.
- Publish no personal paths, credentials, workspace content, or private repository history. Retain the MIT license and
  third-party notices for bundled assets.
- Write clear contributor-facing documentation with real, tested commands. Explain limitations and failed checks
  honestly; a partial or failing gate is not a passing result.
