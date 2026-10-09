# build/

Release tools. They read `extension/` and write into `site/`.

| File | What it does |
| --- | --- |
| `pack.mjs` | **Quetta release.** Signs `extension/` as a CRX3, writes the `.crx`, the same files as `.zip`, `updates.xml` and `latest.json` into `site/`, and removes older versions there. `npm run release:quetta` |
| `crx.mjs` | The CRX3 writer and zip builder (no dependencies) |
| `keygen.mjs` | Makes the signing key once. Keep the `.pem` out of git (`~/kidtube-key.pem`) |
| `build-orion.mjs` | **Orion release.** Copies `extension/` to `dist/orion`, sets `TARGET = 'orion'`, trims the manifest, zips it into `site/orion/` with `latest.json`. `npm run orion:build`; the Claude skill `update-orion` has the full steps |
| `orion-check.mjs` | Every `chrome.*` API the extension uses, looked up in `orion-apis.json`; fails on one Orion lacks unless the Orion build handles it. `npm run orion:check` |
| `orion-apis.json` | A dated snapshot of Kagi's Orion API support table |
| `build-mesh-avatar.mjs` | Bundles the mesh-avatar-studio engine into `extension/apps/kidtube/vendor/mesh-avatar/` (run it only to update the engine) |

## Release

1. Raise `version` in `extension/manifest.json` and commit.
2. `npm test`.
3. Quetta: `npm run release:quetta`, then commit `site/` as `quetta <version>: release`.
4. Orion (only when asked): follow `.claude/skills/update-orion/SKILL.md`.
5. Push `main`. `.github/workflows/pages.yml` publishes `site/`.

`dist/` is the build's scratch folder and is not in git.
