# extension/core/ui/

Plain scripts (not modules) that pages and content scripts share. Each one sets a global.

| File | Global | What it does |
| --- | --- | --- |
| `header.js` | `KidTubeHeader` | The apps header of **Custom Apps** (the extension; KidTube and Instagram are its apps): one bar with the logo and the version (a newer one above it, in blue: a tap installs it on Quetta, opens the install page on Orion, opens `chrome://extensions` for a copy from git), the **App \| site** switch of the running app (App \| YouTube, App \| Instagram; `mount(host, { siteView })` lets a page switch its own view), the connected profile and, on a site's own page, **Connect** (the account signed in there; the page reads it again first with `globalThis.KidTubeAccount.read`). Below: a line with what waits for the AI where the parent is (notes not sent yet, the server's run, posts in an app's list, the checks' problem reports; a tap opens the page to act on), the GitHub connection, or the apps row (each app, dimmed while its site's account has no profile in it). Drawn in its own shadow root. Also `modeSwitch()`, the Parent / Kid switch of the apps' pages |
| `watch.js` | `KidTubeWatch` | The checks on a page (loaded first): screen checks, "no dead buttons", "the background answers", uncaught errors in KidTube's code. Results go to the background (`core/checks/`) |
| `boot.js` | — | Loaded first on the parent screens and the PIN page: if the page does not start, it shows the error on the page (the iPad has no developer console) |

`header.js` runs on YouTube too, so it never uses `innerHTML` (YouTube's Trusted Types policy refuses it).
