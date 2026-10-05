# KidTube for Orion: what changed

Newest first. Each version is built from `extension/` with `tools/build-orion.mjs` (see [ORION.md](../ORION.md)).

## 0.7.1 (2026-10-05)

- Parent screens: swipe left or right between the tabs (swipe right on a video's page to go back).
- New **Prompt** tab: how the helper works (when it runs, its latest diary, every step, the settings and models it uses, the rules it reads) and its whole prompt. **Your changes to the prompt** are instructions it follows on every run; you can remove them any time.
- New **Settings** tab: the settings page right inside the parent screens, without typing the PIN again.

## 0.7.0 (2026-10-05)

- **Parent mode** (Settings → Mode): YouTube opens your own screens instead of his list. Three tabs: **Today** (his list; make a video must-watch, remove it and the next planned one comes in), **Planned** (approve, must-watch, move to today, remove) and **History** (what he watched, by day, with his answers). Every list and every video takes a note for the AI. It turns itself off after 60 minutes (you can change that).
- Tap a video for its details: why it's on the list, what he learns, the summary, the friend's intro and outro, the questions, and a quiz you can try yourself.
- Everything is kept **per YouTube account**: sign in with another account and it has its own settings, lists and history. The PIN is the same for all.

## 0.6.5 (2026-10-05)

- The home list no longer jumps back to the top while scrolling.
- On the video page the strip below the video shows again: the other videos, **🏠 Home** (after the countdown) and **⚙️** settings. The covers around the video and the "That's all for today" screen show too. They were white because Orion doesn't display KidTube's screens as frames; Orion now gets them drawn straight on the page.

## 0.6.4 (2026-10-05)

- Fix for the white screen in Orion: KidTube now talks to its background the way Orion supports, so its screens get their answers.
- If the list's frame still doesn't open, KidTube draws the list straight on the YouTube page instead.
- New download link that never changes: `andyvauliln.github.io/kidtube/orion/kidtube-orion.zip` (always the newest Orion build).

## 0.6.3 (2026-10-05)

- Fixes nothing yet; it finds out why youtube.com stayed white in Orion. Instead of a blank page, KidTube now says what is wrong.
- New page *Check this browser*: on the problem screen, or at the top of the KidTube settings. It tests what KidTube needs; press **Copy the result** and send it.

## 0.6.2 (2026-10-05)

- First build made just for Orion (iPad, iPhone, Mac). It has the same kid screens, rules and questions as the Android tablet (Quetta 0.6.2).
- Other websites are sent back to his list by KidTube; Orion has no blocking rules.
- Updates by hand: when the parent page shows *Install the new version*, download the Orion .zip from the install page and install it again.
- His activity says it came from Orion (`device.target`), so the helper can tell the iPad from the tablet.
- Not tried on a real iPad yet: see the checklist in [ORION.md](../ORION.md#unknowns-test-on-the-ipad).
