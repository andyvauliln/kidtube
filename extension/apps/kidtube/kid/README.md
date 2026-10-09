# extension/apps/kidtube/kid/

The kid's screens. They only ask the background and show the answer.

| File | What it is |
| --- | --- |
| `render.js` | Builds the screens (plain script, sets `globalThis.KidTubeUI`): cards, the home list with the sun meter, the lock screens, the strip. Used by the pages here **and** by the in-page panels on Orion, so both look the same |
| `ui.css` | All styles of these screens; everything hangs off `.screen` (the panels load it into a shadow root) |
| `home.html` + `home.js` | His list, or the lock screen with `?locked=1` |
| `strip.html` + `strip.js` | The strip beside the player: Home, the wait until he may choose another video, the other cards |
| `cover.html` | An empty cover around the player |
| `talk.html` + `talk.js` | The talking friend: the intro before a video; after it, what we learned and the questions (typed, tapped or spoken) |
| `rig.js` | Brings the friend's SVG to life: breathing, blinking, mouth shapes while it talks |

Speaking and listening are in `../lib/voice.js`, answer marking in `../lib/mark.js`.
