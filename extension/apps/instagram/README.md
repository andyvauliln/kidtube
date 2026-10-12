# extension/apps/instagram/

Instagram's saved posts, with voice notes, and a list of posts the server's posts agent handles. No parent or kid
mode: opening the app from the apps header always shows the header too.

## Where it runs

YouTube sends every page to `https://www.instagram.com/robots.txt?kidtube=app` (`home` in `../registry.js`). That
is a plain text page of Instagram's, so none of Instagram's own scripts run there, but the page can read Instagram's
web API with the signed-in Instagram account on every browser (same origin). `content/app.js` draws the app there.
The App | Instagram switch (top right in the app, bottom left on Instagram's pages) moves between the app and
Instagram's own site, where the app does nothing else. YouTube always opens the app.

## The screen

| Tab | What it shows |
| --- | --- |
| Saved | Every saved post (default) or one collection (the dropdown). ★ makes the shown one the default. Chips filter by status. ↻ reads Instagram again |
| To handle | The posts waiting for the agent, the failed ones, and the latest handled ones |

A post opens in a sheet: the video or pictures, the caption, its status with a button (Add to the list, Take out of
the list, Handle again, Try again), what the video says (after the agent), and the notes: 🎤 records until ⏹ (at
most 3 minutes) or type one. A note puts the post in the list by itself.

## Status of a post

| Status | When |
| --- | --- |
| Not handled | Every post read from Instagram starts here: the whole saved list on the first read, new saves after that |
| In the list | Asked for (the button, or a note) and the agent has not done it since |
| Handled | The agent did it, with the notes there were then |
| Failed | The agent tried and says why (for example an expired video address: Try again sends a fresh one) |

The rule is `statusOf` in `lib/posts.js`; the agent on the server uses the same file.

## Files

| File | What it does |
| --- | --- |
| `background/index.js` | Its background part: the state key `ig`, the guard (YouTube → its screen), the site rules (instagram.com, facebook.com) |
| `background/handlers.js` | The screen's messages (`ig…`): the saved pages, collections, the default, the list, notes (a recording is written down here by Groq's Whisper, Gemini or OpenRouter, with the keys of `keys.json` or Settings) |
| `background/sync.js` | The data repo: writes `posts.json` and `notes/<id>.wav`, reads `handled.json` |
| `lib/posts.js` | Plain rules: a post from Instagram's API, merging pages, the status, what goes to the repo |
| `content/api.js` | Instagram's web API: saved posts, collections, one collection, one post |
| `content/app.js` | The screen (tabs, grid, sheet, notes, recording) |

## In the data repo (`instagram/<folder>/`)

| File | Written by | What it holds |
| --- | --- | --- |
| `posts.json` | the tablet | Every saved post: author, caption, collections, notes, the request (`handle`); the video addresses of the posts in the list |
| `notes/<id>.wav` | the tablet | A recorded note no model on the tablet could write down |
| `handled.json` | the agent | For each post: when, which request and notes it did, the transcript length, an error, recorded notes written down |
| `posts/<id>.json` | the agent | The transcript, the notes it read, and `metadata` (empty for now: the AI step comes later) |

The agent is `agent/instagram.mjs`, run by `agent/poll.sh` every minute the data repo changes.

## Not yet

- A post unsaved on Instagram stays in the list.
- Not tried on a real device or a real Instagram account yet: Instagram's web API can change, and asks for a sign-in
  when its session ends (the screen then shows Sign in).
