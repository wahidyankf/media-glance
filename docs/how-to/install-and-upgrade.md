# Install or upgrade media-glance.nvim

Use a matching plugin tag and release binary on Neovim 0.10 or later, macOS or Linux, arm64 or amd64.
Installation needs network access, `curl`, and either `shasum` or `sha256sum`; subsequent local previews work offline.

## Install the released plugin

Add the lazy.nvim spec in the [root README](../../README.md#install), install it with your plugin manager, and restart
Neovim. Run:

```vim
:MediaGlanceInstall
```

The quick start pins v0.1.1, which includes port labels in both server pickers. The installer chooses your platform
automatically and downloads an executable named `media-glance_v0.1.1_<os>_<arch>` and its `.sha256` file from the
[v0.1.1 release](https://github.com/wahidyankf/media-glance/releases/tag/v0.1.1).

It validates the checksum file, checks the downloaded executable's version and protocol, then atomically replaces
`stdpath("cache")/media-glance/v0.1.1/media-glance`. The command waits for installation to finish. Open/list/close
commands never install a missing binary automatically.

Open a saved workspace file and run `:MediaGlanceOpen`. For another plugin manager, make the plugin available on
Neovim's runtime path and call `require("media-glance").setup()` before using the commands.

## Upgrade the plugin revision

Stop your current session's server, change the pinned commit or tag to the revision you intend to use, and update it
through your plugin manager. Restart Neovim to load its Lua code. When upgrading from v0.1.0 to v0.1.1,
run `:MediaGlanceInstall` again for the matching binary; cache entries are versioned.
Check the revision's installation instructions before carrying a custom `binary` override forward.

## Use an explicit source build

Follow the [contributor setup](../../CONTRIBUTING.md#tools-and-setup) in a source checkout, then run:

```bash
npm run build
```

Set `binary` to that checkout's **absolute** `build/media-glance` path in your plugin configuration:

```lua
require("media-glance").setup({
  binary = vim.fn.expand("~/media-glance/build/media-glance"),
})
```

This example assumes your checkout is `~/media-glance`; use its actual location. Source builds need the contributor
tools. Running the built binary needs neither those tools nor the checkout's browser asset files: the binary embeds
its interface and renderer. `:MediaGlanceInstall` still installs into the release cache; it does not replace a custom
`binary` override.

## Recover from an interrupted installation

An interrupted installer can leave `install.lock` under the release cache directory. First confirm that no other
Neovim session is installing the same release. Then remove that exact lock directory and retry
`:MediaGlanceInstall`. With defaults, print its location inside Neovim:

```vim
:lua print(vim.fn.stdpath("cache") .. "/media-glance/v0.1.1/install.lock")
```

If you configured `cache_dir`, inspect that directory instead. Do not remove another session's active lock or
replace a failed verification with an unverified executable. [Troubleshooting](troubleshoot.md) covers missing tools,
unsupported platforms, and checksum or version failures.
