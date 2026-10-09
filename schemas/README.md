# schemas/

JSON Schemas of the files the tablet and the helper exchange through the data repo. Both sides
and the data repo's CI check them with `tools/validate.mjs`.

| Schema | File in the data repo (`<app>/<folder>/`) | Written by |
| --- | --- | --- |
| `parent-config.schema.json` | `parent-config.json`: rules, the friend, quiz items | the helper, the tablet (Settings) |
| `default-config.schema.json` | `extension/apps/kidtube/data/default-config.json` (bundled, not in the repo) | developers |
| `queue.schema.json` | `queue.json`: today's list and what comes next | the helper |
| `activity.schema.json` | `activity/YYYY-MM-DD.json`: what happened on the tablet, one event each | the tablet |
| `memory.schema.json` | `memory.json`: the helper's notes on every video | the helper |
| `transcript.schema.json` | `transcripts/<videoId>.json` | the tablet, the helper (Gemini) |
| `profile.schema.json` | `profile.json`: whose folder this is | the tablet |
| `quiz-item.schema.json` | one question (used inside `parent-config`) | the helper |
| `common.schema.json` | shared pieces (video id, dates) | — |

A change here usually needs the same change in `tools/validate.mjs` cross-checks and in `tests/fixtures/`.
