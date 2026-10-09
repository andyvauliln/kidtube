# KidTube for Quetta

A YouTube wrapper for a child's Android tablet. A Chrome MV3 extension runs in Quetta and does what JSON files on GitHub say. A separately scheduled cloud agent rewrites those files.

- **PLAN.md**: the plan, the check of the original brief (C1–C24), data contracts, milestones
- **RESEARCH.md**: background research
- `schemas/`: JSON Schemas for `parent-config.json`, `queue.json`, `activity/YYYY-MM-DD.json`, `memory.json`
- `tools/validate.mjs`: schema and cross-file checks (`npm run validate -- <data-dir>`)
- `build/keygen.mjs`, `build/pack.mjs`: signing key, CRX3 packer, `updates.xml` and `latest.json`
- `extension/`: the product. `sw.js` wires the browser's events to `sw/` (store, session = the kid's rules and the URL guard, sites, profiles and the apps header, parent mode's data, GitHub sync, transcripts, media, updates, messages = one handler per message type); `lib/` holds the pure helpers shared with the tools and tests; `ui/` the kid's screens (`render.js` + `ui.css` draw them both in the extension pages and in the in-page panels on Orion), the talking friend and the apps header; `content/` the scripts on youtube.com; `parent/`, `settings/`, `apps/` the parent screens, the settings view and the one PIN page
- `build/build-orion.mjs`, `build/orion-check.mjs`: the Orion (iPad/iPhone/Mac) build of the same extension, published in `site/orion/`, and its API compatibility check (see `docs/ORION.md`; Claude skill `update-orion`)
- `tools/video-info.mjs`: real title, channel and length for queue entries (`--search "query"`)
- `fixtures/`: good seed data (also the starting point for the private `kidtube-data` repo) and one bad fixture per check item
- `data-repo-template/`: CI workflow for the private data repo (live at andyvauliln/kidtube-data)

```bash
npm install
npm test
node tools/validate.mjs fixtures/good/data
```
