# extension/apps/kidtube/data/

Files bundled with the extension. `background/config.js` loads them.

| File | What it is |
| --- | --- |
| `default-config.json` | The default rules. GitHub's `parent-config.json` overlays them, the parent's unsent changes overlay that (`core/lib/merge.js`) |
| `default-queue.json` | The starter list, used until the profile has a `queue.json`. The helper copies it into a new profile |
| `quiz-types.json` | The quiz types this version can show. Each activity file names them (`device.quizTypes`), and the helper makes only those types |

`tools/validate.mjs` checks `default-config.json` against `schemas/default-config.schema.json`.
