# extension/apps/blank/

A test app that does nothing. A profile with this app sees only a white page on YouTube, in kid and in parent
mode. Nothing is synced but `profile.json`, and the helper never runs for it.

| File | What it does |
| --- | --- |
| `background.js` | Its background part: the guard sends every YouTube page to `blank.html` |
| `blank.html` + `blank.js` | The white page: the apps header in parent mode, and the Parent / Kid switch |

It is also the smallest example of an app: compare it with `../kidtube/`.
