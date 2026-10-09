# JavaScript unit tests

These node:test suites use jsdom for browser boundaries and controlled subprocess/filesystem adapters for
build, release, tool bootstrap, coverage, and hook decisions. c8 measures every authored production JavaScript
source under `web/` and `scripts/`, excluding generated vendor files. These are separate from browser journeys.
