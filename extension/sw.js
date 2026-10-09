// KidTube service worker: the rules live here. Content scripts and the iframes only ask and show.
// The work is in sw/: store (state), session (the kid's rules and the URL guard), sites (other websites),
// profiles (accounts and the apps header), parent (parent mode's data), sync (GitHub), transcripts, media,
// updates, and messages (one handler per message type). This file only wires the browser's events to them.
import { POLL_MINUTES, INSTALL_PAGE } from './sw/constants.js';
import { withState, effective } from './sw/store.js';
import { guard, leaveSession } from './sw/session.js';
import { applySiteRules } from './sw/sites.js';
import { sync } from './sw/sync.js';
import { latestRelease, autoUpdate } from './sw/updates.js';
import { handle } from './sw/messages.js';

// Kept for the tests and tools that import them from here.
export { fetchTranscript } from './sw/transcripts.js';
export { audioRefs } from './sw/media.js';

// --- the tabs: every URL change goes through the guard -------------------------------------------
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url) return;
  withState((s) => guard(s, tabId, info.url)).then((target) => {
    if (target && target !== info.url) chrome.tabs.update(tabId, { url: target });
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  withState(async (s) => {
    if (s.session?.tabId !== tabId) return;
    leaveSession(s, (await effective(s)).config, 'closed');
  });
});

// --- messages from content scripts, iframes, options --------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender).then(reply, (e) => reply({ error: String(e) }));
  return true;
});

// --- updates and lifecycle -----------------------------------------------------------------
chrome.runtime.onUpdateAvailable?.addListener(() => chrome.runtime.reload());

async function start() {
  chrome.alarms.create('poll', { periodInMinutes: POLL_MINUTES });
  chrome.alarms.clear?.('profileHold');               // 0.9.4–0.9.7's sign-in wait, replaced by the apps header
  await chrome.storage.local.remove('profileHold');
  await applySiteRules();
  sync();
}

chrome.runtime.onInstalled.addListener(async ({ reason } = {}) => {
  await start();
  // A fresh install without a connection: open the install page, where content/backup.js gives it back.
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (reason === 'install' && !settings.token) chrome.tabs.create({ url: INSTALL_PAGE }).catch(() => {});
  // After an update the open YouTube tabs still run the old content script, cut off from KidTube: reload them.
  if (reason === 'update') for (const t of (await chrome.tabs.query?.({ url: '*://*.youtube.com/*' }).catch(() => [])) ?? []) chrome.tabs.reload(t.id).catch(() => {});
});
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'poll') return;
  sync();
  autoUpdate(await latestRelease());
});
