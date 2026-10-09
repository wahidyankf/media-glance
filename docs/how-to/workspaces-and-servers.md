# Choose workspaces and manage servers

A server serves one directory and belongs to the Neovim session that started it. Use the steps below to control
which workspace you preview and to find servers from other sessions.

## Choose a workspace before opening

The default root is Neovim's global working directory, not an automatically detected Git root. Start Neovim from
the workspace you want to browse, or use `:cd` before the first `:MediaGlanceOpen`. Check the default root with:

```vim
:lua print(vim.fn.getcwd(-1, -1))
```

For custom workspace detection, configure a callback that returns an existing absolute directory:

```lua
require("media-glance").setup({
  root = function()
    return vim.fn.getcwd(-1, -1)
  end,
})
```

Replace the callback body with your workspace resolver. Configure options before starting a server. The root stays
fixed for that server even after directory changes. To move this session to another root, stop its server, wait for
it to exit, change directory, then open again.

## Reopen the file you are editing

Select a saved buffer inside the workspace and run `:MediaGlanceOpen`. An existing server opens that focused file
without starting another process. Unsaved changes are not part of the preview; save them first.

If the buffer is unnamed, unavailable, a directory, or outside the server's root, the browser opens the workspace's
root `README.md` when it exists, otherwise the explorer.

## Open another session's server

Run `:MediaGlanceList` and choose a server. The picker shows its workspace, loopback port, and owner process ID;
this session's server appears first and carries a `[this session]` label.

The plugin captures the current file before opening the picker. The selected server opens that file if it belongs
to its root, otherwise its root README or explorer. Selecting a server does not transfer ownership: the session
that started it still controls its lifetime. Sessions must share `state_dir` to discover each other's servers.

## Stop a selected server

Run `:MediaGlanceClose`, choose the intended workspace, and confirm the selection. With common picker providers,
Enter confirms and Escape cancels; the plugin explicitly binds Escape to cancellation for Telescope's picker.
The stop request targets the validated instance identity, not an arbitrary PID.

To stop only the server owned by the current session without a picker, use:

```vim
:lua require("media-glance").shutdown()
```

Shutdown is asynchronous. If you immediately open again, the plugin can report that the server is still stopping;
retry after it exits. Normal editor exit and owner death also stop the owned server. Closing a browser tab does not.

## Run several sessions

Each session starts at most one owned server. It tries ports 57300 through 57399 and skips occupied ports by actually
binding them. A second session can serve the same or a different workspace independently. The port range is fixed
in this release; there is no port configuration option. If all ports are occupied, close an unneeded viewer through
`:MediaGlanceClose` and retry. The plugin does not stop unrelated services to free a port.
