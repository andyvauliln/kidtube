# extension/apps/kidtube/

KidTube: the child's own video list on YouTube. He sees only his list, the talking friend and the video he
picked. The parent sets the hours, the daily minutes and the rules in parent mode; the daily helper on the
server fills the list.

| Folder | What is inside |
| --- | --- |
| `background/` | KidTube's part of the service worker: the kid's rules and guard, its messages, parent mode's data, its files in the data repo |
| `content/` | `youtube.js`: covers YouTube with the kid's screens and reports playback |
| `kid/` | The kid's screens: his list, the strip beside the player, the lock, the talking friend |
| `parent/` | Parent mode: Today, Planned, History, Context, Prompt, Settings |
| `lib/` | KidTube's pure helpers: the list, the plan, the hours, answer marking, captions, speech |
| `data/` | Bundled defaults: rules, a starter list, the quiz types this version supports |
| `avatars/` | Mesh avatars for the talking friend, one folder each (`rig.json` + `built/`, made with mesh-avatar-studio). `miko-qipao` is the test sample |
| `vendor/` | Third-party code: `mesh-avatar/`, the mesh-avatar-studio engine (MIT), bundled by `build/build-mesh-avatar.mjs` |

## A day on the tablet

1. He opens YouTube. `content/youtube.js` covers it with his list (`kid/home.html` in an iframe, or an in-page
   panel on Orion). Outside the hours or over the minutes he sees the lock instead.
2. He taps a video. If the friend's intro is on, the tab goes to `kid/talk.html` first, then to the video.
3. While it plays, the content script reports the time every few seconds (`tick`). The strip beside the player
   shows the other videos; he may leave only after the minimum time.
4. At the end the friend says what they learned and asks the questions (`talk.html?mode=outro`).
5. What he did goes to `activity/<day>.json` in the data repo at the next sync. The helper reads it at night.

## Data repo files (`kidtube/<folder>/`)

`parent-config.json` (rules), `queue.json` (the list), `memory.json` and `helper.json` (the helper's notes and
prompt), `activity/*.json` (what happened), `transcripts/`, `audio/` and `characters/` (the friend), `context/*.md`
(the context documents). The formats are in `schemas/`.
