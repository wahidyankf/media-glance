# Lua verification

`unit.lua` runs isolated dependency tests and measures every authored production Lua file with LuaCov. The report at
`.coverage/lua.json` uses executable lines and enforces 99% without counting integration tests.

`integration.lua` drives commands and example mappings in two real isolated Neovim instances, with a fixture picker
adapter. It checks focused-file selection, ports, immutable roots, cancellation, selected shutdown, normal exit,
suspended owners, owner death, and teardown. It requires `npm run build` first.
