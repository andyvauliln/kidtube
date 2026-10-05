# KidTube for Quetta

A YouTube wrapper for a child's Android tablet. A Chrome MV3 extension runs in Quetta and does what JSON files on GitHub say. A separately scheduled cloud agent rewrites those files.

- **PLAN.md**: the plan, the check of the original brief (C1–C24), data contracts, milestones
- **RESEARCH.md**: background research
- `schemas/`: JSON Schemas for `parent-config.json`, `queue.json`, `activity/YYYY-MM-DD.json`, `memory.json`
- `tools/validate.mjs`: schema and cross-file checks (`npm run validate -- <data-dir>`)
- `tools/keygen.mjs`, `tools/pack.mjs`: signing key, CRX3 packer, `updates.xml` and `latest.json`
- `spike/`: M0 go/no-go probe for Quetta (see spike/README.md)
- `extension/`: the product (0.1.0: kid home screen, navigation guard, leave lock, hours and daily minutes, GitHub sync, parent page)
- `tools/build-orion.mjs`, `tools/orion-check.mjs`: the Orion (iPad/iPhone/Mac) build of the same extension, published in `docs/orion/`, and its API compatibility check (see `docs/ORION.md`; Claude skill `update-orion`)
- `tools/video-info.mjs`: real title, channel and length for queue entries (`--search "query"`)
- `fixtures/`: good seed data (also the starting point for the private `kidtube-data` repo) and one bad fixture per check item
- `data-repo-template/`: CI workflow for the private data repo (live at andyvauliln/kidtube-data)

```bash
npm install
npm test
node tools/validate.mjs fixtures/good/data
```
