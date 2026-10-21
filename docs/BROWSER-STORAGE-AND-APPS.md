# Browser storage, browser features, and how the apps work together

As of 0.12.40 (2026-10-21). Written in ASD-STE100. Code names, keys and paths stay as they are in the code.

Contents:

1. [Summary](#1-summary)
2. [Where the extension keeps data](#2-where-the-extension-keeps-data)
3. [Other browser features that the extension uses](#3-other-browser-features-that-the-extension-uses)
4. [Do the apps talk to each other now?](#4-do-the-apps-talk-to-each-other-now)
5. [Options to connect apps and tabs, and to combine their data](#5-options-to-connect-apps-and-tabs-and-to-combine-their-data)
6. [Switch between apps: with a button, or automatically](#6-switch-between-apps-with-a-button-or-automatically)
7. [Recommendation](#7-recommendation)

---

## 1. Summary

| Question | Short answer |
| --- | --- |
| Where is the data? | Almost all data is in `chrome.storage.local`. The extension has one store for all apps. A small part is in Cache Storage, `localStorage` and `sessionStorage`. The long-term copy is in the GitHub data repo. |
| Do the apps talk to each other? | No, not directly. One profile (one account in one app) runs at a time. The other profiles wait in `acct:<key>`. Only one app tab can be open. |
| Is there something shared? | Yes. All apps share one service worker, one store, the PIN, the mode, the GitHub connection, the apps header, and the data repo. |
| Can we combine data from two apps? | Yes. The best way: an extension page asks the service worker, and the service worker reads the data of each profile (also the waiting profiles in `acct:<key>`). |
| Can we switch apps? | Yes, with a button now: the header's app tiles and the App \| site switch. An automatic switch does not exist yet. Section 6 gives the options. |

---

## 2. Where the extension keeps data

### 2.1 The storage areas

| Area | Origin (who can read it) | Used? | What is in it | Code |
| --- | --- | --- | --- | --- |
| `chrome.storage.local` | The extension only (service worker, extension pages, content scripts) | Yes, the main store | All state of all apps (tables 2.2 to 2.5) | `core/background/store.js`, `core/background/profiles.js` |
| `chrome.storage.session` | The extension only. The browser erases it at a restart. | Yes, small | The last 40 steps of the self-checks | `core/checks/runner.js` |
| `chrome.storage.sync` | — | No | — | — |
| Cache Storage (`caches`) | The extension origin | Yes | Audio, avatar files, speech (table 2.6) | `apps/kidtube/background/media.js`, `apps/kidtube/lib/voice.js`, `apps/kidtube/kid/mesh.js` |
| `localStorage` | The origin of the page | Yes, 2 keys | Table 2.7 | `apps/kidtube/parent/kit.js`, `core/content/backup.js` |
| `sessionStorage` | The origin of the page, one tab | Yes, 1 key | Table 2.7 | `apps/instagram/content/app.js` |
| IndexedDB | — | No | — | — |
| Cookies | instagram.com | Read only, never written | `csrftoken` and `ds_user_id`: Instagram's own cookies. The Instagram app sends them back to Instagram's API. | `apps/instagram/content/api.js` |

The permission `unlimitedStorage` (in `extension/manifest.json`) removes the size limit of `chrome.storage.local`.

### 2.2 `chrome.storage.local`: keys of the device

These keys belong to the tablet, not to a profile. They stay when the parent switches the profile.

| Key | What it holds |
| --- | --- |
| `settings` | Part of it belongs to the device (`DEVICE_SETTINGS` in `core/background/constants.js`): `pinHash`, `pinSalt`, `pinFails`, `pinLockedUntil`, `deviceId`, `mode` (kid or parent), `repo` and `token` (GitHub), `devMode`, `devKey`, `devUntil`, `bridgeUrl`, `readOnly`. The other part belongs to the current profile. |
| `account` | The current profile: `key`, `app`, `folder`, `email` or `username` |
| `accounts` | A list of all profiles on this tablet: `{ email, username, name, datasyncId, app, folder, lastSeen }` |
| `acct:<key>` | All data of one profile that does not run now (section 2.5) |
| `shell` | The apps header state: `{ on, locked }`. `on`: no app runs. `locked`: YouTube is covered until the PIN. |
| `ytAccount` | The account that YouTube's page showed last: email, signed in or not, `datasyncId` |
| `igAccount` | The account that Instagram's page showed last: username, id |
| `siteOffer` | An app that waits for a sign-in on its site (one hour), then the page offers the switch |
| `repoProfiles` | The profiles that the data repo has (for the header's tiles) |
| `repoKeys` | The listening keys from `keys.json` in the data repo |
| `voiceKey`, `geminiKey`, `groqKey` | The listening keys that the parent typed in Settings. They go into the settings file. |
| `remote` | A copy of `site/remote.json` (rules that change without a new version), read again after 30 minutes |
| `updateState` | The state of the update check |
| `checks`, `checkAlert`, `checkEcho` | The self-checks: results, reports, the last alert |
| `bgStuck` | The last background step that stopped for more than 20 seconds |
| `dnrWorks` | The result of a test of `declarativeNetRequest` |
| `headerUi`, `inboxHidden` | The header: is the notification list closed, which rows are hidden |
| `bridgeLog` | Dev mode: the commands from the bridge server |
| `profileDropped` | A profile that the extension removed on purpose, and why |
| `listenCooldown` | KidTube: a pause for a listening service after it failed |

### 2.3 `chrome.storage.local`: keys of the current profile (core)

| Key | What it holds |
| --- | --- |
| `settings` (the profile part) | The settings that are not in `DEVICE_SETTINGS` |
| `data` | What the last sync got from GitHub: the app's files, their etags, `profileFile` |
| `syncStatus` | The time of the last sync and the last error |

### 2.4 `chrome.storage.local`: keys of the current profile (each app)

Each app gives its keys in its background part (`apps/<app>/background/index.js`): `stateKeys` change only through
`withState()`, `profileKeys` change outside it. Both move with the profile.

**KidTube** (`apps/kidtube/background/index.js`):

| Key | What it holds |
| --- | --- |
| `watched` | The time that the child watched, per video and per day |
| `today` | Today's list and its state |
| `session` | The current video session (start, the time limit) |
| `outbox` | Events that wait to go to `activity/<day>.json` in the data repo |
| `localConfig` | Rules that the parent saved and that are not in GitHub yet |
| `seen` | Title and channel of the videos that the child opened |
| `pendingTalk` | The talking friend's screen before or after a video |
| `quizTurn` | The quiz turn |
| `transcripts` | The transcripts of the videos |
| `character` | The talking friend's look |
| `repoAvatars` | The avatars from the data repo |
| `planLog` | The parent's changes to Today and Planned |
| `history` | What the child watched, newest last |
| `notes` | The parent's notes for the AI |
| `memory`, `helperInfo`, `contextDocs` | The helper's files and the context documents (`profileKeys`) |
| `voice:<id>` | A recorded note as audio, until it goes to GitHub |

**Instagram** (`apps/instagram/background/index.js`):

| Key | What it holds |
| --- | --- |
| `ig` | The saved posts (`posts`, `order`), the collections, the cursor of the reader, `rev`, `pushedRev`, `postsSha`, the notes and the requests |
| `igAudio` | Note recordings that wait to go to GitHub: `{ noteId: base64 WAV }` (`profileKeys`) |

### 2.5 The profiles that do not run: `acct:<key>`

`useProfile()` in `core/background/profiles.js` does the switch:

1. It reads all keys of the current profile (tables 2.3 and 2.4).
2. It writes them as one object into `acct:<current key>`.
3. It reads `acct:<new key>` and writes its keys back as the usual keys.
4. It keeps the device part of `settings`.
5. It starts a sync.

The key of a KidTube profile is the email. The key of another app's profile is `<app>:<name>`, for example
`instagram:@ann`.

### 2.6 Cache Storage

| Cache | What it holds |
| --- | --- |
| `kidtube-audio` | The talking friend's audio files from the data repo, and `lips.json` |
| `kidtube-avatar` | The avatar files (`rig.json`, pictures) |
| `kidtube-tts` | Speech that a speech service made, so the extension does not ask again |

### 2.7 `localStorage` and `sessionStorage`

| Key | Area | Origin | What it holds |
| --- | --- | --- | --- |
| `kidtubeFullSize` | `localStorage` | The extension pages | KidTube parent screens: full size on or off |
| `kidtube-settings-backup` | `localStorage` | `andyvauliln.github.io` (the install page) | A copy of `repo`, `token`, `pinSalt`, `pinHash`. An uninstall erases the extension's store, but not this copy. A new install takes it back. |
| `kidtubeIgView` | `sessionStorage` | `www.instagram.com` | The view of the Saved page: `app` or `instagram` |

### 2.8 Data outside the browser

| Place | What it holds |
| --- | --- |
| GitHub data repo (`andyvauliln/kidtube-data`, private) | One folder per profile: `kidtube/<folder>/` (`parent-config.json`, `queue.json`, `activity/<day>.json`, `memory.json`, `helper.json`, `answers.json`, `runs.json`, `server.json`, `context/*.md`, `requests/run.json`, `profile.json`) and `instagram/<folder>/` (`posts.json`, `handled.json`, `notes/<id>.wav`, `profile.json`). Each app also has `<app>/keys.json`. |
| GitHub Pages (`andyvauliln.github.io/kidtube/`) | `latest.json`, `updates.xml`, `remote.json`: the extension reads them, it does not write them |
| The server | Dev mode only: a WebSocket to the bridge server (`BRIDGE_URL`) |

---

## 3. Other browser features that the extension uses

### 3.1 Permissions in `extension/manifest.json`

| Permission | Why |
| --- | --- |
| `storage`, `unlimitedStorage` | Section 2 |
| `alarms` | `poll` every 15 minutes (sync and update check), `soon` (one more sync in a minute), the bridge alarm every minute |
| `tabs` | Send a tab to a new address, close the second app tab, find the active tab, reload YouTube tabs after an update |
| `declarativeNetRequest` | Block other websites in kid mode and block ad servers (rules 100 and 101, `core/background/sites.js`) |
| Host `*.youtube.com` | The content scripts on YouTube |
| Host `api.github.com` | Sync with the data repo |
| Host `andyvauliln.github.io` | Updates, `remote.json`, the backup on the install page |
| Optional `openrouter.ai`, `generativelanguage.googleapis.com` | Listening services. The parent gives them in Settings. |
| Optional `<all_urls>` | Dev mode: pictures of the screen for the server |

### 3.2 Web features

| Feature | Where | Why |
| --- | --- | --- |
| `chrome.runtime.sendMessage` / `onMessage` | All screens and content scripts → service worker | Each screen asks; the service worker decides (`core/background/messages.js`) |
| `chrome.tabs.sendMessage` | Service worker → one tab | `frameReady` to KidTube's YouTube page; dev mode commands |
| `chrome.storage.onChanged` | Header, shell, KidTube screens, Instagram screen, parent page, check page | The screens draw again when the store changes |
| `window.postMessage` | Page world ↔ content script (same tab) | `core/content/youtube-page.js` sends YouTube's account and video data; `apps/instagram/content/net.js` ↔ `app.js` (`kidtube-ig`, `kidtube-ig-cmd`); KidTube's home frame says `frame-ready`; the parent page controls the YouTube player frame |
| `getUserMedia` (microphone), `AudioContext` | KidTube listening, Instagram voice notes, Settings test | Record the voice |
| `SpeechRecognition` | KidTube `lib/voice.js`, parent `kit.js`, check page | Speech to text in the browser, where the browser has it |
| `speechSynthesis` | Check page only | A test. The apps do not use the device voice. |
| `navigator.clipboard` | Check page | Copy the report |
| `window.open` | `core/ui/watch.js` | Open "Check this browser" |
| `WebSocket` | `core/background/bridge.js` | Dev mode bridge |
| `fetch` | Service worker, some screens | GitHub API, Pages, YouTube transcripts, Instagram's API, listening services |
| `chrome.permissions.request` | Header, Settings | Ask for the optional hosts |

---

## 4. Do the apps talk to each other now?

No. There is no feature that sends data from one app to another app. The design keeps them apart on purpose.

### 4.1 What keeps the apps apart

| Rule | Code | Effect |
| --- | --- | --- |
| One current profile | `core/background/profiles.js` `useProfile()` | Only one app's data is in the usual keys. The other app's data is in `acct:<key>`, and no code reads it while it waits. |
| One app tab | `core/background/tabs.js` `keepOneTab()` | When a tab opens YouTube, an extension page or an app home (Instagram), the extension closes the other such tabs. Two app tabs cannot be open at the same time. |
| Each message type has one owner | `core/background/apps.js` `registerApps()` | Two apps cannot handle the same message. A screen of one app cannot ask the other app's handler. |
| Site rules of the app | `core/background/sites.js`, each app's `siteRules` | KidTube in kid mode blocks other websites. Instagram allows only `instagram.com` and `facebook.com`. Every YouTube page goes to Instagram while Instagram runs. |

### 4.2 What the apps share

| Shared part | What it gives |
| --- | --- |
| One service worker | All apps run in the same background. It can read every key. |
| One `chrome.storage.local` | The device keys (PIN, mode, GitHub) are the same for all apps |
| The apps header (`core/ui/header.js`) | The same tiles, notifications and App \| site switch in every app |
| The GitHub data repo | `kidtube/<folder>/` and `instagram/<folder>/` are in one repo. The server's agents can read both. |

So a shared path exists already: the service worker and the store. No code uses it to combine data from two apps yet.

---

## 5. Options to connect apps and tabs, and to combine their data

### 5.1 The options

| # | Option | Works across sites (YouTube tab ↔ Instagram tab)? | Speed | Works on Quetta and Orion? | Comment |
| --- | --- | --- | --- | --- | --- |
| A | **Service worker as the center** (`chrome.runtime.sendMessage`) | Yes | Fast | Yes, the extension uses it now | Each screen asks the service worker. The service worker reads the data of all profiles. Best choice. |
| B | **`chrome.storage.local` + `storage.onChanged`** as a shared board | Yes | Fast | Yes, the extension uses it now | One tab writes a key; all tabs hear the change. Good for "new data is ready". Write only through the service worker (`serial()`) so two writers do not collide. |
| C | **`chrome.tabs.sendMessage`** (service worker → one tab) | Yes | Fast | Yes, the extension uses it now | Good to send a command to a known tab. Needs the tab id. |
| D | **`chrome.runtime.connect`** (a port) | Yes | Fast, a live stream | Quetta yes; Orion: test first | A long connection from a tab to the service worker. Good for a live feed. MV3 stops an idle service worker, so the port can close. |
| E | **`BroadcastChannel`** | No. Only one origin. Extension pages share one origin, content scripts use the site's origin. | Fast | Test first | Good between two extension pages only. |
| F | **`window.postMessage`** | No. Only between a window and its frame or opener. | Fast | Yes | The extension uses it inside one tab. It cannot reach a different tab. |
| G | **`localStorage` + `storage` event** | No. Only one origin. | Fast | Yes | Not better than B. |
| H | **`SharedWorker`** | No. Only one origin. | Fast | Not in Orion/Safari on all versions | Do not use. |
| I | **The GitHub data repo + the server's agents** | Yes, and also across devices | Slow (sync every 15 minutes, every minute while an app waits) | Yes | Good for a daily summary that an agent writes. Not good for a live screen. |
| J | **One page with frames of two sites** | Yes | Fast | Risky | YouTube and Instagram refuse frames (`X-Frame-Options`, CSP). A `declarativeNetRequest` rule can remove these headers, but the sites can break, and Instagram can block the account. Do not use. |

### 5.2 The problem to solve first: only one profile is "live"

The data of the app that does not run is in `acct:<key>`. To combine data from two apps, select one of these ways:

| Way | What to change | Risk |
| --- | --- | --- |
| **Read only** (recommended first step) | Add a function in the service worker: it reads the current profile from the usual keys and the other profiles from `acct:<key>`. A new message type (for example `combined`) gives the result to a page. | Low. The other profile's data is as old as its last switch. A sync of that profile from GitHub (read only) can make it fresh. |
| **Write to a waiting profile** | Every write to `acct:<key>` goes through `serial()`, so it does not collide with a switch. | Medium. A switch can overwrite a change that does not use `serial()`. |
| **Two apps live at the same time** | Give each app its own key names (for example `kidtube:watched`, `instagram:ig`), not one set of usual keys for the current profile. Keep "the current profile" per app, not per tablet. Change `keepOneTab()` so that one tab per app can stay. | High. It changes `store.js`, `profiles.js`, `tabs.js`, the sync, and the self-checks. Kid mode must still block the other app. |

### 5.3 Example: one page with data from KidTube and Instagram

1. Add an extension page, for example `core/pages/combined.html`. It loads `core/ui/header.js`.
2. The page sends `{ type: 'combined' }` to the service worker.
3. The service worker reads `account`, `accounts` and each `acct:<key>` in `serial()`.
4. For KidTube it takes `history`, `watched`, `notes`. For Instagram it takes `ig.posts`, `ig.collections`, the notes.
5. It sends back one object: `{ kidtube: {...}, instagram: {...} }`.
6. The page listens to `chrome.storage.onChanged` and asks again when a key changes.
7. The page is open only in parent mode (`headerOpen()`), because it shows the data of all profiles.

---

## 6. Switch between apps: with a button, or automatically

### 6.1 What exists now (buttons)

| Control | Where | What it does | Code |
| --- | --- | --- | --- |
| App tiles | The apps header | Makes the account of that app's site the current profile, then opens the app in the same tab. Needs the unlocked header or parent mode. | `openApp()` in `core/background/profiles.js` |
| Site tiles | The apps header | Opens the plain site (YouTube or Instagram) with no app | `plainSite()` |
| App \| site switch | The header, in every app | App opens the app. The site side opens the plain site, or changes the view on Instagram's Saved page. | `switchOf()` |
| Connect | The header on YouTube or Instagram | Makes the profile of the signed-in account and opens its app | `connect()` |
| Switch offer | The site's page | After a tap on an app without a profile, the site opens. When an account signs in there, the page offers the switch (one hour). | `siteOffer` |

### 6.2 What happens automatically now

| Event | What happens |
| --- | --- |
| YouTube's account changes while KidTube runs | KidTube stops, and a lock covers YouTube until the PIN |
| A YouTube page opens while Instagram runs | The tab goes to Instagram's app home |
| A second app tab opens | The extension closes the other app tabs |

The extension does not switch the app by itself now.

### 6.3 Options for an automatic switch

| # | Trigger | How | Kid mode risk | Effort |
| --- | --- | --- | --- | --- |
| 1 | **The address**: the parent opens `instagram.com` while KidTube runs (or YouTube while Instagram runs) | `core/background/guard.js` finds the app of the site (`siteOfHost()`), then calls `openApp()` for the account that the site shows | High. A child must not switch. Allow it only in parent mode or for apps with `modes: false`. | Small |
| 2 | **A time or schedule** (for example: KidTube in the day, Instagram after 21:00) | A new `chrome.alarms` alarm calls `openApp()` | Medium. The PIN must stay the gate for parent apps. | Small |
| 3 | **An event** (for example: the Instagram agent finished, or KidTube's time limit ended) | A notification row in the header with an Open button. The parent taps it. | Low. A person still taps. | Small: the notification list exists (`core/background/inbox.js`) |
| 4 | **A button outside the page**: the toolbar button of the extension (`action` with a popup that lists the apps) | Add `action` to `extension/manifest.json` and a popup page that sends `openApp` | Low. The popup checks `headerOpen()`. | Medium. Quetta on Android and Orion show the toolbar button in different ways: test first. |
| 5 | **A keyboard shortcut** (`commands` in the manifest) | `chrome.commands.onCommand` calls `openApp()` | Low | Small. Tablets usually have no keyboard. Useful on a Mac with Orion only. |
| 6 | **Swipe or a floating button** on the page | The header draws a small button that cycles the apps | Low, if it shows only in parent mode | Small |

### 6.4 What a switch costs

A switch moves all keys of the profile (section 2.5), starts a sync with GitHub, and loads a new address. Nobody
measured the time on the tablet yet. Do not switch on every page load. Switch only when the app changes.

---

## 7. Recommendation

| Need | Recommended way |
| --- | --- |
| Combine data from the apps on one screen | Option A + B (section 5.1), with the "read only" way (section 5.2), on a parent-only extension page (section 5.3) |
| Live updates between open screens | `chrome.storage.onChanged` (option B). It works across sites now. |
| A daily summary across apps | The server's agents read the data repo (option I) |
| Switch the app | Keep the header buttons. Add option 3 (Open in a notification) first, then option 1 (by address) for parent mode only. |
| Run two apps at the same time | Only if a real need comes. It is the "two apps live" way in section 5.2 and it has a high risk. |

Do not use `BroadcastChannel`, `SharedWorker`, `localStorage` events or frames of other sites to connect the apps.
They do not work across sites, or they are not safe on Quetta and Orion.
