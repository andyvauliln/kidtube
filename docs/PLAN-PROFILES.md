# Profiles: switch to another email from parent mode, each with its own data and helper

*Written 2026-10-06, starting from version 0.8.7. Background: [HOW-IT-WORKS.md](HOW-IT-WORKS.md), [CONFIGURATION.md](CONFIGURATION.md), [PLAN-DEVICES.md](PLAN-DEVICES.md).*

## Status (2026-10-06)

**Released and migrated:**
- 0.9.0 is released for Quetta (it updates itself) and Orion (download it by hand).
- The data now lives in `kidtube-data/kidtube/johnnypitt.ind/`, and its server state in `state/kidtube/johnnypitt.ind/`.
- `agent/config.json` has `"profiles": ["kidtube/johnnypitt.ind", "kidtube/*"]`, so a new profile gets helper runs once the tablet has written its `profile.json`.

**Checks:**
- Tests: `npm test` passes (132 tests). New tests are in `tests/parent.test.mjs` (Profiles) and `tests/profiles.test.mjs` (server side, `migrate-root`, `init-profile`).
- Desktop Chromium with the extension loaded (Playwright):
  - adding an email switches the profile, keeps parent mode on and starts an empty history;
  - Google's sign-in opens with that email filled in;
  - switching back brings the first profile's history back;
  - Settings shows the profile's folder.
- `claude -p` passes `KIDTUBE_PROFILE` on to the commands it runs.
- After the migration, one `poll.sh` cycle ran for the profile, and `kt.mjs start` read it: 10 today, 25 ideas, all 5 context documents.

**Not checked on a device yet:**
- Google's account chooser inside Quetta and Orion, and YouTube then reporting the new email.
- The first sync of a brand-new profile from the tablet (it writes `profile.json`).

**Differences from the plan below:**
- No code is gated by app yet. There is only one app; the registry, the `app` field and the folders are in place.
- The context documents on the tablet (`contextDocs`) are now per profile. Before, every account on the tablet shared one copy.
- `run.mjs` keeps its own pid lock in `run.pid`. It used to write into, and then delete, the `run.lock` file that `daily.sh` and `poll.sh` lock.
- `poll.sh` and `daily.sh` loop over the profiles. A profile's run asked for from parent mode runs only that profile.
- Still assumes a 4–5-year-old: the backup program's prompts (`agent/lib/prompts.mjs`, used only when Claude can't run). Claude's prompts now take the child from `context/kid.md`.

## Context
Today the tablet already keeps settings, lists, history and memory per YouTube email (`useAccount` in `extension/sw.js:57-95`). But:
- the only way to change the account is to change it in YouTube, and nothing shows the known accounts;
- `mode`, `repo` and `token` are stored per account. A new account starts in kid mode with no token, so it can't sync and it kicks the parent out of parent mode. This is also a suspect in the open "parent mode doesn't turn on" bug;
- the data repo (`kidtube-data`) and the helper (`agent/`) work for one child only: files sit at the repo root, there is one state folder, and the prompts hard-code "a 4–5-year-old boy".

**Goal:** in parent mode, the parent picks a known email or adds a new one. A new profile starts fresh, with its own settings, lists, history, memory, context documents and helper runs. YouTube is then asked to sign in to the same Google account.

**Data layout (your choice):** one repo, one folder per profile: `kidtube-data/<app>/<email name part>/`. For example, `johnnypitt.ind@gmail.com` gets `kidtube/johnnypitt.ind/`.

**Helper:** `agent/config.json` lists the profiles to run, and it runs them one after another.

**Other apps:** this change only lays the groundwork. Each profile has an `app` (`"kidtube"` for now), and app-specific parts are looked up through a small registry on both sides. No second app is built.

## 0. Save this plan in the project
The first step is to copy this plan to `docs/PLAN-PROFILES.md`, next to `docs/PLAN-DEVICES.md`. Then mark it as done there, step by step, as the work goes on.

## 1. Profile model (extension)
- `extension/lib/account.js`: add `profileFolder(email, datasyncId, taken)`.
  - It uses the email's name part, lowercased, with characters other than `[a-z0-9._-]` turned into `-`.
  - If that name is already taken by another email, it adds `-<first part of the domain>`.
  - If there is no email, it uses `yt-<id>`.
  - The folder is assigned once and saved, and never computed again. A `yt:` profile that later gets its email keeps its folder.
- New `extension/lib/apps.js`: the app registry, for now `{ kidtube: { id, label: 'KidTube (YouTube)', sites: ['youtube.com'], contextDocs: [...] } }`. `CONTEXT_DOCS` moves here from `sw.js:868`. Code that is only for KidTube (site rules, the guard, talk/quiz) runs only when `APPS[account.app]` is kidtube. A future app adds an entry here.
- `accounts[key]` and `account` get two new fields: `app` (default `'kidtube'`) and `folder`.
- **Settings that belong to the device:** add `mode`, `parentUntil`, `repo` and `token` to `DEVICE_SETTINGS` (`sw.js:61`), so they carry over on every switch.
  - The PIN and `deviceId` already work this way.
  - This keeps the parent in parent mode after a switch, and keeps sync working for a new profile.
  - The settings backup (`settings.js:281`) keeps working as it is.

## 2. Switching from parent mode
New messages in `sw.js` (allowed only from extension pages, `fromExtensionPage`, and only in parent mode):
- **`profiles`**: the list of known profiles (email, name, app, folder, lastSeen) and which one is current.
- **`switchProfile {key}`** and **`addProfile {email, app}`**:
  - Both call the existing `useAccount` (marked as "by the parent"), which already saves the current data under `acct:<cur>` and loads the other profile's data, or empty data for a new one. A new email gets nothing copied over (a fresh start).
  - Then they set the device-level key `profileHold = { key, until: now + 15 min }`.
  - They return the URL that opens Google's account chooser for that email: `https://accounts.google.com/AccountChooser?Email=<email>&continue=https://m.youtube.com/`.
- **`removeProfile {key}`**: allowed only for a profile that isn't the current one. It deletes `acct:<key>` and its `accounts` entry, on the tablet only.
- **The `account` message from YouTube** (`sw.js:505`):
  - While `profileHold` is active, a report of a *different* account is ignored. Otherwise YouTube would switch back to the old profile before Google has finished the sign-in.
  - A report of the held account clears the hold.
  - When the hold has run out, it switches automatically, as it does today.

The parent screen (`extension/parent/parent.js` + `parent.html`):
- The account line `#who` (`parent.js:74`) becomes a button that opens a **Profiles** panel:
  - each profile shows its email, app and data folder, with ✓ on the current one;
  - **Switch**;
  - **Add profile**, with an email field and an app select that only has KidTube for now;
  - **Remove**, behind a confirm.
- After a switch, the panel opens the chooser URL in the same tab. The parent screen comes back with the new profile, because YouTube home in parent mode opens the parent screens.
- The panel also says: "If YouTube doesn't ask, tap your avatar → Switch account".

## 3. Paths in the repo (extension)
- Add one helper in `sw.js`: `dataPath(account, p) = `${account.app}/${account.folder}/${p}``.
- Use it in every repo path:
  - `fetchDataFile` (`:858`), `pullContext` (`:876`), `getRepoFile`/`putRepoFile` (`:1077`, `:1087`);
  - `requestRun` (`:1043`), `flushOutbox` (`activity/`), `uploadTranscripts`, `pullPlan`;
  - `syncAudio`, and the `repo:audio/…` and `repo:characters/…` links in `loadCharacter`.
- On a profile's first sync, if `<folder>/profile.json` is missing, the extension writes it: `{schemaVersion, app, email, name, createdAt}`. That is how the helper learns about the new profile and its email.
- If there is no folder yet, the profile runs on the bundled defaults. That is the "all new" start.
- Settings → Connection (`settings/settings.js:152`, `:207`, `:242`):
  - repo and token are labeled as shared by all profiles;
  - the data folder is shown read-only.

## 4. Helper (agent/)
**`agent/config.json`:**
- Add `"profiles": ["kidtube/johnnypitt.ind"]`. An entry can be `"kidtube/*"` (every folder under `kidtube/` that has a `profile.json`), or an object `{ "path": "kidtube/x", "defaults": { … } }` to override `defaults` for that child (for example `languageMins`).
- Add `"apps": { "kidtube": { "daily": "agent/DAILY.md", "system": "agent/SYSTEM.md", "fallback": "agent/run.mjs" } }`. This is the agent side of the registry. No files are moved.

**New `agent/lib/profile.mjs`:**
- `resolveProfiles(config, cloneRoot)` expands the list.
- `profileEnv(p)` gives the profile's paths:
  - `dataDir = <clone>/<app>/<folder>`;
  - `stateDir = <state>/<app>/<folder>`;
  - shared across profiles: the clone root, `models.json`, `gemini-usage.json` (the API quota) and `helper.log`.

**`kt.mjs`, `run.mjs`, `runlog.mjs`:** they read `KIDTUBE_PROFILE` (for example `kidtube/johnnypitt.ind`).
- `syncClone` and `commitAndPush` (`agent/lib/data.mjs`) keep using the clone root.
- All data paths, validation (`kt.mjs:334`) and per-run state (`session.json`, `last-save`) use the profile's folders.
- New command `kt.mjs init-profile`: if the profile folder has no `queue.json`, `memory.json` or `context/*.md` yet, it seeds them from a new template, `data-repo-template/kidtube/`. Its `context/kid.md` says "Not filled in yet: add notes in parent mode → Context".

**`daily.sh`:** loops over the resolved profiles. For each one, it sets `KIDTUBE_PROFILE`, `KIDTUBE_DATA_DIR` and `KIDTUBE_STATE_DIR` and runs the app's daily and system prompts from `config.apps`.
- One global `run.lock` (runs happen one at a time, so `/tmp/kidtube-in` stays safe).
- `last-save` and the `run.mjs` fallback are checked per profile.
- Log lines are tagged `[kidtube/johnnypitt.ind]`.

**`poll.sh`:** keeps its single `git ls-remote` and pull on the clone root, then checks each profile's `requests/run.json` against that profile's `last-request` and `on-demand` count. It writes the profile's `run-status.json` and runs `daily.sh` for that profile only (`KIDTUBE_ONLY_PROFILE`).

**Prompts written for one child:** `SYSTEM.md:3,17`, `lib/prompts.mjs:7,147-158,198`, `.claude/skills/helper-write-words/SKILL.md:19`, and the "he/his" in `DAILY.md`. These change to "the child described in `context/kid.md`" (age, languages, interests). The current boy's details move into his `context/kid.md`, which already has most of them.

**Checks:** `tools/validate.mjs` validates one profile folder when given one, and every `<app>/<folder>` when given the repo root. The data repo's CI (`.github/workflows/validate.yml`) keeps calling it on the root. Add `schemas/profile.schema.json`.

## 5. Moving the current data (once)
New command `node agent/kt.mjs migrate-root kidtube/johnnypitt.ind`:
- It runs `git mv` on every root data file and folder (`parent-config.json`, `queue.json`, `memory.json`, `helper.json`, `runs.json`, `run-status.json`, `activity/`, `context/`, `characters/`, `transcripts/`, `audio/`, `requests/`) into the folder.
- It writes `profile.json` with that email, commits and pushes.
- It also moves the matching state files on the server into `state/kidtube/johnnypitt.ind/`.

**Release order:**
1. Build 0.9.0 for Quetta, and for Orion (skill `update-orion`).
2. Run the migration right after publishing.

Older versions sync from the root. Until they update, they get "not found" sync errors. Events waiting on the tablet stay in the outbox and are sent after the update, so nothing is lost. The tablet auto-updates through `update_url`; Orion has to be installed by hand.

## Files touched (main ones)
- **Extension:** `extension/sw.js`, `extension/lib/account.js`, new `extension/lib/apps.js`, `extension/parent/parent.js`/`.html`/`.css`, `extension/settings/settings.js`, `extension/manifest.json` (0.9.0)
- **Agent:** `agent/config.json`, new `agent/lib/profile.mjs`, `agent/kt.mjs`, `agent/run.mjs`, `agent/runlog.mjs`, `agent/daily.sh`, `agent/poll.sh`, `agent/SYSTEM.md`, `agent/DAILY.md`, `agent/lib/prompts.mjs`, `.claude/skills/helper-*`
- **Checks and templates:** `tools/validate.mjs`, new `schemas/profile.schema.json`, new `data-repo-template/kidtube/`
- **Docs:** `docs/CONFIGURATION.md`, `docs/HOW-IT-WORKS.md`, `agent/README.md`

The working tree already has uncommitted changes (voice, options, parent, kt.mjs). This work goes on top of them; I won't revert them.

## Verification
- **`npm test`** (with `tests/fake-chrome.mjs`):
  - **`sw.test.mjs`:**
    - add a profile, then a fresh start: default queue, no history;
    - after a switch, parent mode, PIN, repo and token are kept;
    - while the hold is active, YouTube's report of the old account is ignored, and it is cleared when the held account is reported;
    - switching back brings the first profile's data back;
    - every GitHub URL has the `kidtube/<folder>/` prefix;
    - `profile.json` is written on the first sync.
  - **`logic.test.mjs`:** `profileFolder` (dots, collisions, `yt:` profiles).
  - **`agent.test.mjs`:** `resolveProfiles` (list, `*`, per-profile overrides); `kt.mjs` paths under `KIDTUBE_PROFILE`; `migrate-root` on a temporary git repo.
  - **`validate.test.mjs`:** a repo root with two profile folders.
- **Desktop Chromium with Playwright** (as in earlier sessions):
  1. Load the unpacked extension and turn on parent mode.
  2. Add `test2@example.com`: the Profiles panel shows two profiles, Today shows the default list, and parent mode stays on.
  3. Switch back: the old lists come back.
  4. Check that the chooser URL opens.
- **Helper:**
  1. Run `KIDTUBE_DRY_RUN`, or `node agent/kt.mjs info` with `KIDTUBE_PROFILE=kidtube/johnnypitt.ind`, against a copy of the clone after a test migration in the scratchpad.
  2. Run `daily.sh` with two profiles in config and the runner stubbed: each profile runs in turn with its own state folder.
- **On the device (can't be checked here):** whether Google's AccountChooser with `Email=` works inside Quetta and Orion, and whether YouTube then reports the new email. I'll list this as untested when reporting.
