# extension/

One Chrome MV3 extension for every app. It runs in Quetta on Android (the source as written) and in Orion on
iPad, iPhone and Mac (the same source, built by `build/build-orion.mjs`).

| Folder | What is inside |
| --- | --- |
| `core/` | What every app uses: the service worker's core, the apps header, the PIN page, accounts and profiles, GitHub sync, updates |
| `apps/` | The apps. `registry.js` lists them; each app has its own folder (`kidtube/`, `blank/`) |
| `manifest.json` | Permissions, the service worker (`core/background/main.js`), the content scripts |

## The idea

- **A profile** is one YouTube account (email) in one app. Its data lives in the data repo under
  `<app>/<folder>/` and on the tablet under the usual storage keys (other profiles wait in `acct:<key>`).
- **The core** knows profiles, modes (kid / parent), the PIN, the apps header, sync timing and updates. It does
  not know videos, quizzes or time limits.
- **An app** brings its rules and its screens. Its background part (`apps/<app>/background/`) tells the core how
  to guard its pages, what its screens show, which messages it handles and which files it syncs. The contract is
  at the top of `core/background/apps.js`.

## What happens when

1. **A tab changes its URL.** `core/background/guard.js` lets extension pages and Google's sign-in pass, sends
   other websites through the site rules, leaves YouTube plain at the apps header, and hands every other YouTube
   page to the app (`apps/kidtube/background/rules.js` for KidTube).
2. **A YouTube page loads.** Content scripts run in this order: `core/ui/header.js`, `core/content/shell.js`
   (header, lock, signed-in account), `apps/kidtube/kid/render.js`, `apps/kidtube/content/youtube.js` (the kid's
   screens over YouTube). The page-world script `core/content/youtube-page.js` reads YouTube's own data.
3. **A screen asks something.** Every page and content script sends messages (`{ type, ... }`) to the service
   worker. `core/background/messages.js` answers the core's types and routes the rest to the app's handlers.
   Screens only ask and show; the service worker decides.
4. **Every 15 minutes** (and when a screen opens after a few minutes) the core syncs: it finds the profile's
   folder, writes `profile.json`, and lets the app sync its own files.

## Rules for code here

- No `innerHTML` in anything a content script can reach: YouTube's Trusted Types policy refuses it.
- Content scripts are plain scripts, not modules. Shared pieces set a global (`KidTubeHeader`, `KidTubeShell`,
  `KidTubeUI`).
- A `chrome.*` API that Orion lacks goes behind `TARGET !== 'orion'` (`core/lib/target.js`); `npm run
  orion:check` finds them.
