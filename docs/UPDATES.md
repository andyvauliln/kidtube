# How an update gets to the tablet

This document tells how a change goes from the code to the tablet, step by step. It covers the extension (Custom
Apps: KidTube, Instagram), the server's agents, and the rules that change without a release.

Kind: reference (kept current). As of 0.12.10, 2026-10-13.

## 1. Branches

| Branch | Where | Use |
| --- | --- | --- |
| `main` | GitHub (`origin/main`) and the server's checkout `~/youtube-wraper` | The only branch for releases. Every release, every agent and GitHub Pages use `main`. |
| `refactor` | Local only, worktree `~/youtube-wraper-refactor` | Old work (0.10 layout). It is merged into `main`. Do not use it. |
| `mesh-avatar` | Local only, worktree `~/youtube-wraper-mesh` | Old work (the moving avatar). It is merged into `main`. Do not use it. |

- There are no release branches and no tags. A version is a commit on `main` with a new number in
  `extension/manifest.json`.
- Three writers push to `main`: a person in a chat session, the fix agent, and the notes agent. They do not lock each
  other. Each one must do `git pull --rebase origin main` before `git push`. A conflict means that two writers changed
  the same lines: keep both changes, test again, then push.

## 2. The parts of a release

| Part | File | Who reads it |
| --- | --- | --- |
| Version number | `extension/manifest.json` → `version` | The browser, and the header (next to the logo) |
| Quetta package | `site/custom-apps-<version>.crx` (signed) and `.zip` | Quetta (Android) |
| Quetta update file | `site/updates.xml` | Quetta's own update check (`update_url` in the manifest) |
| Quetta newest version | `site/latest.json` | KidTube (`core/background/updates.js`) and the install page |
| Orion package | `site/orion/kidtube-orion-<version>.zip` and `kidtube-orion.zip` | Orion (iPad, iPhone, Mac), by hand |
| Orion newest version | `site/orion/latest.json` | KidTube on Orion, and the install page |
| Orion change list | `site/orion/CHANGES.md` | The parent |
| Install page | `site/index.html` | The parent: first install, and install by hand |

GitHub Pages publishes the folder `site/` at https://andyvauliln.github.io/kidtube/. The workflow
`.github/workflows/pages.yml` runs on each push to `main` that changes `site/`. It takes about 1 minute. The CDN can
keep an old file for up to 10 minutes.

## 3. Make a release

### 3.1 Version

1. Change the code in `extension/`.
2. Increase the last number of `version` in `extension/manifest.json` (0.12.9 → 0.12.10).
3. Run `npm test`. All tests must pass.
4. Commit as `<version>: <what changed>`.
5. Push to `main`. The workflow `.github/workflows/test.yml` runs the tests again on GitHub.

One version number is one set of files. Quetta and Orion use the same number. A version can be released for Quetta
only, for Orion only, or for both.

### 3.2 Quetta (Android)

1. Run `npm run release:quetta`. This is `node build/pack.mjs extension --key ~/kidtube-key.pem`.
2. The script signs the `.crx` with the key. The key keeps the extension id the same
   (`mpgpgldgfogdipaaaobleoppocmhlidp`), so a new version installs over the old one and the settings stay.
3. The script writes `site/custom-apps-<version>.crx`, `.zip`, `site/updates.xml` and `site/latest.json`.
4. Remove the old `.crx` and `.zip` from git (`git rm`).
5. Commit as `quetta <version>: release`, then push.
6. Wait for GitHub Pages. Check: `curl -s https://andyvauliln.github.io/kidtube/latest.json` shows the new version.

The key `~/kidtube-key.pem` is on the server only. Never commit it.

### 3.3 Orion (iPad, iPhone, Mac)

1. Follow the skill `update-orion` (`.claude/skills/update-orion/SKILL.md`).
2. `node build/orion-check.mjs` finds browser functions that Orion does not have.
3. `node build/build-orion.mjs` makes the Orion build: `TARGET = 'orion'`, no `update_url`, no
   `declarativeNetRequest`. It writes `site/orion/`.
4. Add a section to `site/orion/CHANGES.md`.
5. Commit as `orion <version>: <what changed>`, then push.

## 4. The tablet gets the new version

### 4.1 Quetta (Android)

```
GitHub Pages: latest.json, updates.xml, .crx
        │
        ▼
KidTube reads latest.json  ── when the header shows (every minute while a newer version waits),
        │                     every 15 minutes (alarm "poll"), and at the start
        ▼
newer than the installed version?
        │ yes
        ▼
KidTube asks Quetta: chrome.runtime.requestUpdateCheck
   once when the new version appears, then at most every 30 minutes, and at once on a tap
        │
        ├── "update_available" → Quetta downloads the .crx → onUpdateAvailable → KidTube restarts
        │                        → onInstalled("update") → KidTube reloads the open YouTube tabs
        ├── "throttled"        → Quetta refuses: it was asked too often. KidTube waits.
        └── "no_update"        → Quetta does not see it yet (the CDN can be 10 minutes behind).
```

The label above the version, next to the logo:

| Label | Phase | What the parent does |
| --- | --- | --- |
| (none, only `0.12.10`) | The newest version is installed | Nothing |
| `↓ 0.12.11 installing…` | Quetta said `update_available` less than 5 minutes ago | Wait. Custom Apps restarts by itself. |
| `↑ 0.12.11` | Quetta was asked and waits | Tap it to ask again now |
| `↑ 0.12.11 · by hand` | Not installed 10 minutes after the ask, or this copy was installed from a `.zip` | Tap it: the install page opens. Install the `.crx` (below). |

The App update row in the header's 🔔 list shows the same phase in words, with **Install now** and **By hand**.

**Install by hand (Quetta):**

1. Open https://andyvauliln.github.io/kidtube/ in Quetta.
2. Tap **Download .crx**.
3. Open Quetta's **⋮** menu → **Extensions**.
4. Install the file from **Downloads**.
5. Make sure the header shows the new version only.

The settings, the PIN and the lists stay, because the extension id does not change.

**Known limits (2026-10-13):**

- It is not proven that Quetta installs a new version by itself. On 2026-10-13 the tablet stayed on 0.12.2 for
  hours. Version 0.12.2 asked Quetta every 5 minutes, and Quetta answered `throttled`. 0.12.9 and later ask less often.
- A copy installed from a `.zip` is an unpacked copy (`installType: development`). Quetta never updates it. Install
  the `.crx` once to fix this.
- A tablet on 0.12.8 or older keeps the old way to ask. Install 0.12.9 or later by hand once.

### 4.2 Orion

Orion has no automatic update for a file install. The header compares the version with `site/orion/latest.json`. A
tap on the new version opens the install page. The parent downloads the `.zip` and installs it in Orion →
Extensions → **+**. Then the parent checks the PIN and the GitHub connection.

### 4.3 A copy from git (desktop Chrome, development)

The header compares the version with `extension/manifest.json` on GitHub's `main`. A tap opens
`chrome://extensions`. Run `git pull` in the folder, then press **Reload** on Custom Apps.

## 5. Who makes a release

| Who | When | What it releases |
| --- | --- | --- |
| A person in a chat session | On request. Standing rule since 2026-10-13: every change set is also released for Quetta. | Quetta; Orion only on request |
| The fix agent (`agent/FIX.md`) | A tablet sent a problem report (`problems/<day>.json` in the data repo). `agent/poll.sh` starts it within 1 minute. At most 6 runs a day. | Quetta and Orion |
| The notes agent (`agent/NOTES.md`) | The parent sent a note that asks for an app change. At most 10 runs a day. | Quetta and Orion |

The fix agent and the notes agent work in their own checkout (`~/.local/share/kidtube/app`). `poll.sh` resets it to
`origin/main` before each run. Only one agent runs at a time (`run.lock`). A chat session does not use this lock.

Before it changes code, the fix agent reads the recent commits and the newest release. A report from a version that
a newer release already fixed gets the answer "fixed in X". It does not get a second fix.

## 6. Updates without a new version

| What | File | How it gets to the tablet |
| --- | --- | --- |
| The Instagram reader's rules | `site/remote.json` (key `instagram.reader`) | KidTube reads it every 30 minutes (`core/background/remote.js`) |
| The fix agent's answers | `fixes.json` in the data repo | KidTube reads it every 2 minutes while a report waits |
| Lists, rules, run status, answers to questions | The profile's folder in the data repo (`kidtube-data`) | Each sync: every 15 minutes, and every minute while a question or a run waits |

## 7. The server's own code

- The cron runs `agent/poll.sh` from the main checkout `~/youtube-wraper`. A change to `poll.sh` is live when this
  checkout has it.
- After an agent run, `poll.sh` does `git pull --ff-only` in the main checkout, but only when the checkout has no
  local changes.
- The agents read `agent/FIX.md` and `agent/NOTES.md` from their own checkout. That checkout is reset to `origin/main`
  before each run, so a pushed change to these files is live at the next run.
- The nightly helper (`agent/daily.sh`, 03:30 UTC) runs from the main checkout.

## 8. Check that an update arrived

1. Look at the version next to the logo in the header. Only one version must show.
2. Read the tablet's problem reports in the data repo: `problems/<day>.json` → `context.app.version`,
   `context.app.installType` and `context.app.update` (the phase and Quetta's last answer).
3. If the version is old, look at `context.app.update.status`:
   - `throttled` or `no_update` for a long time: install by hand.
   - `installType: development`: install the `.crx` by hand once.
