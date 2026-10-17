# Git hooks

The tracked pre-commit hook checks staged files through lint-staged (Biome for JavaScript, Prettier for
documents, gofmt and `go mod edit` for Go, StyLua for Lua, shfmt for shell). The tracked commit-msg hook
lints the message against Conventional Commits through commitlint. Do not bypass failed checks.
The tracked pre-push hook runs fresh unit tests and the independent 99% coverage gate, then format/lint checks.
The contributor setup command activates this directory through `core.hooksPath`. Do not bypass failed checks.
