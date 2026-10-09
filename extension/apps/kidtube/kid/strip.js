// The strip beside the player: Home, the wait until he may choose another video, and the other cards.
// Drawn by ui/render.js (shared with the in-page screens on Orion).
import { ask } from '../../../core/lib/ask.js';

const screen = globalThis.KidTubeUI.mountStrip(document.body, { ask });
chrome.storage.onChanged.addListener((c) => { if (c.data || c.watched || c.today) screen.refresh(); });
