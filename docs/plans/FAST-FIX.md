# Plan: checks inside KidTube, reports and fast fixes

*Status 2026-10-09: F1, most of F2 and the tablet side of F3 are built in 0.10.4 (`extension/core/checks/`, `core/ui/watch.js`): reports go to `problems/<day>.json` in the data repo, with a 15-second banner. Next: F4, the server reads them.*

*Written 2026-10-09, starting from version 0.10.2. Background: [HOW-IT-WORKS.md](../HOW-IT-WORKS.md), [ORION.md](../ORION.md), `agent/NOTES.md`, `agent/poll.sh`.*

## Goal

KidTube checks itself on the tablet, all the time, against a written list of what must happen:

1. After an install or an update, KidTube runs a **start checklist**.
2. After each action (a button, a mode change, a sync, a video), it checks that **the expected result happened** in the expected time.
3. When something is not as expected, KidTube **sends a report** with everything needed to reproduce it: browser, version, profile, app, mode, page and tab, the action, what was expected, what happened, and the last steps before it.
4. The parent sees a **banner for 15 seconds**: what went wrong and "Report sent. A fix comes as a new version." A small mark stays in the bottom bar until the fix arrives.
5. The server agent gets the report within a minute, fixes, tests and releases. Quetta installs the fix by itself. Orion shows **⬇ Fix ready**. A fix that is data only (a link, a selector, a model name) reaches both at the next sync, with no install.

The same checklist runs in three places: on the tablet, in `npm test`, and in the server canary. We write each check once.

## What we already have

| Step | Today | Gap |
| --- | --- | --- |
| Checks | `npm test` (176 tests, fake `chrome`), **Check this browser** (`core/pages/check.js`), the `bgStuck` watchdog in `store.js`, the error line in `core/ui/boot.js` | Nothing checks real use on the tablet. A button that does nothing is not noticed. |
| Report | The parent types a note. It goes to `activity/<day>.json` with `context.screen` and `context.app`. | Only a person reports, and only after **↻ Update**. |
| Pick up | `agent/poll.sh` (cron, every minute) → `agent/notes.mjs` → the notes agent (`agent/NOTES.md`) | No reproduction harness for the real YouTube. |
| Release | The notes agent tests, raises the version, packs Quetta, builds Orion, pushes. Pages publishes `site/`. | Every fix is a full release. |
| Deliver | Quetta: `autoUpdate()` on the 15-min alarm. Orion: **↻ Update** opens the install page. | The parent does not learn that their problem is fixed. |

One fact makes the background part simple: every message goes through one function, `handle()` in `core/background/messages.js`. One wrapper there covers all background actions.

## Design

### 1. The checklist: one file per area

A **check** is a small object:

```js
{ id: 'header.appsToggle',            // stable name, used in reports and fixes
  area: 'header',                     // core, header, account, github, apps, parent, kid, youtube, ai, sync
  when: { click: 'apps button' },     // or { message: 'setMode' }, { start: 'install' }, { event: 'videoEnded' }
  within: 2000,                       // ms to wait for the result
  expect: 'the apps row shows or hides',
  check: async (before, after) => after.appsRowVisible !== before.appsRowVisible || 'the apps row did not change' }
```

`check` returns `true`, or a short text that says what it saw instead.

Files:
- `extension/core/checks/runner.js`: runs checks, keeps the results, cancels a check when the page closes or the parent leaves (that is not a failure).
- `extension/core/checks/core.js`: start, header, account, GitHub, apps, sync.
- `extension/apps/kidtube/checks.js`: the parent page, kid mode, videos, quiz, voice notes.
- `extension/apps/<app>/checks.js`: each new app brings its own list. An app without checks still gets the general rules below.

### 2. Four kinds of checks

| Kind | Where it runs | Example |
| --- | --- | --- |
| **Start checklist** | Background, on `onInstalled` (install and update) and on `onStartup` | The storage reads back what it wrote; the `poll` alarm exists; on Quetta the blocking rules are on; `latest.json` answers; GitHub answers when a token is set |
| **Action contracts** | Background, a wrapper around `handle()` | After `setMode` to `kid`: `settings.mode` is `kid` and the tab shows his list within 5 s |
| **Screen checks** | In the page (`core/ui/header.js`, `apps/kidtube/parent/kit.js`, the kid screens) | After a tap on **Load from GitHub**: the card shows "Loaded" or an error text within 15 s |
| **Outside checks (probes)** | Where the code already does the real work | On a watch page, a `video` element is found within 10 s |

**Two general rules** cover every button, also future ones:
- **No dead buttons.** After any tap on a KidTube button, something visible must change within 5 s: a new screen, a busy state, a toast, or new text. If nothing changes, this is `ui.deadButton` with the button's label.
- **No silent errors.** An uncaught error on a KidTube screen (`core/ui/boot.js`) or a background step that hangs (`bgStuck`) is a failure.

**False failures are not reported.** A check does not fail when:
- the device is offline (`navigator.onLine`, and a second simple request also fails);
- an AI service says 401 or 403 (a wrong key: that goes to the settings card, not to the agent);
- the page closed, the parent tapped somewhere else, or Orion froze the page before the time ran out (`document.visibilityState`);
- it failed only once. An outside check reports after 2 failures more than 1 minute apart. An action contract or a screen check reports at once, because it follows a real tap.

### 3. The checklist, first version

This is the list that F1 and F2 build. Each row is one check.

**Start (after install, update, browser start)**

| id | Expect | Within |
| --- | --- | --- |
| `start.worker` | The background answers `ping` | 2 s |
| `start.storage` | A value written to `chrome.storage.local` reads back the same | 1 s |
| `start.alarm` | The `poll` alarm exists with 15 min | 1 s |
| `start.rules` | Quetta: the blocking rules match the mode. Orion: skipped. | 2 s |
| `start.content` | An open YouTube tab answers from `shell.js` | 5 s |
| `start.latest` | `latest.json` answers, and its version is not lower than the installed one | 10 s |
| `start.github` | With a token: GitHub answers for the data repo | 10 s |
| `start.account` | On YouTube, the account check reports (signed in or not) | 10 s |
| `start.version` | After an update: the new version is the one in `latest.json`, and the settings, PIN and token are still there | 2 s |

**Header and account**

| id | When | Expect | Within |
| --- | --- | --- | --- |
| `header.shows` | A YouTube page or a KidTube page opens | The header is drawn | 3 s |
| `header.appsToggle` | Tap the round apps button | The apps row shows or hides, and the choice is saved | 2 s |
| `header.youtubeTile` | Tap **YouTube** | No app runs, and the tab is on YouTube's home | 5 s |
| `header.appTile` | Tap an app tile | That app runs, and its home screen shows | 5 s |
| `account.connect` | Switch the account with the site's own buttons, then tap **Connect** | That account's profile runs (loaded, or new and empty); the same one again says so | 15 s |
| `account.menu` | Tap the account button | The menu opens with the email and "checked HH:MM:SS" | 2 s |

**GitHub and settings file**

| id | When | Expect | Within |
| --- | --- | --- | --- |
| `github.connect` | Tap **Connect** with a token | The card says connected, and a sync starts | 15 s |
| `github.load` | Tap **Load from GitHub** | The rules and lists are loaded again, and `syncStatus.at` is new | 15 s |
| `file.load` | **Load from file** | The repo, the token hint and the PIN are set, and a sync starts | 15 s |
| `file.save` | **Save to file** | A file is offered for download | 3 s |

**Parent page**

| id | When | Expect | Within |
| --- | --- | --- | --- |
| `parent.open` | The parent page opens | The tabs, today's list and the bottom bar are drawn | 3 s |
| `parent.tab` | Tap a tab (Today, Planned, History, Context, Prompt, Settings) | That tab's section shows, and the URL has its `#tab` | 1 s |
| `parent.update` | Tap **↻ Update** | The button shows "AI is working…", or a newer app version is asked for | 5 s |
| `parent.toKid` | Tap **Kid** | The tab shows his list | 5 s |
| `parent.settingsSave` | Save a setting | The save bar hides, and the value reads back the same | 3 s |
| `notes.record` | Tap 🎤, speak, stop | A note appears in the held notes, or an error text shows | 30 s |

**Kid mode**

| id | When | Expect | Within |
| --- | --- | --- | --- |
| `kid.list` | His list opens | At least one card, or the "videos are over" screen | 5 s |
| `kid.open` | Tap a card | The video page opens, and a `video` element plays | 10 s |
| `kid.tick` | A video plays for 1 minute | `today.playedSeconds` grows | 70 s |
| `kid.ended` | A video ends | The quiz or the talk shows, or his list comes back | 5 s |
| `kid.timeUp` | The day's minutes are used | The lock screen shows | 5 s |
| `kid.blocked` | He opens a video not on his list | He is sent back to his list | 3 s |
| `kid.toParent` | Tap the parent button and enter the PIN | The parent page opens | 5 s |

**Outside things (probes)**

| id | Expect |
| --- | --- |
| `yt.player` | A `video` element is found by the known selectors |
| `yt.pageData` | `ytInitialPlayerResponse` has `videoDetails` |
| `yt.switcher` | `/getAccountSwitcherEndpoint` answers 200 with the expected shape |
| `yt.transcript` | `youtubei/v1/player` gives caption tracks for videos that have captions |
| `yt.url` | Every `youtube.com` URL matches a known shape in `core/lib/youtube.js` |
| `yt.thumb` | Card images from `i.ytimg.com` load |
| `gh.sync` | A sync ends with no error |
| `ai.<service>` | Gemini, OpenRouter and Groq answer, and the model is not "not found" |

### 4. The report

When a check fails, KidTube adds a `problem` event to the outbox and starts a sync within 10 s:

```json
{ "type": "problem", "check": "github.load", "fingerprint": "github.load|0.10.4|orion",
  "expect": "the rules and lists are loaded again", "saw": "syncStatus.at did not change; error: 404 Not Found",
  "action": { "kind": "click", "label": "Load from GitHub", "at": "2026-10-10T08:12:03Z" },
  "context": {
    "app":    { "version": "0.10.4", "target": "orion", "app": "kidtube", "mode": "parent", "profile": "<folder>" },
    "screen": { "page": "apps/kidtube/parent/parent.html", "tab": "settings", "card": "GitHub connection", "viewport": "1024x768" },
    "browser": { "userAgent": "…", "online": true, "language": "ru" },
    "steps":  [ { "at": "…", "kind": "message", "type": "header", "ok": true }, "… the last 30 steps …" ],
    "state":  { "sync": { "at": "…", "error": "…" }, "shell": { "on": true }, "bgStuck": null }
  } }
```

- **Steps.** A ring of the last 30 steps (messages, taps, page changes, check results). It is kept in `chrome.storage.session`, so it is gone after a browser restart.
- **No secrets.** A report never holds a token, a key, a PIN or PIN hash, the parent's notes or page text. A test checks this for every check in the list.
- **One report per problem.** A tablet sends a fingerprint (check, version, browser) once; a repeat only counts up on the tablet, until a new version comes (a new fingerprint). The server merges the same check from all tablets, handles a report once (a higher count later is not new), and tries a problem the agent gave no answer for again after 2 hours, at most 3 times.
- **The parent can report too.** **Report a problem** in the notes button sends a `problem` with the parent's words and the same context.

### 5. What the parent sees

| Moment | Where | What |
| --- | --- | --- |
| A check fails | A banner at the top of the screen for **15 seconds**, on the parent page, the PIN page and the YouTube header | "⚠ Load from GitHub did not work: 404 Not Found. Report sent. A fix comes as a new version." A tap on the banner shows the details. |
| Until the fix comes | The bottom bar, next to the version | "⚠ 1 problem · waiting for a fix". A tap lists the problems and their state. |
| The server works on it | Same list | **sent** → **working on it** → **fixed in 0.10.5** or **needs you** (with the agent's words) |
| The fix arrives | Quetta: a toast after the update. Orion: **⬇ Fix ready · 0.10.5** in the bottom bar. | "Fixed: Load from GitHub (0.10.5)." The mark goes away. |
| In kid mode | Nothing technical for the child | The report is still sent. The parent sees the banner the next time they open parent mode. |

### 6. The server: canary and fix lane

**Canary** (`agent/canary.mjs`, new). It loads the built extension in headless Chromium (Playwright, the same setup as our device tests). It opens the real YouTube and runs the start checklist and the outside checks. It runs:
- every 3 hours from cron, so the server often finds a YouTube change before the tablet does;
- before every fix, to reproduce the report;
- after every fix, against the new build.

There is no Google sign-in, so the account checks are run only for their response shape.

**Fix lane.** `agent/notes.mjs` learns the `problem` type. `agent/poll.sh` starts the fix agent (`agent/FIX.md`, new) at once for a new fingerprint. It does not wait for **↻ Update**, and it runs before the notes lane. Limits: `fixAgent.perDay` 6, and one run per fingerprint in 2 hours.

Rules in `agent/FIX.md`:
1. **Reproduce first** with `node agent/canary.mjs --check <id>`, or with a test in `tests/` built from the report's steps. If it cannot be reproduced, say so and change nothing.
2. **Prefer a data fix** in `site/remote.json` (part 7).
3. **Otherwise, make a small code fix.** Add a test that fails without the fix. When the check itself was wrong, fix the check and say so.
4. **Keep the child's protections.** Never turn off blocking, time limits, the PIN or kid mode to make a check pass. If the only fix weakens one, stop and say "needs you".
5. **Prove it:** `npm test`, `node build/orion-check.mjs`, the canary.
6. **Release** as in `agent/NOTES.md`. Add `"fixes": [fingerprints]` to `latest.json`.
7. **Write the result** to `fixes.json` in the data repo: the fingerprint, the state, the version, and one line for the parent.

### 7. Data fixes: `site/remote.json`

MV3 forbids running code from the network, but data from the network is allowed. The fragile **values** move into one file:

```json
{ "schemaVersion": 1, "minVersion": "0.10.6",
  "yt": { "playerSelectors": ["#movie_player video", "video.html5-main-video", "video"],
          "switcherPath": "/getAccountSwitcherEndpoint", "playerApi": "/youtubei/v1/player",
          "thumb": "https://i.ytimg.com/vi/{id}/hqdefault.jpg" },
  "ai": { "gemini": { "notes": "gemini-3.5-flash-lite", "transcribe": "gemini-3.5-transcribe" } } }
```

- Today's values stay in the code as **defaults**. A missing or broken file changes nothing.
- The tablet reads it with each sync and at the start of each session.
- A schema checks it. A value with a wrong shape is ignored.
- It can only **replace** a selector, a path, a URL template or a model name. It cannot turn a protection off.

### 8. When a fix makes it worse

- For 24 hours after a release, a new problem from that version is marked `regression: true`, with the last diff attached.
- A browser cannot install a lower version. A rollback is `git revert` plus a **higher** version number.
- `fixAgent.enabled: false` in `agent/config.json` stops the fix lane. The checks still report, and the parent still sees "sent".

## Phases

| Phase | Version | Work | Tests |
| --- | --- | --- | --- |
| F1 Checklist and start checks | 0.10.3 | `core/checks/runner.js`, the start checklist, a **Checks** list in **Check this browser** with ✓ / ✗ / skipped for each row. No reports yet. | The runner in `tests/extension/` with fake `chrome`: pass, fail, timeout, cancel, offline. |
| F2 Action and screen checks | 0.10.4 | The wrapper around `handle()`, the screen-check helper for buttons, the no-dead-buttons and no-silent-errors rules, the steps ring, the header / account / GitHub / parent / kid rows above, the probes. Results show only in **Check this browser**, so we can see false failures first. | Each check runs in `npm test` against the fake `chrome`, and once with a broken handler to see it fail. |
| F3 Report and banner | 0.10.5 | The `problem` event, dedup, send now, the 15-second banner, the bottom bar mark, **Report a problem**. `notes.mjs` reads `problem`. | The no-secrets test; an outbox test; a banner test in `tests/extension/parent.test.mjs`. |
| F4 Canary and fix lane | server | `agent/canary.mjs`, cron every 3 hours, `agent/FIX.md`, the fix lane in `poll.sh`, `fixAgent` in `config.json`, `fixes.json`. | A dry run: break a selector in a branch and check that the agent finds, fixes and releases it. |
| F5 Data fixes | 0.10.6 | `site/remote.json`, its schema, the loader with defaults. | A broken `remote.json` changes nothing. |
| F6 Fix arrives | 0.10.7 | `latest.json.fixes`, the urgent update on Quetta, **⬇ Fix ready** on Orion, the states from `fixes.json`, the "Fixed" toast. | `sw.test.mjs` for the urgent update; a parent page test for the states. |

F1 and F2 are useful alone: they show at once which parts work on a new device.

## Decisions (defaults chosen; change any of them before we start)

| # | Decision | Default | Why |
| --- | --- | --- | --- |
| D1 | Send a report without asking the parent | **Yes.** The banner says it was sent. | A fix is faster when nobody has to act first. The report has no secrets. |
| D2 | Show the banner in kid mode | **No.** The parent sees it on the next visit to parent mode. | The child cannot act on it. It would worry him. |
| D3 | Release without a person | **Yes** for data fixes and for code fixes that pass all tests and the canary. **No** when the fix touches blocking, limits, the PIN or kid mode. | Speed for the common case. Safety for the child's protections. |
| D4 | Turn on the reports at once | **No.** F2 shows the results only in **Check this browser** for a week. F3 turns on the reports. | We first remove the checks that fail by mistake. |
| D5 | Canary frequency | Every 3 hours | YouTube changes are rare, and a run costs almost nothing. |
| D6 | Fix agent limit | 6 runs a day, 1 per fingerprint in 2 hours | Stops a loop when a fix does not hold. |
| D7 | Messages outside the app | **None at first.** The banner and the bottom bar only. | Add e-mail or Telegram later if the parent wants it. |

## Risks

| Risk | What we do |
| --- | --- |
| Too many false failures (slow Wi-Fi, Orion frozen, the parent navigates away) | Offline, visibility and cancel rules; generous `within` times; D4 (one quiet week first); the canary must reproduce before a code change. |
| The checks slow the tablet down | A check reads storage and the page once, after the action. Probes reuse requests the code already makes. No timers when nothing happens. |
| The agent "fixes" by weakening a protection | Rule 4 in `FIX.md`; the blocking and limit tests must pass; D3. |
| A bad `remote.json` breaks every tablet at once | Schema, defaults in the code, `minVersion`, replace-only values. |
| A bad release on the Quetta tablets | The 24-hour watch, rollback by revert plus a higher version, `fixAgent.enabled`. |
| Secrets in a report | The no-secrets test runs over every check's report. |
| The checklist gets old | Each new feature adds its rows to its `checks.js` in the same change. `agent/NOTES.md` and `agent/FIX.md` say so. |

## Plan in ASD-STE100

**Goal.** KidTube must check each action against a written list. When a check fails, KidTube must send a report and show a banner for 15 seconds. The server agent must fix the problem. The tablet must get the fix.

**Phase F1: add the checklist and the start checks (version 0.10.3).**
1. Create `extension/core/checks/runner.js`.
2. Give each check an `id`, an `area`, a `when`, a `within` time, an `expect` text and a `check` function.
3. Make the `check` function return `true` or a short text that tells what it saw.
4. Cancel a check when the page closes or goes to the background.
5. Create `extension/core/checks/core.js` with the start checks: `start.worker`, `start.storage`, `start.alarm`, `start.rules`, `start.content`, `start.latest`, `start.github`, `start.account`, `start.version`.
6. Run the start checks on `onInstalled` and on `onStartup` in `core/background/main.js`.
7. Show each result as ✓, ✗ or skipped in `core/pages/check.js`.
8. Add tests in `tests/extension/` for pass, fail, timeout, cancel and offline.

**Phase F2: add the action checks and the screen checks (version 0.10.4).**
1. Wrap `handle()` in `core/background/messages.js` to run the action checks after each message.
2. Add a helper that runs a screen check after each button tap.
3. Add the rule "no dead buttons": after a tap, something visible must change within 5 seconds.
4. Add the rule "no silent errors": report uncaught errors and `bgStuck`.
5. Keep the last 30 steps in `chrome.storage.session`.
6. Add the checks for the header, the account, GitHub, the parent page and kid mode in `core/checks/core.js` and `apps/kidtube/checks.js`.
7. Add the probes for YouTube, GitHub and the AI services.
8. Do not fail a check when the device is offline.
9. Do not fail a check on a 401 or 403 from an AI service.
10. Show the results only in **Check this browser** for one week.
11. Run each check in `npm test`. Run each check once with a broken handler and make sure that it fails.
12. Risk: false failures. Remove or change each check that fails by mistake during the week.

**Phase F3: send the report and show the banner (version 0.10.5).**
1. Add the `problem` event to the outbox.
2. Put in the event: the check id, the fingerprint, the expected result, the actual result, the action, the app, the mode, the profile, the page, the tab, the browser and the last 30 steps.
3. Do not put a token, a key, a PIN, a PIN hash, notes or page text in the event.
4. Add a test that makes sure no secret is in any report.
5. Send each fingerprint only once. Count a repeat on the tablet only. A new version makes a new fingerprint.
6. Start a sync within 10 seconds after a `problem` event.
7. Show a banner for 15 seconds on the parent page, the PIN page and the YouTube header.
8. Do not show the banner in kid mode. Show it when the parent next opens parent mode.
9. Show "⚠ 1 problem · waiting for a fix" in the bottom bar until the fix arrives.
10. Add **Report a problem** to the notes button.
11. Change `agent/notes.mjs` to read `problem` events.

**Phase F4: add the canary and the fix lane (server).**
1. Create `agent/canary.mjs`. Load the built extension in headless Chromium with Playwright.
2. Run the start checks and the outside checks against the real YouTube.
3. Add a cron line that runs the canary every 3 hours.
4. Write `agent/FIX.md`.
5. Tell the agent to reproduce the problem first.
6. Tell the agent to use a data fix in `site/remote.json` when possible.
7. Tell the agent to add a test that fails without the fix.
8. Tell the agent never to weaken blocking, time limits, the PIN or kid mode.
9. Tell the agent to run `npm test`, `node build/orion-check.mjs` and the canary before a release.
10. Add the fix lane to `agent/poll.sh`. Start it at once for a new fingerprint.
11. Add `fixAgent` to `agent/config.json`: `enabled`, `perDay: 6`, 1 run per fingerprint in 2 hours.
12. Write each result to `fixes.json` in the data repo.
13. Test the lane: break a selector in a branch and make sure that the agent fixes and releases it.

**Phase F5: add data fixes (version 0.10.6).**
1. Create `site/remote.json`.
2. Move the YouTube selectors, the endpoint paths, the image URL and the AI model names into it.
3. Keep the current values in the code as defaults.
4. Read `remote.json` with each sync and at the start of each session.
5. Add a schema. Ignore a value with a wrong shape.
6. Do not let `remote.json` turn off a protection.
7. Add a test: a broken `remote.json` changes nothing.

**Phase F6: deliver the fix and tell the parent (version 0.10.7).**
1. Add `fixes` to `latest.json`.
2. On Quetta, when `fixes` names a problem from this tablet, ask for the update at once.
3. On Quetta, reload YouTube only when no video plays.
4. On Orion, show **⬇ Fix ready · <version>** in the bottom bar.
5. Read `fixes.json` with each sync.
6. Show the state of each problem: **sent**, **working on it**, **fixed in X** or **needs you**.
7. Show "Fixed: <action> (<version>)" when the fix is installed. Remove the mark from the bottom bar.

**When a fix makes it worse.**
1. For 24 hours after a release, mark each new problem from that version as `regression: true`.
2. To roll back, revert the commit and release it with a higher version number.
3. To stop the fix lane, set `fixAgent.enabled` to `false` in `agent/config.json`.
