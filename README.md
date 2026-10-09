# KidTube

A safe YouTube for a child's tablet. A browser extension shows only the videos on the child's list, with time
limits, a talking friend and questions after a video. A daily helper on a server plans the list. The parent
steers everything from parent mode on the tablet.

The extension is a small platform for apps: the **core** (accounts, the apps header, the PIN, sync, updates) runs
every **app** (today: KidTube on YouTube, and a blank test app). See `extension/README.md`.

## How the parts talk

```
 tablet (Quetta / Orion)                    GitHub                         this server
 ┌──────────────────────┐   sync   ┌──────────────────────┐   git   ┌──────────────────────┐
 │ extension/           │ <──────> │ kidtube-data (private)│ <─────> │ agent/ (daily helper) │
 │  core + apps/kidtube │          │  <app>/<profile>/...  │         │  Claude Code + kt.mjs │
 └──────────────────────┘          └──────────────────────┘         └──────────────────────┘
            ^ installs and updates from
 ┌──────────────────────┐
 │ site/ (GitHub Pages)  │  install page, updates.xml, latest.json, the current release
 └──────────────────────┘
```

The parts never call each other. Everything goes through files in the private data repo. The file formats are
in `schemas/`.

## Folders

| Folder | What is inside |
| --- | --- |
| `extension/` | The browser extension: `core/` for every app, `apps/` for each app |
| `agent/` | The daily helper on the server (plans the list, writes the friend's words, records voices) |
| `schemas/` | JSON Schemas of the files in the data repo |
| `site/` | What GitHub Pages publishes: the install page and the releases |
| `build/` | Release tools: pack and sign for Quetta, the Orion build, the Orion API check |
| `tools/` | Developer tools: the data validator, real video details from YouTube |
| `tests/` | `node --test` tests, by area, with fixtures |
| `data-repo-template/` | Starter files and CI for the private data repo |
| `docs/` | Longer texts: how it works, configuration, Orion, plans |

Each folder has a `README.md` that says how it works and what is inside.

## Commands

```bash
npm install
npm test                              # all tests
npm run validate -- tests/fixtures/good/data
npm run orion:check                   # chrome.* APIs the Orion build can't use
npm run release:quetta                # sign and pack into site/ (needs ~/kidtube-key.pem)
npm run orion:build                   # the Orion release into site/orion/ (Claude skill: update-orion)
```

## Publishing

`site/` is published by `.github/workflows/pages.yml` on every push to `main` that changes it. GitHub Pages must
use **Source: GitHub Actions** (repo Settings → Pages). Until 0.10.0 Pages served `main /docs`; switch the source
once, when this layout reaches `main`, or installed tablets stop finding `updates.xml`.
