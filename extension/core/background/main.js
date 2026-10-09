// The service worker: the rules live here. Content scripts and pages only ask and show.
// This file registers the apps' background parts and wires the browser's events to the core modules
// (README.md in this folder lists them); each app's own rules are in apps/<app>/background/.
import { POLL_MINUTES, INSTALL_PAGE } from './constants.js';
import { withState } from './store.js';
import { registerApps, allParts } from './apps.js';
import { guard } from './guard.js';
import { applySiteRules } from './sites.js';
import { sync } from './sync.js';
import { latestRelease, autoUpdate } from './updates.js';
import { handle } from './messages.js';
import APP_BACKGROUNDS from '../../apps/backgrounds.js';

registerApps(APP_BACKGROUNDS);

// --- the tabs: every URL change goes through the guard -------------------------------------------
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url) return;
  withState((s) => guard(s, tabId, info.url)).then((target) => {
    if (target && target !== info.url) chrome.tabs.update(tabId, { url: target });
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  withState(async (s) => { for (const p of allParts()) await p.tabRemoved?.(s, tabId); });
});

// --- messages from content scripts, iframes and pages --------------------------------------
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
  // A fresh install without a connection: open the install page, where core/content/backup.js gives it back.
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
