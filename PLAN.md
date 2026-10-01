# KidTube for Quetta — development plan (v2)

## Context

The repo (`/home/superuser/youtube-wraper`) holds only `RESEARCH.md`. You wrote a product brief: a Chrome MV3 extension running in Quetta on an Android tablet, driven by JSON files on GitHub that a separately scheduled cloud agent rewrites. You asked for three things: (1) turn the brief into a plan someone can build from, (2) fix the data schemas, (3) a check of what is wrong or risky.

The product idea stays the same: a dumb tablet, a smart agent, and GitHub between them. Changes in this version:
- The **check** (section 1) lists every problem found in the brief.
- **Corrected contracts** (section 3), each with a JSON Schema file and a validator.
- **Milestones with acceptance checks** (section 6). M0 is a go/no-go spike on Quetta, because about half the design depends on Quetta behaving like desktop Chrome.

---

## 1. The check: problems in the brief

| # | Problem in the brief | Why it matters | Fix in this plan |
|---|---|---|---|
| C1 | `queue.json` keys videos by `url` and the start screen filters by **title** | Titles change and repeat. URL parsing is fragile (`youtu.be`, `&t=`, `m.`). | Key everything by `videoId` (11 chars, `[A-Za-z0-9_-]`). Build the URL from it. |
| C2 | No `schemaVersion` in any file | When the format changes, an old tablet misreads a new file without noticing | Every file has `schemaVersion: 1`. The extension ignores a file whose major version it doesn't know and keeps the last good copy. |
| C3 | Times like `"16:00"` and "per day" have no time zone | The agent runs in UTC in the cloud, so the hours and the daily cap are off by hours | `timezone` (IANA name) in config. The day starts at local midnight in that zone. |
| C4 | "Overlay keys replace bundled keys" doesn't say how deep | Overlay `{"time":{"maxMinutesPerDay":30}}` would wipe out `time.allowed` | Objects deep-merge. Arrays and scalars replace. `null` resets a key to its bundled default. |
| C5 | Quiz `items` has no link to a video, and `afterEachVideo` with N items means every quiz runs after every video | The agent can't say "ask about fractions after the fractions video" | Quiz items become a library keyed by id. A queue item has optional `quizIds`. If it has none, `quiz.defaultIds` rotates. |
| C6 | `choice` has no `options` or correct-answer field. `audio` is "text or choice", so it is two types in one | The renderer and the marker can't be written from that | One item shape: `prompt`, optional `audioUrl`, and `answer` as `{kind:"text", accept:[]}` or `{kind:"choice", options:[], correct}`. `type` only picks the renderer. |
| C7 | "Cannot open the next video until passed" has no way out | A 5-year-old stuck on a wrong template is locked out until the agent runs again | `quiz.maxAttempts` (default 3). After that the answer is shown, he continues, and the result is logged as `passed:false`. Parent PIN can also skip. |
| C8 | One `activity.json` holds everything and the tablet rewrites it on each event | It grows forever. The GitHub Contents API needs the file's `sha` on each write, so two writes in a row conflict (409). An offline retry can duplicate an event. | One file per local day, `activity/YYYY-MM-DD.json`. Every event has an `eventId` (UUID), and the writer de-duplicates on it. Outbox in `chrome.storage.local`. |
| C9 | A watch event has no seconds watched and no reason it ended. Parent like/comment is inside the watch record. | The agent can't tell "loved it" from "quit at the lock". A comment made later can't be attached to the event. | Typed events: `watch` (with `watchedSeconds`, `endReason`), `quiz` (with the answers he gave), `parentNote`, `blocked`, `timeUp`. |
| C10 | The agent doesn't know which build and which quiz types the tablet actually runs | `quiz-types.json` in the repo says what was released, not what is installed. The agent would send types the tablet can't show. | Each activity day file has a `device` header: `extensionVersion`, `quizTypes`, and the `updatedAt` of the config and queue it last applied. The agent uses those types only. |
| C11 | The agent "publishes a CRX", but the signing key is kept out of the repo | Then the agent would need the private key. An unattended agent pushing code into a browser that has a GitHub token on a child's tablet is the biggest risk in this design. | The agent opens a **PR** for code. A GitHub Action holding the key as a secret packs, signs and releases after **you** merge. Data files (queue, config, memory) are committed directly. |
| C12 | `memory.json` is about your child but sits next to files that must be public (`updates.xml`, CRX) | Mixing private and public data in one repo | Two repos: private `kidtube-data` and public `kidtube` (code and releases). |
| C13 | The tablet token has write access to the repo that holds the config and the queue | Anyone holding the tablet token can unlock everything. Low risk with a child, but free to avoid. | The fine-grained token is scoped to `kidtube-data` only. Recommended: keep `activity/` in its own repo so the token can't write the config at all (decision D2). |
| C14 | Fetching from `raw.githubusercontent.com` | It is cached about 5 minutes, so Update may show stale data. Private repos need auth anyway. | Use the Contents API with `Accept: application/vnd.github.raw+json`, the token, and `If-None-Match` (ETag). A 304 doesn't count against the rate limit. |
| C15 | Queue and config "change together", but they are two separate fetches | A new queue can point at a quiz id that the cached config doesn't have yet | A missing quiz id falls back to `defaultIds`. Never block on it. The validator CI rejects queues that reference unknown ids. |
| C16 | Quetta can open any website. Family Link only filters sites in Chrome. | The kid types `games.com` into Quetta's address bar and the whole product is bypassed | DNR rule: block `main_frame` everywhere except an allowlist (`youtube.com`, `m.youtube.com`, `accounts.google.com`, `consent.youtube.com`). Config key `allowedSiteDomains`. |
| C17 | Incognito tabs and uninstalling the extension aren't mentioned | Extensions are off in incognito by default, and the kid could remove it from Quetta's menu | M0 checks what Quetta allows: incognito setting, and whether extension management can be locked. If it can't, Family Link app limits are the backstop. Documented in setup. |
| C18 | YouTube is a single-page app, so "swallowing clicks" doesn't catch navigation that isn't a click (end screen autoplay, keyboard, back button) | Leaks through autoplay and history | Three layers: capture-phase click guard, a `yt-navigate-start` listener plus a `history.pushState` patch in the MAIN world, and a `tabs.onUpdated` guard in the service worker that sends any disallowed URL back to home. Autoplay is turned off. |
| C19 | The extension trusts the queue's `channelId` and `durationSeconds` | Stale or wrong agent data lets a blocked channel or a Short through | On the watch page, read `ytInitialPlayerResponse.videoDetails` (`channelId`, `lengthSeconds`, `isLiveContent`) and enforce the rules on the real values |
| C20 | `minVideoDurationSeconds` exists, but no maximum, no live-stream rule, no autoplay rule | Gaps the agent can't control | Add `maxVideoDurationSeconds` (0 = none) and `blockLive`. Autoplay is always off. |
| C21 | Ads: request blocking on `/get_midroll` and `/api/stats/ads` | YouTube's anti-adblock checks can break playback or show a warning wall. Then the whole product stops working. | Ad handling sits behind the `blockAds` flag and ships in its own milestone, so it can be turned off from GitHub without a new build |
| C22 | The PIN is stored, but not said how | A plaintext PIN in storage | PBKDF2 hash with a salt in `chrome.storage.local`. Lockout after 5 wrong tries. |
| C23 | No check on what the agent writes | One bad JSON file and the tablet shows nothing | A `validate` script and a CI workflow on `kidtube-data`. The agent must run it before committing. The tablet also validates and keeps the last good copy. |
| C24 | The brief says "Update" pulls everything, but nothing tells the parent when a newer release exists that `requestUpdateCheck` didn't install | Silent stale build | The options page compares the installed version with `latest.json` in the releases repo and shows "Install v1.4 →" (your fallback, made visible) |

---

## 2. Decisions (defaults chosen. Change any of them at approval.)

- **D1 Two repos.** Public `kidtube`: extension source, agent workspace, schemas, CI, GitHub Pages hosting `updates.xml`, `latest.json` and CRX files. Private `kidtube-data`: config, queue, memory, activity.
- **D2 Tablet token.** One fine-grained PAT, `kidtube-data` only, Contents read and write. Optional hardening: move `activity/` to a third repo `kidtube-activity`, give a read token for data and a write token for activity.
- **D3 The agent never ships code unreviewed.** Code changes are PRs. CI signs after a human merges.
- **D4 Plain JS, no bundler.** ES modules in the extension and a small `node` validator using `ajv`. That keeps the CRX build reproducible and the agent's code PRs easy to read.
- **D5 UI is drawn in extension iframes** (`web_accessible_resources`: `home.html`, `lock.html`, `quiz.html`) placed over the YouTube page. YouTube's CSS and CSP can't touch them, so `<audio>` from our host works. The YouTube player stays native.

---

## 3. Data contracts (corrected)

Each contract has a schema in `kidtube/schemas/*.schema.json`. The validator and the extension both use these.

### 3.1 `parent-config.json` (agent writes; overlay on `extension/default-config.json`)

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-10-01T12:00:00Z",
  "minExtensionVersion": "1.0.0",
  "timezone": "Europe/Moscow",

  "blockShorts": true,
  "blockLive": true,
  "blockOutboundLinks": true,
  "blockAds": true,
  "allowSkip": false,
  "allowedSiteDomains": ["youtube.com", "m.youtube.com", "accounts.google.com", "consent.youtube.com"],

  "minVideoDurationSeconds": 60,
  "maxVideoDurationSeconds": 1200,
  "minSecondsBeforeLeave": 120,
  "closeAfterSeconds": 0,
  "queueSize": 10,

  "time": {
    "allowed": [
      { "days": ["mon", "tue", "wed", "thu", "fri"], "from": "16:00", "to": "18:30" },
      { "days": ["sat", "sun"], "from": "10:00", "to": "18:30" }
    ],
    "maxMinutesPerDay": 40
  },

  "blockedChannelIds": [],

  "quiz": {
    "enabled": false,
    "when": "afterEachVideo",
    "maxAttempts": 3,
    "defaultIds": ["add-3-3"],
    "itemsPerVideo": 1,
    "items": {
      "add-3-3":     { "type": "text",   "prompt": "How much is 3 + 3?", "answer": { "kind": "text", "accept": ["6", "six"] } },
      "pick-6":      { "type": "choice", "prompt": "Which is 3 + 3?",    "answer": { "kind": "choice", "options": ["5", "6", "7"], "correct": "6" } },
      "hear-number": { "type": "audio",  "prompt": "What number did you hear?", "audioUrl": "https://<you>.github.io/kidtube/audio/six.mp3",
                       "answer": { "kind": "text", "accept": ["6"] } }
    }
  }
}
```

Rules:
- Merge: objects deep-merge, arrays and scalars replace, `null` means bundled default. `quiz.items` is an object, so the agent can add one item without resending all of them.
- `from` < `to`, both in the same day (no windows past midnight in v1). Day names are `mon`..`sun`.
- `maxMinutesPerDay` counts seconds while the `<video>` is playing and the page is visible. It resets at local midnight in `timezone`.
- `allowSkip`: `false` means no jumping forward inside a video and no speed above 1x (going back is fine).
- Rules saved on the tablet's parent page apply at once and are merged into `parent-config.json` on GitHub, so the parent and the agent edit one file.
- `closeAfterSeconds`: `0` means off. A positive number sends him back to the list after that many seconds of playback.
- `minExtensionVersion` higher than the installed build: lock screen saying "Ask a parent to press Update".
- Text marking: NFKC, trim, collapse spaces, lowercase. If both the answer and the accepted value parse as numbers (`,` counts as a decimal point), they are compared as numbers, so `6` = `6.0` = `6,0`.
- `choice.correct` must be one of `options`. Options are shuffled on screen.
- An unknown `type` shows "This tablet needs an update". It counts neither as pass nor as fail and does not block. It is logged as `quiz` with `result:"unsupported"`.

### 3.2 `queue.json` (agent writes)

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-10-01T12:00:00Z",
  "videos": [
    {
      "videoId": "dQw4w9WgXcQ",
      "title": "Fractions with blocks",
      "channelId": "UCxxxxxxxxxxxxxxxxxxxxxx",
      "channelTitle": "Math Blocks",
      "durationSeconds": 360,
      "thumbnailUrl": "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
      "addedAt": "2026-10-01T12:00:00Z",
      "quizIds": ["add-3-3"],
      "allowRewatch": false,
      "note": "Follow-up to the blocks video he liked"
    }
  ]
}
```

Rules:
- `videoId` is unique within the file.
- Shown = in queue, **not** in the local watched set (unless `allowRewatch`), channel not blocked, duration between min and max, not a Short. At most `queueSize`.
- "Watched" means `endReason` is `ended`, or `watchedSeconds >= minSecondsBeforeLeave`. Stored locally by `videoId` and reported in activity.
- `note` is for the parent's view only. The kid doesn't see it.

### 3.3 `activity/YYYY-MM-DD.json` (tablet writes; agent read-only)

```json
{
  "schemaVersion": 1,
  "date": "2026-10-01",
  "device": {
    "deviceId": "tab-7f3a",
    "extensionVersion": "1.0.0",
    "quizTypes": ["text", "choice", "audio"],
    "configUpdatedAt": "2026-10-01T12:00:00Z",
    "queueUpdatedAt": "2026-10-01T12:00:00Z",
    "lastSyncAt": "2026-10-01T15:05:00Z"
  },
  "events": [
    { "eventId": "6f1c…", "type": "watch", "at": "2026-10-01T15:00:00Z", "videoId": "dQw4w9WgXcQ",
      "watchedSeconds": 340, "durationSeconds": 360, "endReason": "ended" },
    { "eventId": "a2d9…", "type": "quiz", "at": "2026-10-01T15:04:00Z", "videoId": "dQw4w9WgXcQ", "quizId": "add-3-3",
      "result": "passed", "attempts": 2, "answers": ["5", "6"] },
    { "eventId": "c81e…", "type": "parentNote", "at": "2026-10-01T19:00:00Z", "videoId": "dQw4w9WgXcQ",
      "liked": true, "comment": "he liked the blocks" },
    { "eventId": "d001…", "type": "blocked", "at": "2026-10-01T15:02:00Z", "videoId": "dQw4w9WgXcQ",
      "target": "channel", "url": "https://m.youtube.com/@x" },
    { "eventId": "e7aa…", "type": "timeUp", "at": "2026-10-01T16:40:00Z", "reason": "dailyCap", "playedMinutes": 40 }
  ]
}
```

Rules:
- `endReason`: `ended` | `leftAfterLock` | `closeAfter` | `timeUp` | `blockedOnLoad`.
- Quiz `result`: `passed` | `failed` (hit maxAttempts) | `skippedByParent` | `unsupported`.
- `blocked.target`: `video` | `channel` | `shorts` | `ad` | `external` | `search`. Lets the agent see what he keeps trying to reach.
- Writer: queue the event in the outbox, then GET the file (sha), merge by `eventId`, PUT. On a 409, retry up to 3 times with backoff. When offline, it stays in the outbox until the next poll or Update.

### 3.4 `memory.json` (agent-owned; tablet never reads it)

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-10-01T20:00:00Z",
  "processedThrough": "2026-10-01T19:00:00Z",
  "likes":    [{ "topic": "building blocks", "evidence": ["dQw4w9WgXcQ"], "since": "2026-10-01" }],
  "dislikes": [{ "topic": "loud pranks", "source": "parent", "note": "not cool", "since": "2026-09-20" }],
  "channels": { "UCxxxxxxxxxxxxxxxxxxxxxx": { "verdict": "good", "note": "calm pacing" } },
  "skills":   { "addition-to-10": { "passed": 7, "failed": 1, "level": "ready-for-20" } },
  "shown":    ["dQw4w9WgXcQ"],
  "journal":  [{ "at": "2026-10-01T20:00:00Z", "summary": "Added 3 math videos, raised quiz to sums to 10" }]
}
```

Only the agent uses this file, so the schema is light: required keys plus `additionalProperties: true`. `processedThrough` keeps the agent from counting the same events twice. `journal` is the agent's changelog for you.

### 3.5 Release files (public repo, GitHub Pages)

- `updates.xml`: standard gupdate XML, `appid` = the fixed extension id, `codebase` = the CRX URL on Pages, `version`.
- `latest.json`: `{ "version": "1.1.0", "crxUrl": "…", "releaseUrl": "…", "quizTypes": ["text","choice","audio"] }`. The options page uses it for the fallback button.
- `extension/quiz-types.json`: generated at build time from the quiz-type registry, so it can never disagree with the code.

---

## 4. Repo layout

```
kidtube/                         (public)
  extension/
    manifest.json                MV3, key, update_url, content_scripts www+m, DNR, alarms, storage, tabs
    default-config.json
    quiz-types.json              generated
    sw/            service worker: sync.js (fetch+ETag), outbox.js, merge.js, alarms.js, update.js, guard.js (tabs.onUpdated)
    content/       boot.js (isolated), nav-main.js (MAIN world pushState patch), player.js (time/lock/videoDetails), ads.js
    ui/            home.html/js, lock.html/js, quiz.html/js   (iframes)
    quiz/          registry.js, mark.js (normalize/numeric), types/text.js, types/choice.js, types/audio.js
    options/       options.html/js   (PIN, repo, token, recent watches → like/comment, Update, status)
    rules/ads.json, rules/sites.json (DNR)
    lib/           config.js (deep merge + validate), time.js (tz windows, daily counter), schema/ (copied JSON Schemas)
  schemas/         config, queue, activity, memory .schema.json
  tools/           validate.mjs, pack.mjs, gen-quiz-types.mjs
  agent/           README.md, PROMPT.md, examples/ (good/bad queue diffs)
  .github/workflows/
    release.yml    on tag: gen quiz-types → pack+sign (KEY secret) → Pages: crx, updates.xml, latest.json
    test.yml       unit tests + validate fixtures
  RESEARCH.md
kidtube-data/                    (private)
  parent-config.json  queue.json  memory.json  activity/
  .github/workflows/validate.yml (runs kidtube/tools/validate.mjs on every push)
```

---

## 5. Kid UX (precise behavior)

- **Home** (`/` or any non-allowed page): full-screen iframe with up to `queueSize` big thumbnail cards, nothing else. Outside the hours or over the cap, the lock screen shows instead ("See you at 16:00" with a clock icon).
- **Watch**: native player. Out of fullscreen, the iframe strip below the player shows the other cards, grey with a countdown ring until `minSecondsBeforeLeave`. The rest of the YouTube page (comments, related videos, header) is hidden with CSS.
- **End**: if `ended`, or he leaves after the lock: quiz iframe (if enabled) → home. The watched card disappears.
- **Daily cap reached during a video**: the video pauses and the lock screen shows. The leave lock never extends the day.
- **Quiz screen**: one item at a time, large type, a replay button for audio, the on-screen keyboard for text (`inputmode="numeric"` when every accepted value is a number), and a gentle wrong-answer animation.

---

## 6. Milestones (each ends with checks you can run)

**M0: Quetta spike (go/no-go, about 1 day).** _Status: done on the tablet. CRX installs, background update installs 0.0.2, `requestUpdateCheck` returns `throttled`._ A throwaway CRX with a content script, a DNR rule, `tabs.onUpdated`, an `alarms` poll, a `fetch` to api.github.com, and an `update_url`.
- [ ] Quetta installs a self-signed CRX, and the id stays the same across reinstall (the `key` in the manifest)
- [ ] Content scripts run on `m.youtube.com` and `www.youtube.com`, in both MAIN and ISOLATED worlds
- [ ] DNR blocks a `main_frame` to an outside site and blocks `doubleclick.net`
- [ ] `chrome.alarms` fires in the background, and the SW can fetch the GitHub API
- [ ] `chrome.runtime.requestUpdateCheck()` returns `update_available` and Quetta installs v0.0.2 from Pages. Record what it really does.
- [ ] Incognito: can it be disabled, or do extensions run there? Can the extension be uninstalled without friction?
- [ ] Fullscreen on the tablet: does the injected iframe stay hidden or visible as specified?
- **If requestUpdateCheck fails:** keep the "open the release" fallback (C24) as the main path. Everything driven by data still works.

**M1: Contracts and tooling.** _Status: done (28 tests pass)._ `schemas/*`, `tools/validate.mjs`, fixtures (good and bad), `test.yml`, `kidtube-data` with seed files and `validate.yml`.
- [x] `node tools/validate.mjs fixtures/good/*` passes, and each `fixtures/bad/*` fails with a clear message (one bad fixture per check item C1–C8)

**M2: Sync core (SW).** _Status: built in 0.1.0 (sync, ETag, outbox, activity writer, PIN, Update). Not yet checked against GitHub from the tablet._ Config fetch, deep merge, ETag, last-good cache, `alarms` every 15 min, outbox, day-file writer with eventId de-duplication and 409 retry, options page (PIN, repo, token, Update, status panel).
- [ ] Unit tests for `merge.js` (C4 cases) and the outbox merge (a duplicate eventId is written once)
- [ ] Desktop Chrome unpacked: edit `parent-config.json` on GitHub, press Update, and the new value shows in the status panel within 5 s
- [ ] Offline (DevTools offline): the event stays in the outbox, then arrives after you go back online and press Update

**M3: Kid shell.** _Status: built in 0.1.0. Logic tested in node (tests/sw.test.mjs); on-tablet check pending._ Home iframe from the queue, watch page, real `videoDetails` checks (C19), leave lock, `closeAfterSeconds`, the nav guard in 3 layers (C18), site allowlist (C16), time windows plus playback counter (C3), lock screen, autoplay off, watch events.
- [ ] Unit tests for `time.js`: window edges, timezone, midnight reset, paused time not counted
- [ ] Manual script: clicking a channel, a related video, the logo, `/shorts/x`, an outside URL in the address bar, the back button, or an end-screen card always lands on home or does nothing, and logs `blocked`
- [ ] A queue item from a blocked channel never appears, even if the agent left it in

**M4: Quizzes.** Registry, `text` / `choice` / `audio`, the marker, maxAttempts, PIN skip, unsupported type, quiz events, generated `quiz-types.json`.
- [ ] Unit tests for `mark.js`: `" 6 "`, `6.0`, `6,0`, `SIX`, NFKC full-width `６`
- [ ] Unknown type → "needs update" screen, doesn't block, logged `unsupported`

**M5: Release pipeline.** `pack.mjs`, `release.yml` (signing key as a secret), Pages, `updates.xml`, `latest.json`, options-page fallback button.
- [ ] Tag `v1.0.1`, and the tablet's Update installs it (or shows "Install v1.0.1 →" if M0 found that requestUpdateCheck doesn't work)

**M6: Agent workspace.** `agent/README.md` (connect, the two repos, schedule daily at 20:00 local, run validate before commit, code only through PRs), `agent/PROMPT.md` (focus, good and bad examples, parent comments win over inferred taste, keep `queueSize` unwatched and valid, use only `device.quizTypes`, update `memory.processedThrough` and `journal`).
- [ ] Dry run: hand the agent a fixture day of activity. It writes a valid queue of 10 new videos, a memory update, and no code changes.

**M7: Ads (behind `blockAds`).** DNR ad list, removal of banners and overlays, auto-Skip, cover over an unskippable pre-roll.
- [ ] 20 videos played on the tablet with no anti-adblock wall. If a wall appears, set `blockAds:false` from GitHub and the next poll fixes it.

---

## 7. Verification (end-to-end)

1. `npm test` (merge, time, mark, outbox) and `node tools/validate.mjs` against the fixtures and the live `kidtube-data` clone.
2. Desktop Chrome, unpacked: go through M2–M4 checks with a test repo.
3. Tablet with Quetta: install the signed CRX from M5. Home-screen shortcut → watch → quiz → `activity/<today>.json` appears on GitHub with the right `device` header.
4. Run the agent once by hand on that activity. Its commit passes `validate.yml`. Press Update on the tablet and the new list appears.

## 8. Remaining risks

- Quetta's extension support is the foundation. M0 decides it before anything else is built.
- YouTube DOM and anti-adblock changes. Mitigation: `videoDetails` checks rather than DOM scraping where possible, and ads behind a flag.
- The device clock can be changed by the kid. Mitigation: compare against the GitHub API `Date` header on each sync, and lock if they are more than 10 min apart.
