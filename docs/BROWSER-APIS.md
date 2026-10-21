# Browser APIs, tab communication, and the limits of an extension app

As of 0.12.40 (2026-10-21). Research. Written in ASD-STE100. Code names, keys and paths stay as they are in the code.

This file adds to `BROWSER-STORAGE-AND-APPS.md`. That file tells where the data is and gives the options to connect
the apps. This file gives the full list of browser APIs in the code, and what the extension app cannot do that Instagram's and
YouTube's own sites can do.

Contents:

1. [How the apps and tabs communicate](#1-how-the-apps-and-tabs-communicate)
2. [Extension APIs (`chrome.*`) in the code](#2-extension-apis-chrome-in-the-code)
3. [Web APIs in the code](#3-web-apis-in-the-code)
4. [The four places where code runs](#4-the-four-places-where-code-runs)
5. [What the extension cannot do that the site itself can do](#5-what-the-extension-cannot-do-that-the-site-itself-can-do)
6. [Summary](#6-summary)

---

## 1. How the apps and tabs communicate

### 1.1 Short answer

1. A tab does not talk to a different tab directly. All communication goes through the service worker or the store.
2. The service worker is the center. Each screen sends a message to it. The service worker reads the store and
   answers.
3. The store (`chrome.storage.local`) is the shared board. When a key changes, every open screen gets
   `storage.onChanged`. This works across sites: a YouTube tab, an Instagram tab and an extension page all get it.
4. Inside one tab, the parts use `window.postMessage`.
5. Only one app tab is open at a time. `keepOneTab()` in `core/background/tabs.js` closes the other app tabs.
6. Only one profile is live at a time. The other profiles wait in `acct:<key>`. No code reads them now.

### 1.2 The channels in use now

| # | From → to | API | Example in the code | Across tabs? | Across sites? |
| --- | --- | --- | --- | --- | --- |
| 1 | Screen or content script → service worker, with an answer | `chrome.runtime.sendMessage` / `chrome.runtime.onMessage` | Every request: `state`, `igSync`, `igNote`, `header` (`core/background/messages.js`, `core/background/main.js`) | Yes, through the service worker | Yes |
| 2 | Service worker → one tab | `chrome.tabs.sendMessage` | `frameReady` to KidTube's YouTube page (`apps/kidtube/background/handlers.js`), dev mode commands (`core/background/bridge.js`) | Yes, if the service worker knows the tab id | Yes |
| 3 | Store → all open screens | `chrome.storage.onChanged` | The header, the shell, the KidTube screens, the Instagram screen, the parent page, the check page draw again | Yes | Yes |
| 4 | Page world ↔ content script, in one tab | `window.postMessage` | `core/content/youtube-page.js` sends YouTube's account and video data. `apps/instagram/content/net.js` ↔ `app.js` (`kidtube-ig`, `kidtube-ig-cmd`). | No | No |
| 5 | Extension frame ↔ YouTube page, in one tab | `window.postMessage` | KidTube's home frame says `frame-ready` (`apps/kidtube/kid/home.js` → `apps/kidtube/content/youtube.js`) | No | No |
| 6 | Parent page ↔ YouTube player frame | `window.postMessage` (YouTube's `enablejsapi=1` protocol) | `apps/kidtube/parent/parent.js` | No | No |
| 7 | Service worker → a tab's address | `chrome.tabs.update` | The guard sends a tab to a new address (`core/background/main.js`) | Yes | Test first |
| 8 | Device ↔ server | `fetch` to GitHub, `WebSocket` to the bridge | Sync with the data repo. Dev mode bridge (`core/background/bridge.js`). | Yes, also across devices | Yes |

### 1.3 Channels that do not work for the apps

| API | Why not |
| --- | --- |
| `BroadcastChannel` | It works only inside one origin. A content script on YouTube has the origin `youtube.com`. A content script on Instagram has the origin `instagram.com`. They cannot hear each other. |
| `localStorage` + `storage` event | The same limit: one origin only |
| `SharedWorker` | One origin only. Not in all Safari and Orion versions. |
| `window.postMessage` between tabs | It needs a reference to the other window (a frame or an opener). Two normal tabs do not have one. |
| A frame of YouTube in an Instagram page (or the opposite) | Both sites refuse frames (`X-Frame-Options`, CSP) |

### 1.4 How to add a new link between two apps

1. Add a message type in the service worker, for example `combined`.
2. In its handler, read the current profile from the usual keys. Read the other profile from `acct:<key>`.
3. Do all reads and writes inside `serial()`, so a profile switch does not collide with them.
4. Send the result back to the screen.
5. In the screen, listen to `chrome.storage.onChanged`. Ask again when a key changes.

`BROWSER-STORAGE-AND-APPS.md` sections 5.2 and 5.3 give the full example and the risks.

---

## 2. Extension APIs (`chrome.*`) in the code

The column "Calls" gives the number of calls in `extension/` (vendor code is not counted). "Orion" gives what
`docs/ORION.md` says, or "test first" when nobody tested it.

### 2.1 Storage

| API | Calls | What it does here | Files (examples) | Quetta | Orion |
| --- | --- | --- | --- | --- | --- |
| `chrome.storage.local.get` / `set` / `remove` | 103 / 46 / 13 | The main store of all apps | `core/background/store.js`, `core/background/profiles.js`, the screens | Yes | Yes |
| `chrome.storage.onChanged` | 11 | The screens draw again after a change | `core/ui/header.js`, `core/content/shell.js`, `apps/instagram/content/app.js` | Yes | Yes |
| `chrome.storage.session` | 1 | The last 40 steps of the self-checks | `core/checks/runner.js` | Yes | Test first |
| `unlimitedStorage` (permission) | — | No 10 MB limit on `chrome.storage.local` | `extension/manifest.json` | Yes | Test first |

### 2.2 Messages and the extension itself

| API | Calls | What it does here | Files (examples) | Quetta | Orion |
| --- | --- | --- | --- | --- | --- |
| `chrome.runtime.sendMessage` / `onMessage` | 12 / 3 | Every request from a screen to the service worker | `core/background/main.js`, all screens | Yes | Yes |
| `chrome.runtime.getURL` | 28 | The address of an extension page or file | `apps/kidtube/content/youtube.js`, `core/ui/watch.js` | Yes | Yes |
| `chrome.runtime.getManifest` | 18 | The version and the build kind (Quetta or Orion) | `core/ui/header.js`, `core/background/updates.js` | Yes | Yes |
| `chrome.runtime.lastError` | 17 | Read and drop the error of a callback | Many | Yes | Yes |
| `chrome.runtime.id` | 4 | The extension's id, for example in a network rule | `apps/kidtube/parent/parent.js` | Yes | Yes |
| `chrome.runtime.onInstalled` / `onStartup` | 1 / 1 | Start the sync and the checks | `core/background/main.js` | Yes | Test first |
| `chrome.runtime.requestUpdateCheck` | 1 | Ask the browser for a new version from `updates.xml` | `core/background/updates.js` | Yes, but the browser can refuse ("throttled") | No |
| `chrome.runtime.onUpdateAvailable` + `chrome.runtime.reload` | 1 + 1 | Restart with the new version | `core/background/main.js` | Yes | No (the parent installs a new .zip) |
| `chrome.management.getSelf` | 3 | The install kind (`development`, `normal`) | `core/background/updates.js`, `core/checks/runner.js` | Yes | Test first |
| `chrome.permissions.request` | 1 | Ask for an optional host (listening services, `<all_urls>`) | `core/ui/header.js` | Yes | Test first |

### 2.3 Tabs

| API | Calls | What it does here | Files (examples) | Quetta | Orion |
| --- | --- | --- | --- | --- | --- |
| `chrome.tabs.update` | 20 | Send a tab to a new address (guard, open an app) | `core/background/main.js`, `core/background/profiles.js` | Yes | Test first |
| `chrome.tabs.query` | 6 | Find the active tab, or all app tabs | `core/background/tabs.js` | Yes | Test first |
| `chrome.tabs.create` | 5 | Open a new tab | `core/background/main.js`, `core/background/profiles.js`, `core/background/updates.js` | Yes | Test first |
| `chrome.tabs.sendMessage` | 3 | Service worker → one tab | `apps/kidtube/background/handlers.js`, `core/background/bridge.js` | Yes | Test first |
| `chrome.tabs.onUpdated` | 1 | Every address change goes to `keepOneTab()` and the guard | `core/background/main.js` | Yes | Test first. On Orion the guard is the only site block. |
| `chrome.tabs.onRemoved` | 1 | Each app hears that a tab closed (`tabRemoved`) | `core/background/main.js` | Yes | Test first |
| `chrome.tabs.remove` | 1 | Close the other app tabs | `core/background/tabs.js` | Yes | Test first |
| `chrome.tabs.reload` | 1 | Reload the YouTube tabs after an update | `core/background/main.js` | Yes | Test first |
| `chrome.tabs.get` / `getCurrent` | 2 / 1 | Read one tab | Background, parent page | Yes | Test first |
| `chrome.tabs.captureVisibleTab` | 1 | Dev mode: a picture of the screen for the server | `core/background/bridge.js` | Yes, with `<all_urls>` | Test first |

### 2.4 Time and network rules

| API | Calls | What it does here | Files (examples) | Quetta | Orion |
| --- | --- | --- | --- | --- | --- |
| `chrome.alarms.create` / `get` / `clear` / `onAlarm` | 2 / 1 / 2 / 1 | `poll` every 15 minutes, `soon` after one minute, the bridge alarm | `core/background/main.js`, `core/background/bridge.js` | Yes | Yes, but iOS can stop the app, so the alarm can be late |
| `chrome.declarativeNetRequest.updateDynamicRules` / `getDynamicRules` | 1 / 1 | Block other sites in kid mode. Block ad servers. Allow the YouTube embed in the parent page. | `core/background/sites.js`, `apps/kidtube/parent/parent.js` | Yes | No. The Orion build skips it. The guard sends the tab back after the page starts to load. |

### 2.5 Manifest features

| Feature | What it does here | Quetta | Orion |
| --- | --- | --- | --- |
| Manifest V3, `background.service_worker` with `type: module` | One service worker for all apps (`core/background/main.js`) | Yes | Yes |
| `content_scripts` in the isolated world | The header, the shell, KidTube on YouTube, the Instagram app | Yes | Yes |
| `content_scripts` with `world: "MAIN"` | `core/content/youtube-page.js`, `apps/instagram/content/net.js`, `apps/instagram/lib/reader.js` | Yes (Chrome 111+, so `minimum_chrome_version` is `111`) | Test first |
| `web_accessible_resources` | YouTube can show `apps/kidtube/kid/*` and `core/pages/check.html` in a frame | Yes | The frames are blank. The Orion build draws the screens in the page (`apps/kidtube/kid/render.js`). |
| `options_page` | `core/pages/options.html` | Yes | Test first |
| `update_url` and `key` | Self-update from GitHub Pages, a fixed extension id | Yes | No. The build removes `update_url`. |

---

## 3. Web APIs in the code

### 3.1 Network and data

| API | What it does here | Files (examples) |
| --- | --- | --- |
| `fetch`, `Response`, `AbortController` | GitHub API, GitHub Pages, transcripts, Instagram's API, listening services. A time limit stops a slow request. | `core/lib/github.js`, `apps/instagram/content/api.js`, `apps/kidtube/lib/voice.js` |
| `fetch` and `XMLHttpRequest` wrappers in the page world | Read Instagram's own answers, to find the saved posts | `apps/instagram/content/net.js` |
| `WebSocket` | Dev mode bridge to the server | `core/background/bridge.js` |
| `document.cookie` (read only) | Instagram's `csrftoken` and `ds_user_id` | `apps/instagram/content/api.js` |
| `URL`, `URLSearchParams`, `FormData` | Read and make addresses and request bodies | Many |
| `TextEncoder`, `TextDecoder`, `Blob` | Base64 for GitHub, audio files | `core/lib/github.js`, `apps/kidtube/lib/voice.js` |
| `DOMParser` | Read the avatar's SVG and remove scripts and frames from it | `apps/kidtube/kid/talk.js` |
| `navigator.onLine` | Know when the device is offline | `apps/kidtube/parent/kit.js` |

### 3.2 Storage outside `chrome.storage`

| API | What it does here | Files |
| --- | --- | --- |
| Cache Storage (`caches`) | `kidtube-audio`, `kidtube-avatar`, `kidtube-tts` | `apps/kidtube/background/media.js`, `apps/kidtube/lib/voice.js`, `apps/kidtube/kid/mesh.js` |
| `localStorage` | `kidtubeFullSize` (extension pages), `kidtube-settings-backup` (install page) | `apps/kidtube/parent/kit.js`, `core/content/backup.js` |
| `sessionStorage` | `kidtubeIgView` (Instagram's Saved page view) | `apps/instagram/content/app.js` |
| IndexedDB | Not in use | — |

### 3.3 Sound and voice

| API | What it does here | Files |
| --- | --- | --- |
| `navigator.mediaDevices.getUserMedia` | The microphone: KidTube answers, Instagram voice notes, Settings test, check page | `apps/kidtube/lib/voice.js`, `apps/instagram/content/app.js`, `apps/kidtube/parent/settings.js`, `core/pages/check.js` |
| `AudioContext`, `createScriptProcessor` | Record the voice as WAV | `apps/kidtube/lib/voice.js`, `apps/instagram/content/app.js` |
| `AudioContext`, `createAnalyser` | Move the avatar's lips with the sound | `apps/kidtube/kid/mesh.js` |
| `Audio` | Play the friend's speech | `apps/kidtube/lib/voice.js` |
| `SpeechRecognition` / `webkitSpeechRecognition` | Speech to text in the browser, where the browser has it | `apps/kidtube/lib/voice.js`, `apps/kidtube/parent/kit.js`, `core/pages/check.js` |
| `speechSynthesis` | The check page test only. The apps do not use the device voice. | `core/pages/check.js` |

### 3.4 Screen and page

| API | What it does here | Files |
| --- | --- | --- |
| `attachShadow` (closed shadow root) | Keep the site's CSS away from the header and the app screens | `core/ui/header.js`, `core/content/shell.js`, `apps/instagram/content/app.js`, `apps/kidtube/content/youtube.js` |
| `MutationObserver`, `ResizeObserver` | See changes in YouTube's and Instagram's pages | `core/content/shell.js`, `core/ui/watch.js`, `apps/instagram/content/app.js` |
| Canvas and WebGL, `requestAnimationFrame` | The talking avatar | `apps/kidtube/kid/mesh.js`, `apps/kidtube/kid/avatar-lab.js` |
| `URL.createObjectURL` | Show a picture or play a recording from a `Blob` | `core/ui/header.js`, `apps/instagram/content/app.js` |
| `history.pushState` | Open a post sheet with its own address (`#<id>`), so Back closes it | `apps/instagram/content/app.js` |
| `document.visibilityState` | Count video time only when the screen is visible. Refresh only when visible. | `apps/kidtube/content/youtube.js`, `apps/instagram/content/app.js` |
| `requestFullscreen` | KidTube parent screens at full size | `apps/kidtube/parent/kit.js` |
| `navigator.vibrate` | A short buzz on a long press | `apps/kidtube/parent/kit.js` |
| `navigator.clipboard.writeText` | Copy the check report | `core/pages/check.js` |
| `window.open` | Open "Check this browser" | `core/ui/watch.js` |

### 3.5 Security

| API | What it does here | Files |
| --- | --- | --- |
| `crypto.subtle.importKey` + `deriveBits` (PBKDF2) | Make the PIN hash from the PIN and `pinSalt` | `core/lib/pin.js` |
| `crypto.subtle.digest` | A hash as the name of a speech file in the cache. A hash for the bridge. | `apps/kidtube/lib/voice.js`, `core/background/bridge.js` |
| `crypto.randomUUID`, `crypto.getRandomValues` | Ids of notes, devices, check runs. The PIN salt. | Many |

---

## 4. The four places where code runs

Each place has different APIs. This is the main cause of the design: the screens ask, the service worker decides.

| Place | Examples | Origin | `chrome.*` APIs | DOM, microphone, audio | Can call the site's API with its cookies? |
| --- | --- | --- | --- | --- | --- |
| Service worker | `core/background/main.js` | `chrome-extension://<id>` | All | No DOM. No microphone. No audio. | No. It can `fetch` the hosts in `host_permissions` without CORS limits. |
| Extension page or frame | `core/pages/*.html`, `apps/kidtube/kid/*.html`, `apps/kidtube/parent/*.html` | `chrome-extension://<id>` | Most | Yes | No |
| Content script (isolated world) | `core/ui/header.js`, `apps/instagram/content/app.js` | The site's origin for `fetch`, cookies and permissions | Only `runtime`, `storage` and some others. Everything else goes to the service worker. | Yes. The microphone permission is for the site's origin. | Yes. `fetch` to the same site sends its cookies. |
| Page world (`world: "MAIN"`) | `core/content/youtube-page.js`, `apps/instagram/content/net.js` | The site's origin | None | Yes | Yes. It also sees the site's own variables and requests. |

---

## 5. What the extension cannot do that the site itself can do

### 5.1 Why there is a difference

1. Instagram's site is Instagram's own code. It talks to Instagram's own servers with all of Instagram's tokens.
2. The extension app is a guest. It draws a layer over Instagram's page. It sees only what the page receives, or
   what Instagram's web API gives to the signed-in user.
3. Meta's official API does not give a person's saved posts. So the app uses Instagram's private web API. Instagram
   can change that API at any time, with no notice.
4. The extension runs only in a browser with extensions (Quetta, Orion). It cannot run in Instagram's phone app.

### 5.2 Instagram: what the site does and the extension app cannot do

| # | Instagram's site (or phone app) | The extension app | Why | Code |
| --- | --- | --- | --- | --- |
| 1 | Gets all data from its own server | Reads only what the page receives (`net.js`), or Instagram's web API from the page (`api.js`) | No official API for saved posts. The reader rules guess which answers hold saved posts. | `apps/instagram/content/net.js`, `apps/instagram/lib/reader.js`, `apps/instagram/lib/rules.js` |
| 2 | Works the same after each of its own changes | Can break when Instagram changes its page, its GraphQL queries or its web API | Instagram changes them with no notice | `site/remote.json` `instagram.reader` changes the rules with no new version. Send to AI reports a failed read. |
| 3 | Saves, unsaves, likes, comments, posts, sends messages, shows stories and reels | Reads only. It does not write to Instagram. | A write to the private API is a high account risk. The app is not made for it. | `apps/instagram/content/api.js` (only `GET` requests) |
| 4 | Knows at once when you unsave a post | Keeps an unsaved post in its list | The app reads only new saves after the first read | `apps/instagram/README.md` "Not yet" |
| 5 | Shows every collection | Sometimes cannot get a collection from the web API | The web API may not give a collection. The app then takes the collection when the parent opens it on Instagram's page. | `apps/instagram/content/api.js` `collection` |
| 6 | Works with no open tab: push notifications, sync on the phone | Works only while an Instagram tab is open and signed in | The manifest has no host permission for `instagram.com`. The code calls Instagram only from the page. | `extension/manifest.json`, `apps/instagram/content/api.js` |
| 7 | Signs in, asks for a second factor, and handles security checks | Cannot sign in. When the session ends, the app tells you to sign in on Instagram's page. | The session cookie (`sessionid`) is `HttpOnly`. The page sends it, but no script can read or keep it. | `apps/instagram/content/api.js` (reads only `csrftoken` and `ds_user_id`) |
| 8 | Reads its feeds as fast as it needs | Must read slowly. Too many requests can get an error, a security check, or a blocked account. | Instagram limits automated use | Stop and Read the rest (`igStop`, `igResume`) |
| 9 | Pictures and videos always load | Picture and video addresses expire after some days. The app asks Instagram for the post again. | Instagram's media addresses are signed and expire | `apps/instagram/content/app.js` (broken picture → new request), `apps/instagram/lib/posts.js` (`posts.json` keeps no picture addresses) |
| 10 | Plays video with its own player (adaptive quality) | Plays the one video address from the post data. **▶ Play on Instagram** opens Instagram's player. | The app does not have Instagram's player | `apps/instagram/content/app.js` |
| 11 | Its server can read the video | The tablet sends the video address to the data repo. The server's agent downloads it. An expired address makes the post Failed (Try again sends a new one). | The tablet does not process video | `agent/instagram.mjs` `download()` |
| 12 | Search, Explore, recommendations, likes and view counts | Has only the fields that come with a saved post | These parts live on Instagram's servers | `apps/instagram/lib/posts.js` |
| 13 | Owns the page: its design, its address, its Back button | Is a layer over the page. It must keep Instagram's CSS away and share the address bar. | The page belongs to Instagram | Closed shadow root, `history.pushState` for the post sheet (`apps/instagram/content/app.js`) |
| 14 | Asks for the microphone as Instagram | The microphone prompt says `instagram.com`, not the extension | The recording runs in a content script, and a content script has the site's origin | `apps/instagram/content/app.js` |
| 15 | Keeps your data on its servers, on every device | Keeps notes and statuses in `chrome.storage.local` and the GitHub data repo. Instagram never sees the notes. | The notes are the app's own data | `apps/instagram/background/sync.js` |
| 16 | Works the same in every browser | On Orion, page-world scripts may not run. Then only the web API path (`api.js`) works. | Orion supports fewer extension features | `apps/instagram/README.md` |
| 17 | Can see which scripts are in its page | Can be detected: the app wraps the page's `fetch` and `XMLHttpRequest` | The page world is shared with Instagram's code | `apps/instagram/content/net.js` |

### 5.3 YouTube: what the site does and KidTube cannot do

| # | YouTube's site (or phone app) | KidTube | Why |
| --- | --- | --- | --- |
| 1 | Decides the recommendations, the search and the comments | Can only hide them or cover them | They come from YouTube's servers |
| 2 | Works in YouTube's phone app | Works only in the browser. The phone app opens YouTube without KidTube. | The phone app has no extensions. Delete or block the app on the tablet. |
| 3 | Shows ads | Blocks ad servers on Quetta. On Orion the ads stay. | Orion has no `declarativeNetRequest` |
| 4 | Changes the account in the page | Must find the change. Then KidTube stops and a lock covers YouTube until the PIN. | The account belongs to YouTube's page (`core/content/youtube-page.js`) |
| 5 | Changes its page layout | Can break when YouTube changes its page | The self-checks (`core/checks/`) find the problem and send a report |
| 6 | Plays every video | Some owners turn off the embed, so the parent page's player cannot play them | The parent page uses YouTube's embedded player (`apps/kidtube/parent/parent.js`) |

### 5.4 Limits of every browser extension

These limits are the same for both apps. They come from the browser, not from the sites.

| Limit | Effect |
| --- | --- |
| The service worker stops after about 30 seconds with no work | No state stays only in variables. The store holds it. |
| The service worker has no DOM, no microphone, no audio | Recording and sound happen in a page or a content script |
| A content script gets only some `chrome.*` APIs | It sends a message to the service worker |
| A page-world script gets no `chrome.*` API | It sends `window.postMessage` to the content script |
| The user can switch the extension off or remove it | KidTube needs the PIN and Guided Access on the iPad |
| Updates come only through `update_url` or a store | Quetta: `updates.xml` on GitHub Pages. Orion: the parent installs a new .zip. |
| iOS stops Orion in the background | No sync while Orion is closed. The sync starts when a screen opens. |

---

## 6. Summary

| Question | Answer |
| --- | --- |
| How do the apps communicate across tabs? | Through the service worker (`chrome.runtime.sendMessage`) and the store (`chrome.storage.onChanged`). Both work across sites. A tab never talks to a different tab directly. |
| Do two apps communicate now? | No. One profile and one app tab are live at a time. |
| Which browser APIs are the base? | `chrome.storage.local`, `chrome.runtime` messages, `chrome.tabs`, `chrome.alarms`, `declarativeNetRequest`, content scripts in two worlds, `getUserMedia` with `AudioContext`, `fetch` |
| What can the Instagram app not do, compared with Instagram's site? | Write to Instagram (save, like, post), work with no open tab, sign in, use an official API, keep media addresses, play with Instagram's player. Section 5.2 has 17 points. |
| What is the largest limit of the extension? | It needs a browser with extensions, and it depends on the pages and private APIs of YouTube and Instagram |
| What to test on Orion | `chrome.storage.session`, `chrome.tabs.sendMessage`, `chrome.tabs.remove`, `world: "MAIN"`, `chrome.permissions.request`, `SpeechRecognition` |
