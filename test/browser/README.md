# Browser journeys

Playwright launches one Chromium worker against an owned synthetic fixture. The controller creates media and
Markdown files, starts the built Go binary, and exposes controlled external edits. The journey verifies focused
files, sidebar reveal, media zoom/pan, modal focus, external refresh, errors, and out-of-order navigation.
The test always closes its context and fixture; the fixture stops its own viewer and validates registry cleanup.
