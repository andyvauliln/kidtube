# docs/

Longer texts. The code map is in the `README.md` of each code folder; start at `../README.md`.

| File | What it is | Kind |
| --- | --- | --- |
| `HOW-IT-WORKS.md` | The four parts, the kid's day, parent mode, the helper's night | Guide (as of 0.7.1) |
| `UPDATES.md` | How a change gets to the tablet: branches, releases (Quetta, Orion), the update phases, who releases, updates without a version | Reference (kept current) |
| `CONFIGURATION.md` | Every setting: where it lives, its default, what it does | Reference (kept current) |
| `ORION.md` | KidTube on Orion (iPad/iPhone/Mac): what works, what the build changes | Research + reference |
| `SAFARI.md` | KidTube on Safari: research, nothing built | Research |
| `PLAN.md` | The first development plan: the brief's checks (C1–C24), data contracts, milestones | Plan (history) |
| `PLAN-DEVICES.md` | Android and iPhone/iPad plan | Plan (history) |
| `PLAN-PROFILES.md` | Profiles per email, then the apps header | Plan (history) |
| `plans/FAST-FIX.md` | Checks inside the app, reports, the fix agent, data fixes (`site/remote.json`) | Plan |
| `plans/DEVICE-BRIDGE.md` | Dev mode: the fix and notes agents test on the real tablet (bridge + MCP) and in a lab browser | Plan (2026-10-13) |

Plans and research are snapshots of their time: file names and line numbers in them (`sw.js:807`) point to the
code as it was then. Since 0.10.0 the service worker is split into `extension/core/background/` and
`extension/apps/kidtube/background/`.
