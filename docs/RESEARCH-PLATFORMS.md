# Research: one KidTube view over several video sites (YouTube, Netflix, …)

*Written 2026-10-06, starting from version 0.9.3. It is research, not a plan; nothing here is built yet. Everything here is about **websites in the browser** (Quetta on Android, Orion on iPad), not the platforms' own apps. Background: [HOW-IT-WORKS.md](HOW-IT-WORKS.md), [PLAN-PROFILES.md](PLAN-PROFILES.md), [ORION.md](ORION.md). Facts marked **[probe]** were checked on 2026-10-06 by requesting the pages as a tablet browser or calling the public API. Facts marked **(unconfirmed)** need a test on a device.*

## The question

Today KidTube is our own view on top of youtube.com: our list, our rules, our screens, and YouTube only plays the video. How can the same view, with the same functionality and logic, sit on top of **several sites at once**? We want one list that mixes items from YouTube, Netflix and others, with the same rules, the same parent screens and the same helper.

## Short answer

- **The view becomes ours, and the sites become players.**
  - The list, the kid's home, the parent screens, the talking friend and the quiz live in **extension pages** we own.
  - A site is only asked to *play one item*. Afterwards, the child comes back to our page.
- **Each site gets an adapter:** a small module that tells our shared logic how to work with that site. It covers:
  - its links and ids;
  - how to open an item;
  - what to hide on its page;
  - where its player is and how to read time, length and the end;
  - how the helper searches it.
  - Site-specific behaviour, like Netflix's next-episode autoplay, is a hook in the adapter. The rules engine stays one.
- **A site plays its item in one of two ways:**
  - **embedded** in our own player page, when the site allows embedding (YouTube embed, Dailymotion, Vimeo, Internet Archive);
  - **covered**: the tab goes to the site's own watch page, and our content script hides everything except the player (how YouTube works now). This is for sites that refuse to be embedded, such as Netflix.
- **One list, many sites:** the id gets a site prefix (`nf:81234567`, `dm:x8abcd1`); plain 11-character ids stay YouTube. Old lists and history stay valid.
- **Netflix has a limit that is in its site, not ours:**
  - **netflix.com won't play video in any Android browser**, Quetta included. It redirects Android browsers away from the player **[probe]**, and "desktop site" mode ends in a DRM error.
  - It is supported in Safari on the iPad; Orion is unconfirmed.
  - So in a mixed list, Netflix items can play only on the iPad (and on a desktop), and the Android tablet should hide them.

---

## 1. How the YouTube view works today

There are four layers. Only the last two know about YouTube.

```
 ┌───────────────────────────────────────────────────────────────┐
 │ 1. Logic (service worker, sw.js)                              │
 │    list, rules, budget, sessions, watched, outbox, sync,      │
 │    profiles, helper requests                                  │
 └───────────────┬───────────────────────────────────────────────┘
                 │ messages: open, tick, ended, details, state …
 ┌───────────────┴───────────────────────────────────────────────┐
 │ 2. Our screens (extension pages: ui/home, ui/talk, ui/strip,  │
 │    parent/, settings/)                                        │
 └───────────────┬───────────────────────────────────────────────┘
                 │ drawn over the site (iframe, or in-page panel on Orion)
 ┌───────────────┴───────────────────────────────────────────────┐
 │ 3. Guard (sw.js guard() + lib/url.js + blocking rules)        │
 │    every URL change in the tab is checked: allowed, or home   │
 ├───────────────────────────────────────────────────────────────┤
 │ 4. Site hooks (content/content.js + content/main.js)          │
 │    hide YouTube's UI, find its <video>, ticks, no-skip, end,  │
 │    real channel/length, signed-in account                     │
 └───────────────────────────────────────────────────────────────┘
```

**Where YouTube is hard-coded:**

| Layer | File | YouTube-only parts |
| --- | --- | --- |
| Guard | `extension/lib/url.js`, `sw.js` `guard()`, `applySiteRules` | `youtube.com` hosts; `/watch?v=` with an 11-character id; shorts, search and channel paths; every other host counts as external |
| Screens | `content.js` + `ui/home.html` | The kid's home is drawn **over YouTube's home page** |
| Site hooks | `content/content.js`, `content/main.js` | `.ytp-*`/`ytm-*` selectors, `ytcfg`, `getPlayerResponse()`, `DATASYNC_ID` |
| Data | `schemas/queue.schema.json`, `common.schema.json`, `lib/queue.js` | `videoId` is exactly 11 characters, `channelId` must be `UC…`, thumbnails must come from `i.ytimg.com` |
| Talk and quiz | `lib/captions.js`, `sw.js` `uploadTranscripts` | YouTube caption XML |
| Helper | `agent/kt.mjs search`, `tools/video-info.mjs`, `agent/lib/prompts.mjs`, `.claude/agents/video-scout.md` | YouTube search |
| Manifest | `extension/manifest.json` | Hosts and content scripts only for `*.youtube.com` |

**Not tied to any site:**
- the rules engine: budget, sessions, must-watch ⭐, approval, watched marks, lock, outbox, activity, sync, profiles;
- the parent screens.

They work on an id, a title and a length. That is what makes several sites possible without rewriting the logic.

---

## 2. Four ways to put one view over many sites

### A. Our hub, and the site covered while it plays (today's way, extended)

```
 our home page ──open──▶ site's watch page (covered) ──ended──▶ our home page
 (extension page)        content script: hide the site,         talk / quiz
                          keep the player, ticks, no-skip
```

- **How it works:**
  - The tab goes to the site's own watch URL.
  - A content script for that site hides everything except the player and draws our strip and badge.
  - The guard lets only that one listed item through.
- **Good:**
  - Works with any site that plays in the browser, including those with DRM and sign-in (Netflix), because the site plays on its own page.
- **Bad:**
  - Each site needs its own hide-list of CSS selectors, which breaks when the site changes its page.
  - The site's own autoplay and suggestions must be caught by the guard.

### B. Our player page, with the site's embedded player inside

```
 our home page ──open──▶ ui/player.html?v=dm:x8abcd1 ──ended──▶ our home page
                         ┌──────────────────────────┐
                         │ our strip, our controls  │
                         │ ┌──────────────────────┐ │
                         │ │ site's embed iframe  │ │ ← player API: play, pause, time, ended
                         │ └──────────────────────┘ │
                         └──────────────────────────┘
```

- **How it works:**
  - Our own page hosts the site's **embed player** (an iframe the site offers for embedding) and talks to it through the site's player API.
- **Good:**
  - Nothing to hide: an embed has no site navigation and few suggestions.
  - One page plays every embeddable site.
  - The guard only has to allow our page.
  - The view looks the same whatever the site.
- **Bad:**
  - Only sites that allow embedding.
  - MV3 extension pages can't load remote scripts, so a site's player library has to be bundled into the extension (Vimeo's `player.js` is MIT and can be). Otherwise the page talks to the iframe through `postMessage`.

### C. Our own `<video>` with the site's file

- **How it works:** our player page plays the media file directly.
- **Fits:** only open files, such as Internet Archive's MP4s.
- **Good:** full control: time, end, no-skip, speed, our own captions.
- **Not possible for:**
  - YouTube: its files are protected and its terms forbid it;
  - any DRM site.

### D. The whole site in an iframe inside our page

- **How it works:** our page frames the site's full watch page.
- **Why it doesn't work:**
  - netflix.com sends `X-Frame-Options: DENY` on every page, PBS KIDS sends `DENY`, and YouTube and Prime send `SAMEORIGIN` **[probe]**.
  - Chrome's blocking rules can strip those headers. Even then, DRM inside a frame needs extra permissions, sign-in cookies count as third-party, the site may refuse to run, and Orion has no blocking rules at all.
- **Verdict:** not a real option.

### Recommendation: A + B (+ C where it fits)

- **Our pages are the frame of the whole experience:**
  - the kid's home;
  - the talking friend and the quiz;
  - the lock screen;
  - the player page.
- **Each adapter says how its site plays:**
  - **B** if the site can be embedded (Dailymotion, Vimeo; maybe YouTube later);
  - **C** for open files (Internet Archive);
  - **A** for sites that must play on their own page (YouTube now, Netflix).
- **The child always starts and ends on our page.** Only the part in the middle (playing) differs by site.

---

## 3. The adapter: one module per site

The shared logic only calls the adapter. A new site means a new adapter, not a change to the rules.

```js
// extension/lib/sites/netflix.js
export default {
  id: 'netflix', prefix: 'nf', label: 'Netflix', icon: 'ui/sites/netflix.svg',
  hosts: ['netflix.com'],
  mode: 'cover',                       // 'cover' (A) | 'embed' (B) | 'file' (C)
  plays: { quetta: false, orion: true }, // netflix.com doesn't play in Android browsers

  // Guard: what is this URL? The guard decides with the same rules for every site.
  classify(url) {},                    // → { kind: 'watch', id: '81234567' } | { kind: 'home' | 'browse' | 'search' | 'other' }
  openUrl(id) {},                      // https://www.netflix.com/watch/81234567
  homeKinds: ['home', 'browse'],       // these go to OUR home page in kid mode

  // Different logic per site: hooks the shared logic calls.
  hooks: {
    // Netflix plays the next episode by itself: the guard sees /watch/<next> and sends him home,
    // unless the parent listed the next episode too.
    onAutoNext: 'home',
    // Before the item opens, e.g. "is someone signed in on this site?"
    async beforeOpen(item, page) {},
  },
};
```

**Each adapter also has a page-side part**, `content/sites/netflix.js`, that only runs on its site (cover mode):

```js
export default {
  hideCss: `…the site's rows, search, profile menu, post-play panel…`,
  findPlayer() {},            // the <video>, plus the site's own player API when needed (page-world script)
  readDetails() {},           // real title, length, creator → 'details' (as content/main.js does for YouTube)
  seek(seconds) {},           // for no-skip; Netflix needs its own player API: setting video.currentTime breaks it
  account() {},               // who is signed in, when the site shows it (YouTube: ytcfg)
};
```

The shared `content/content.js` keeps everything common: screens, ticks, the `ended` event, no-skip and the time lock. It loads the adapter for the host it runs on.

**Embed-mode adapters** (`mode: 'embed'`) have an `embed` part instead. `ui/player.html` uses it:
- `embedUrl(id)`;
- `connect(iframe)` → `{ play, pause, time, duration, onEnded }`, from the site's player API.

The player page sends the same `tick` and `ended` messages as a covered page. The logic can't tell the two apart.

**What changes in the shared code:**
- **Guard:**
  - `lib/url.js` asks every enabled adapter's `classify`.
  - "external" means "no enabled adapter knows this host".
  - A `watch` on any site goes through the same `isOpenable()`.
  - A site's home or browse page goes to **our** home.
- **Blocking rules:** `allowedDomains` adds the hosts of enabled adapters (cover mode), and the embed and file hosts the player page needs.
- **Manifest:**
  - one `content_scripts` entry per cover-mode site;
  - host permissions for each site, under `optional_host_permissions` where possible, so they are asked when the parent turns that site on. Orion's support for `permissions.request` is unconfirmed; the Orion build may list them up front.
- **Kid's home:**
  - It moves off YouTube's home page and becomes a top-level extension page (`ui/home.html`), like the Blank test app's `ui/blank.html` already does.
  - `ended` goes back there instead of `homeUrl(host)`.
  - This needs a check on Orion: extension *iframes* on web pages don't show there, but top-level extension pages (Settings, parent mode) do.
- **Profiles (0.9):** a profile still follows YouTube's signed-in account when YouTube is one of its sites. Other sites are signed in once in the browser and shared by the profiles.

---

## 4. One logic across sites

Nothing in the rules has to know about sites, because every site reports the same few things:

| Event | Today (YouTube) | Any site |
| --- | --- | --- |
| `open {videoId}` | from our home card | same; the adapter gives the URL, or the player page for embeds |
| `details {videoId, length, creator}` | `content/main.js` reads YouTube's player data | the adapter's `readDetails()`, or the embed API's duration |
| `tick {videoId, seconds}` | `content.js` counts the `<video>` | same, from the covered page or from the player page |
| `ended {videoId}` | `<video>` `ended` | the same event, or the embed API's end event |
| guard on URL change | `tabs.onUpdated` → `guard()` | same, with the adapters' `classify()` |

**What follows from that:**
- **Sessions cross sites naturally.** The service worker holds the one session, today's budget and the lock, so the child can go YouTube → our home → Netflix → our home with one timer.
- **The talking friend's intro and outro, and the quiz,** are our pages and appear before and after any site.

---

## 5. One list with several sites

### Ids

- **Format:**
  - A plain 11-character id stays YouTube: `dQw4w9WgXcQ`.
  - Every other site is `"<prefix>:<id>"`: `nf:81234567`, `dm:x8abcd1`, `vm:76979871`, `ia:popeye_taxi-turvy`.
  - A colon can't occur in a YouTube id, so no id can mean two things.
- **Why:**
  - `videoId` is the key in many places: queue, `watched`, `seen`, sessions, activity events, `memory.shown`, `helper.json`, plan actions, notes, quiz links and the parent's `#v=<id>` routes.
  - With prefixes, all of them keep working and **old data needs no migration**.
- **Schema (`common.schema.json`):** `videoId` becomes `^([A-Za-z0-9_-]{11}|[a-z]{2}:[A-Za-z0-9._-]{1,64})$`.
- **List items:**
  - `channelId` is required only for YouTube ids.
  - Other sites get `creator`, plus optional `kind` (`video` / `movie` / `episode`) and `series` (`{title, season, episode}`).
  - `thumbnailUrl` allows each site's image hosts.
- **Files:** per-site folders, `transcripts/<site>/<id>.json`; YouTube keeps `transcripts/<id>.json`.
  - Not a colon in file names.
  - Not `nf-…`, because `nf-81234567` is also a valid YouTube id.

### Rules per site (`parent-config.json`)

The daily budget and session rules stay shared. Each site can tighten them:

```json
"sites": {
  "youtube":     { "enabled": true },
  "netflix":     { "enabled": true, "country": "US", "maxItemsPerDay": 1, "maxVideoDurationSeconds": 1800 },
  "dailymotion": { "enabled": true, "approvalRequired": true }
}
```

- **Length cap per site:** a film is 80 minutes, a YouTube video at most 20. Without this, one global cap either blocks films or lets long YouTube videos in.
- **`maxItemsPerDay`:** for example, one Netflix episode a day and the rest from YouTube.
- **`approvalRequired`:** open sites have no kids' catalog, so the parent approves before an item shows.

### The screens

- **Kid's home:**
  - one list;
  - each card has a small site badge;
  - items whose site can't play on this device are hidden (Netflix on the Android tablet);
  - must-watch ⭐, order, intro and outro work the same everywhere.
- **Parent mode:**
  - **Today / Planned / History:** the same badges, and filter chips: **All · YouTube · Netflix · Dailymotion …**.
  - **Add by link:** one box for any supported link. Each adapter's `classify()` finds the id; the title and length come from the next helper run, or from the page when it plays. An unknown site says which sites are supported.
  - **Video detail:** series, season and episode for shows, and "plays on: iPad only" when that applies.
- **Settings → Sites (new section, per profile):**
  - each site with an on/off switch;
  - the country (Netflix's catalog depends on it);
  - whether it is signed in on this device, where the page shows it;
  - the limits above.

---

## 6. The helper (server)

**Search per site:** `kt.mjs search "<query>" [n] [lang] --site <id>`. Each site gets a module, `tools/sites/<id>.mjs`, that returns the same candidate shape:
`{ videoId: 'nf:81234567', title, durationSeconds, creator, thumbnailUrl, lang, kidsFlag, rating, kind, series }`.

| Site | How the helper finds items |
| --- | --- |
| YouTube | as today |
| Netflix | No official API, and Netflix's terms forbid robots and scrapers on netflix.com, so the server never touches it. **Streaming Availability API** (Movie of the Night): Netflix ids and links per country, episodes too; free for 1,000 requests a month, commercial use allowed. TMDB has descriptions and age ratings, but no Netflix ids or links, and it is non-commercial only. |
| Dailymotion | Public API without a key **[probe]**, with an `is_created_for_kids` field that is often empty |
| Vimeo | API with a token (in the secrets file); search terms unconfirmed |
| Internet Archive | `advancedsearch.php` JSON without a key **[probe]** |

**Other changes:**
- **Planning:** the planning prompt gets the enabled sites and their limits. Searches carry a `site`, and the candidates table gets a site column. Picking already works on ids.
- **Talk and quiz:**
  - For sites without transcripts (Netflix), the intro, outro and quiz come from the description and the parent's notes.
  - Reading Netflix's on-screen captions on the tablet is technically possible (Firefox's picture-in-picture reads `.player-timedtext`). It is fragile and pushes against Netflix's terms, so leave it out.

---

## 7. Site by site

| Site | Plays in Quetta (Android) | Plays in Orion (iPad) | Can be embedded | Mode | Notes |
| --- | --- | --- | --- | --- | --- |
| **YouTube** | Yes | Yes | Embed exists, but it loses the signed-in account (profiles) and some videos forbid it | cover (as now) | — |
| **YouTube Kids** (youtubekids.com) | The site loads, no redirect **[probe]** | Signed-out Safari supported (unconfirmed in Orion) | `SAMEORIGIN` | cover | Same video ids as YouTube; little gain |
| **Netflix** | **No** (redirect away from the player **[probe]**, DRM error M7121-1331-P7 in desktop mode) | Safari supported up to 1080p; **Orion unconfirmed** (some titles fail, fullscreen broken) | No (`DENY`) | cover | The player API is reachable from a page-world script: `netflix.appContext.state.playerApp.getAPI().videoPlayer`, with `getCurrentTime()`, `getDuration()`, `pause()` and `seek(ms)` (used by Firefox's picture-in-picture). Autoplays the next episode. Page fields change without notice (Language Reactor broke in June 2026). |
| **Disney+** | No (mobile browsers not supported) | No | No | — | Leave out |
| **Prime Video** | No (player opens, video doesn't play) | iOS 26 Safari fixed for desktop mode; Orion unconfirmed | `SAMEORIGIN` | — | Leave out for now |
| **Dailymotion** | Yes | Yes | Yes | embed | Player API: play, pause, seek, state, events |
| **Vimeo** | Yes | Yes | Yes (owners can limit domains) | embed | `player.js` can be bundled: time, events, `getTextTracks`, captions (`cuechange`) |
| **Internet Archive** | Yes | Yes | Yes | file (our `<video>`) | Plain MP4, full control |
| **PBS KIDS** | Unconfirmed | Unconfirmed | No (`DENY`) | cover | No public search API |
| **Khan Academy** | — | — | — | — | Its videos are on YouTube; use those |

---

## 8. Risks

- **Netflix's terms** forbid "insert[ing] any code … or manipulat[ing] the content of the Netflix service". A content script that hides its rows and pauses at the time limit breaks the letter of that, as Teleparty and Language Reactor do. The risk is low for a family's own use, but not zero.
- **Breakage:** cover-mode adapters depend on each site's page structure. Each one is a small, separate file, so a break affects one site only.
- **Orion:** Netflix's DRM there is unproven, and fullscreen is reported broken.
- **Catalogs:** Netflix titles come and go by country and month. The helper rechecks before an item goes on today's list, and the tablet handles a title that won't play.
- **Safety on open sites:** Dailymotion, Vimeo and Internet Archive have no kids' catalog. Their items need parent approval by default.

---

## 9. Suggested order

| Phase | What | Done when |
| --- | --- | --- |
| **0. Device check (no code)** | iPad, Orion: sign in to Netflix, open `https://www.netflix.com/watch/<id>` of a kids' title. Does it play, does fullscreen work, does the next episode start by itself? Both devices: open a Dailymotion and a Vimeo embed page. | We know which sites play where |
| **1. Ids and schema** | Prefixed `videoId`, per-site item fields, `parent-config.sites`, validation and tests. YouTube only, no visible change. | `npm test` passes with a mixed fixture list |
| **2. Adapters** | YouTube's code moves into `lib/sites/youtube.js` and `content/sites/youtube.js`; the guard and blocking rules ask the registry. | Same behaviour on both devices |
| **3. Our own home and player page** | `ui/home.html` as a top-level page for every site's home; `ui/player.html` for embed and file modes. | Works in Quetta and Orion |
| **4. A second site, embedded** | Dailymotion or Internet Archive: adapter, helper search, badges, filter, Add by link. | A mixed YouTube + second-site list works end to end |
| **5. Netflix, covered** | Adapter with the post-play hook and seek through its player API; Streaming Availability search; Settings → Sites; hidden on Android. | On the iPad, a Netflix episode from the list plays, counts time, stops at the limit and returns to our home |

## 10. Questions

1. Which site after YouTube: one that works on both devices (Dailymotion, Vimeo, Internet Archive), or Netflix, which can only work on the iPad?
2. Which country is the Netflix account in? The catalog depends on it.
3. Is a free Streaming Availability API key OK? 1,000 requests a month, no card.

## Sources

- Netflix supported browsers: https://help.netflix.com/en/node/23742 and https://help.netflix.com/en/node/100
- Netflix on Android in desktop mode (M7121-1331-P7): https://ask.metafilter.com/318169/How-can-I-watch-Netflix-on-Chrome-for-Android
- Orion and Netflix: https://orionfeedback.org/d/2785-netflix-stream-error, https://orionfeedback.org/d/12048-orion-doesnt-work-with-some-video-playback-netflix, https://forum.languagelearningwithnetflix.com/t/orion-on-ipad/41195
- Netflix player API used by Firefox picture-in-picture: https://raw.githubusercontent.com/mozilla-firefox/firefox/main/browser/extensions/pictureinpicture/video-wrappers/netflix.js
- Language Reactor breakage, June 2026: https://forum.languagelearningwithnetflix.com/t/language-reactor-gets-stuck-on-loading/40501?page=3
- Netflix terms of use (updated 2026-04-10): https://help.netflix.com/legal/termsofuse
- TMDB watch providers and terms: https://developer.themoviedb.org/reference/movie-watch-providers, https://www.themoviedb.org/api-terms-of-use
- Streaming Availability API: https://www.movieofthenight.com/about/api, https://www.movieofthenight.com/about/api/pricing
- Disney+ in browsers: https://www.androidcentral.com/can-you-watch-disney-plus-desktop
- Prime Video browsers: https://primevideo.com/supported-browsers; WebKit fix for iPad: https://bugs.webkit.org/show_bug.cgi?id=301171
- YouTube Kids browsers: https://support.google.com/youtubekids/answer/9597907
- Dailymotion player methods: https://developers.dailymotion.com/docs/use-player-methods-web
- Vimeo player.js: https://github.com/vimeo/player.js
- PBS Media Manager: https://digitalsupport-stations.pbs.org/products/media-manager
- Khan Academy API shutdown: https://github.com/Khan/khan-api/issues/149
- Encrypted media in iframes: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Feature-Policy/encrypted-media
