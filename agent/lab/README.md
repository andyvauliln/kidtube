# agent/lab/

The lab browser (`docs/plans/DEVICE-BRIDGE.md` part 3): Chromium on this server with a checkout's `extension/`, for
the agents when no tablet is connected and to try a build before `npm run ship`. The agents drive it with Playwright
MCP (`agent/devices/mcp.json` "lab": `browser_snapshot`, `browser_click`, `browser_console_messages`, …).

| Command | What it does |
| --- | --- |
| `node agent/lab/lab.mjs --detach --profile kidtube/<folder>` | Starts it in the background with that profile's data from the data repo, **read only** (`settings.readOnly`: the app writes nothing to GitHub and sends no report), and prints `{ cdp, extensionId, page, synced }` |
| `node agent/lab/lab.mjs --detach` | A fresh tablet: no GitHub, the apps header's first screen |
| `node agent/lab/lab.mjs --stop` | Stops it |

A new start replaces the lab that runs (one at a time, CDP on port 9333). The browser profile is new each start
(`<state>/lab/profile-*`). No Google or Instagram sign-in: YouTube's pages see nobody signed in, so the account checks
are for shape only; the extension's own pages work fully.

The browser is Playwright's Chromium in `~/.cache/ms-playwright`. This server lacks two of its libraries; they were
unpacked without root into `~/.local/share/kidtube/lab/root` (`apt-get download libgbm1 libwayland-server0`, then
`dpkg-deb -x <deb> ~/.local/share/kidtube/lab/root`), and `lab.mjs` adds them to `LD_LIBRARY_PATH`.
