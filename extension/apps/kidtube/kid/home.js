// The kid's home screen (his list), or the lock screen (?locked=1). Drawn by ui/render.js, the same code that
// draws the in-page screens on Orion; this file only connects it to the page and the background.
import { ask } from '../../../core/lib/ask.js';

const forceLock = new URLSearchParams(location.search).has('locked');

// Tells the YouTube page this screen runs. postMessage can be dropped or rejected on Orion;
// the service worker relays frameReady to the content script, which is the path that works there.
// The lock screen is the same file (?locked=1) and must not count as the home list opening.
if (!forceLock) {
  try { parent.postMessage({ kidtube: 'frame-ready' }, '*'); } catch {}
  ask({ type: 'frameReady' });
}

const screen = globalThis.KidTubeUI.mountHome(document.body, { ask, locked: forceLock });
chrome.storage.onChanged.addListener((c) => { if (c.data || c.watched || c.today || c.localConfig) screen.refresh(); });
