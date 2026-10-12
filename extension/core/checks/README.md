# extension/core/checks/

KidTube checks itself while it runs. Each check says what must be true after something happens, and finds out
whether it is. A failure becomes a **report** with what the server's AI needs to fix it.

| File | What it does |
| --- | --- |
| `kit.js` | `Expect` (what a check fills: `eq`, `ok`, `has`, `note`, `skip`), `redact` (no tokens, keys, PIN, names or texts in a report), `shapeOf`, `safeUrl` |
| `runner.js` | Runs the checks in the service worker, keeps the results and the reports (`chrome.storage.local` `checks`), the last 40 steps (`chrome.storage.session`), and the rules every message follows |
| `start.js` | The core's start checks (after an install, an update, a browser start, or **Run the start checks**) |
| `actions.js` | What each of the core's messages must have done |

An app adds its own in `apps/<app>/background/checks.js` (`checks` in its background part, see `core/background/apps.js`).
The pages report through `core/ui/watch.js`.

## Kinds of checks

| Kind | Where | Example |
| --- | --- | --- |
| `start` | the service worker, after a start | `start.github`: GitHub accepts the saved token |
| `action` | the service worker, after a message's answer | `action.kidHome`: kid mode is on, and 4 s later the tab is on his list |
| `screen` | a page (`watch.js check`) | `kid.list`: his list came from the background |
| `rule` | everywhere | `rule.deadButton.*`, `rule.noAnswer.*`, `rule.slowAnswer.*`, `rule.handlerError.*`, `rule.noReason.*`, `rule.pageError.*`, `rule.bgStuck` |
| `probe` | where the code already talks to an outside thing | `yt.switcher`, `yt.player`, `gh.sync`: fail only the second time, a minute or more apart |

A check is not failed when the device is offline (`net: true`), when it is skipped (`t.skip(why)`), or when the
page left or went to the background before the time ran out.

## A check

```js
// core/checks/actions.js or apps/<app>/background/checks.js, under the message type
setMode: {
  area: 'mode',
  expect: 'Parent | Kid: the mode is the one asked for',     // shown to the parent and sent in the report
  code: ['core/background/messages.js setMode'],              // where to look first
  snap: ['settings'],                                         // storage keys read before and right after the answer
  check(t, { msg, answer, before, after }) {
    t.eq('answer.ok', true, answer?.ok);
    t.eq('settings.mode', msg.mode, after.settings?.mode);   // one mismatch line: { what, expected, actual }
  },
  later: { ms: 4000, check: (t, c) => { /* the tab moved: c.tabUrl(c.tabId) */ } },
},
```

Name the value in `what` (`settings.mode`, `answer.error`), not a feeling. Put what helps find the cause in
`t.note(key, value)`: it goes into the report after `redact`.

## A report

```json
{ "type": "problem", "fingerprint": "action.account|0.10.3|orion", "check": "action.account", "kind": "action",
  "expect": "YouTube’s account reaches KidTube; another account than the profile’s stops the app",
  "saw": "shell.on (the app stopped): expected true, saw false",
  "mismatch": [{ "what": "shell.on (the app stopped)", "expected": true, "actual": false }],
  "evidence": { "message": { "type": "account", "loggedIn": true, "switcher": "(hidden)" }, "answer": { "ok": true } },
  "code": ["core/background/profiles.js youtubeAccount", "core/content/shell.js reportAccount"],
  "count": 2, "firstAt": "…", "lastAt": "…",
  "context": { "app": { "version", "target" }, "browser": { "userAgent", "online", "language", "timeZone" },
    "profile": { "app", "folder", "running", "mode", "shell", "youtube": { "signedIn", "sameAsProfile" }, "github": { "connected", "repo" } },
    "sync": { "at", "errors" }, "worker": { "blockingRules", "stuckStep" }, "page": { "url", "tab", "viewport" } },
  "steps": [{ "at": "…", "kind": "message", "type": "setMode", "ok": true }, { "kind": "tap", "label": "Connect", "page": true }] }
```

The same fingerprint (check, version, browser) counts up (`count`) on the tablet and is **not sent again**: the
server has it, and its fix agent may be working on it. The fix comes as a new version, which is a new fingerprint.
If the problem is still there in the new version, that is a new report (the server marks it as a regression).

## Where a report goes

1. **The data repo**, 10 s after it is made and with every sync: `problems/<YYYY-MM-DD>.json` at the top of the repo
   (not in a profile's folder: the apps header has no profile). One entry per `reportId`, sent once.
   No GitHub token: it waits on the tablet. The server reads these files (`docs/plans/FAST-FIX.md`, F4).
2. **A banner for 15 seconds** (`core/ui/watch.js`), on the first page where the parent is: parent mode, or the
   unlocked apps header. Never in kid mode: he does not see it, the parent sees it the next time.
3. **The parent page's bottom bar**: "⚠ N problems · sent, waiting for a fix" (or "not sent yet"); a tap opens
   **Check this browser** with every report, **Send the reports now**, **Copy** and **Clear**.
