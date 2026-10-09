# GitHub workflows

`check.yml` runs CI for pull requests, pushes to `main`, release tags matching `v*`, and manual workflow dispatches.
It uses native contributor tools and pins GitHub Actions to exact commits.

## Required checks

The complete gate runs on Linux with Neovim 0.10.4 and 0.12.5, and on macOS with Neovim 0.12.5. It covers independent
unit coverage, formatting/lint, Go race and integration tests, native Neovim behavior, Git hooks, and browser journeys.

Contributor downloads use the checksum-verified tool bootstrap and pinned Neovim assets. JavaScript dependencies
come from `npm ci`; the browser uses the project-local Playwright cache.

## Release artifacts

On release-tag runs, the `release-build` job waits for every complete gate to pass. It builds four standalone
executables for macOS/Linux on arm64/amd64, plus the checksum manifest and individual checksum files, and uploads
them as the `release-binaries` workflow artifact. Publishing a GitHub release is a separate maintainer action;
the workflow does not create one automatically. See [contributor release guidance](../../CONTRIBUTING.md#releases).

The product landing page is the repository's [root README](../../README.md). Automation documentation lives here
so it does not replace that page through GitHub's `.github/README.md` precedence.
