# extension/apps/kidtube/content/

`youtube.js` runs on youtube.com and m.youtube.com after `core/content/shell.js`. It acts only while a KidTube
profile runs (the state from `KidTubeShell` says `app: 'kidtube'` and no apps header).

What it does:

- **Home page**: covers YouTube with his list (`kid/home.html`).
- **Watch page**: covers everything around the player (`kid/cover.html`) and puts the strip beside it
  (`kid/strip.html`): below the player upright, on the right sideways.
- **Lock**: when a `tick` answer says `lock`, the lock screen covers the page (`kid/home.html?locked=1`).
- **Playback time**: counts while the video plays and the page is visible, and sends `tick` every 5 seconds.
- **No skipping** (rule `allowSkip` off): no jumping forward, no speed above 1×. An ad is not his video: it is not guarded.
- **Ads** (rule `blockAds`): YouTube's ad boxes are hidden; a video ad (the player's class `ad-showing`) is muted, run
  to its end at 16×, and Skip is tapped. An ad's end is never his video's end, and ad time is not counted. Checks:
  `yt.adSkipped` (an ad still there after 10 s, with the player's classes and the buttons found) and `yt.adWarning`
  (YouTube warns about ad blockers).
- **Links** it doesn't own are swallowed; the service worker's guard is the real check.
- **Parent mode**: nothing is covered, nothing is counted.

**Iframes or in-page panels.** Normally the screens are extension iframes, which YouTube's CSS can't touch.
Orion shows extension iframes blank, so its build (`version_name` "… Orion") draws the same screens in a closed
shadow root with `kid/render.js` and `kid/ui.css`. Any other browser whose home iframe stays silent for 4 seconds
switches to panels too.
