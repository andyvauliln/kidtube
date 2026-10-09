// Profiles: everything is kept per YouTube account (email) and app. The current profile's data lives under
// the usual keys; the others wait in "acct:<key>". accounts[key]: { email, name, datasyncId, app, folder, lastSeen }.
// The PIN, the mode, the device id and the GitHub connection belong to the tablet, so they move along with every switch.
// Also the apps header: who YouTube has, the GitHub connection, this email's apps, and the settings file.
import { accountFromSwitcher, profileFolder, chooserUrl } from '../lib/account.js';
import { APPS, DEFAULT_APP, appOf } from '../../apps/registry.js';
import { ghHeaders, getRepoFile, explainHttp } from '../lib/github.js';
import { homeUrl } from '../lib/youtube.js';
import { DEFAULT_REPO, DEVICE_SETTINGS, BACKUP_KEYS } from './constants.js';
import { stateKeys, serial, withState, shellOf, headerOpen, parentMode, live } from './store.js';
import { applySiteRules } from './sites.js';
import { sync } from './sync.js';
import { partOf, allParts } from './apps.js';

// Everything kept per profile: the state keys and the apps' other keys.
const accountKeys = () => [...stateKeys(), ...allParts().flatMap((p) => p.profileKeys ?? [])];
// The apps' keys that go into the settings file with the connection and the PIN (KidTube: the listening keys).
const fileKeys = () => allParts().flatMap((p) => p.fileKeys ?? []);

// A profile is an email with one app, so one email can have a profile in each app. KidTube's key is the email
// itself (what YouTube reports, and what tablets before 0.9.6 have); another app's is "<app>:<email>".
const keyFor = (app, base) => (!app || app === DEFAULT_APP ? base : `${app}:${base}`);
const baseOf = (key) => key.replace(new RegExp(`^(${Object.keys(APPS).join('|')}):`), '');
const shortLabel = (a) => a.label.replace(/ \(.*/, '');

// Tablets from 0.9.2 to 0.9.5 keyed a Blank profile by its email alone: give it its "<app>:" key, so that the
// same email can also have a KidTube profile. Call inside serial().
async function migrateProfileKeys() {
  const g = await chrome.storage.local.get(['account', 'accounts']);
  const accounts = g.accounts ?? {};
  const moves = Object.entries(accounts).map(([k, a]) => [k, keyFor(a.app, baseOf(k))]).filter(([k, want]) => k !== want && !accounts[want]);
  if (!moves.length) return;
  const saved = await chrome.storage.local.get(moves.map(([k]) => `acct:${k}`));
  const set = {};
  for (const [k, want] of moves) {
    accounts[want] = accounts[k];
    delete accounts[k];
    if (saved[`acct:${k}`]) set[`acct:${want}`] = saved[`acct:${k}`];
    if (g.account?.key === k) set.account = { ...g.account, key: want };
  }
  await chrome.storage.local.set({ ...set, accounts });
  await chrome.storage.local.remove(moves.map(([k]) => `acct:${k}`).filter((k) => saved[k]));
}

// The record of a profile, with its app and folder given once (unique within its app: blank/ann and kidtube/ann).
// folder: the one the data repo already has for this email and app (found by the header).
function profileRecord(accounts, key, info, app, folder) {
  const old = accounts[key] ?? {};
  const myApp = old.app ?? (APPS[app] ? app : DEFAULT_APP);
  const taken = Object.entries(accounts).filter(([k, a]) => k !== key && (a.app ?? DEFAULT_APP) === myApp).map(([, a]) => a.folder).filter(Boolean);
  return {
    email: info.email ?? old.email ?? null, name: info.name ?? old.name ?? null, datasyncId: info.datasyncId || old.datasyncId || null,
    app: myApp, folder: old.folder ?? folder ?? profileFolder(info, taken), lastSeen: new Date().toISOString(),
  };
}

// Makes the profile <key> (an email in one app) the current one: the current profile's data goes to
// "acct:<its key>", the new one's comes back (a new profile starts empty). The header's Open and Create.
async function useProfile(info, { app, key, folder }) {
  const r = await serial(async () => {
    await migrateProfileKeys();
    const g = await chrome.storage.local.get(['account', 'accounts']);
    const accounts = g.accounts ?? {};
    const cur = g.account;
    accounts[key] = profileRecord(accounts, key, info, app, folder);
    const { lastSeen, ...rec } = accounts[key];
    const me = { key, ...rec };
    // The first profile on this tablet keeps what is already here.
    if (!cur || cur.key === key) {
      await chrome.storage.local.set({ account: me, accounts });
      return { switched: false };
    }
    const keys = accountKeys();
    const work = await chrome.storage.local.get(keys);
    const next = (await chrome.storage.local.get(`acct:${key}`))[`acct:${key}`] ?? {};
    const device = Object.fromEntries(DEVICE_SETTINGS.filter((k) => work.settings?.[k] != null).map((k) => [k, work.settings[k]]));
    next.settings = { ...(next.settings ?? {}), ...device };
    await chrome.storage.local.set({ [`acct:${cur.key}`]: work, ...next, account: me, accounts });
    await chrome.storage.local.remove([`acct:${key}`, ...keys.filter((k) => !(k in next))]);
    return { switched: true };
  });
  if (r.switched) sync();
  return { ok: true, ...r };
}

// YouTube's page says who is signed in (the 'account' message: its account switcher answer and DATASYNC_ID).
// At the header this only changes what the header shows. While an app runs, another account (or none) stops it:
// the app's data belongs to its email. A grown-up's PIN then opens the header; in parent mode it opens at once.
export async function youtubeAccount(msg) {
  const info = { ...(accountFromSwitcher(msg.switcher ?? '') ?? {}), datasyncId: msg.datasyncId };
  const signedOut = !msg.loggedIn && !info.email;
  await chrome.storage.local.set({ ytAccount: { email: info.email ?? null, loggedIn: !signedOut, datasyncId: info.datasyncId || null, at: Date.now() } });
  const g = await chrome.storage.local.get(['shell', 'account', 'accounts', 'settings']);
  const sh = await shellOf(g);
  const cur = g.account;
  if (sh.on || !cur?.email) return { ok: true, shell: sh };
  const ds = String(info.datasyncId ?? '').split('||')[0];
  const other = signedOut ? 'YouTube is signed out'
    : info.email && info.email !== cur.email ? `YouTube is signed in to ${info.email}`
      : !info.email && ds && cur.datasyncId && ds !== String(cur.datasyncId).split('||')[0] ? 'YouTube is signed in to another account' : null;
  if (!other) {
    if (info.email && info.datasyncId && !cur.datasyncId) {   // remember YouTube's id: it tells accounts apart without an email
      const accounts = { ...(g.accounts ?? {}), [cur.key]: { ...(g.accounts?.[cur.key] ?? {}), datasyncId: info.datasyncId } };
      await chrome.storage.local.set({ account: { ...cur, datasyncId: info.datasyncId }, accounts });
    }
    return { ok: true };
  }
  const locked = !!g.settings?.pinHash && !parentMode(g);
  const shell = { on: true, locked, why: `${other}, not ${cur.email}: ${shortLabel(appOf(cur))} stopped.` };
  await chrome.storage.local.set({ shell });
  await applySiteRules();
  return { ok: true, shell };
}

// The profiles in the data repo: <app>/<folder>/profile.json says whose folder it is. Read again after 10 minutes.
export async function repoProfiles(force = false) {
  const { settings = {}, repoProfiles: cached } = await chrome.storage.local.get(['settings', 'repoProfiles']);
  const repo = settings.repo || DEFAULT_REPO, token = settings.token || '';
  if (!token) return { list: [], error: null };
  if (!force && cached?.repo === repo && cached.at > Date.now() - 10 * 60000 && !cached.error) return cached;
  const list = [];
  let error = null;
  try {
    for (const app of Object.keys(APPS)) {
      const r = await fetch(`https://api.github.com/repos/${repo}/contents/${app}`, { headers: ghHeaders(token, 'application/vnd.github+json'), cache: 'no-store' });
      if (r.status === 404) continue;
      if (!r.ok) throw new Error(await explainHttp(r.status, { repo, base: `${app}/` }, token, ''));
      for (const d of (await r.json()).filter((x) => x.type === 'dir')) {
        const f = await getRepoFile({ repo, base: `${app}/${d.name}/` }, token, 'profile.json').catch(() => null);
        if (f?.json?.email) list.push({ app, folder: d.name, email: String(f.json.email).toLowerCase() });
      }
    }
  } catch (e) { error = e.message; }
  const out = { repo, at: Date.now(), list, error };
  await chrome.storage.local.set({ repoProfiles: out });
  return out;
}

// What the header shows: who YouTube has, the GitHub connection, and this email's apps (here or in the repo),
// the running one marked active.
export async function headerView(force) {
  const g = await chrome.storage.local.get(['shell', 'account', 'accounts', 'ytAccount', 'settings']);
  const sh = await shellOf(g);
  const settings = g.settings ?? {};
  const email = g.ytAccount?.email ?? null;
  // Only the token's start and end reach the page: enough to see which one is saved.
  const t = settings.token || '';
  const github = { connected: !!t, repo: settings.repo || DEFAULT_REPO, tokenHint: t ? `${t.slice(0, t.length > 20 ? 11 : 2)}…${t.slice(-4)}` : null };
  const running = !sh.on && g.account && (!email || g.account.email === email) ? appOf(g.account).id : null;
  const out = { ok: true, shell: sh, open: await headerOpen(g), mode: parentMode(g) ? 'parent' : 'kid', running,
    email, seen: !!g.ytAccount, signedIn: !!g.ytAccount?.loggedIn, checkedAt: g.ytAccount?.at ?? null, github, apps: [], error: null,
    switchAccount: chooserUrl(null, live.host), signOut: `https://${live.host}/logout` };
  if (!email || !github.connected) return out;
  const remote = await repoProfiles(force);
  out.error = remote.error;
  const accounts = g.accounts ?? {};
  out.apps = Object.values(APPS).map((a) => {
    const here = accounts[keyFor(a.id, email)];
    const there = remote.list.find((p) => p.app === a.id && p.email === email);
    return { id: a.id, label: shortLabel(a), color: a.color, glyph: a.glyph, about: a.about,
      has: !!(here || there), active: a.id === running, folder: here?.folder ?? there?.folder ?? null, parentScreens: !!a.parentPage };
  });
  return out;
}

// The header's app tiles (mode: 'parent' unless asked, so the parent sees the app first) and Add app (create).
// The profile is the signed-in email in that app; its folder in the repo is found, or given now.
export async function openApp(msg, tabId, host) {
  const g = await chrome.storage.local.get(['shell', 'account', 'ytAccount', 'accounts', 'settings']);
  if (!(await headerOpen(g))) return { ok: false, error: 'Unlock with the PIN first.' };
  const email = g.ytAccount?.email;
  if (!email) return { ok: false, error: 'Sign in to YouTube first.' };
  const app = APPS[msg.app];
  if (!app) return { ok: false, error: 'Unknown app.' };
  const key = keyFor(app.id, email);
  const there = (await repoProfiles()).list.find((p) => p.app === app.id && p.email === email);
  const known = !!(g.accounts?.[key] || there);
  if (!msg.create && !known) return { ok: false, error: `No ${shortLabel(app)} for ${email} yet: add it.` };
  const r = await useProfile({ email, datasyncId: g.ytAccount.datasyncId }, { app: app.id, key, folder: there?.folder });
  const parent = msg.create || msg.mode !== 'kid';
  await withState((s) => {
    Object.assign(s.settings, { mode: parent ? 'parent' : 'kid', parentUntil: 0 });
    if (msg.create && !known) partOf({ app: app.id }).created?.(s);   // the app's starting files
  });
  await chrome.storage.local.set({ shell: { on: false, locked: false } });
  await applySiteRules();
  // A switch syncs anyway. Else (the first profile on this tablet, or the same one again) sync now too: its lists and
  // rules come from GitHub at once, and a new profile writes profile.json, so the server's helper knows it.
  if (!r.switched) sync();
  const url = app.page ? chrome.runtime.getURL(app.page) : parent ? chrome.runtime.getURL(app.parentPage) : homeUrl(host);
  if (tabId != null) await chrome.tabs.update(tabId, { url });
  return { ok: true, url, navigated: tabId != null };
}

// The header's GitHub connection: one repo and token for every account and app on this tablet.
export async function connectGitHub(msg) {
  if (!(await headerOpen())) return { ok: false, error: 'Unlock with the PIN first.' };
  const repo = String(msg.repo ?? '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
  const token = String(msg.token ?? '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return { ok: false, error: 'The repo is owner/name, for example andyvauliln/kidtube-data.' };
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (!token && !settings.token) return { ok: false, error: 'Paste the GitHub token.' };
  const before = { repo: settings.repo, token: settings.token };
  await chrome.storage.local.set({ settings: { ...settings, repo, ...(token ? { token } : {}) } });
  const r = await repoProfiles(true);
  if (r.error) {   // keep what worked before
    const now = (await chrome.storage.local.get('settings')).settings ?? {};
    await chrome.storage.local.set({ settings: { ...now, repo: before.repo, token: before.token } });
    await chrome.storage.local.remove('repoProfiles');
    return { ok: false, error: r.error };
  }
  // Everything of the running profile comes again from GitHub now (none runs yet at a fresh header: the app's Open does it).
  const { account } = await chrome.storage.local.get('account');
  await sync();
  return { ok: true, repo, profiles: r.list.length, synced: !!account };
}

// The settings file (the header's Save / Load): the GitHub connection and the PIN (BACKUP_KEYS), and the apps' fileKeys.
// chrome.storage is erased when the extension is removed (Orion updates); this file brings them back.
export async function exportSettings() {
  if (!(await headerOpen())) return { ok: false, error: 'Unlock with the PIN first.' };
  const got = await chrome.storage.local.get(['settings', ...fileKeys()]);
  const settings = got.settings ?? {};
  const keep = Object.fromEntries(BACKUP_KEYS.filter((k) => settings[k]).map((k) => [k, settings[k]]));
  const keys = Object.fromEntries(fileKeys().filter((k) => got[k]).map((k) => [k, got[k]]));
  return { ok: true, file: { kidtubeSettings: 1, savedAt: new Date().toISOString(), ...keep, ...keys } };
}

export async function importSettings(file) {
  if (!(await headerOpen())) return { ok: false, error: 'Unlock with the PIN first.' };
  if (file?.kidtubeSettings !== 1) return { ok: false, error: 'That file is not a KidTube settings file.' };
  const { settings = {} } = await chrome.storage.local.get('settings');
  const strings = (names) => Object.fromEntries(names.filter((k) => typeof file[k] === 'string' && file[k]).map((k) => [k, file[k]]));
  await chrome.storage.local.set({ settings: { ...settings, ...strings(BACKUP_KEYS) }, ...strings(fileKeys()) });
  await chrome.storage.local.remove('repoProfiles');
  const r = await sync();
  return { ok: true, errors: r?.errors ?? [] };
}

// The header's YouTube tile: no app runs, plain YouTube with the apps header above it.
export async function plainYouTube(tabId, host) {
  if (!(await headerOpen())) return { ok: false, error: 'Unlock with the PIN first.' };
  await chrome.storage.local.set({ shell: { on: true, locked: false } });
  await applySiteRules();
  const url = homeUrl(/(^|\.)youtube\.com$/.test(host) ? host : live.host);   // from an app's own page: the YouTube in use
  if (tabId != null) await chrome.tabs.update(tabId, { url });
  return { ok: true, url, navigated: tabId != null };
}

// Back to the header: the PIN page, when YouTube was locked.
export async function leaveApp() {
  await chrome.storage.local.set({ shell: { on: true, locked: false } });
  await applySiteRules();
  return { ok: true, open: homeUrl(live.host) };
}

// The PIN page: what runs now, whether it may skip the PIN, where YouTube is, and the app's settings page.
export async function pinPageView(s) {
  const { account } = await chrome.storage.local.get('account');
  const sh = await shellOf();
  const app = appOf(account);
  return { ok: true, shell: sh, parentMode: parentMode(s), home: homeUrl(live.host),
    settings: app.parentPage ? chrome.runtime.getURL(`${app.parentPage}#settings`) : null,
    running: sh.on ? null : { email: account?.email ?? null, app: shortLabel(app) } };
}
