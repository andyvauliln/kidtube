# KidTube for Orion: what changed

Newest first. Each version is built from `extension/` with `tools/build-orion.mjs` (see [ORION.md](../ORION.md)).

## 0.6.3 (2026-10-05)

- Fixes nothing yet; it finds out why youtube.com stayed white in Orion. Instead of a blank page, KidTube now says what is wrong.
- New page *Check this browser*: on the problem screen, or at the top of the KidTube settings. It tests what KidTube needs; press **Copy the result** and send it.

## 0.6.2 (2026-10-05)

- First build made just for Orion (iPad, iPhone, Mac). It has the same kid screens, rules and questions as the Android tablet (Quetta 0.6.2).
- Other websites are sent back to his list by KidTube; Orion has no blocking rules.
- Updates by hand: when the parent page shows *Install the new version*, download the Orion .zip from the install page and install it again.
- His activity says it came from Orion (`device.target`), so the helper can tell the iPad from the tablet.
- Not tried on a real iPad yet: see the checklist in [ORION.md](../ORION.md#unknowns-test-on-the-ipad).
