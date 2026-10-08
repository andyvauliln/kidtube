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
  - They return the URL that opens Google's account chooser for that email (`chooser`), or, for an app that isn't on YouTube, that app's page (`open`). Since 0.9.5 the chooser comes back through YouTube's own sign-in handler, as YouTube's Sign in button does: `https://accounts.google.com/AccountChooser?service=youtube&Email=<email>&continue=https://m.youtube.com/signin?action_handle_signin=true&app=m&…&noapp=1`. Without it YouTube could keep the account it had.
  - While the hold is on, all of `google.com` is open (the sign-in can pass through www.google.com or gds.google.com); it closes when the account arrives or the hold runs out (alarm `profileHold`). The hold also remembers which account YouTube still shows (`seen`), and the switcher says so.
- **`removeProfile {key}`**: allowed only for a profile that isn't the current one. It deletes `acct:<key>` and its `accounts` entry, on the tablet only.
- **The `account` message from YouTube** (`sw.js:505`):
  - While `profileHold` is active, a report of a *different* account is ignored. Otherwise YouTube would switch back to the old profile before Google has finished the sign-in.
  - A report of the held account clears the hold.
  - When the hold has run out, it switches automatically, as it does today.

**Since 0.9.6:** a profile is an email *in one app*, so the same email can have a KidTube profile and a Blank one. KidTube's key stays the email (what YouTube reports); another app's is `<app>:<email>` (older tablets' Blank profiles are renamed on the first look, `migrateProfileKeys`). Data folders are unique within an app. Every switch to a profile with an email goes through Google's sign-in, Blank too. Google's steps on YouTube's hosts (`accounts.youtube.com`, `consent.youtube.com`, `/signin`, `/ServiceLogin`) are never redirected: before, kid mode sent `accounts.youtube.com/accounts/SetSID` "home" to `accounts.youtube.com/`, a Google 404 page, so every sign-in broke there.

**Since 0.9.7:** a switch no longer goes straight to Google. It opens YouTube, and while the profile waits for YouTube to have its email (`profileHold`, at most 15 min) KidTube steps aside there: no kid list, no parent page, no Blank page, no link blocking, YouTube's bottom tabs shown, `google.com` open. So YouTube's own Sign in and account switch work, and a bar at the bottom offers "Sign in as <email>" (Google's chooser) and Cancel. When YouTube names the profile's email (content.js asks again every 6 s while waiting) the wait ends and the app takes over: KidTube's screens, or the app's page (Blank). Cancel or the time running out also brings the app back; Profiles & apps then shows "YouTube now: …" and a "Sign in to YouTube as …" button (`startSignIn`). `ytAccount` keeps the account YouTube reported last. Before, kid mode covered YouTube with the kid list and swallowed every link, so the parent could not sign in, and a Blank page replaced YouTube before it could name the account.

**Since 0.9.8 (the apps header):** the YouTube account is the identity; profiles are no longer picked from a list. `shell` = `{ on, locked, why }`. With no app running (`on`), YouTube is plain YouTube with KidTube's header on top (content.js, closed shadow root; YouTube's fixed top bar is moved down by the header's height). The header: not signed in → "Sign in"; signed in, no GitHub token → "Connect GitHub" (the apps page, `apps/apps.html#github`); then this email's apps — local profiles plus `<app>/<folder>/profile.json` found in the data repo (`repoProfiles`, cached 10 min) — with ▶ Open (kid mode), "parent" (KidTube) and "+ Create" (a new profile for email × app, always opened in parent mode; the folder comes from the repo if it is there). Switch account (Google's chooser) and Sign out (`/<host>/logout`) are on the header too. While an app runs, YouTube naming another account (or being signed out) stops it: `shell.on` with `locked` when a PIN exists and parent mode is off, so YouTube is covered by "Ask a grown-up" until the PIN on the apps page; nothing switches by itself any more. The apps page (PIN unless parent mode or the header is open) has "⬆ Show the apps header" (`leaveApp`) and the one GitHub connection; the parent screens' 👤 chip, Settings and the Blank page lead to it. Blank writes its `profile.json` too, so the header finds it. Profiles & apps (0.9.5–0.9.7), `profileHold` and the sign-in bar are gone. A tablet from before 0.9.8 keeps running its profile (no `shell` key + an account = running); a fresh install starts at the header.

**Since 0.9.9 (the header's new design, from the parent's mockup):** one header, `extension/ui/header.js` (a plain script; YouTube's content script and the extension pages load it), drawn the same way above YouTube, the parent screens and the Blank page. It shows where the header may act (`headerOpen`: the unlocked `shell`, or parent mode) and never in kid mode. States: not signed in → logo + **Sign in**; signed in → the account (avatar, email, menu) + **Switch**; no GitHub token → the GitHub card (repo, token, **Connect**, **Load from file**, **Save to file**; `connectGitHub` checks the repo before it keeps the token); connected → the account's apps as round tiles (the running one ringed) + **Add app** (pick an app, then add: a new profile with no list — `emptyQueue` on the tablet, an empty `queue.json` and the default `parent-config.json` from the server's `init-profile`). A tile opens its app in parent mode; **Parent | Kid** sits top right of the app's own page (the parent toolbar, Blank), and the kid's screens have **🔒 Parent** top right (`parentGate`). One PIN page, `apps/apps.html?for=parent|unlock|kid|settings`; the extension's options page leads there. Settings lost everything that lives elsewhere now: Mode, Apps and accounts, Connection and the settings file (header), the helper-prompt box (Prompt tab) and the second AI box (only **Ask the AI** stays). Google stays open in parent mode too (`signingIn`), so **Switch** works there.
