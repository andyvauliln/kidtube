# extension/core/pages/

The core's own pages (`chrome-extension://<id>/core/pages/...`).

| Page | What it does |
| --- | --- |
| `pin.html` + `pin.js` | The one PIN page. `?for=parent` turns on parent mode, `?for=unlock` opens a locked YouTube, `?for=kid` asks for the first PIN before kid mode, `?for=settings` opens the app's settings. Without a PIN yet, it asks to choose one |
| `options.html` + `options.js` | The extension's options page: goes to the PIN page with `?for=settings` |
| `check.html` + `check.js` + `check-module.js` | "Check this browser": one row per thing KidTube needs, so a blank screen can say why. `check.js` is a plain script on purpose: it must run where module scripts don't |
