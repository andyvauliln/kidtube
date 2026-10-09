# extension/core/ui/

Plain scripts (not modules) that pages and content scripts share. Each one sets a global.

| File | Global | What it does |
| --- | --- | --- |
| `header.js` | `KidTubeHeader` | The apps header: one bar for every state (signed out → Sign in; signed in → the account, Switch, the GitHub connection or this account's apps, + Add app, the settings file). Drawn in its own shadow root. Also `modeSwitch()`, the Parent / Kid switch of the apps' pages |
| `boot.js` | — | Loaded first on the parent screens and the PIN page: if the page does not start, it shows the error on the page (the iPad has no developer console) |

`header.js` runs on YouTube too, so it never uses `innerHTML` (YouTube's Trusted Types policy refuses it).
