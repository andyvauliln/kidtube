// The blank test app's page: the apps header in parent mode, and the Parent | Kid switch.
import { ask } from '../lib/ask.js';

const a = await ask({ type: 'apps' });
const parent = !!a?.parentMode;
if (parent) globalThis.KidTubeHeader.mount(document.getElementById('appHeader'));
document.getElementById('mode').replaceChildren(globalThis.KidTubeHeader.modeSwitch(parent ? 'parent' : 'kid'));
// The mode can change in another tab: draw again.
chrome.storage.onChanged.addListener((ch) => { if (ch.settings && (ch.settings.newValue?.mode === 'parent') !== parent) location.reload(); });
