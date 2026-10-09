// Messages from the content scripts, the screens and the pages: one handler per message type. The core's own
// types are here (the apps header, the PIN page, modes, sync, updates); the rest belong to the apps (apps.js
// handlers). Content scripts and screens only ask and show; the handlers decide.
import { TARGET } from '../lib/target.js';
import { homeUrl } from '../lib/youtube.js';
import { appOf } from '../../apps/registry.js';
import { PIN_PAGE } from './constants.js';
import { withState, parentMode, shellOf, fromExtensionPage, live } from './store.js';
import { applySiteRules } from './sites.js';
import { guard } from './guard.js';
import { youtubeAccount, headerView, openApp, connectGitHub, exportSettings, importSettings, leaveApp, pinPageView } from './profiles.js';
import { sync, syncIfStale, settingsBackup } from './sync.js';
import { checkUpdate, appVersion, updateApp } from './updates.js';
import { partOf, allParts } from './apps.js';

const pinPage = (purpose) => chrome.runtime.getURL(`${PIN_PAGE}?for=${purpose}`);

// ctx: { tabId, host, sender } of the message.
const HANDLERS = {
  // "Check this browser" and the screens' fallbacks: is the background alive, and what does it have?
  ping: () => ({ ok: true, version: chrome.runtime.getManifest().version, target: TARGET, at: new Date().toISOString(),
    apis: ['alarms', 'storage', 'tabs', 'declarativeNetRequest', 'permissions', 'scripting'].filter((n) => !!chrome[n]) }),

  // What a screen or content script on YouTube shows: the app's view, the mode and the apps header.
  // Screens ask every second or so; the newest files are fetched when the last sync is a few minutes old.
  state: () => {
    syncIfStale(2);
    return withState(async (s) => {
      const { account } = await chrome.storage.local.get('account');
      const view = (await partOf(account).view?.(s)) ?? {};
      return { ...view, app: appOf(account).id, parentMode: parentMode(s), shell: await shellOf() };
    });
  },


  // From the YouTube page: who is signed in.
  account: (msg) => youtubeAccount(msg),

  // The apps header (core/ui/header.js) on YouTube and on an app's pages.
  header: (msg) => headerView(!!msg.refresh),
  openApp: (msg, { tabId, host }) => openApp(msg, tabId, host),
  connectGitHub: (msg) => connectGitHub(msg),
  exportSettings: () => exportSettings(),
  importSettings: (msg) => importSettings(msg.file),

  // The lock's Unlock: the PIN page, then back to the header.
  openApps: async (msg, { tabId }) => {
    if (tabId != null) await chrome.tabs.update(tabId, { url: pinPage('unlock') });
    return { ok: true };
  },

  // The kid's 🔒 Parent button, an app page's Parent switch: the PIN page, then parent mode.
  parentGate: async (msg, { tabId }) => {
    if (tabId != null) await chrome.tabs.update(tabId, { url: pinPage('parent') });
    else await chrome.tabs.create({ url: pinPage('parent') });
    return { ok: true };
  },

  // The PIN page (a locked header): back to the header.
  leaveApp: () => leaveApp(),

  // The PIN page: what runs now, whether it may skip the PIN, and where YouTube is.
  apps: () => withState((s) => pinPageView(s)),

  // Settings page or parent screens, after the PIN. Parent mode stays on until the parent switches back (no timer since 0.8.9).
  setMode: (msg) => {
    if (!['kid', 'parent'].includes(msg.mode)) return { ok: false, error: 'Unknown mode.' };
    return withState((s) => {
      Object.assign(s.settings, { mode: msg.mode, parentUntil: 0 });
      return { ok: true, until: 0, parentMode: parentMode(s) };
    }).then(async (r) => { await applySiteRules(); return r; });
  },

  // A YouTube home tab in parent mode becomes the app's parent screens (an app without them: its own page, as its guard).
  openParent: (msg, { tabId }) => withState(async (s) => {
    if (!parentMode(s) || tabId == null || (await shellOf()).on) return { ok: false };
    const app = appOf((await chrome.storage.local.get('account')).account);
    await chrome.tabs.update(tabId, { url: chrome.runtime.getURL(app.parentPage ?? app.page) });
    return { ok: true };
  }),

  // Parent mode just ended on this page (or the apps header closed): the app's rules apply to it again.
  recheck: (msg, { tabId, sender }) => withState((s) => guard(s, tabId, msg.url ?? sender.tab?.url ?? '')).then((target) => {
    if (target && tabId != null && target !== msg.url) chrome.tabs.update(tabId, { url: target });
    return { ok: true };
  }),

  // Parent screens → kid mode: back to the app's home (KidTube: his list on YouTube).
  kidHome: async (msg, { tabId }) => {
    await withState((s) => { Object.assign(s.settings, { mode: 'kid', parentUntil: 0 }); });
    await applySiteRules();
    const app = appOf((await chrome.storage.local.get('account')).account);
    const url = app.page ? chrome.runtime.getURL(app.page) : homeUrl(live.host);
    if (tabId != null) await chrome.tabs.update(tabId, { url });
    return { ok: true, url };
  },

  // core/content/backup.js on the install page: take the copy back, or refresh it.
  settingsBackup: (msg, { sender }) => settingsBackup(sender, msg.saved),

  // From the app's pages (KidTube: Settings → Update now also sends the notes held for it, notes: true).
  sync: async (msg, { sender }) => {
    if (fromExtensionPage(sender)) await partOf((await chrome.storage.local.get('account')).account).beforeSync?.(msg);
    return sync();
  },
  checkUpdate: () => checkUpdate(),
  version: () => appVersion(),
  updateApp: () => updateApp(),
};

// Messages that change the mode or the profile come only from the extension's own pages.
const PAGE_ONLY = new Set(['leaveApp', 'apps', 'setMode', 'kidHome']);

export async function handle(msg, sender) {
  const type = msg?.type;
  const owner = HANDLERS[type] ? null : allParts().find((p) => p.handlers?.[type]);
  const fn = HANDLERS[type] ?? owner?.handlers[type];
  if (!fn) return undefined;
  if ((PAGE_ONLY.has(type) || owner?.pageOnly?.has(type)) && !fromExtensionPage(sender)) {
    return { ok: false, error: `Refused: the request did not come from a KidTube page (${sender.url ?? sender.tab?.url ?? 'no address'}).` };
  }
  const tabId = sender.tab?.id;
  const host = sender.tab?.url ? new URL(sender.tab.url).hostname : 'm.youtube.com';
  return fn(msg, { tabId, host, sender });
}
