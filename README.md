# KidTube for Quetta

A YouTube wrapper for a child's Android tablet. A Chrome MV3 extension runs in Quetta and does what JSON files on GitHub say. A separately scheduled cloud agent rewrites those files.

- **PLAN.md**: the plan, the check of the original brief (C1–C24), data contracts, milestones
- **RESEARCH.md**: background research
- `schemas/`: JSON Schemas for `parent-config.json`, `queue.json`, `activity/YYYY-MM-DD.json`, `memory.json`
- `tools/validate.mjs`: schema and cross-file checks (`npm run validate -- <data-dir>`)
- `tools/keygen.mjs`, `tools/pack.mjs`: signing key, CRX3 packer, `updates.xml` and `latest.json`
- `spike/`: M0 go/no-go probe for Quetta (see spike/README.md)
- `extension/`: the product (so far: `default-config.json`, `lib/merge.js`)
- `fixtures/`: good seed data (also the starting point for the private `kidtube-data` repo) and one bad fixture per check item
- `data-repo-template/`: CI workflow to copy into `kidtube-data`

```bash
npm install
npm test
node tools/validate.mjs fixtures/good/data
```
