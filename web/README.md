# Browser interface

`start.js` initializes `app.js`, whose controller owns navigation, the lazy file tree, live subscriptions,
and cleanup. It normalizes external HTTP/HTTPS anchors and owns the system/manual theme preference and the sidebar
preference. `media.js` owns independent image and Mermaid zoom, pan, and expanded dialogs.
The header owns the sidebar toggle and theme selection. The sidebar state is saved as `media-glance.sidebar`; Cmd+B on
macOS and Ctrl+B elsewhere toggles it. Expanded media has only media controls. Code copy actions use one delegated
document listener and ignore results from replaced previews. Bundled fonts in `fonts/` load before diagram geometry.
`favicon.svg` is a self-contained eye icon served through the authenticated asset route.
`style.css` keeps the document column at 123ch and supplies responsive media controls.

The build stages the pinned renderer graph under ignored `vendor/`; Go embeds it with these interface files.
Unit tests inject browser boundaries through the controller host. Browser journeys use the actual Go server.
