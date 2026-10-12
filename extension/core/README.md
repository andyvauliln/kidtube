# extension/core/

What every app uses. Nothing here knows about videos, quizzes or time limits: that is the app's job.

| Folder | What is inside |
| --- | --- |
| `background/` | The service worker: state, profiles, the guard's common part, site rules, sync timing, messages, updates |
| `content/` | Scripts that run on web pages: the apps header and lock on YouTube, YouTube's page data, the install-page backup |
| `ui/` | Plain scripts shared by pages and content scripts: the apps header, the start-up error box |
| `pages/` | The core's own pages: the one PIN page, the options page, "Check this browser" |
| `lib/` | Small helpers without state: accounts, GitHub, PIN hashing, time, YouTube addresses, versions |

## The core's jobs

- **Profiles.** One account in one app, the account of the app's own site (`account` in `apps/registry.js`): a YouTube
  email for KidTube, an Instagram username for Instagram. The header's Connect, on that site's page, takes the account
  signed in there. Another YouTube account stops a running YouTube app (`background/profiles.js`).
- **Modes.** Kid mode runs the app's rules. Parent mode (after the PIN) opens the app's parent screens and lifts
  the rules (`background/store.js` `parentMode`).
- **The apps header** above YouTube and above the apps' own pages (`ui/header.js`): sign in, switch the account,
  connect GitHub, open or add an app, save or load the settings file.
- **The lock**: an app stopped because YouTube's account changed covers YouTube until a grown-up's PIN.
- **Sync timing and the data location**: one data repo per tablet, one folder per profile.
- **Updates**: Quetta updates itself from `site/updates.xml`; Orion shows a link to the new zip.
