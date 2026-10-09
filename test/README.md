# Test suites

Unit tests exercise authored frontend and tooling behavior without browser or server journeys. Lua unit and
runtime tests live under `lua/`. Browser tests own a synthetic fixture controller and one viewer process.
Integration tests verify the installed Git hook against temporary local repositories. Go tests live beside
the packages they exercise; integration tests use the `integration` build tag.
