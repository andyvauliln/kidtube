# MCP in this project: what the tools can do, and their limits

As of 0.12.40 (2026-10-21). Written in ASD-STE100. Code names, tool names and paths stay as they are in the code.
The design and its history: [plans/DEVICE-BRIDGE.md](plans/DEVICE-BRIDGE.md).

Contents:

1. [What MCP is](#1-what-mcp-is)
2. [The MCP servers of this project](#2-the-mcp-servers-of-this-project)
3. [How a command gets to the tablet](#3-how-a-command-gets-to-the-tablet)
4. [The `device` tools: what each tool does](#4-the-device-tools-what-each-tool-does)
5. [The `lab` tools](#5-the-lab-tools)
6. [Limits](#6-limits)
7. [What the real tablet showed (2026-10-13 to 2026-10-17)](#7-what-the-real-tablet-showed-2026-10-13-to-2026-10-17)
8. [Who can use the tools, and how](#8-who-can-use-the-tools-and-how)
9. [Options to make the tools better](#9-options-to-make-the-tools-better)

---

## 1. What MCP is

MCP (Model Context Protocol) is a standard that connects an AI agent (here: Claude Code) to tools.

| Part | What it is |
| --- | --- |
| MCP server | A small program. It gives a list of tools, each with a name, a description and its inputs. |
| Tool | One action. The agent calls it with inputs, and the tool gives back text or a picture. |
| Transport | How the agent and the server talk. Here: stdio (the agent starts the server as a child process). |
| Config | A JSON file that names the servers and the command that starts each one. Here: `agent/devices/mcp.json`. |

The agent cannot do more than the tools let it do. The tools in this project are the only way for the AI to see and
control the tablet.

---

## 2. The MCP servers of this project

`agent/devices/mcp.json` names two servers:

| Server | Program | What it controls | Tool names |
| --- | --- | --- | --- |
| `device` | `agent/devices/mcp.mjs` (our code) | The **real tablet** (Quetta now; Orion later), through the relay | `device_*` (15 tools, section 4) |
| `lab` | Playwright MCP (`node_modules/@playwright/mcp/cli.js`) | The **lab browser**: Chromium on this server with a checkout's `extension/` | `browser_*` (section 5) |

The other MCP servers in a chat session (GitHub, Notion, ClickUp, Vercel) are not part of this project. This
document does not describe them.

---

## 3. How a command gets to the tablet

```
Claude Code (agent)
   │ stdio (MCP)
agent/devices/mcp.mjs            the device_* tools
   │ unix socket: <state>/devices/relay.sock   (GET /devices, POST /cmd)
agent/devices/relay.mjs          the relay, on 127.0.0.1:8790
   │ nginx (TLS) → wss://68-183-124-79.sslip.io/bridge
extension/core/background/bridge.js     the service worker of the tablet
   │ tabs.sendMessage / runtime.sendMessage
extension/core/ui/bridge.js      the part on each page and frame
```

1. The parent turns on dev mode: apps header → account menu → Dev mode. The tablet makes a key.
2. The tablet writes `devices/<device>/bridge.json` to the data repo: `on`, the SHA-256 of the key, the end time.
3. The tablet opens a WebSocket to the relay and sends `hello` with the key.
4. The relay compares the key with `bridge.json`. If they match, it sends `welcome`.
5. The agent calls a tool. `mcp.mjs` sends the command to the relay. The relay sends it to the tablet.
6. The tablet runs a **fixed** handler (`COMMANDS` in `bridge.js`) and sends the answer back.
7. The relay writes each command to `<state>/devices/log/<device>.jsonl`.

The server never sends code to the tablet. Each command is a handler that is in the extension already.

---

## 4. The `device` tools: what each tool does

| Tool | What it does | Inputs |
| --- | --- | --- |
| `device_list` | Lists the tablets with dev mode on: connected or not, version, browser, since when | — |
| `device_state` | All that a problem report has, now: build, browser, profile, mode, sync errors, checks, the last 40 steps, the tabs | `device` |
| `device_storage` | Reads keys of `chrome.storage.local`. It hides tokens, keys, the PIN hash, names and texts. | `device`, `keys` |
| `device_tabs` | Lists the open tabs: id, address, title, which tab is in front | `device` |
| `device_snapshot` | Gives what a tab shows as an outline: headings, texts, and each button, link and field with a ref. It includes the app's closed shadow roots. It marks "parent only" on what dev mode cannot tap. | `device`, `tab`, `frame` |
| `device_tap` | Taps an element (by ref or by its text) | `device`, `tab`, `ref`, `text` |
| `device_type` | Types into a field, with input and change events. `enter: true` presses Enter. | `device`, `tab`, `ref`, `text`, `enter` |
| `device_scroll` | Scrolls an element into view, or scrolls the page by `dy` pixels | `device`, `tab`, `ref`, `dy` |
| `device_wait` | Waits until a text or a CSS selector is on the page (or is gone), max 15 s | `device`, `tab`, `text`, `selector`, `gone`, `ms` |
| `device_errors` | Gives the last 20 uncaught errors of the page | `device`, `tab` |
| `device_navigate` | Opens a web address or an extension page in a tab. The app's guard still decides, as for the child. | `device`, `tab`, `url`, `newTab` |
| `device_message` | Sends a message to the service worker, as the extension's own pages do | `device`, `tab`, `msg` |
| `device_run_checks` | Runs the start checks now and gives the results | `device` |
| `device_update` | Asks the browser for the newest version, then gives the version it has | `device` |
| `device_screenshot` | Takes a picture of the tab in front. Keeps it in `<state>/devices/shots/`, never in git. | `device`, `tab`, `quality` |

If only one tablet is connected, the `device` input is not necessary.

---

## 5. The `lab` tools

The lab is Chromium on this server. `node agent/lab/lab.mjs --detach --profile <app>/<folder>` starts it with
the data of one profile from the data repo. Playwright MCP connects to it on CDP port 9333.

| Tool group (Playwright MCP) | Examples | What they do |
| --- | --- | --- |
| Page | `browser_navigate`, `browser_snapshot`, `browser_take_screenshot` | Open an address, read the page as an outline, take a picture |
| Input | `browser_click`, `browser_type`, `browser_press_key`, `browser_select_option` | Tap, type, keys |
| Debug | `browser_console_messages`, `browser_network_requests`, `browser_evaluate` | Read the console and the network, run JavaScript in the page |
| Tabs | `browser_tabs` | List, open, close tabs |

The lab can do more than the tablet: it can run JavaScript in the page, read the network, and take pictures.
The lab is not the real device: section 6.3 gives the differences.

---

## 6. Limits

### 6.1 Limits on purpose (safety)

The tablet refuses these commands, also if the server asks for them:

| Refused | Where the rule is |
| --- | --- |
| The PIN, the PIN page | `data-bridge="no"` and the PIN page check in `core/ui/bridge.js` |
| The rules, the minutes (`saveRules`, `resetToday`) | `REFUSED` in `core/background/bridge.js` |
| The GitHub connection, the settings file (`connectGitHub`, `exportSettings`, `importSettings`, `settingsBackup`) | `REFUSED` |
| The reports (`clearChecks`) | `REFUSED` |
| Dev mode itself (`devMode`, `devStop`) | `REFUSED` |
| Any message type with `pin`, `token`, `secret` or `password` in its name | `SECRET_TYPE` in `core/background/bridge.js` |
| On YouTube and Instagram: like, subscribe, follow, comment, share, send | `core/ui/bridge.js` |
| On YouTube and Instagram: type in any field but the search box | `device_type` |
| Addresses that are not `http(s)` or an extension page (`javascript:`, `data:`, `chrome:`) | `addressOf()` in `core/background/bridge.js` |
| Run code that came from the server | There is no such command |

More safety rules:

- Dev mode is off by default. Only the parent turns it on, at the unlocked header or in parent mode.
- Dev mode can end by itself after one hour or one day (`devUntil`), or stay on until the parent turns it off.
- Each page shows "AI is testing · Stop" while the agent works. Stop turns dev mode off.
- `device_storage` and `device_snapshot` hide secrets (tokens, API keys, the PIN hash, names, texts).
- Screen pictures need one more permission (`<all_urls>`). The parent gives it with **Allow screen pictures**.
  The tablet gives it back when dev mode goes off.
- In kid mode the child can use the tablet. The agents only read then (`agent/FIX.md`, `agent/NOTES.md`).

### 6.2 Technical limits of the `device` tools

| Limit | Value | Effect |
| --- | --- | --- |
| Time for one command | 30 s (default), 60 s for `device_message`, 45 s for `device_screenshot` | A slow tablet gives "No answer from <device> in <ms> ms" |
| `device_wait` | Max 15 s | Wait again for a longer load |
| Snapshot size | Max 400 lines | A long page is cut: scroll, or ask for one frame |
| Frames in a snapshot | Only the frames that answer in 1.2 s | A slow frame is not in the outline |
| A page without the app's scripts | No answer | Plain text pages (for example `instagram.com/robots.txt`) and pages that load now do not answer |
| Refs | Valid until the page loads again | Take a new snapshot after each navigation |
| Message size | 16 MB per WebSocket message | Large pictures can fail |
| No JavaScript in the page | By design | The agent cannot read a variable or call a function of the page |
| No network log, no console log | Only uncaught errors (`device_errors`) | Find network errors with `device_state` (sync errors) or in the lab |
| No new build on the tablet before a release | MV3 forbids remote code | Test the build in the lab first. Test on the tablet after `npm run ship`. |
| An update | Quetta with a `.crx` install updates by itself. A `.zip` install and Orion need the parent. | `device_update` cannot finish an update for those |
| The tablet must be awake | Android can stop the browser or the service worker in the background | The socket closes. The tablet connects again after 5 s, 15 s, then every minute. |
| GitHub | Dev mode needs the GitHub connection | Without it, dev mode does not turn on |
| One tablet per call | The `device` input | With two tablets online, name the tablet |

### 6.3 Limits of the lab

| Limit | Effect |
| --- | --- |
| No Google and no Instagram sign-in | YouTube sees nobody signed in. Instagram shows its sign-in page. Account checks show only the shape. |
| Read only (`settings.readOnly`) | The lab writes nothing to GitHub and sends no reports |
| One lab at a time | A new start stops the old one |
| A new browser profile each start | Nothing stays from the last start |
| Desktop Chromium on Linux | It is not Quetta on Android and not Orion: touch, screen size, speed and browser APIs are different |
| Two libraries unpacked without root | `lab.mjs` adds `~/.local/share/kidtube/lab/root` to `LD_LIBRARY_PATH`. A Playwright update can need new libraries. |

### 6.4 Limits of MCP itself

| Limit | Effect |
| --- | --- |
| The agent sees only text and pictures that a tool gives | It does not see the screen live. It must ask again after each step. |
| Each tool call is one round trip | A flow with many taps is slow (tablet → relay → agent) |
| The tools exist only in sessions that load `agent/devices/mcp.json` | A usual chat session has no `device_*` tools (section 8) |
| The tool descriptions use tokens in each session | More tools make each run more expensive |

---

## 7. What the real tablet showed (2026-10-13 to 2026-10-17)

Source: `<state>/devices/log/tab-2553c4e5.jsonl` and `<state>/devices/relay.log`.

| Fact | Value |
| --- | --- |
| Tablet | `tab-2553c4e5`, Quetta (Android), versions 0.12.18 to 0.12.37 |
| Connections | 85 in five days. The socket closes often (the tablet sleeps, the browser goes to the background). |
| Commands | 80. Most of them worked: `state` 13, `message` 24, `tabs` 8, `snapshot` 9 of 12, `tap` 5, `scroll` 3, `navigate` 4, `storage` 3, `errors` 4 |
| `device_screenshot` | **Failed 4 of 4**: "GetWebContentsForID not implemented for Android". `chrome.tabs.captureVisibleTab` does not work in Quetta. |
| `device_snapshot` failures | 3: two pages that did not answer (`www.instagram.com/` during load, `instagram.com/robots.txt`), one tab that was closed |
| Orion | Not tested (phase P5 of the plan) |

So on Quetta the agent reads the page as text only. It cannot get a picture of the screen.

---

## 8. Who can use the tools, and how

| Who | How | Tools |
| --- | --- | --- |
| The fix agent and the notes agent | `agent/poll.sh` adds `--mcp-config agent/devices/mcp.json` and allows `mcp__device` (and `mcp__lab` if `devices.lab` is true) when `devices.enabled` is true in `agent/config.json` | `device_*`, `browser_*` |
| A person in a terminal | `claude --mcp-config agent/devices/mcp.json`, then ask for `device_list` | `device_*`, `browser_*` |
| A usual chat session | Not loaded | None |

Rules for the agents (`agent/FIX.md`, `agent/NOTES.md`):

1. Call `device_list`. Find the tablet of the report or the note.
2. If it is connected: `device_state`, then `device_snapshot`. Do the steps again with `device_navigate`, `device_tap`,
   `device_type`, `device_message`. Then read `device_errors` and `device_state`.
3. In kid mode: only read. Leave the tablet in the same mode and on the same page.
4. If it is not connected: use the lab, then `tests/`.
5. After `npm run ship`: `device_update`, then `device_message` `{type: "version", fresh: true}` until the new
   version is there.

---

## 9. Options to make the tools better

| # | Change | Why | Effort |
| --- | --- | --- | --- |
| 1 | A picture without `captureVisibleTab` on Quetta: draw the page into a canvas in the page (DOM to image), or send only the box sizes and colors of the elements | Section 7: pictures fail on Android | Medium. The result is not the real screen, and a cross-origin frame (the YouTube player) stays empty. |
| 2 | A network and console log in the page part (`core/ui/bridge.js`): the last 50 `fetch` results and console warnings of the app's own scripts | The agent cannot see why a call failed | Small |
| 3 | A fallback when the WebSocket closes: long-poll `fetch` to the relay | The socket closes often on Android, and maybe on Orion | Medium |
| 4 | Phase P5: Orion | No test yet on the iPad | Medium |
| 5 | A tool that does a list of steps in one call (navigate, wait, tap, snapshot) | Fewer round trips, faster tests | Small |
| 6 | Let the lab sign in with a test account | The lab cannot test YouTube or Instagram account flows now | Medium. A real account on a server can be blocked by the site. |
