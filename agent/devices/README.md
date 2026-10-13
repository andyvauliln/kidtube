# agent/devices/

Dev mode's server side (`docs/plans/DEVICE-BRIDGE.md`): the fix and notes agents test the real tablet. A tablet is
reachable only while its parent has **dev mode** on (apps header → account menu → Dev mode;
`extension/core/background/bridge.js`). Everything here is off when `devices.enabled` is false in `agent/config.json`.

| File | What it does |
| --- | --- |
| `relay.mjs` | The bridge server. Tablets connect to `wss://<relayUrl>` (nginx → `127.0.0.1:<port>/bridge`); it accepts one only when `devices/<device>/bridge.json` in the data repo says on, with the SHA-256 of the key the tablet sends. The agents' commands come on a unix socket (`<state>/devices/relay.sock`: `GET /devices`, `POST /cmd`). Every command goes to `<state>/devices/log/<device>.jsonl`. `agent/poll.sh` starts it every minute when it is not running, and again when `relay.mjs` changed |
| `mcp.mjs` | The `device_*` tools for Claude Code (MCP on stdio): list, state, storage, tabs, snapshot, tap, type, scroll, wait, errors, navigate, message, run checks, update, screenshot |
| `mcp.json` | `--mcp-config` for `claude -p`: the device tools and the lab's Playwright MCP (`agent/lab/`) |
| `common.mjs` | The settings (`devices` in `agent/config.json`), the paths, and a request to the relay |
| `setup-server.sh` | Once, as root: nginx on 443 for the relay's host name with a Let's Encrypt certificate (`sudo bash agent/devices/setup-server.sh`) |

Try it by hand: `claude --mcp-config agent/devices/mcp.json`, then ask for `device_list`.

What dev mode never does (the tablet refuses it, whatever the server asks): the PIN, the rules, the minutes, the
GitHub connection, the settings file, the reports, dev mode itself, and on YouTube or Instagram what acts for the
account (like, subscribe, follow, comment, share, send). Screen pictures need the parent's extra permission (the card's
**Allow screen pictures**); without it the agent reads the page as text.
