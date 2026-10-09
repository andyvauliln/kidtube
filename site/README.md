# site/

What GitHub Pages publishes at https://andyvauliln.github.io/kidtube/ (workflow `.github/workflows/pages.yml`).
Installed tablets read these addresses, so the names must not change.

| File | Read by |
| --- | --- |
| `index.html` | The install page: one card per device, the steps to lock it down. `core/content/backup.js` keeps the connection's copy here |
| `updates.xml` | Quetta's built-in updater (`update_url` in the manifest) |
| `latest.json` | KidTube's update check: the newest version, its files and quiz types |
| `kidtube-<version>.crx` / `.zip` | The current Quetta release |
| `orion/latest.json`, `orion/kidtube-orion-<version>.zip`, `orion/kidtube-orion.zip` | The Orion release (the last name never changes) |
| `orion/CHANGES.md` | What changed in each Orion version, for the parent |

Only the release tools in `build/` write here. Older releases are removed; git history keeps them.
