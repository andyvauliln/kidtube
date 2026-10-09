# extension/core/content/

Scripts the browser runs on web pages (`content_scripts` in `manifest.json`). They only show things and report;
the service worker decides.

| File | Where | What it does |
| --- | --- | --- |
| `shell.js` | youtube.com, before the apps' scripts | Asks the background for the state, shows the apps header (at the header and in parent mode), covers YouTube with the lock when an account change stopped the app, reports who is signed in. Hands the state to the app's script through `globalThis.KidTubeShell` |
| `youtube-page.js` | youtube.com, page world (`"world": "MAIN"`) | Reads YouTube's own data: who is signed in, and the player's real channel and length. Posts them to the page; `shell.js` and the app's script listen |
| `backup.js` | the install page on GitHub Pages | Keeps a copy of the connection (repo, token, PIN) in the site's storage, so a new install gets it back. Not in the Orion build |

## KidTubeShell (for an app's content script)

```js
const { ask, Z, refresh, onState } = globalThis.KidTubeShell;
onState((st) => { /* st: { app, shell, parentMode, ...the app's view } after every answer */ });
```

An app's script acts only while `st.app` is its id and `st.shell.on` is false. At the apps header it removes its
screens and leaves YouTube plain.
