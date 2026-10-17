# media-glance.nvim Contributor Instructions

This repository owns the Neovim plugin, the Go viewer server, the browser interface, and their build and test tooling.
Keep platform configuration and personal workspace documents outside this repository.

## Development and Delivery

- Read the affected source and check Git status before changing files. Preserve unrelated changes.
- Use a task branch in a worktree at `{repository}/worktrees/<task>`; keep `/worktrees/` ignored. Deliver through a pull
  request, pass required CI, and merge to `main`. After merge, remove only clean task-owned worktrees and branches.
- Keep changes focused and document public API, configuration, installation, and behavior changes in the same change.
- Use the repository's native checks. Do not require an external governance catalog or resource scheduler to contribute.
- Run `npm run setup` to configure the tracked Husky hooks in `.husky/`. The pre-commit hook formats and checks
  staged files; every commit message must follow Conventional Commits (the commit-msg hook enforces it).
  Never bypass a failing hook.
- Follow [Git delivery](docs/reference/git-delivery.md) for ongoing task authority, owned branch sync, and recovery.

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
- For lifecycle changes, verify cleanup of servers, streams, watchers, goroutines, file descriptors, and retained
  memory. Test fixtures must stop only their own processes and must never modify a contributor's live workspace.
- During a TDD cycle, run only the check covering the current item to demonstrate Red and Green. Do not run the whole
  automated suite except end-to-end tests to prove a single item.
- New/changed behaviour and bug fixes start from a failing test.
- When a plan delivers work in batches (one pull request or delivery boundary at a time), the TDD cycle may run per
  batch instead of per scenario, so planned work does not pay a full red-green ceremony for every scenario: write the
  batch's tests first from its scenarios before any production change; run one focused RED run where every scenario's
  test fails for its stated reason, grouped in one batch record, repairing any passing test before implementation;
  implement the batch, then run the identical selection to GREEN with the selection frozen between RED and GREEN;
  refactor inside the batch only while the selection is green, adding a behaviour change noticed along the way to the
  batch's tests or its own cycle; run the full applicable regression and touched end-to-end flows only at the phase or
  push boundary; do not repeat an accepted RED whose tests and production code are unchanged. A batch is one cohesive
  behaviour slice sharing a boundary and fixtures; unrelated failures in one RED run mean the batch is too large, so
  split it. Small single-scenario changes and single bug fixes keep the per-scenario cycle. This changes run and
  evidence granularity only: it never permits writing tests after the code, and existing scope exemptions are unchanged.
- At the end of each plan phase, and before pull request ready-for-review or session end as a safety net, run the whole
  automated suite except full end-to-end tests, plus only the affected end-to-end flow. A full end-to-end run is never
  a completion condition for plan execution or a plan phase; full end-to-end is batched through its scheduled workflow.
  Keep local end-to-end runs selective to the touched flow.
- Before starting plan execution or creating a new worktree, sync the execution checkout from the latest `origin/main`.

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
- Never open or read private-key contents anywhere, including outside every repository. Each secret step is exactly one
  copy-ready command carrying its working directory, placed on the operator clipboard; the operator runs it in their
  own terminal, entering each secret at a hidden prompt only, and replies with the success word the step names;
  continue only on it. Never request, handle, or record secret values, full outputs, or screenshots, and avoid any
  script or interaction that prints, echoes, logs, or otherwise exposes a secret to the session; diagnose by exit and
  error codes alone; only local-development secrets (loopback services, dummy/example values such as `.env.example`)
  may appear in records. Open the secret session only inside the phase that needs it and lock it before any review,
  pause, or PR handoff. Allow agent-assisted delivery only with a proper pipeline and secrets management (tracked
  wrapper, closed one-word outputs, leak screens, green gates); elsewhere stop at the secret boundary. Delegate the
  leak review's reading and judging to a fresh-context subagent with no part in authoring the change — read-only,
  never posting — and post its verdict unchanged on behalf of the user, so no human reviewer is on the merge path.
  Operate the leak review only after that subagent reads every commit at the pinned head against the three leak
  classes; a self-judged record, or a record without that reading, is fabrication. A failed spawn blocks the
  push or merge exactly as a finding does.
- Write clear contributor-facing documentation with real, tested commands. Explain limitations and failed checks
  honestly; a partial or failing gate is not a passing result.
