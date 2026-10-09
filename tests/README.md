# tests/

`npm test` runs every `*.test.mjs` here with `node --test`. No browser: the service worker runs in Node with a
fake `chrome.*` (`helpers/fake-chrome.mjs`), and fetches to `ext://` read files from `extension/`.

| Folder | What it tests |
| --- | --- |
| `extension/` | What the parent asked for, one test per requirement with the parent's words (`requirements`), the checks inside KidTube and their reports (`checks`), the service worker through its messages and tab events (`sw`, `parent`, `profiles`, `talk`, `transcripts`, `orion`), the pure helpers (`logic`, `mark`, `merge`), the parent kit and the apps header (`kit`), listening (`voice`), the mesh avatar (`mesh`), lip shapes (`lips`) |
| `agent/` | The helper's toolkit, quiz and voices (`agent`), the poller: notes, run requests and the fix lane (`notes`), `[mood]` tags (`moods`) |
| `build/` | The Orion build and the Orion API check (`orion-build`) |
| `tools/` | The data validator against the fixtures (`validate`) |
| `helpers/` | `fake-chrome.mjs` |
| `fixtures/` | `good/data`: a valid profile folder; `bad/<check>/`: one broken file per validator check |

Content scripts and pages are not covered here. What must be true on them is checked by KidTube itself, on the
tablet, every time (`extension/core/checks/`, `core/ui/watch.js`: the header, his list covering YouTube, the bottom
bar, each tab, no blank page, no dead button); those checks were run in headless Chromium with the extension loaded.

`requirements.test.mjs` holds only what is true now. A request the parent later replaced (the parent-mode timer, the
recent videos in Settings, notes kept after the AI used them, a remembered apps row) has no test.

Run one file: `node --test tests/extension/sw.test.mjs`.
