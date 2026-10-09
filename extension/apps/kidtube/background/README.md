# extension/apps/kidtube/background/

KidTube's part of the service worker. `index.js` is the part the core registers (the fields are explained in
`core/background/apps.js`).

| File | What it does |
| --- | --- |
| `index.js` | The part: state keys, the guard, the screens' view, handlers, sync, site rules, a new profile's empty list |
| `config.js` | The rules and the list in force: bundled defaults (`data/`) + GitHub's files + the parent's unsent changes + today's plan changes |
| `rules.js` | The kid's rules: time today, the lock, the video he is on, his list (⭐ first), the guard of YouTube pages, the quiz pick, the talk page |
| `handlers.js` | KidTube's messages: the screens (`open`, `talk`, `quizResults`...), the content script (`tick`, `ended`, `details`) and the parent screens (`parentData`, `plan`, `saveRules`...) |
| `parent.js` | Parent mode's data: Today, Planned, History, a video's details, the Prompt tab, the notes for the AI, plan changes |
| `sync.js` | KidTube's files in the data repo: rules and list, the helper's files, keys, context documents, other devices' plan changes; writes activity, rules and run requests |
| `transcripts.js` | Captions fetched on the tablet (YouTube refuses servers) and saved as `transcripts/<videoId>.json` |
| `media.js` | The friend's recordings (`audio/*.mp3` in Cache Storage) and picture (`characters/`) |

## Who decides what

- The core's guard hands over every YouTube page except at the apps header. `rules.js` `guard` decides: parent
  mode opens everything (home → the parent screens); kid mode allows his list's videos and sends the rest home.
- Time counts only from `tick` messages, at most 15 seconds each, never in parent mode.
- Every change of the state goes through `withState()` (core), so ticks, syncs and messages never race.
