# KidTube on Orion: research

*As of 2026-10-02 (version 0.6.1, Orion for iOS 1.5.5). For Safari, see [SAFARI.md](SAFARI.md).*

The question: what does it take for KidTube to run in **Orion**, Kagi's browser for iPad, iPhone and Mac? What works from the current project, and what can't?

## Short answer

- **Orion runs Chrome extensions on iPad.** It is a WebKit browser, like Safari, with its own implementation of the Chrome and Firefox extension APIs. It installs extensions from the Chrome Web Store, from Firefox Add-ons, or **from a .zip file**. So the same KidTube extension that runs in Quetta can be installed as it is:
  - no Apple Developer account,
  - no App Store,
  - no repackaging.
- **This is already started.** Version 0.6.1 (commit `80503d4`) added:
  - Orion steps on the install page (`site/index.html`);
  - a fallback when the browser has no blocking rules: other sites are sent back to the list (`externalGuard`, `sw.js:807`);
  - a short Orion table in `HOW-IT-WORKS.md`.
- **Nothing has been confirmed on a real iPad yet.** I found no record of a test on a device in the repo. Several pieces depend on Orion behaviour that isn't documented (see [Unknowns](#unknowns-test-on-the-ipad)).
- **What can't work in Orion:**
  - Blocking sites before they load: Orion has no `declarativeNetRequest`.
  - Probably automatic updates of a file-installed extension.
  - Any way to stop a child from switching KidTube off inside Orion's own settings.
  - Background syncing while Orion is closed.
- **On the iPad, Orion is the cheapest way to get KidTube.** It's cheaper than both Safari options in `SAFARI.md`. The trade-off is a small company's beta extension support instead of Apple's own.

## How Orion runs extensions

| | Orion |
| --- | --- |
| Engine | WebKit (Apple's engine; every iOS browser must use it) |
| Extension APIs | Its own implementation, about 70% of WebExtensions. iOS/iPadOS gets fewer APIs than macOS because of Apple's limits. Extension support on iOS is still called beta. |
| Install | Chrome Web Store, Firefox Add-ons, or **+ → Install from file**: a .zip or a folder (iOS since 1.2.8) |
| Updates | Orion checks extensions from the Chrome and Firefox stores and updates them; documented for macOS. Nothing documented for file-installed extensions. |
| Screen Time | Orion for iOS respects Apple's web limits (since 1.4.17) |
| Platforms | macOS, iOS, iPadOS. No Android, so the Android tablet stays on Quetta. |
| Price | Free (Orion+ is an optional paid supporter plan) |

## KidTube's pieces, one by one

Status in Orion, from Kagi's API support table (iOS/iPadOS column) and the iOS release notes, checked against the code:

| Piece | Code | Orion on iPad | Notes |
| --- | --- | --- | --- |
| Storage (`storage.local`, `onChanged`) | `sw.js`, all screens | ✅ Supported | |
| Messages between screens and the worker (`runtime.sendMessage`, `onMessage`, `getURL`, `getManifest`) | everywhere | ✅ Supported | |
| `runtime.onInstalled`, `onStartup`, `openOptionsPage` | `sw.js`, options | ✅ Supported | `onInstalled` was broken on iOS before 1.3.0 |
| Alarms (15-min sync) | `sw.js:842` | ✅ API supported | ⚠️ iOS suspends Orion in the background, so syncs happen only while Orion is open. See [What to change](#what-to-change). |
| URL guard (`tabs.onUpdated` with `url`, `tabs.update`, `tabs.create`, `tabs.onRemoved`) | `sw.js:196` | ✅ Supported | This is now also the site blocker (below). Needs a test with YouTube's in-page navigation. |
| Site blocking (`declarativeNetRequest.updateDynamicRules`, `excludedRequestDomains`, `main_frame`) | `sw.js:786` | ❌ Not supported (iOS and macOS, per the table) | 0.6.1 catches the error and uses the URL guard instead. The page starts loading, then goes back to the list. Release notes for Orion **macOS** mention a declarativeNetRequest engine, so on a Mac the rule might be accepted while the domain condition is ignored. That case needs a test. |
| `webRequest` | not used | ⚠️ Partial on iOS (page loads only, no redirects) | Not needed |
| Content scripts at `document_start`, cover iframes from `web_accessible_resources` | `content/content.js`, `ui/*.html` | ⚠️ Supported in general ("partial" since 1.3.0) | The whole kid screen depends on it. **Test first.** |
| Page-world script (`"world": "MAIN"`) | `content/main.js` | ❓ Not documented | Only reads the real channel and length. If Orion runs it in the isolated world, it silently finds nothing and that check is skipped. The helper checks channels on the server anyway. |
| Talk screen opened as a tab page (`tabs.update` to `ui/talk.html`) | `sw.js:470` | ❓ Should work: extension pages render since 1.3.0 | Needs a test |
| Friend's voice (`speechSynthesis`, mp3 via `<audio>`) | `ui/voice.js` | ✅ WebKit supports both after a tap | The friend screen already asks for a tap |
| Recorded mp3s kept in Cache Storage | `sw.js:731`, `ui/voice.js` | ❓ Not documented | If it fails, the tablet speaks with its own voice (already the fallback) |
| Speech recognition (`webkitSpeechRecognition`) | `ui/voice.js` | ❓ Probably missing on iOS (the install page already says so) | *Record and send* (the default, with a Gemini or OpenRouter key) doesn't need it; else he types |
| Recording for OpenRouter (`getUserMedia`, `AudioContext`) | `ui/voice.js` | ❓ Needs a test on an extension page | If it fails, he types |
| `permissions.request` (OpenRouter) | `settings/settings.js` | ✅ Supported | |
| PIN (`crypto.subtle` PBKDF2), time zones (`Intl`), `crypto.randomUUID` | `lib/` | ✅ WebKit | |
| GitHub sync (`fetch` to `api.github.com` with the token) | `sw.js` | ✅ Should work (host permission) | |
| Tablet captions (`fetchTranscript`, cookies to youtube.com) | `sw.js:661` | ❓ | Not needed: Gemini makes the transcripts |
| Self-update (`update_url`, `requestUpdateCheck`, `onUpdateAvailable`) | `sw.js:822`, `sw.js:837` | ⚠️ The APIs exist; unknown whether Orion follows our `update_url` for a file install | The parent page already falls back to "Install the new version" from `latest.json` |

## What works today (0.6.1)

- Install: the install page tells the parent to download the .zip and install it with Orion's **+**.
- The kid flow is the same as in Quetta, if the content scripts and iframes work: list, talking friend, video with covers, questions, locks, minutes.
- Other websites: without blocking rules, the URL guard sends any page outside `allowedSiteDomains` back to the list. It's tested in `tests/orion.test.mjs` with a fake browser, not in Orion.
- Hearing his answers: recorded and sent (free Gemini, then OpenRouter) when a key is set; else typing.
- Updates: the parent page compares the installed version with `latest.json` and offers the new .zip.

## What can't work in Orion

| Can't | Why | Instead |
| --- | --- | --- |
| Stop other sites **before** they load | No `declarativeNetRequest` in Orion | The URL guard sends him back after the page starts loading. Screen Time "Allowed Websites Only" blocks them for real. |
| Stop him from switching KidTube off or removing it | Orion's extension settings live inside Orion. There's no lock and no MDM setting for Orion. MDM *Always On* exists only for Safari extensions. | **Guided Access** keeps him in Orion, but not out of Orion's menus. In Guided Access, a parent can draw over the area with the menu buttons to disable it. For a 4–5-year-old the risk is low; *Watched* and *activity* would show gaps. |
| Sync while Orion is closed | iOS suspends apps in the background | Sync when he opens the list (see below) |
| Update by itself (probably) | Store updates are documented, file installs aren't | Manual: a new .zip from the install page. Or publish KidTube unlisted on the Chrome Web Store (one-time 5 USD), install it in Orion from the store, and let Orion's store updates handle it. Store review applies, and iOS store updates need a test. |
| Speech recognition (probably) | Not documented for Orion's iOS extension pages | Record and send (Gemini / OpenRouter), else typing |

## Two builds from one code (0.6.2)

KidTube keeps **one source**, `extension/`. It is developed and released for Quetta. The Orion build is made from it on request ("update orion", the `update-orion` skill in `.claude/skills/`), so Orion can lag behind Quetta without a second copy of the code.

| What differs | How | Where |
| --- | --- | --- |
| Behaviour | `TARGET` is `'quetta'` in the source; the Orion build rewrites it to `'orion'`. Code checks it only where Orion really differs. | `extension/core/lib/target.js` |
| No blocking rules | `applySiteRules` returns early on Orion; `externalGuard` always does the job | `extension/core/background/main.js` |
| Updates | No `requestUpdateCheck` on Orion; the parent page compares with `orion/latest.json` and links to `#orion` on the install page | `extension/core/background/main.js` (`checkUpdate`) |
| Which build wrote the activity | `device.target`: `quetta` or `orion` | `extension/core/background/main.js` (`flushOutbox`), `schemas/activity.schema.json` |
| Manifest | No `update_url`, no `minimum_chrome_version`, no `declarativeNetRequest` permission | `orionManifest()` in `build/build-orion.mjs` |
| Release | `site/orion/kidtube-orion-<version>.zip` + `site/orion/latest.json` (with the commit and a hash of the source), separate from Quetta's `site/latest.json` | `build/build-orion.mjs` |
| Compatibility check | Every `chrome.*` API in use, looked up in a snapshot of Kagi's support table; fails on an API Orion lacks unless it is handled for the Orion build | `build/orion-check.mjs`, `build/orion-apis.json`, `tests/orion-build.test.mjs` |

Rules that keep this working:
- **New Orion differences go behind `TARGET`** in `extension/`, never into the built files.
- **One version number means one set of files.** The build refuses to reuse a version for different code; bump `version` in `extension/manifest.json`.
- **Quetta releases stay as they were** (`build/pack.mjs` with the signing key). Building Orion never touches `site/latest.json`, `updates.xml` or the `.crx`.

## What to change

The code is close to done. These changes are small and also help Safari. They are scheduled in [PLAN-DEVICES.md](PLAN-DEVICES.md) (P1, P2):

| Change | Where | Why |
| --- | --- | --- |
| Sync when a screen asks for `state` and the last sync is older than 15 min | `sw.js:219` | On iPad, the alarm only fires while Orion is open. Opening the list should be enough to pull the new list. |
| ~~Make sure an accepted-but-ignored blocking rule can't switch the guard off~~ **Done in 0.6.2:** the Orion build never adds the rule and always keeps the guard on | `sw.js` `applySiteRules`, `externalGuard` | — |
| Fallback for the page-world script: if `main.js` never reports, inject it as a `<script>` tag from the content script | `content/content.js`, `manifest.json` | Keeps the real channel and length check if Orion has no `world: "MAIN"`. Optional: the server checks too. |
| ~~Show which browser sent each event~~ **Done in 0.6.2:** `device.target` | `sw.js` `flushOutbox`, `schemas/activity.schema.json` | — |
| Note in `HOW-IT-WORKS.md` what the iPad test showed | docs | The table there says "may" in several places |

## Locking down the iPad for Orion

| Setting | Where | What it does |
| --- | --- | --- |
| Turn Safari off | Screen Time → Content & Privacy → Allowed Apps | Orion is the only browser |
| Delete or block the YouTube app and other browsers | Screen Time → App Limits / App Store | YouTube links stay in Orion |
| **Allowed Websites Only**: `youtube.com`, `accounts.google.com`, `andyvauliln.github.io`, plus `allowedSiteDomains` | Screen Time → Content & Privacy → Web Content | Real blocking, which Orion respects since 1.4.17. Needs a test that YouTube's video and image servers still load. |
| **Guided Access** on Orion, with the toolbar area disabled | Settings → Accessibility → Guided Access | Keeps him in Orion and away from its menus |
| In Orion: extensions on, KidTube allowed on all websites | Orion → Settings → Extensions | KidTube runs on YouTube without asking |

## Orion compared with Safari on the iPad

| | Orion (0.6.1, now) | Safari extension (SAFARI.md, A) | Web page (SAFARI.md, B) |
| --- | --- | --- | --- |
| Cost | Free | 99 USD a year | Free |
| Code changes | Small (above) | Small; packaging through App Store Connect | New page shell around the existing screens |
| Install and update | .zip by hand, or the Chrome Web Store | TestFlight or App Store; a build at least every 90 days | Instant (GitHub Pages) |
| Covers real youtube.com | ✅ | ✅ | ❌ embedded player |
| Blocks other sites | After load (guard) + Screen Time | Partly (DNR) + Screen Time | Screen Time or Guided Access only |
| Child can switch it off | Yes, inside Orion's settings | Yes, unless MDM *Always On* | Nothing to switch off |
| Speech recognition | Probably not | Probably (needs a test) | Yes |
| Maturity | Beta extension support from a small company | Apple, stable | Plain web |

**Recommendation:** use Orion on the iPad first, because it's already built. Spend one evening on the test below, then make the changes above. Move to a Safari option only if the test fails on the content scripts and covers, or if switching the extension off turns out to be a real problem.

## Unknowns: test on the iPad

| Check | Pass when |
| --- | --- |
| The 0.6.1 .zip installs from Files via Orion's **+**, and the id matches the install page | Installed, same id |
| youtube.com shows his list (content script at `document_start` + cover iframe) | List shown, YouTube hidden |
| Tap a video → intro screen (talk page in the tab) → video with covers and strip | Same as Quetta |
| `content/main.js` reports channel and length (look for a `details` call, or a too-short video being blocked) | Reported, or note it as missing |
| Typing `example.com` in the address bar goes back to the list | Back within a second |
| Screen Time "Allowed Websites Only" + YouTube still plays | Plays; other sites blocked |
| Friend speaks after a tap; a recorded mp3 plays | Both heard |
| Voice question: speech recognition, then OpenRouter recording | Note which one works |
| Close Orion for 30 min, open it, press nothing: does the list update? | Updates (after the sync-on-open change) |
| Parent page → Update: what `requestUpdateCheck` returns for a file install | Note the status |
| Can he switch KidTube off from Orion's menus under Guided Access with the toolbar disabled? | No |
| On a Mac: does the blocking rule load, and does it block other sites but not YouTube? | Both, or the guard takes over |

## Sources

- Orion iOS & iPadOS extension support (install from stores and from file; Apple's limits; beta) — https://help.kagi.com/orion/browser-extensions/ios-ipados-extensions.html
- Orion WebExtensions API support table (Google Sheet, linked from Kagi's technical page; the iOS/iPadOS column was read for this research) — https://help.kagi.com/orion/misc/technical.html
- Orion for iOS release notes (file install 1.2.8; partial webRequest, content scripts and extension pages 1.3.0; Screen Time web limits 1.4.17; latest 1.5.5, 2026-10-01) — https://orionbrowser.com/updates/orion-iOS-release-notes
- Orion for macOS release notes (declarativeNetRequest engine, 1.1) — https://orionbrowser.com/updates/orion-release-notes
- Orion automatic extension updates (store extensions) — https://help.kagi.com/orion/features/automatic-extension-updates.html
- Orion FAQ (own WebExtensions implementation, MV2 and MV3) — https://browser.kagi.com/faq.html
- Missing declarativeNetRequest reported for a Chrome extension in Orion — https://orionfeedback.org/d/13031-compatibility-issue-with-chrome-extension-bewlycat-missing-declarativenetrequest-api
- Safari extension management by MDM (Safari only) — https://support.apple.com/guide/deployment/safari-extensions-management-declarative-depff7fad9d8/web
