# Configuration and Lua API

The public module is `require("media-glance")`. Call `setup` before using commands; it creates commands and
`VimLeavePre` cleanup without starting a server or installing a binary.

## Options

```lua
require("media-glance").setup({
  root = function() return vim.fn.getcwd(-1, -1) end,
  state_dir = vim.fn.stdpath("state") .. "/media-glance",
  cache_dir = vim.fn.stdpath("cache") .. "/media-glance",
  -- binary = "/absolute/path/to/media-glance",
})
```

| Option      | Default                               | Meaning                                                        |
| ----------- | ------------------------------------- | -------------------------------------------------------------- |
| `root`      | Function returning global cwd         | Resolve the workspace when starting an owned server.           |
| `binary`    | Versioned cache executable            | Optional explicit executable path, for example a source build. |
| `state_dir` | `stdpath("state") .. "/media-glance"` | Private server registry directory.                             |
| `cache_dir` | `stdpath("cache") .. "/media-glance"` | Parent of versioned binaries and install locks.                |

`binary`, `state_dir`, and `cache_dir` are optional strings. Use absolute paths for directory and executable
overrides. The root must resolve to an existing directory. The default callback returns `vim.fn.getcwd(-1, -1)`.
`root` must be callable and return a string; callback failures produce a notification. It does not run when
reopening an already owned server. The default binary is `cache_dir/v0.1.0/media-glance` in this release.

A `setup` call replaces the option table; it does not merge with options from an earlier call. Configure before
starting a server. Existing roots stay fixed, and changing registry options while a server is active can make list
commands look in a different registry.

There are no default mappings, port options, or automatic Git-root detection. Server selection uses `vim.ui.select`.

## Commands and functions

| Command               | Lua function     | Behavior                                                            |
| --------------------- | ---------------- | ------------------------------------------------------------------- |
| `:MediaGlanceOpen`    | `open()`         | Start or reuse this session's server and open a focused saved file. |
| `:MediaGlanceList`    | `list()`         | Discover validated servers and open the selected instance.          |
| `:MediaGlanceClose`   | `close()`        | Discover validated servers and stop the selected instance.          |
| `:MediaGlanceInstall` | `install()`      | Download, verify, and atomically install the matching release.      |
| No command            | `shutdown()`     | Stop only this session's owned server through its ownership pipe.   |
| No command            | `setup(options)` | Register commands and exit cleanup; replace configuration.          |

`install()` returns `path, nil` on success or `nil, failure` for an expected installation failure. It also sends a
Neovim notification. It operates on `cache_dir` even when `binary` overrides the runtime executable.
The other functions return no result; startup, browser-open, list, and stop failures produce notifications.

Open/list/close use asynchronous jobs or subprocess callbacks. `install()` waits for its download and verification
steps to finish. `shutdown()` initiates cleanup; it does not wait for the server's exit callback.

The list orders this session's owned server first, then other servers by port. Each item displays its root, port,
owner PID, and an owned-session label when applicable. Selection opens the file captured before the picker, if that
file belongs to the selected root. Otherwise it falls back to root `README.md`, then the explorer.

## Installed binary and protocol

The plugin and installer target v0.1.0 and protocol 1. The installer executes `version --json` and requires both
values to match before publishing the binary. The CLI reports:

```json
{ "version": "v0.1.0", "protocol": 1 }
```

Readiness, list, and stop records use protocol version 1; the plugin validates their shapes and identity before
acting on them. Configure a source-built binary from matching source rather than assuming an arbitrary executable
is compatible. The CLI is the plugin's server boundary; contributor implementation details live in the source.

## Timeouts

- Server readiness: 30 seconds, then the plugin initiates shutdown.
- List and stop subprocesses: 10 seconds each.
- Each installer download: 10-second connection timeout and 60-second transfer limit.
- Installer binary version probe: 5 seconds.

A failed or interrupted installation never substitutes an unverified download for the installed executable.
An interrupted process can leave an install lock; use the [recovery guide](../how-to/install-and-upgrade.md).
