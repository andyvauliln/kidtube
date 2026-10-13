# Plan: the fix agent connects to the real tablet (device bridge + MCP), and to a lab browser

*Written 2026-10-13, starting from version 0.12.14. Replaces the `agent/canary.mjs` idea of [FAST-FIX.md](FAST-FIX.md) part 6.*

*Status 2026-10-13: P1–P4 built in one change (the tablet side, the relay, the `device_*` tools, the agents' wiring,
the lab). Tested: the fake browser (`tests/extension/bridge.test.mjs`), the relay and MCP server
(`tests/agent/relay.test.mjs`), and end to end in the lab (a tablet in Chromium → a local relay → snapshot, tap,
refusals, navigate, off). Waiting: nginx and the certificate on this server (`sudo bash agent/devices/setup-server.sh`,
root), then a first session on the real Quetta tablet; P5 (Orion). Built differently from the plan below:*
- *The Dev mode card is in the apps header (account menu → Dev mode), for every app, not in KidTube's Settings.*
- *No systemd unit: `agent/poll.sh` starts the relay every minute when it is not running (and again when `relay.mjs` changed).*
- *Screen pictures need the optional `<all_urls>` permission (the card's **Allow screen pictures**); a required one would turn the app off on update until the parent accepts.*
- *The lab is always read only (a real profile, or a fresh tablet with no GitHub): a lab with writes would send reports and start the fix agent on itself.*
- *No `device_end` and no `device_request`: the pages' "AI is testing · Stop" turns dev mode off; the agents do not ask for a session.*

## Context

Today the fix agent (`agent/FIX.md`) and the notes agent (`agent/NOTES.md`) only read a report and reproduce it in
`tests/` with the fake browser (`tests/helpers/fake-chrome.mjs`). That is not enough:

- The app needs the accounts that live on the tablet: YouTube/Google sign-in, Instagram sign-in, the profile folder,
  the GitHub connection. The server has none of them, and YouTube blocks server IPs.
- Many errors come from one concrete device (slow tablet, Quetta version, Orion, its storage). The agent cannot see
  that device, cannot repeat the taps from `steps`, and cannot confirm on it that the new version fixed the problem.

Goal: when a report or a note comes from a device, the agent can **connect to that device** through MCP tools:
read its state, see the page, tap buttons, open app links, run the checks, and check the fix after the update. For
work without a device (a candidate build before release, a device that is offline), the agent also gets a **lab
browser** on the server with the same `extension/` and either a test profile or the data of the real profile the
note/report came from.

The parent's answers (2026-10-13): connect to the concrete device the error came from; use test or real profile
data, depending on the profile and app of the note/report.

## Configuration: dev mode (off = everything stays as now)

The parent's wish (2026-10-13): the agent can use the device only when dev mode is on in the configuration; when it
is off, nothing changes. The bridge server is this server by default.

| Where | Setting | Default | Off means |
| --- | --- | --- | --- |
| Tablet, Settings (parent mode, PIN) | **Dev mode: the AI can test this tablet** (`devMode`, a device setting in `DEVICE_SETTINGS`, `core/background/constants.js`) | off | `bridge.js` never connects; no banner; no new permission is used; the app is as today |
| Tablet, same Settings card, shown only when dev mode is on | **Bridge server** (`bridgeUrl`) | `BRIDGE_URL` in `constants.js` = this server (`wss://68-183-124-79.sslip.io/bridge`) | — |
| Tablet, same card | **Dev mode ends** (`devUntil`) | never (on until turned off); choices: 1 h, 1 day, never | — |
| Server, `agent/config.json` | `devices: { enabled, relayUrl, lab }` | `enabled: true`, `relayUrl` = this server, `lab: true` | `poll.sh` starts the agents exactly as today: no `--mcp-config`, no device tools, no lab |

- When the tablet turns dev mode on, it makes the device key and writes its hash to `devices/<deviceId>/bridge.json`
  in the data repo; when it turns it off, it deletes that file and closes the socket. The relay refuses a device with
  no file.
- Each report and note carries `context.app.devMode` (`runner.js contextNow`), so the agent knows before it tries.
- The agent's rule: dev mode off on that device → use the lab and `tests/` (as now); never ask the parent to turn it
  on in a fix message unless the problem cannot be reproduced any other way (then `needs-you`).
- Document all of it in `docs/CONFIGURATION.md` (1.2 per-device settings, 2.2 `agent/config.json`).

## Design

```
tablet (Quetta / Orion)                         this server (68.183.124.79)
 extension SW  core/background/bridge.js  ──wss──▶ nginx :443 /bridge ─▶ agent/devices/relay.mjs (ws, systemd)
   └ pages/content scripts core/ui/bridge.js                                   ▲  unix socket
      (snapshot, tap, type, scroll, wait)                                       │
                                                  claude -p (fix/notes agent) ─▶ agent/devices/mcp.mjs (stdio MCP)
                                                                             └▶ @playwright/mcp ─CDP─▶ agent/lab/lab.mjs Chromium
```

### 1. Device bridge in the extension (no remote code: every command is a fixed handler)

- `extension/core/background/bridge.js` (new): opens a WebSocket to `bridgeUrl` (default `BRIDGE_URL`) only while
  dev mode is on. It answers commands by name:
  - `state`: version, target, installType, profile, mode, shell, sync status, tabs, `checksView()`, `stepsNow()`,
    `contextNow()` (reuse from `core/checks/runner.js`); all through `redact` (`core/checks/kit.js`).
  - `message {type, ...}`: runs `handle()` from `core/background/messages.js` like a page does, so `observe()` runs
    the action checks as usual.
  - `navigate {url, tab?}`, `tabs`, `screenshot` (`chrome.tabs.captureVisibleTab`), `runChecks` (`runStartChecks`),
    `runCheck {id}`, `update` (`chrome.runtime.requestUpdateCheck`, then the version), `end`.
  - Page commands are forwarded to the tab: `snapshot` (an outline of visible elements with refs, labels, roles, the
    app's own ids), `tap {ref|text}`, `type {ref, text}`, `scroll`, `wait {text|selector|ms}`, `console` (page
    errors that `core/ui/watch.js` already catches).
- `extension/core/ui/bridge.js` (new): the page side of these commands. Add it next to `core/ui/watch.js` in every
  `content_scripts` entry of `extension/manifest.json` and in the extension pages (parent, PIN, kid home, check).
- MV3 keep-alive: a WebSocket message every 20 s keeps the service worker alive (Chrome 116+). Fallback for an older
  Quetta or for Orion: long-poll `fetch` to the relay. `build/orion-check.mjs` must stay clean.
- **Consent and safety, enforced in code** (the child's protections stay):
  - Off by default: only the dev mode switch above (`apps/kidtube/parent/settings.js`, behind the PIN) turns it on.
    The switch itself cannot be changed through the bridge.
  - A small mark in the header while dev mode is on ("DEV · AI can test"), and a banner while a command runs:
    "AI is testing this tablet · Stop" (Stop turns dev mode off).
  - The device key: a random key made on the tablet. Its hash and end time go to the data repo
    (`devices/<deviceId>/bridge.json`), the trusted channel both sides already use. The relay accepts only that key.
  - Refused commands: anything about the PIN, the GitHub token, the settings file, dev mode, deleting a profile, and
    changes to blocking, time limits or kid-mode rules (a deny list of message types in `bridge.js`). Enter parent
    mode is a bridge command (no PIN typed); it works only because the parent turned dev mode on behind the PIN.
  - Outside sites: navigate and read. Taps only on the app's own UI (the shell, the header, the kid screens); taps on
    YouTube/Instagram actions (like, subscribe, follow, comment, share, send) are refused.
  - Every command becomes a `step()` (`runner.js`) and a line in the server log; the 🔔 list shows "AI did N actions".

### 2. Relay and MCP server on this server

- `agent/devices/relay.mjs` (new, `ws` package): accepts tablets on `/bridge` (key checked against the data repo
  clone), keeps one connection per `deviceId`, and serves the MCP side on a local unix socket. systemd unit
  `kidtube-relay.service`; `agent/poll.sh` restarts it when it is down.
- nginx: a new `server` on 443 with TLS. The server has only an IP and port 80 today, so it needs a host name:
  `68-183-124-79.sslip.io` + certbot (no domain to buy), or a domain of the parent's. Add the host to
  `host_permissions` in the manifest.
- `agent/devices/mcp.mjs` (new, `@modelcontextprotocol/sdk`, stdio): tools `device_list`, `device_state`,
  `device_snapshot`, `device_tap`, `device_type`, `device_scroll`, `device_wait`, `device_navigate`,
  `device_message`, `device_screenshot` (PNG saved in the run's state dir, never in git), `device_logs`,
  `device_run_checks`, `device_update`, `device_end`. `device_list` also shows devices with dev mode on that are not
  connected now (from `devices/*/bridge.json`), with their last seen time.
- `agent/devices/mcp.json`: the MCP config for `claude -p` (device server + lab server).

### 3. Lab browser on the server (when no device is online, and to test a build before `ship`)

- `agent/lab/lab.mjs` (new): starts the Playwright Chromium already cached (`~/.cache/ms-playwright/chromium-1243`,
  headless new mode, `--load-extension=<checkout>/extension`, `--remote-debugging-port`), then fills
  `chrome.storage.local` through the service worker: the server's GitHub token, the repo, the app and the folder.
  - `--profile <folder> --app kidtube|instagram`: the real profile of the note/report. **Read only**: a new device
    setting `readOnly` in `DEVICE_SETTINGS` makes `core/background/sync.js` pull and never push.
  - `--profile lab`: a test folder `lab/` in the data repo; full read and write.
- `@playwright/mcp --cdp-endpoint http://127.0.0.1:<port>` (via `npx`) gives the agent `browser_snapshot`,
  `browser_click`, `browser_console_messages`, screenshots on the parent, PIN, kid and Instagram app pages.
- No Google/Instagram sign-in in the lab: account checks there are for shape only (as `docs/plans/FAST-FIX.md` part 6
  says). This replaces the `agent/canary.mjs` idea of that plan.

### 4. Agent wiring

- `agent/poll.sh` (fix agent ~line 108, notes agent ~line 233): only when `devices.enabled` in `agent/config.json`
  (read with the existing `cfg` helper), add `--mcp-config agent/devices/mcp.json` and `mcp__device__*`
  `mcp__lab__*` to `--allowedTools`, and pass the report's `deviceId` / the note's device and its `devMode` in the
  prompt. Otherwise the command line is exactly today's.
- `agent/FIX.md` and `agent/NOTES.md`: a section "Test on the device (only when you have the device tools)":
  1. `device_list`. When the reporting device has dev mode on and is connected: `device_state`, repeat the report's
     `steps` with `device_tap`/`device_message`, read `device_logs`. When it is not: the lab, then `tests/`.
  2. Still write the failing test in `tests/` (it stays the proof in CI).
  3. Before `ship`: check the build in the lab. After `ship`: `device_update`, wait for the new version, repeat the
     steps. `.zip` (development) and Orion installs cannot update by themselves: answer `fixed` and say "tap the new
     version next to the logo"; check again on the next session.
  4. Never tap outside actions, never touch the PIN or protections; end the session with `device_end`.
- `agent/problems.mjs`: keep `deviceId` and the bridge state in the problem it passes on.

## Step 0: put this plan in the repo docs

Copy this plan to `docs/plans/DEVICE-BRIDGE.md` (next to `docs/plans/FAST-FIX.md`), add a line to
`docs/README.md`, and point `docs/plans/FAST-FIX.md` part 6 (canary) to it. Commit and push with `npm run ship`.

## Phases (each one shipped with `npm run ship`)

| Phase | What | Done when |
| --- | --- | --- |
| P1 | Dev mode settings (tablet + `agent/config.json`), relay + MCP + bridge with read tools only (`state`, `logs`, `snapshot`, `screenshot`), mark, key | Dev mode off: tests show no socket and the same `poll.sh` command; dev mode on: the agent reads the state of the parent's Quetta tablet from the server |
| P2 | Action tools (`tap`, `type`, `navigate`, `message`, `runChecks`, `update`) and the deny lists | The agent repeats a report's steps on the tablet; refused commands are refused |
| P3 | `poll.sh`, `FIX.md`, `NOTES.md`, `problems.mjs` wiring | A fix run uses the device, then the lab, then tests |
| P4 | Lab browser (`lab.mjs`, Playwright MCP, `readOnly`) | The agent opens a real profile read-only and the `lab` profile |
| P5 | Orion (iPad): long-poll fallback, what Orion lacks (`captureVisibleTab`?) | `orion-check` clean; a session works on the iPad |

## Files

- New: `extension/core/background/bridge.js`, `extension/core/ui/bridge.js`, `agent/devices/{relay.mjs,mcp.mjs,mcp.json,README.md}`,
  `agent/lab/lab.mjs`, `tests/extension/bridge.test.mjs`, `tests/agent/relay.test.mjs`.
- Changed: `extension/manifest.json` (content scripts, host), `core/background/{main.js,messages.js,constants.js,sync.js}`,
  `core/ui/header.js`, `apps/kidtube/parent/settings.js`, extension pages' HTML, `agent/poll.sh`, `agent/FIX.md`,
  `agent/NOTES.md`, `agent/problems.mjs`, `agent/config.json` (`devices`), `docs/CONFIGURATION.md`, `package.json` (`ws`, `@modelcontextprotocol/sdk`), READMEs
  (`core/background/README.md`, `core/checks/README.md`, `agent/README.md`), nginx site, systemd unit.
- Reuse: `redact`/`shapeOf`/`safeUrl` (`core/checks/kit.js`); `step`, `stepsNow`, `contextNow`, `runStartChecks`,
  `runCheck`, `checksView`, `observe` (`core/checks/runner.js`); `handle` (`core/background/messages.js`);
  `parentMode`, `serial` (`core/background/store.js`); the device id (`DEVICE_SETTINGS`); page error capture in
  `core/ui/watch.js`; `tests/helpers/fake-chrome.mjs`.

## Risks

- A remote control of a child's tablet: only with dev mode on (behind the PIN, off by default), a visible mark,
  deny lists, a log, an optional end time.
- Quetta's Chromium version and Orion's background may not keep a WebSocket: long-poll fallback.
- A public port: TLS, a per-session key, one device per key, the relay drops unknown keys; rate limit in nginx.
- The device cannot load a build before release (MV3 forbids remote code): verification on the device happens after
  `ship`; the lab tests the build before it.
- Screenshots can show account names: kept only in the run's state dir, deleted after 7 days.

## Verification

1. `npm test`: `bridge.test.mjs` (fake browser: dev mode off → no socket and all commands refused; deny list incl.
   dev mode itself; redact; steps logged; `devUntil` ends it; default `bridgeUrl` = this server),
   `relay.test.mjs` (no `bridge.json` or wrong key refused, command round trip with a fake tablet socket), a
   `poll.sh` test: `devices.enabled: false` gives today's `claude -p` command line.
2. `node build/orion-check.mjs`: no `✗`.
3. Manual on the parent's Quetta tablet: turn dev mode on in Settings; in a chat session on the server run
   `claude --mcp-config agent/devices/mcp.json` and call `device_state`, `device_snapshot`, `device_tap` on a kid
   button, `device_message {type:'setMode'}`; check the mark, Stop, the end time, a refused PIN command; turn dev
   mode off and check that `device_list` shows the tablet as off and the relay closed it.
4. `node agent/lab/lab.mjs --profile lab` then `browser_snapshot` of the parent page; `--profile <real>`: no push in
   the data repo after a sync.
5. A real fix run: a test report with the device online; the run log shows device tools, then `ship`, `device_update`.

## Plan in ASD-STE100

Step 0: the plan in the docs.

1. Copy this plan to `docs/plans/DEVICE-BRIDGE.md`.
2. Add a line for it to `docs/README.md`.
3. In `docs/plans/FAST-FIX.md` part 6, add a link to the new plan.
4. Commit. Run `npm run ship -- -m "<summary>"`.

Phase P1: dev mode and read tools.

1. Add the device settings `devMode`, `bridgeUrl` and `devUntil` to `DEVICE_SETTINGS` in `core/background/constants.js`.
2. Set `devMode` to off by default.
3. Set `BRIDGE_URL` in `constants.js` to this server: `wss://68-183-124-79.sslip.io/bridge`.
4. Add the "Dev mode" card to `apps/kidtube/parent/settings.js`. It is behind the PIN.
5. Show `bridgeUrl` and `devUntil` in the card only when dev mode is on.
6. When dev mode goes on, write the key hash to `devices/<deviceId>/bridge.json`. When it goes off, delete the file.
7. Add `devices: { enabled, relayUrl, lab }` to `agent/config.json`. Set `relayUrl` to this server.
8. In `agent/poll.sh`, add the device tools only when `devices.enabled` is true. Risk: a changed agent command. Test that "off" gives the command of today.
9. Add `devMode` to `contextNow()` in `core/checks/runner.js`.
10. Write the settings in `docs/CONFIGURATION.md`, sections 1.2 and 2.2.
11. Create `agent/devices/relay.mjs`. This program accepts tablet connections on `/bridge`. Risk: an open port. Use TLS and a session key.
12. Create a host name for the server. Use `68-183-124-79.sslip.io` or a domain of the parent.
13. Get a TLS certificate with `certbot`. Add a `server` on port 443 to nginx. Send `/bridge` to the relay.
14. Create the systemd unit `kidtube-relay.service`. Start the relay with it.
15. Create `agent/devices/mcp.mjs`. This MCP server gives the tools `device_list`, `device_state`, `device_logs`, `device_snapshot`, `device_screenshot`.
16. Create `agent/devices/mcp.json`. Put the device server and the lab server in it.
17. Create `extension/core/background/bridge.js`. It opens the WebSocket only when dev mode is on.
18. Use `redact` from `core/checks/kit.js` on all data that the bridge sends.
19. Create `extension/core/ui/bridge.js`. It makes the page outline and does the page commands.
20. Add `core/ui/bridge.js` to `extension/manifest.json` and to the extension pages.
21. Show the mark "DEV · AI can test" in the header (`core/ui/header.js`) when dev mode is on.
22. Show the banner "AI is testing this tablet · Stop" while a command runs. Stop turns dev mode off.
23. Make the relay refuse a device that has no `bridge.json` or a wrong key.
24. Write `tests/extension/bridge.test.mjs` and `tests/agent/relay.test.mjs`.
25. Test that dev mode off gives no socket and refuses all commands.
26. Run `npm test` and `node build/orion-check.mjs`.
27. Commit. Run `npm run ship -- -m "<summary>"`.

Phase P2: action tools.

1. Add the commands `tap`, `type`, `scroll`, `wait`, `navigate`, `message`, `runChecks`, `update`.
2. Send `message` through `handle()` in `core/background/messages.js`. Then the action checks run as usual.
3. Refuse all commands about the PIN, the GitHub token, the settings file, dev mode and profile delete.
4. Refuse all changes to blocking, time limits and kid-mode rules. Risk: weak protections. Test each refusal.
5. Refuse taps on outside actions on YouTube and Instagram: like, subscribe, follow, comment, share, send.
6. Record each command with `step()` in `core/checks/runner.js`.
7. Show the number of AI actions in the 🔔 list.
8. Test. Commit. Run `npm run ship`.

Phase P3: agent wiring.

1. When `devices.enabled` is true, add `--mcp-config agent/devices/mcp.json` to the two `claude -p` commands in `agent/poll.sh`.
2. In the same case, add `mcp__device__*` and `mcp__lab__*` to `--allowedTools`.
3. Put the device id and its `devMode` of the report or note in the prompt.
4. Keep `deviceId` in the problems in `agent/problems.mjs`.
5. Add the section "Test on the device" to `agent/FIX.md` and `agent/NOTES.md`.
6. In that section, tell the agent the order: device first, then lab, then `tests/`.
7. Tell the agent to write a failing test in `tests/` also.
8. Tell the agent to call `device_update` after `ship` and to do the steps again.
9. Tell the agent: a `.zip` or Orion install does not update by itself. Write "tap the new version next to the logo".
10. Commit. Run `npm run ship` (no release for a change to `agent/` only).

Phase P4: lab browser.

1. Create `agent/lab/lab.mjs`. It starts the cached Playwright Chromium with `--load-extension` and a debug port.
2. Fill `chrome.storage.local` with the token, the repo, the app and the folder.
3. Add the device setting `readOnly`. Make `core/background/sync.js` pull and not push when it is on.
4. Use `readOnly` for a real profile. Risk: changes to the child data. Test that no push occurs.
5. Use the folder `lab/` in the data repo for the test profile.
6. Connect `@playwright/mcp --cdp-endpoint` to that Chromium. Add it to `agent/devices/mcp.json`.
7. Test. Commit. Run `npm run ship`.

Phase P5: Orion.

1. Add a long-poll `fetch` fallback to the bridge for browsers that stop the WebSocket.
2. Find which commands Orion cannot do. Example: `captureVisibleTab`.
3. Run `node build/orion-check.mjs`. Make sure that it shows no `✗`.
4. Test a session on the iPad. Build Orion only when the parent asks (`--orion`).

Checks at the end.

1. Turn dev mode on in Settings on the Quetta tablet.
2. On the server, run `claude --mcp-config agent/devices/mcp.json`.
3. Call `device_state`, `device_snapshot`, `device_tap` and `device_message`.
4. Make sure that the mark, the banner, Stop and the end time work.
5. Make sure that a PIN command is refused.
6. Turn dev mode off. Make sure that the relay closes the connection.
7. Run `node agent/lab/lab.mjs --profile lab`. Call `browser_snapshot` on the parent page.
8. Do a fix run with a test report while the tablet is online. Read the run log.
