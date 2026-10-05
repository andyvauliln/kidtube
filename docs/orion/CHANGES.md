# KidTube for Orion: what changed

Newest first. Each version is built from `extension/` with `tools/build-orion.mjs` (see [ORION.md](../ORION.md)).

## 0.8.5 (2026-10-05)

- Fixes "something went wrong" when installing 0.8.3 and 0.8.4 in Orion.
- On Orion, the GitHub connection is no longer kept on the install page; use Settings → Save settings to a file before reinstalling.

## 0.8.4 (2026-10-05)

- If the parent screens fail to start, they now show a red box with the reason instead of a white page.

## 0.8.3 (2026-10-05)

- Your GitHub connection and parent PIN now survive removing and reinstalling KidTube. KidTube keeps a copy on its install page; after a fresh install it opens that page and takes the copy back by itself ("✓ KidTube: your GitHub connection and parent PIN are back").
- "⬆ Download" in parent mode now opens the install page (download the .zip there); that also refreshes the copy.

## 0.8.2 (2026-10-05)

- The tablet fetches the newest list whenever a KidTube screen opens (if the last check is over 2 minutes old), and sends what he watched and answered about 20 seconds after each video.
- Parent mode → Prompt: **Latest runs** (when, nightly or on request, minutes, steps, cost) and **Step details (skills)** — everything the helper reads.
- The helper now plans by subject: today's list follows the balance in the Strategy document, and new videos are searched from each subject document.

## 0.8.1 (2026-10-05)

- Every place you write a note for the helper (Today, Planned, History, each video, Context, Prompt) now has the same three buttons:
  - **🎤** dictate the note (tap ⏹ to stop);
  - **Add note** — save it; add as many as you like;
  - **Add & ↻ Update** — save it and run the helper now with all your notes from every tab.

## 0.8.0 (2026-10-05)

- New **Context** tab in parent mode: the documents the helper plans from — About him, Strategy, Math, Letters, World. Read them and add notes; the helper works your notes into the document on its next run (tap ↻ Update to run it now).
- Every video now has a subject (math, letters, world or other).

## 0.7.4 (2026-10-05)

- Settings → Connection: **Save settings to a file** and **Load settings from a file**. Removing the extension erases the GitHub key and PIN; after a reinstall, set any PIN, then load the file to get both back.
- The Settings tab in parent mode now uses the full page height instead of a small box that scrolls inside.

## 0.7.3 (2026-10-05)

- **↻ Update** button at the top of parent mode: sends your notes and what he watched, then the helper runs right away (it starts within a minute or two and takes about 10–30 minutes).
- Next to it: "Waiting for the server…", "Helper is working…", then "Updated" with the time. The lists refresh by themselves when it's done.
- At most 6 runs on request a day; the nightly run still happens.

## 0.7.2 (2026-10-05)
- Parent mode shows the app version at the top; when a newer one exists, a "⬆ Download" link gets the new .zip directly.
- The home screen refills itself: when he watches a video or you remove one, the next ready video takes its place (up to 10 on screen).
- Parent mode → Today shows only the current 10 (plus watched); the spares wait in Planned.
- Parent mode → Prompt shows what the helper noticed, its study plan, and the messages it keeps in mind. Notion is no longer used.

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
