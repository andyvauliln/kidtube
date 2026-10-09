# extension/apps/kidtube/lib/

KidTube's helpers. The background, the screens and the tests import them; `agent/` imports `plan.js` too.

| File | What it does |
| --- | --- |
| `queue.js` | Which videos of the list he can open now, and which wait for the ⭐ videos (`requiredFirst`) |
| `plan.js` | The parent's plan changes made on the tablet: applied at once, sent to the helper as `plan` events, dropped once the helper has read them |
| `schedule.js` | The hours and the daily cap: is now allowed, when do the videos open again, why is it locked |
| `mark.js` | Checks an answer against a quiz item: typed answers must match, spoken ones only have to contain it |
| `captions.js` | YouTube's caption XML → lines of text |
| `voice.js` | Speaking and listening: the browser's own speech engines, recordings from the data repo, or a recording sent to an audio model. Every function has a quiet fallback |
