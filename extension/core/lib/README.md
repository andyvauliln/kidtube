# extension/core/lib/

Small modules without state. The service worker, the pages, the tests, `build/` and `agent/` import them.

| File | What it does |
| --- | --- |
| `account.js` | Who is signed in to YouTube (the account switcher's answer), the profile key and folder name, Google's account chooser link |
| `ask.js` | `ask(msg)`: send a message to the service worker and wait for the answer (callback form, with a timeout: Orion needs it) |
| `github.js` | GitHub's contents API: read and write one JSON file of the data repo, and plain-language HTTP errors |
| `merge.js` | `mergeConfig`: objects deep-merge, arrays and values replace, `null` resets to the default |
| `pin.js` | PIN hashing (PBKDF2 with a salt) and the wait after wrong tries |
| `target.js` | `TARGET`: `'quetta'` here; the Orion build rewrites the line to `'orion'`. Never edit it for a release |
| `time.js` | `nowIso()` (the time format of every data file) and `localParts()` (date, day and minutes in a time zone) |
| `version.js` | `cmpVersion(a, b)` for "major.minor.patch" |
| `youtube.js` | YouTube addresses: `classifyUrl` (home, watch, shorts, search, sign-in, other site...), `homeUrl`, `watchUrl`, video ids, thumbnails |
