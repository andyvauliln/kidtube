# KidTube on Safari: research

*As of 2026-10-02 (version 0.6.1). Research only: nothing here is built yet. For Orion, the other WebKit browser on iPad, see [ORION.md](ORION.md).*

The question: what would it take for KidTube to run in Safari, mainly on an **iPad**? What can we reuse from the current project, and what can't work there?

## Short answer

- **Only the tablet side changes.** The daily helper, the data repo, Notion, Gemini and the voices run on the server and on GitHub, so they don't care which browser the tablet uses. `queue.json`, `parent-config.json`, `activity/`, `audio/` and `characters/` stay as they are.
- **There are two realistic ways to do it:**
  - **A. Port the extension to Safari.** The code is plain MV3 JavaScript, and most of it runs in Safari as it is. You need an Apple Developer account (99 USD a year), and the app has to be installed through TestFlight or the App Store. You don't need a Mac: App Store Connect now packages a ZIP of the extension. Weak spots on iPad: the background worker gets stopped, the site allowlist is unreliable, there is no self-update, and the child can switch the extension off in Settings unless the iPad is locked down.
  - **B. Make KidTube a web page** (on GitHub Pages, added to the iPad's Home Screen) that plays videos with YouTube's embedded player instead of covering youtube.com. There's no Apple account, no App Store and no extension, and it works in every browser, Quetta included. You lose control of youtube.com itself, so locking the child out of other sites is left to iPad settings (Guided Access or Screen Time).
- **Recommendation: try B first**, after a one-evening test on the real iPad (see [The test on the iPad](#the-test-on-the-ipad)). Choose A if keeping YouTube's own full player and site matters more than avoiding Apple's developer program.
- **On every option, the iPad needs Apple's own lockdown.** That means Guided Access, or Screen Time with "Allowed Websites Only" and the YouTube app removed. No browser extension or web page can stop a child from leaving Safari on iOS.

## What "Safari" means here

| Device | Fits KidTube? | Notes |
| --- | --- | --- |
| **iPad (iPadOS 18 or 26)** | Main target | Safari loads the desktop site (`www.youtube.com`) by default. KidTube already handles both `www.` and `m.youtube.com`. |
| iPhone | Works, but less well | In Safari on iPhone, fullscreen video uses the system player, so our overlays and strip aren't visible during fullscreen. |
| Mac (Safari 18+) | Works | The same Safari extension package runs on macOS. Useful for testing, but it isn't a child's device. |

## How the tablet part works today, and what Safari changes

The tablet part is a Chrome MV3 extension in Quetta (Android). These are the pieces it relies on, and how each one behaves in Safari:

| Piece today | File | Safari extension (option A) | Web page (option B) |
| --- | --- | --- | --- |
| Install a signed `.crx` from GitHub Pages; self-update via `update_url`, `requestUpdateCheck` and `onUpdateAvailable` | `manifest.json`, `sw.js:822`, `sw.js:837`, `tools/pack.mjs` | ❌ Not possible. Install via TestFlight or the App Store only, and updates come the same way. | ✅ Every push to GitHub Pages is live on the next reload. |
| Service worker holds the rules, state and 15-min sync (`chrome.alarms`) | `sw.js` | ⚠️ Supported. On iOS the worker is stopped often, and alarms don't fire while Safari is in the background. Sync has to happen when a page asks (see changes). | ✅ The page holds the logic. It syncs on open and every 15 min while open. |
| Content script covers youtube.com with iframes (`ui/*.html`), hides the end screen and suggestions, blocks seeking and speed-up, counts played seconds | `content/content.js` | ✅ Should work as it is: content scripts at `document_start` and `web_accessible_resources` iframes are standard. | ➖ Not needed. Our page is the screen; YouTube's player is one iframe inside it. |
| `world: "MAIN"` script reads the real channel and length | `content/main.js` | ✅ Supported since Safari 16.4. | ⚠️ The embed API gives the duration and the title, but not the channel ID. The helper already checks channels on the server. |
| URL guard on every tab change (`tabs.onUpdated`, `tabs.update`) | `sw.js:196` | ⚠️ Should work after a parent grants KidTube "Allow on every website". Needs a test for YouTube's in-page navigation. | ➖ Not needed: there is no youtube.com page to escape to. |
| Site allowlist: block every other site (`declarativeNetRequest`, `excludedRequestDomains`, `main_frame`) | `sw.js:786` | ⚠️ Blocking works in Safari, but domain conditions have known failures ("Failed to apply rules"). Since 0.6.1 a failed rule falls back to the navigation guard (`externalGuard`, `sw.js:807`). Use Screen Time as well. | ❌ A page can't block other sites. Use Screen Time or Guided Access. |
| Talking friend: `speechSynthesis`, recorded mp3 from Cache Storage, `<audio>` | `ui/voice.js`, `ui/talk.js`, `sw.js` `syncAudio` | ✅ Works after a tap, which the friend screen already asks for. | ✅ Same code. |
| Hearing answers: `webkitSpeechRecognition`; or recording to WAV and sending it to OpenRouter | `ui/voice.js` | ⚠️ Safari on iPad has speech recognition (via Apple's service, with a permission prompt). Whether it works on an extension page needs a test. The typing fallback already exists. | ✅ Works on an `https://` page. Safari asks for the microphone once per site. |
| PIN (PBKDF2 via `crypto.subtle`), time zones (`Intl`), `crypto.randomUUID` | `lib/pin.js`, `lib/time.js` | ✅ | ✅ |
| GitHub sync: Contents API with a fine-grained token, ETags | `sw.js` sync functions | ✅ Needs host permission for `api.github.com`. | ✅ GitHub's API allows calls from web pages (CORS). The token sits on the iPad, same as today. |
| Captions fetched on the tablet (`fetchTranscript`, `credentials: 'include'` to youtube.com) | `sw.js:661` | ⚠️ May fail because of Safari's cookie and tracking rules. Not needed any more: Gemini makes the transcripts. | ❌ Blocked by CORS. Not needed (Gemini). |
| Optional OpenRouter permission (`chrome.permissions.request`) | `options/options.js:278` | ⚠️ Safari handles host access per site; needs a test. Simplest is to list `openrouter.ai` in `host_permissions`. | ✅ No permission needed. |
| Parent page (`options_page`) | `options/` | ✅ Opens from Safari's extension menu. | ✅ A `#parent` view behind the PIN. |

## Option A: port the extension to Safari

### How you'd ship it

1. Join the **Apple Developer Program** (99 USD a year; you need it to give anything to an iPad).
2. In **App Store Connect**: create an app → Xcode Cloud tab → **Safari Web Extension Packager** → upload a ZIP of `extension/`. Apple wraps it in a small iOS/iPadOS/macOS app in a few minutes. No Mac and no Xcode needed.
   - Alternative: build with `xcrun safari-web-extension-packager` on a macOS GitHub Actions runner and upload with the App Store Connect API, so a release happens on merge, like the CRX today.
3. Install on the iPad through **TestFlight**. A TestFlight build stops working after 90 days, so a new build has to be uploaded at least every 90 days. The alternative is App Store review, which is possible as an unlisted app.
4. On the iPad: Settings → Apps → Safari → Extensions → KidTube → on, and **All Websites: Allow**. Without this, Safari asks per site, and the content script doesn't run on YouTube until someone taps Allow.

### What has to change in the code

| Change | Where | Why |
| --- | --- | --- |
| Guard `chrome.runtime.onUpdateAvailable` (and `reload`, `requestUpdateCheck`) with `?.` | `sw.js:837`, `sw.js:822` | If an API is missing, a call at the top level throws, and the whole worker fails to start. |
| Replace the "Install vX →" CRX link with "Update in TestFlight" when running in Safari | `sw.js:828`, options page | A CRX can't be installed in Safari. |
| Sync when a screen asks for `state` and the last sync is older than 15 min | `sw.js` `handle('state')` | On iOS the alarm may never fire. The child opening the list must be enough to pull a new list. |
| Assume the worker can stop at any time: no state kept only in variables (today only `bundled`, which is reloaded anyway) | `sw.js` | iOS stops idle extension workers. A known iOS 17.4–17.6 bug killed them for good, so require iPadOS 18 or later. |
| Check that the site allowlist really blocks in Safari, and rely on Screen Time too | `sw.js:786`, `sw.js:807` | A rule that throws already falls back to the navigation guard (0.6.1). A rule that is accepted but ignored would turn the guard off and block nothing. |
| Turn off tablet captions (`fetchTranscript`) | `sw.js:661` | They're likely blocked, and Gemini already does this job. |
| Move `openrouter.ai` from optional to `host_permissions` | `manifest.json` | Avoids the per-site permission flow. |
| Add icons (at least 512 px) | `manifest.json` | The App Store app needs them. The manifest has none today. |
| Ignored by Safari, harmless: `key`, `update_url`, `minimum_chrome_version` | `manifest.json` | The packager only warns about them. |

The kid UI, the rules, the quiz, the voice and the GitHub sync stay the same. Roughly 1–2 days of code and a day of testing on the iPad, plus Apple account setup.

### What option A can't do

- **No self-update from GitHub Pages.** Every new version goes through App Store Connect, plus a TestFlight build every 90 days.
- **The child can switch the extension off** in Settings → Safari → Extensions, or by long-pressing in Safari's menu. Only these stop it:
  - **Guided Access**, which locks the iPad to Safari, so Settings can't be opened.
  - **A supervised iPad with device management (MDM)**. On iPadOS 18+ this can set KidTube to *Always On* (`com.apple.configuration.safari.extensions.settings`). Supervision means wiping the iPad and enrolling it in an MDM service: heavy for one family iPad.
- **Private Browsing** runs without extensions by default. Screen Time's web restrictions hide Private Browsing, which fixes this.
- **The YouTube app** opens instead of Safari when a YouTube link is tapped, if the app is installed. Delete it or block it in Screen Time.
- **The site allowlist** has to come from Screen Time, not the extension.

## Option B: KidTube as a web page with the embedded player

The kid screens are already separate HTML pages (`ui/home.html`, `talk.html`, `strip.html`, `cover.html`). The rules are plain modules with no browser-extension calls (`lib/merge.js`, `time.js`, `queue.js`, `mark.js`, `pin.js`). So a web version reuses most of the code:

- **One page on GitHub Pages**, for example `andyvauliln.github.io/kidtube/app/`, added to the iPad's Home Screen. It opens full screen, with no address bar.
- **The service worker's logic moves into the page.** It keeps the same rules and the same sync, and saves state with `localStorage` or IndexedDB instead of `chrome.storage`.
- **Videos play in the YouTube IFrame Player** (`youtube-nocookie.com`, `rel=0`, `referrerpolicy="strict-origin-when-cross-origin"`; without the referrer, YouTube shows Error 153).
  - Our page draws everything around the player, as `layoutWatch` does now.
  - When the video ends, our page covers the player straight away, so YouTube's end screen is never seen.
  - The player API reports play, pause, end, the current time and the speed. Skipping and speed-up can be blocked by putting the time and speed back, as `guardSkipping` does now. The played seconds come from player events, which is more exact than today.
- **The friend, the questions, the voice, the recorded mp3s, the PIN and the parent page** work as they do now.
- **The same page works in Quetta, Chrome and on a computer.** Later, the extension could be kept only for what the page can't do (covering youtube.com itself).

### What option B can't do

- **It can't control youtube.com or the rest of the internet.** If the child reaches Safari's address bar, the page can't stop them. On the iPad this is handled by:
  - **Guided Access** on the Home Screen app. The child can't leave it; a parent ends it with a code or Face ID. It also has its own time limit.
  - Or **Screen Time → Content & Privacy → Web Content → Allowed Websites Only**, with just our page and the YouTube domains the player needs. Whether the player still loads when `youtube.com` itself isn't allowed must be tested (see the test below).
- **Some videos can't be embedded**, because their owner turned embedding off. The helper should check that a video can be embedded when it picks it, and skip it if not.
- **YouTube's own controls inside the player**, like the logo and "Watch on YouTube", can open youtube.com. Guided Access or Screen Time catch this. The embed also shows ads on some videos, as the normal site does.
- **No signed-in YouTube account features.** The future ideas in `HOW-IT-WORKS.md` (pressing YouTube's Like, reading the home feed as suggestions) need the real site, so they are option A only.
- **The real channel ID isn't available in the browser.** The helper's server-side check of the channel and length stays the only check.

## Locking down the iPad (needed on both options)

| Setting | Where | What it does |
| --- | --- | --- |
| Delete the YouTube app, or block it | Screen Time → App Limits / Always Allowed | YouTube links stay in Safari |
| Allow only Safari (and block other browsers) | Screen Time → Content & Privacy → App Store / Allowed Apps | No way around KidTube via another browser |
| **Allowed Websites Only** | Screen Time → Content & Privacy → App Store, Media, Web & Games → Web Content | Plays the role of today's site allowlist, and hides Private Browsing |
| **Guided Access** | Settings → Accessibility → Guided Access | Locks the iPad to one app (Safari or the KidTube Home Screen page) until a parent ends it. It is the strongest lock without MDM. |
| Option A only: extension on, "All Websites: Allow" | Settings → Apps → Safari → Extensions | Lets KidTube run on YouTube without asking |
| Optional, option A: MDM with Safari extension *Always On* | Supervised iPad, iPadOS 18+ | The child can't switch the extension off |

## The test on the iPad

Like the Quetta test before version 0.1 (`spike/`), test the unknowns on the real iPad before building anything. About one evening:

| Check | For | Pass when |
| --- | --- | --- |
| A plain `https://` test page plays an embedded video with `youtube-nocookie.com` and reports end, time and speed | B | Plays, and events arrive |
| Same page with Screen Time "Allowed Websites Only" (our site + `youtube-nocookie.com`, `googlevideo.com`, `ytimg.com`; `youtube.com` not allowed) | B | The video still plays, and youtube.com is blocked |
| Home Screen page + Guided Access: tap the YouTube logo inside the player | B | Nothing leaves the page |
| `webkitSpeechRecognition` on the test page, English and Russian | B | It hears "seven" and "семь" |
| Speech and an mp3 `<audio>` play after a tap | A, B | Both are heard |
| GitHub Contents API call with the token from the page | B | 200 |
| Upload `extension/` ZIP to the Safari Web Extension Packager; install via TestFlight | A | The extension appears in Safari settings |
| The extension's cover and list appear on `www.youtube.com` | A | Covered on load and after in-page navigation |
| After 30 min with Safari in the background, opening YouTube still gets an answer from the worker | A | The list shows, not a blank cover |
| Speech recognition on the extension's talk page | A | It hears an answer, or falls back to typing |

## What stays the same on every option

- The daily helper (`agent/`), its schedule, Claude, Gemini, OpenRouter and Notion.
- The data repo and every file format (`schemas/`), including `activity/<day>.json`. The tablet's `device` header would report the Safari or web build in `extensionVersion`, so the helper still knows which question types the tablet can show.
- The parent flows: Notion, wishes, approvals, and a chat with Claude.

## Sources

- Apple, WWDC26 "Create web extensions for Safari": MV3, service workers, declarativeNetRequest, and packaging without a Mac — https://developer.apple.com/videos/play/wwdc2026/216/
- Apple, Safari extension submission and the Safari Web Extension Packager — https://developer.apple.com/safari/extensions/submission
- Apple Developer Forums: `world: "MAIN"` support (Safari 16.4) — https://developer.apple.com/forums/thread/728849
- Apple Developer Forums: declarativeNetRequest domain conditions failing in Safari — https://developer.apple.com/forums/thread/729860, https://developer.apple.com/forums/thread/721258
- Apple Developer Forums: iOS extension service worker stopped, alarms not firing — https://developer.apple.com/forums/thread/758346, https://developer.apple.com/forums/thread/764594
- Developer ID distribution outside the App Store doesn't work well in practice — https://developer.apple.com/forums/thread/782005
- Apple, Safari extensions management (MDM, iOS/iPadOS 18+, supervised) — https://support.apple.com/guide/deployment/safari-extensions-management-declarative-depff7fad9d8/web
- YouTube embeds, Error 153 and the referrer policy — https://til.simonwillison.net/youtube/fixing-153-embed
- Screen Time website limits hide Private Browsing — https://www.macobserver.com/tips/how-to/fix-private-browsing-not-working-in-safari-iphone-ipad/
