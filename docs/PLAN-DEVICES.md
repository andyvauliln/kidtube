# Plan: KidTube on Android and iPhone/iPad

*Written 2026-10-02, starting from version 0.6.1. Background: [ORION.md](ORION.md), [SAFARI.md](SAFARI.md), [HOW-IT-WORKS.md](HOW-IT-WORKS.md).*

## Goal

The same KidTube runs on his **Android** devices and his **iPhone/iPad**, with one list, one set of rules, one daily budget and one activity log. Nothing on the server side changes: the daily helper, the data repo, Gemini and the voices stay as they are.

## Decisions (defaults chosen; change any of them before we start)

| # | Decision | Default | Why |
| --- | --- | --- | --- |
| D1 | Which browser on each platform | **Quetta on Android, Orion on iPhone/iPad.** The same extension and the same .zip in both. | Already works (0.6.1). No Apple account, no app store, one codebase. |
| D2 | Background syncing | **None needed.** Sync when he uses it: on open, on return to the screen, and after each video. | iOS freezes Orion in the background, and Android stops browsers too. The helper runs once a day, so syncing on use is enough. |
| D3 | Daily minutes with two devices | **Shared**: one budget for the child, not one per device | Otherwise switching devices doubles his time |
| D4 | Watched videos with two devices | **Shared**: a video watched on one device disappears on the other | Same list everywhere |
| D5 | Updates on Orion | **By hand** from the install page when the parent page says *Install the new version*. Claude publishes a new Orion build when you say "update orion" (skill `update-orion`). | File-installed extensions probably don't update themselves. Revisit after P3: an unlisted Chrome Web Store listing (5 USD once) could make it automatic. |
| D6 | Keeping him inside KidTube | The device's own controls: **Family Link + screen pinning** on Android, **Screen Time + Guided Access** on iPhone/iPad | No extension can stop a child leaving the browser |

## Where we are (0.6.1)

| | Android (Quetta) | iPhone / iPad (Orion) |
| --- | --- | --- |
| Install | .crx or .zip from the install page | .zip from the install page (steps added in 0.6.1) |
| Kid flow | Works | Not yet tried on a real device |
| Other websites | Blocked before loading (blocking rules) | Sent back to the list by the navigation guard (0.6.1) |
| Sync | Browser start, a 15-min timer while Quetta runs, parent actions | Same, but the timer stops as soon as Orion leaves the screen |
| Two devices | Not handled: separate minutes, separate watched lists, and the activity `device` header is overwritten by whichever device writes last | Same |

## Phases

### P1. Sync on use (0.6.2)

So a device that was closed or frozen still shows today's list and sends what he did.

**Code** (`extension/core/background/main.js` unless noted):
1. **Sync when stale.** When any screen asks for `state` (`sw.js:219`) and the last sync (`syncStatus.at`) is older than 15 min, start a sync and answer right away from the cached data. The home screen already redraws when new data arrives (`ui/home.js`, `storage.onChanged`).
2. **One sync at a time.** If a sync is already running, a new request joins it instead of queueing another. Today `sync()` (`sw.js:522`) queues every request.
3. **Sync on return to the screen.** On `visibilitychange` to visible, `ui/home.js` and `content/content.js` ask for `state` at once, so a resumed Orion syncs immediately rather than within 30 s.
4. **Send events right after a video.** After `ended`, `quizResults` and `talkDone`, and when a session ends, flush the outbox within about 10 s. This only writes `activity/<day>.json`, not a full sync.
5. Keep the 15-min alarm and the startup sync as they are; they still help while the browser stays open.

**Tests** (new `tests/sync-on-use.test.mjs` with `tests/fake-chrome.mjs`):
- `state` with a sync older than 15 min calls the GitHub API; with a fresh one it doesn't.
- Two `state` calls during a running sync start only one sync.
- After `ended` and `quizResults`, the outbox is written without a parent action.

**Done when:** `npm test` passes, and in desktop Chrome: change `queue.json` on GitHub, wait 16 min, open youtube.com, and the new list shows with no Update press.

### P2. Orion hardening (0.6.2)

**Code:**
1. ~~Use the blocking rules only on Chromium.~~ **Done in 0.6.2** with a separate Orion build instead of browser detection: the build sets `TARGET = 'orion'`, which skips the blocking rules and keeps the navigation guard on. See [ORION.md → Two builds from one code](ORION.md#two-builds-from-one-code-062).
2. **Fallback for the page-world script.** If `content/main.js` hasn't reported a video's details within 5 s, the content script adds it as a `<script>` tag, which runs in the page world. `content/main.js` goes into `web_accessible_resources`. This keeps the real channel and length check where `world: "MAIN"` isn't supported.
3. **Which browser sent this.** **Partly done in 0.6.2:** `device.target` (`quetta` | `orion`). Still to do: `platform` (`android` | `ios` | `macos`), and showing it in the parent page's status panel.

**Tests:** guard used when `userAgentData` is missing (extend `tests/orion.test.mjs`); validator accepts the new optional fields.

**Done when:** tests pass; 0.6.2 is packed (`build/pack.mjs`) and on the install page.

### P3. Test on a real iPhone/iPad (go/no-go)

Install 0.6.2 in Orion and go through the checklist in [ORION.md → Unknowns](ORION.md#unknowns-test-on-the-ipad). The ones that decide go/no-go:

| Check | If it fails |
| --- | --- |
| youtube.com shows his list (content script + cover iframes) | **No-go for Orion.** Go to P6: the Safari extension or the web page. |
| Tap a video → friend screen → video with covers | No-go, as above |
| Other sites go back to the list; Screen Time "Allowed Websites Only" doesn't break YouTube | Rely on Screen Time alone, or adjust its list |
| Friend's voice and recordings play | The device voice is the fallback; note it |
| Speech recognition / OpenRouter recording | Typing is the fallback; note which works |
| Closed for 30 min, then opened: new list without Update (P1) | Fix P1 before going on |
| He can't switch KidTube off under Guided Access with the toolbar disabled | Accept the risk, or P6 Safari with MDM |

Write the results into `ORION.md` and the Orion table in `HOW-IT-WORKS.md` (replace every "may").

**Also on iPhone:** fullscreen video uses the system player, so the covers and the strip vanish while the video is fullscreen. Note whether he can reach anything from there; YouTube's own links stay hidden by our CSS.

### P4. Two devices, one child (0.7.0)

Only needed if he really uses more than one device. Skip it otherwise.

**Activity file** (`schemas/activity.schema.json`, `tools/validate.mjs`, `agent/lib/data.mjs`):
- Add `devices`: a map from `deviceId` to that device's header. Each device updates only its own entry. `device` stays (the last writer) so older files and the backup program keep working, and `schemaVersion` stays 1.
- The helper uses only the question types **every** device seen in the last 7 days can show (an intersection), instead of `devices.at(-1)` (`agent/kt.mjs:85`, `agent/run.mjs:134`).

**Shared minutes and watched list** (`extension/core/background/main.js`):
- On each sync, read today's `activity/<day>.json` (with an ETag, so usually free). From the **other** devices' events, take:
  - the seconds watched, which go into `today.playedSeconds` for the lock;
  - the videos that count as watched, which leave the list.
- Store this as `s.others = { date, playedSeconds, watched }`; `lockNow` and `kidList` use own + others.
- New events so other devices follow:
  - `timeUp` with reason `stoppedForToday` when the questions end the day;
  - a parent event `resetToday` when a parent presses *Reset today*, so every device clears the day.
- **Precision:** another device's minutes are known as of its last flush, which after P1 is the end of each video. At worst he gets one extra video's minutes on the other device. That's acceptable and goes in `HOW-IT-WORKS.md`.

**Tests:** two fake devices writing one day file: minutes add up, a video watched on A leaves B's list, *Reset today* on A clears B, and the header map keeps both devices.

**Done when:** tests pass, the validator accepts old and new files, and a real test with the tablet and the iPad on the same day shows one budget.

### P5. Set-up guides and docs

- **Install page** (`site/index.html`): one card per device, each with the lockdown steps:
  - **Android tablet or phone:** Quetta + KidTube; Family Link blocks the Play Store and other browsers and the YouTube app; screen pinning on Quetta.
  - **iPhone or iPad:** Orion + KidTube; Screen Time: Safari off, YouTube app and other browsers off, *Allowed Websites Only* (`youtube.com`, `accounts.google.com`, `andyvauliln.github.io` + `allowedSiteDomains`); Guided Access on Orion with the toolbar disabled.
- **`HOW-IT-WORKS.md`:** when a device syncs (P1); the Orion table with P3 results; how two devices share minutes (P4).
- **`README.md`:** "for Quetta" → "for Android (Quetta) and iPhone/iPad (Orion)".

### P6. Later options (only if a trigger happens)

| Option | Trigger | Work |
| --- | --- | --- |
| **Firefox on Android** instead of Quetta | Quetta stops being updated, or breaks the extension | Add `background.scripts` next to `service_worker` in the manifest; Mozilla signing (free, unlisted); test install from file on Android |
| **Safari extension** on iPhone/iPad ([SAFARI.md](SAFARI.md), option A) | P3 fails on the content scripts, or switching the extension off becomes a real problem (Safari can be locked *Always On* by MDM) | Apple Developer Program (99 USD a year); ZIP to App Store Connect; TestFlight; the small fixes listed in SAFARI.md |
| **Web page with YouTube's embedded player** ([SAFARI.md](SAFARI.md), option B) | Both browsers turn out fragile, or you want it on any device without installing anything | New page shell around the existing `ui/` screens and `lib/` logic; state in IndexedDB |
| **Own app** for Android and iOS | You need real background syncing, or control of fullscreen on iPhone | Biggest job: a WebView app (e.g. Capacitor) with the same screens; Android background jobs; iOS background refresh or a silent push after the helper's run; store or TestFlight distribution |

## Order and rough size

| Phase | Version | Size | Needs |
| --- | --- | --- | --- |
| P1 Sync on use | 0.6.2 | ~½ day | — |
| P2 Orion hardening | 0.6.2 | ~½ day | — |
| P3 Device test | — | 1 evening | The iPhone/iPad, with you |
| P4 Two devices | 0.7.0 | 1–2 days | Only if he uses two devices |
| P5 Guides and docs | 0.7.0 | ~½ day | P3 results |
| P6 | — | days to weeks | A trigger |

P1 and P2 ship together as 0.6.2, before the device test, so the test runs on the code we intend to keep.

## Risks

| Risk | Effect | What we do |
| --- | --- | --- |
| Orion's extension support is beta and from a small company | An Orion update could break KidTube on iPhone/iPad | P3 checklist re-run after big Orion updates; P6 Safari or the web page as the way out |
| Quetta is a small browser | Same, on Android | P6 Firefox |
| Manual updates on Orion are forgotten | The iPad runs an old version | The parent page already shows *Install the new version*; the helper can mention an old `extensionVersion` in *What the helper noticed* |
| Two devices write the same day file at once | GitHub returns 409 | Already retried 3 times (`flushOutbox`); events stay in the outbox until the next try |
| The child switches the extension off | No covers | Guided Access / screen pinning; gaps show up in activity, and the helper can flag a day with no events |
