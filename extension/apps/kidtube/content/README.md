# extension/apps/kidtube/content/

`youtube.js` runs on youtube.com and m.youtube.com after `core/content/shell.js`. It acts only while a KidTube
profile runs (the state from `KidTubeShell` says `app: 'kidtube'` and no apps header).

What it does:

- **Home page**: covers YouTube with his list (`kid/home.html`).
- **Watch page**: covers everything around the player (`kid/cover.html`) and puts the strip beside it
  (`kid/strip.html`): below the player upright, on the right sideways.
- **Lock**: when a `tick` answer says `lock`, the lock screen covers the page (`kid/home.html?locked=1`).
- **Playback time**: counts while the video plays and the page is visible, and sends `tick` every 5 seconds.
- **No skipping** (rule `allowSkip` off): no jumping forward, no speed above 1×.
- **Links** it doesn't own are swallowed; the service worker's guard is the real check.
- **Parent mode**: nothing is covered, nothing is counted.

**Iframes or in-page panels.** Normally the screens are extension iframes, which YouTube's CSS can't touch.
Orion shows extension iframes blank, so its build (`version_name` "… Orion") draws the same screens in a closed
shadow root with `kid/render.js` and `kid/ui.css`. Any other browser whose home iframe stays silent for 4 seconds
switches to panels too.
