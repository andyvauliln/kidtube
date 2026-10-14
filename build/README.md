# build/

Release tools. They read `extension/` and write into `site/`.

| File | What it does |
| --- | --- |
| `ship.mjs` | **Push and release, for every writer.** Rebase, next free version, `npm test`, push the code, then the Quetta release (`--orion`: also Orion), push; under a lock so writers take turns. `verify`: is `main`'s release made from `main`'s code. `pre-push`: the git hook (`.githooks/pre-push`). `npm run ship -- -m "summary" -t "what to test"` (both go into `latest.json` changes, shown in the app) |
| `pack.mjs` | **Quetta release.** Signs `extension/` as a CRX3, writes the `.crx`, the same files as `.zip`, `updates.xml` and `latest.json` into `site/`, and removes older versions there. `npm run release:quetta` |
| `crx.mjs` | The CRX3 writer and zip builder (no dependencies) |
| `keygen.mjs` | Makes the signing key once. Keep the `.pem` out of git (`~/kidtube-key.pem`) |
| `build-orion.mjs` | **Orion release.** Copies `extension/` to `dist/orion`, sets `TARGET = 'orion'`, trims the manifest, zips it into `site/orion/` with `latest.json`. `npm run orion:build`; the Claude skill `update-orion` has the full steps |
| `orion-check.mjs` | Every `chrome.*` API the extension uses, looked up in `orion-apis.json`; fails on one Orion lacks unless the Orion build handles it. `npm run orion:check` |
| `orion-apis.json` | A dated snapshot of Kagi's Orion API support table |
| `build-mesh-avatar.mjs` | Bundles the mesh-avatar-studio engine into `extension/apps/kidtube/vendor/mesh-avatar/` (run it only to update the engine) |

## Release

1. Commit the change (not the version, not `site/`).
2. `npm run ship -- -m "<what changed>"`: version, tests, push, Quetta release, push (`docs/UPDATES.md` section 3).
3. Orion (only when asked): add `--orion`, and follow `.claude/skills/update-orion/SKILL.md` for what to check.

`.github/workflows/pages.yml` publishes `site/`.

`dist/` is the build's scratch folder and is not in git.
