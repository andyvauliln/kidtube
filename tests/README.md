# tests/

`npm test` runs every `*.test.mjs` here with `node --test`. No browser: the service worker runs in Node with a
fake `chrome.*` (`helpers/fake-chrome.mjs`), and fetches to `ext://` read files from `extension/`.

| Folder | What it tests |
| --- | --- |
| `extension/` | The service worker through its messages and tab events (`sw`, `parent`, `profiles`, `talk`, `transcripts`, `orion`), the pure helpers (`logic`, `mark`, `merge`), the parent kit and the apps header (`kit`), listening (`voice`) |
| `agent/` | The helper's toolkit, quiz and voices (`agent`), the notes poller (`notes`) |
| `build/` | The Orion build and the Orion API check (`orion-build`) |
| `tools/` | The data validator against the fixtures (`validate`) |
| `helpers/` | `fake-chrome.mjs` |
| `fixtures/` | `good/data`: a valid profile folder; `bad/<check>/`: one broken file per validator check |

Content scripts and pages are not covered here. They were checked in headless Chromium with the extension loaded
(on a live youtube.com page in both the iframe and the Orion in-page mode).

Run one file: `node --test tests/extension/sw.test.mjs`.
