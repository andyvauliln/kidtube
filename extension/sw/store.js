// The service worker's state: everything persistent lives in chrome.storage.local, and every change to the
// current profile's state goes through withState(), so ticks, syncs and messages never race.
import { mergeConfig } from '../lib/merge.js';
import { applyPlan } from '../lib/plan.js';
import { profileFolder } from '../lib/account.js';
import { DEFAULT_APP, appOf } from '../lib/apps.js';
import { DEFAULT_REPO } from './constants.js';

// --- the files bundled with the extension --------------------------------------------------------------
let bundled; // { config, queue, quizTypes }
export async function loadBundled() {
  if (!bundled) {
    const [config, queue, quizTypes] = await Promise.all(['default-config.json', 'default-queue.json', 'quiz-types.json']
      .map((f) => fetch(chrome.runtime.getURL(f)).then((r) => r.json())));
    bundled = { config, queue, quizTypes };
  }
  return bundled;
}

// --- the current profile's state --------------------------------------------------------------------------
// localConfig: rules saved on the parent page that haven't reached GitHub yet.
// seen: title/channel of videos he opened, for the parent's list after the queue has moved on.
// pendingTalk: the talking friend's screen he is on (before or after a video).
// planLog: the parent's changes to today's list and the planned videos (lib/plan.js).
// history: what he watched, newest last (parent mode → History). notes: the parent's notes for the AI.
export const KEYS = ['settings', 'data', 'watched', 'today', 'session', 'outbox', 'syncStatus', 'localConfig', 'seen', 'pendingTalk', 'quizTurn', 'transcripts', 'character', 'planLog', 'history', 'notes'];

let chain = Promise.resolve();
// Runs fn after every earlier serial() call has finished.
export function serial(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

// Loads the state, lets fn change it, writes back only what changed (the PIN page and the header's GitHub
// connection write settings on their own). opts.account: run only if that account is still the signed-in one
// (a sync that started before a switch).
export function withState(fn, { account } = {}) {
  return serial(async () => {
    if (account !== undefined && ((await chrome.storage.local.get('account')).account?.key ?? null) !== account) return undefined;
    const s = await chrome.storage.local.get(KEYS);
    s.settings ??= {}; s.data ??= {}; s.watched ??= {}; s.outbox ??= []; s.syncStatus ??= {}; s.seen ??= {};
    const before = Object.fromEntries(KEYS.map((k) => [k, JSON.stringify(s[k] ?? null)]));
    const result = await fn(s);
    const changed = KEYS.filter((k) => JSON.stringify(s[k] ?? null) !== before[k]);
    if (changed.length) await chrome.storage.local.set(Object.fromEntries(changed.map((k) => [k, s[k] ?? null])));
    return result;
  });
}

// What the worker remembers only while it runs (lost on restart, which is fine):
// host: the YouTube host he uses (m. or www.), for the URLs the worker sends tabs to.
export const live = { host: 'm.youtube.com' };

// --- the rules in force: bundled defaults, GitHub's parent-config.json, the parent's unsent changes -------
export async function effective(s) {
  const b = await loadBundled();
  let config = mergeConfig(mergeConfig(b.config, s.data?.config), s.localConfig);
  const queue = applyPlan(s.data?.queue ?? b.queue, s.planLog);
  // Questions of planned videos the parent moved onto today's list.
  if (Object.keys(s.planLog?.items ?? {}).length) config = mergeConfig(config, { quiz: { items: s.planLog.items } });
  return { config, queue };
}

// --- modes ----------------------------------------------------------------------------------------------
// The apps header (shell): no app runs, so YouTube is plain YouTube with KidTube's header on top, where the
// parent signs in, connects GitHub and opens or creates an app for the signed-in email. { on, locked, why }:
// locked = YouTube is covered until a grown-up enters the PIN (an app stopped because YouTube's account changed).
// No shell key yet: a tablet from before 0.9.8 keeps running its profile; a new one starts at the header.
export async function shellOf(g) {
  const { shell, account } = g ?? await chrome.storage.local.get(['shell', 'account']);
  return shell ?? { on: !account, locked: false };
}

// The header can act (open an app, connect GitHub, the settings file): at the unlocked header, or in parent mode.
// In kid mode it isn't shown, and a locked header waits for the PIN.
export async function headerOpen(g) {
  g ??= await chrome.storage.local.get(['shell', 'account', 'settings']);
  const sh = await shellOf(g);
  return sh.on ? !sh.locked : parentMode(g);
}

// Parent mode: the parent's screens instead of his list, no rules, nothing counted.
// parentUntil: set only by versions before 0.8.9 (a timer); a session started then still ends on time.
export function parentMode(s) {
  const st = s.settings ?? {};
  return st.mode === 'parent' && (!st.parentUntil || st.parentUntil > Date.now());
}

// Messages that change the plan or the mode come only from the extension's own pages.
// (Some browsers leave out sender.url; a content script always comes with its YouTube tab.)
export function fromExtensionPage(sender) {
  const base = chrome.runtime.getURL('');
  if (sender.url) return sender.url.startsWith(base);
  return !sender.tab?.url || sender.tab.url.startsWith(base);
}

// --- the current profile and where its files are --------------------------------------------------------
// For the screens (no lock: safe inside withState): "kidtube/johnnypitt.ind/", or null before the first sync.
export async function folderShown() {
  const a = (await chrome.storage.local.get('account')).account;
  return a?.folder ? `${a.app ?? DEFAULT_APP}/${a.folder}/` : null;
}

// Profiles from before 0.9.0 have no folder yet: the current one gets it on the first sync.
export async function profileBase() {
  return serial(async () => {
    const { account, accounts = {} } = await chrome.storage.local.get(['account', 'accounts']);
    if (!account?.key) return null;
    if (!account.folder || !account.app) {
      const rec = accounts[account.key] ?? {};
      account.app = rec.app ?? account.app ?? DEFAULT_APP;
      const taken = Object.entries(accounts).filter(([k, a]) => k !== account.key && (a.app ?? DEFAULT_APP) === account.app).map(([, a]) => a.folder).filter(Boolean);
      account.folder = rec.folder ?? account.folder ?? profileFolder(account, taken);
      accounts[account.key] = { ...rec, email: account.email ?? rec.email ?? null, app: account.app, folder: account.folder };
      await chrome.storage.local.set({ account, accounts });
    }
    return account.folder ? `${account.app}/${account.folder}/` : null;
  });
}

// One data repo for the tablet, one folder per profile (<app>/<folder>/).
export async function dataLocation(settings) {
  return { repo: settings.repo || DEFAULT_REPO, base: await profileBase() };
}

// Context documents (parent mode → Context) of the current profile's app.
export const contextDocsOf = async () => appOf((await chrome.storage.local.get('account')).account).contextDocs;
