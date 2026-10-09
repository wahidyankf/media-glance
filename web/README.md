# Browser interface

`start.js` initializes `app.js`, whose controller owns navigation, the lazy file tree, live subscriptions,
and cleanup. It normalizes external HTTP/HTTPS anchors and owns the system/manual theme preference. `media.js` owns
independent image and Mermaid zoom, pan, and expanded dialogs.
Expanded theme controls delegate to the app’s document listener and are removed with their media owner.
`favicon.svg` is a self-contained eye icon served through the authenticated asset route.
`style.css` keeps the document column at 123ch and supplies responsive media controls.

The build stages the pinned renderer graph under ignored `vendor/`; Go embeds it with these interface files.
Unit tests inject browser boundaries through the controller host. Browser journeys use the actual Go server.
