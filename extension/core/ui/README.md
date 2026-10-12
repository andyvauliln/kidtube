# extension/core/ui/

Plain scripts (not modules) that pages and content scripts share. Each one sets a global.

| File | Global | What it does |
| --- | --- | --- |
| `header.js` | `KidTubeHeader` | The apps header: one bar with the connected profile and, on a site's own page, **Connect** (the account signed in there; the page reads it again first with `globalThis.KidTubeAccount.read`). Below: the GitHub connection, or the apps row (YouTube and Instagram without any app, then the apps with a profile for their site's account, the settings file). Drawn in its own shadow root. Also `modeSwitch()`, the Parent / Kid switch of the apps' pages |
| `watch.js` | `KidTubeWatch` | The checks on a page (loaded first): screen checks, "no dead buttons", "the background answers", uncaught errors in KidTube's code. Results go to the background (`core/checks/`) |
| `boot.js` | — | Loaded first on the parent screens and the PIN page: if the page does not start, it shows the error on the page (the iPad has no developer console) |

`header.js` runs on YouTube too, so it never uses `innerHTML` (YouTube's Trusted Types policy refuses it).
