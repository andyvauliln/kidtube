# extension/apps/instagram/

Instagram's saved posts, with voice notes, and a list of posts the server's posts agent handles. No parent or kid
mode: opening the app from the apps header always shows the header too.

## Where it runs

The app is Instagram's own Saved page of the profile's account (`/<username>/saved/all-posts/`, `savedPath` in
`lib/rules.js`), with two views of the same page:

| View | What you see |
| --- | --- |
| **App** | The app over the page, in its own layer (a closed shadow root): the apps header, the tabs, the post sheet |
| **Instagram** | The page itself, with the apps header on top while the header may show (parent mode, the apps header): App \| site, **Connect**, the apps, the notifications. The Connect bar (bottom left) keeps its messages and the tile's offer; without the header it also has App \| Instagram and **Connect** |

The App | Instagram switch (top right in the app) changes the view without loading a page; the tab keeps its view
(`sessionStorage`). YouTube and the header's tile send the tab to the launch address `robots.txt?kidtube=app` (`home`
in `../registry.js`), which goes on to the Saved page in the App view. **▶ Play on Instagram** in a post opens the
post in Instagram's own player (the Instagram view); App in the Connect bar comes back.

## Where the saved posts come from

1. **What Instagram's own page receives.** `content/net.js` runs in the page's world (manifest `world: "MAIN"`). It
   sees the page's requests (fetch and XMLHttpRequest) and the data that comes with the page. `lib/reader.js` finds
   the saved posts, the collections and the next page's position in any answer (the web API's JSON or GraphQL's).
2. **The next pages:** the page's own request again, with the next position (`withCursor`). The page's tokens stay in
   the page world.
3. **Else Instagram's web API** from the page (`content/api.js`), when the page gave nothing (`api` in the rules).
   Orion may not run page-world scripts: there only this one works.
4. **A collection's posts:** Instagram's web API (`/api/v1/feed/collection/<id>/posts/`) when the app shows the
   collection, and whatever collection the parent opens on Instagram's own page (its GraphQL answer, for example
   `PolarisSavedCollectionPageWWWQuery`), at once: the web API may not give a collection at all.

The rules (which requests mean "saved", where the position is) are data: `lib/rules.js` has the defaults, and
`site/remote.json` `instagram.reader` can change them without a new version (`core/background/remote.js`).

## When reading fails: Send to AI

A read that fails (not a sign-in), of the saved posts or of a collection, sends a problem report `ig.read` by itself; **Send to AI** on the status line
sends `ig.parentSent` (no banner: the parent sent it). The report holds what the fix agent needs to adjust the
reader, and no values:

| Evidence | What it is |
| --- | --- |
| `requests` | The last 30 requests of the page: method, path, parameter names, GraphQL's query name and `docId`, variable names, status, size, how many posts and collections were found; for 8 of them `answer`: the structure of the answer (keys and types), as text |
| `dom` | The page's outline: tags, roles, link patterns (`/p/*/`), which attributes there are; no texts |
| `rules`, `via`, `pageWorld`, `posts` | The rules in use, where the posts came from (`page` or `api`), whether the page world ran |

The account's username becomes `{user}` in the evidence. A report goes once per version (`core/checks`).

## Whose posts

A profile is one Instagram account: its username (key `instagram:@<username>`, folder `instagram/<username>/`).
Every Instagram page tells the background which account is signed in (`igAccount`; `content/api.js` `me()`: Instagram's
Edit profile form, else the account of the `ds_user_id` cookie).

| Where | What Connect does |
| --- | --- |
| The Connect bar on Instagram's pages, the header on the app's screen | Reads the account again, then: the profile already connected → "Already connected"; a known one → loaded; a new one → made, empty. Then the app opens |
| App in the Connect bar | Opens the profile of the account signed in here; none yet → it says to press Connect |
| The header's Instagram tile, no profile yet | Opens Instagram (`plainSite` with `offer`, kept an hour in `siteOffer`). The Connect bar says to sign in; signed in, it asks "Switch to the Instagram app now?": Switch to the app is Connect, Not now ends the offer |

While the Instagram app runs, any Instagram page that sees another account signed in switches to that account's
profile at once, as Connect does (`siteAccount` in `core/background/profiles.js`); the old profile's posts wait in
`acct:<key>`. Another account's saved posts never join a profile's list: if the switch fails, nothing is read and a
card offers Connect. Signed out: the profile stays, and a card says to sign in on Instagram itself.

## The screen

| Tab | What it shows |
| --- | --- |
| Saved | Every saved post (default) or one collection (the dropdown). ★ makes the shown one the default. Chips filter by status. ↻ reads Instagram again. While the whole list is read, **Stop** ends it there (`igStop`: the list counts as read to its end, ↻ then only adds the newest saves); **Read the rest** goes on from the kept position (`igResume`). ⤓ saves every saved post to a JSON file (`igExport`, `lib/posts.js exportFile`) |
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
| `lib/reader.js` | Plain rules (a plain script, loaded in the page world): the posts, collections and next position in an answer; the page's request with the next position |
| `lib/rules.js` | The reader's rules and their defaults; `site/remote.json` can change them |
| `content/net.js` | The page world: the page's requests and answers, the request again for the next page, the record for Send to AI |
| `content/api.js` | Instagram's web API: the signed-in account, saved posts, collections, one collection, one post |
| `content/app.js` | The two views of the Saved page, the screen (tabs, grid, sheet, notes, recording), the Connect bar, Send to AI, and the account report |

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
- Not tried on a real device or a real Instagram account yet: Instagram's web API can change (also the Edit profile
  form that names the account), and asks for a sign-in when its session ends (the screen then says so).
