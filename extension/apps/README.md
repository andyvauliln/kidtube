# extension/apps/

The apps. A profile is one YouTube account in one app; the app decides what the tablet does for it.

| Item | What it is |
| --- | --- |
| `registry.js` | Plain data about every app: label, tile color and glyph, its sites, its pages (`page`, `parentPage`), its context documents. Read by the background and by the pages |
| `backgrounds.js` | The list of the apps' background parts. `core/background/main.js` registers them |
| `kidtube/` | KidTube: the child's own video list on YouTube, time limits, the talking friend, parent mode |
| `instagram/` | Instagram: the account's saved posts on instagram.com, voice notes, and a list the server's posts agent handles (it writes down what each video says). No parent or kid mode |

## Add an app

1. Make `apps/<id>/` with a `README.md`.
2. Add an entry to `registry.js`: `id`, `label`, `color`, `glyph`, `about`, `sites`, `account` (the site in `SITES` whose
   signed-in account names its profiles: Connect on that site's page makes them), and `page`, `parentPage` or `home`
   (a web address its content script draws on, like Instagram's). `modes: false` for an app without parent and kid mode.
   A new site in `SITES` needs a content script that sets `globalThis.KidTubeAccount.read` and sends `siteAccount`.
3. Write its background part (`apps/<id>/background.js`, or a `background/` folder for a bigger app) and add it
   to `backgrounds.js`. The fields are listed at the top of `core/background/apps.js`.
4. Pages of the app go in its folder. To show the apps header, load `core/ui/header.js`.
5. A content script for its site: add it to `manifest.json` after `core/content/shell.js`, and use
   `globalThis.KidTubeShell` (see `core/content/README.md`).
6. On the server: an entry in `agent/config.json` `apps` if the helper should work for it.
