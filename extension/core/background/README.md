# extension/core/background/

The service worker's core. `main.js` is the entry point (named in `manifest.json`). It registers the apps'
background parts (`apps/backgrounds.js`) and wires the browser's events to the modules below.

| File | What it does |
| --- | --- |
| `main.js` | Event wiring: tab URL changes → `guard.js` and `tabs.js`, messages → `messages.js`, the 15-minute alarm → sync and update check, install and start-up |
| `apps.js` | The contract of an app's background part, and `partOf(account)`: the part of the profile's app |
| `store.js` | The state in `chrome.storage.local`. Every change of the profile's state goes through `withState()`, one at a time. Also the modes, the apps header state (`shellOf`) and the data location |
| `guard.js` | The guard's common part: extension pages, Google's sign-in and the apps header pass; other websites → `sites.js`; YouTube pages → the app's `guard` |
| `sites.js` | Other websites: one blocking rule (declarativeNetRequest), or the guard's fallback where there are no rules (Orion). The app says which domains stay open |
| `profiles.js` | Profiles and the apps header: who YouTube has, switching profiles, the header's apps, the GitHub connection, the settings file |
| `tabs.js` | One tab for YouTube and KidTube's pages: a tab that opens one closes the others |
| `sync.js` | When a sync runs (one at a time, soon after activity, when stale), `profile.json`, then the app's `sync`. Also the install page's backup of the connection |
| `messages.js` | The core's message types (header, PIN page, modes, sync, updates), the route to the apps' handlers, and the check that some types come only from extension pages |
| `updates.js` | New versions: `latest.json`, the update check, the "Update" button |
| `constants.js` | Names shared by these modules: the repo, the Pages address, the PIN page, settings that belong to the tablet |

## An app's background part

A plain object, all fields optional except `id` (full list in `apps.js`):

```js
export default {
  id: 'myapp',
  stateKeys: ['myState'],            // per-profile keys changed through withState()
  guard(s, tabId, c, href) {},       // a YouTube page: return a URL to send the tab to, or null
  view(s) {},                        // what the app's screens get from the 'state' message
  handlers: { myMessage: (msg, ctx) => ({ ok: true }) },
  pageOnly: new Set(['myMessage']),  // only the extension's own pages may send these
  async sync({ loc, token, data, status, acct }) {},
  siteRules(stored) { return { block: true, allowed: [] }; },
};
```

The core never imports an app; `main.js` hands the parts over with `registerApps()`. That keeps the imports one-way:
apps import the core, never the reverse (except the plain data in `apps/registry.js`).
