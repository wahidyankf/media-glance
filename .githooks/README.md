# Git hooks

The tracked pre-push hook runs fresh unit tests and the independent 99% coverage gate, then format/lint checks.
The contributor setup command activates this directory through `core.hooksPath`. Do not bypass failed checks.
Unit command fixtures and real local Git integration fixtures verify refusal and successful push behavior.
