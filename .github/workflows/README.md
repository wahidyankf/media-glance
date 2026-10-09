# Check workflow

`check.yml` runs the complete suite on Linux with Neovim 0.10.4 and 0.12.5, and on macOS with Neovim 0.12.5.
It verifies native editor assets and uses the checksum-verified contributor tool bootstrap. Required checks cover
unit coverage, formatting/lint, Go race/integration tests, Neovim runtime tests, Git hooks, and browser journeys.
Release tags additionally build and upload the four executable/checksum artifacts after the complete gate passes.
