// Profiles: everything is kept per account and app. An app's account is the one its site has signed in
// (registry.js account, SITES): KidTube's is a YouTube email, Instagram's an Instagram username. The current
// profile's data lives under the usual keys; the others wait in "acct:<key>".
// accounts[key]: { email, username, name, datasyncId, app, folder, lastSeen }.
// The PIN, the mode, the device id and the GitHub connection belong to the tablet, so they move along with every switch.
// Also the apps header: the connected profile, Connect (the account signed in on the page's site), the apps, the
// GitHub connection, and the settings file.
import { accountFromSwitcher, profileFolder } from '../lib/account.js';
import { APPS, DEFAULT_APP, SITES, appOf, appHome, siteOfHost, siteOfApp } from '../../apps/registry.js';
import { ghHeaders, getRepoFile, explainHttp } from '../lib/github.js';
import { homeUrl } from '../lib/youtube.js';
import { DEFAULT_REPO, DEVICE_SETTINGS, BACKUP_KEYS } from './constants.js';
import { stateKeys, serial, withState, shellOf, headerOpen, parentMode, live } from './store.js';
import { applySiteRules } from './sites.js';
import { sync } from './sync.js';
import { partOf, allParts } from './apps.js';
import { checksView } from '../checks/runner.js';

// Everything kept per profile: the state keys and the apps' other keys.
const accountKeys = () => [...stateKeys(), ...allParts().flatMap((p) => p.profileKeys ?? [])];
// The apps' keys that go into the settings file with the connection and the PIN (KidTube: the listening keys).
const fileKeys = () => allParts().flatMap((p) => p.fileKeys ?? []);

// A profile is an account with one app. The account's name: its email (YouTube) or "@username" (Instagram).
// KidTube's key is the email itself (what tablets before 0.9.6 have); another app's is "<app>:<name>".
const keyFor = (app, name) => (!app || app === DEFAULT_APP ? name : `${app}:${name}`);
const baseOf = (key) => key.replace(new RegExp(`^(${[...Object.keys(APPS), 'blank'].join('|')}):`), '');
const shortLabel = (a) => a.label.replace(/ \(.*/, '');
// What the header calls a profile: its email or @username.
export const whoOf = (rec) => (rec?.username ? `@${rec.username}` : rec?.email ?? null);

// The account a site's page reported last (SITES stored: ytAccount, igAccount).
// name: the account's name for the profile key; null when signed out or when the page could not tell.
function seenOn(site, g) {
  const a = g[site.stored];
  const name = !a?.loggedIn ? null : site.by === 'username' ? (a.username ? `@${a.username}` : null) : a.email ?? null;
  return { site: site.id, label: site.label, seen: !!a, signedIn: !!a?.loggedIn, name, checkedAt: a?.at ?? null,
    info: site.by === 'username' ? { username: a?.username ?? null, igId: a?.id ?? null } : { email: a?.email ?? null, datasyncId: a?.datasyncId ?? null } };
}
const seenKeys = () => Object.values(SITES).map((x) => x.stored);

// A profile that can't stay: its app is gone (Blank, the test app before Instagram), or its app names accounts by
// username and it has none (Instagram profiles of 0.11.0 were named by the YouTube email).
const unkept = (a) => !APPS[a?.app ?? DEFAULT_APP] || (siteOfApp(APPS[a?.app ?? DEFAULT_APP]).by === 'username' && !a?.username);

// Tablets from 0.9.2 to 0.9.5 keyed a Blank profile by its email alone: give it its "<app>:" key, so that the
// same email can also have a KidTube profile. Profiles that can't stay (unkept) go with their data; when the current
// one goes, no profile runs (the header) and only the tablet's settings stay. Call inside serial().
export async function migrateProfileKeys() {
  const g = await chrome.storage.local.get(['account', 'accounts']);
  const accounts = g.accounts ?? {};
  const set = {}, remove = [];
  const gone = Object.keys(accounts).filter((k) => unkept(accounts[k]));
  for (const k of gone) { delete accounts[k]; remove.push(`acct:${k}`); }
  if (g.account && unkept(g.account)) {
    const { settings = {} } = await chrome.storage.local.get('settings');
    set.settings = Object.fromEntries(DEVICE_SETTINGS.filter((k) => settings[k] != null).map((k) => [k, settings[k]]));
    set.shell = { on: true, locked: false };
    // Said so the start check (start.kept) tells this drop from a profile lost by an update.
    set.profileDropped = { app: g.account.app ?? DEFAULT_APP, at: new Date().toISOString(), why: APPS[g.account.app ?? DEFAULT_APP] ? 'no username' : 'app gone' };
    remove.push('account', ...accountKeys().filter((k) => k !== 'settings'));
    g.account = null;
  }
  const moves = Object.entries(accounts).map(([k, a]) => [k, keyFor(a.app, baseOf(k))]).filter(([k, want]) => k !== want && !accounts[want]);
  if (!moves.length && !remove.length) return;
  const saved = await chrome.storage.local.get(moves.map(([k]) => `acct:${k}`));
  for (const [k, want] of moves) {
    accounts[want] = accounts[k];
    delete accounts[k];
    if (saved[`acct:${k}`]) { set[`acct:${want}`] = saved[`acct:${k}`]; delete set[`acct:${k}`]; }
    if (g.account?.key === k) set.account = { ...g.account, key: want };
  }
  await chrome.storage.local.set({ ...set, accounts });
  await chrome.storage.local.remove([...remove, ...moves.map(([k]) => `acct:${k}`).filter((k) => saved[k])]);
}

// The record of a profile, with its app and folder given once (unique within its app: instagram/ann and kidtube/ann).
// info: the account as its site said it ({ email, datasyncId } or { username, igId }).
// folder: the one the data repo already has for this account and app (found by the header).
function profileRecord(accounts, key, info, app, folder) {
  const old = accounts[key] ?? {};
  const myApp = old.app ?? (APPS[app] ? app : DEFAULT_APP);
  const taken = Object.entries(accounts).filter(([k, a]) => k !== key && (a.app ?? DEFAULT_APP) === myApp).map(([, a]) => a.folder).filter(Boolean);
  return {
    email: info.email ?? old.email ?? null, name: info.name ?? old.name ?? null, datasyncId: info.datasyncId || old.datasyncId || null,
    ...(info.username || old.username ? { username: info.username ?? old.username, igId: info.igId ?? old.igId ?? null } : {}),
    app: myApp, folder: old.folder ?? folder ?? profileFolder(info, taken), lastSeen: new Date().toISOString(),
  };
}

// Makes the profile <key> (an account in one app) the current one: the current profile's data goes to
// "acct:<its key>", the new one's comes back (a new profile starts empty). The header's tiles and Connect.
async function useProfile(info, { app, key, folder }) {
  const r = await serial(async () => {
    await migrateProfileKeys();
    const g = await chrome.storage.local.get(['account', 'accounts']);
    const accounts = g.accounts ?? {};
    const cur = g.account;
    accounts[key] = profileRecord(accounts, key, info, app, folder);
    const { lastSeen, ...rec } = accounts[key];
    const me = { key, ...rec };
    // The same profile, or the first one on this tablet: it keeps what is already here. With no current profile
    // (it was dropped: migrateProfileKeys) a profile that waits in "acct:" comes back.
    const saved = cur?.key === key ? null : (await chrome.storage.local.get(`acct:${key}`))[`acct:${key}`];
    if ((!cur && !saved) || cur?.key === key) {
      await chrome.storage.local.set({ account: me, accounts });
      return { switched: false };
    }
    const keys = accountKeys();
    const work = await chrome.storage.local.get(keys);
    const next = saved ?? {};
    const device = Object.fromEntries(DEVICE_SETTINGS.filter((k) => work.settings?.[k] != null).map((k) => [k, work.settings[k]]));
    next.settings = { ...(next.settings ?? {}), ...device };
    await chrome.storage.local.set({ ...(cur ? { [`acct:${cur.key}`]: work } : {}), ...next, account: me, accounts });
    await chrome.storage.local.remove([`acct:${key}`, ...keys.filter((k) => !(k in next))]);
    return { switched: true };
  });
  if (r.switched) sync();
  return { ok: true, ...r };
}

// YouTube's page says who is signed in (the 'account' message: its account switcher answer and DATASYNC_ID).
// At the header this only changes what the header shows. While an app of a YouTube account runs, another account
// (or none) stops it: the app's data belongs to its email. A grown-up's PIN then opens the header; in parent mode it
// opens at once. An app of another site's account (Instagram) has no email and keeps running.
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

// Another site's page says who is signed in there (Instagram: apps/instagram/content/app.js, on every page and
// before Connect). It only changes what the header knows: the app's screen itself sees a different account.
export async function siteAccount(msg, host) {
  const site = siteOfHost(host);
  if (!site || site.id === 'youtube') return { ok: false, error: 'Only a page of the site can say its account.' };
  const name = String(msg.username ?? '').toLowerCase();
  const username = /^[a-z0-9._]{1,30}$/.test(name) ? name : null;
  const id = /^\d{1,30}$/.test(String(msg.id ?? '')) ? String(msg.id) : null;
  await chrome.storage.local.set({ [site.stored]: { loggedIn: !!msg.loggedIn, username: msg.loggedIn ? username : null, id: msg.loggedIn ? id : null, at: Date.now() } });
  return { ok: true };
}

// The profiles in the data repo: <app>/<folder>/profile.json says whose folder it is (email, or username).
// Read again after 10 minutes.
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
        const email = f?.json?.email ? String(f.json.email).toLowerCase() : null;
        const username = f?.json?.username ? String(f.json.username).toLowerCase() : null;
        if (email || username) list.push({ app, folder: d.name, email, username });
      }
    }
  } catch (e) { error = e.message; }
  const out = { repo, at: Date.now(), list, error };
  await chrome.storage.local.set({ repoProfiles: out });
  return out;
}
// The repo's profile of this app and account name, if any (an app of usernames matches its profile.json username).
const inRepo = (list, app, name) => list.find((p) => p.app === app.id
  && (siteOfApp(app).by === 'username' ? !!p.username && `@${p.username}` === name : p.email === name));

// What the header shows: the connected profile, the account signed in on this page's site (for Connect), the GitHub
// connection, the App | site switch, and each app with its site's account and whether that account has a profile in it.
// host: the page's host (an extension page has no site, so no Connect there).
export async function headerView(force, host) {
  const g = await chrome.storage.local.get(['shell', 'account', 'accounts', 'settings', ...seenKeys()]);
  const sh = await shellOf(g);
  const settings = g.settings ?? {};
  const site = siteOfHost(host);
  // Only the token's start and end reach the page: enough to see which one is saved.
  const t = settings.token || '';
  const github = { connected: !!t, repo: settings.repo || DEFAULT_REPO, tokenHint: t ? `${t.slice(0, t.length > 20 ? 11 : 2)}…${t.slice(-4)}` : null };
  const cur = g.account?.key ? g.account : null;
  const running = !sh.on && cur ? appOf(cur).id : null;
  const out = { ok: true, shell: sh, open: await headerOpen(g), mode: parentMode(g) ? 'parent' : 'kid', running,
    site: site?.id ?? null, here: site ? seenOn(site, g) : null,
    connected: cur ? { app: appOf(cur).id, label: shortLabel(appOf(cur)), who: whoOf(cur) ?? 'a YouTube account without an email', site: siteOfApp(appOf(cur)).label } : null,
    github, switch: switchOf(running, site), apps: [], error: null, ai: null };
  if (out.open) out.ai = await aiNow(running ? cur : null);
  if (!github.connected) return out;
  const remote = await repoProfiles(force);
  out.error = remote.error;
  const accounts = g.accounts ?? {};
  out.apps = Object.values(APPS).map((a) => {
    const who = seenOn(siteOfApp(a), g).name;
    const mine = who ? accounts[keyFor(a.id, who)] : null;
    const there = who ? inRepo(remote.list, a, who) : null;
    return { id: a.id, label: shortLabel(a), color: a.color, glyph: a.glyph, about: a.about, site: siteOfApp(a).label, who,
      has: !!(mine || there), active: a.id === running, folder: mine?.folder ?? there?.folder ?? null, parentScreens: !!a.parentPage };
  });
  return out;
}

// The header's App | site switch, the same for every app: the running app (with none, the app of this page's site)
// and its site without the app. on: 'app' where the app's own screen shows (its home or page, its parent screens),
// 'site' on the plain site (no app runs) and on the site itself while an app without its own screen runs there
// (KidTube in parent mode on YouTube). App opens the app (openApp); the site opens the plain site (plainSite), or,
// on a page that has both views (Instagram's Saved page), switches the view there.
function switchOf(running, site) {
  const app = running ? APPS[running] : Object.values(APPS).find((a) => siteOfApp(a).id === site?.id);
  if (!app) return null;
  const its = siteOfApp(app);
  const ownScreen = !!(app.home || app.page);
  return { app: app.id, label: shortLabel(app), site: its.id, siteLabel: its.label,
    on: running && (ownScreen || site?.id !== its.id) ? 'app' : 'site' };
}

// What waits for the AI, under the header's bar where the parent is: the running app's own (its part's aiView) and
// the checks' reports (core/checks/runner.js), which go to the server's fix agent.
async function aiNow(cur) {
  const app = cur ? await withState((s) => partOf(cur).aiView?.(s) ?? null) : null;
  const { problems } = await checksView();
  // Each problem that waits for something, and the ones fixed or checked in the last 30 minutes.
  const recent = (p) => p.fix?.at && Date.now() - Date.parse(p.fix.at) < 30 * 60000;
  const shown = problems.filter((p) => !p.done || recent(p))
    .map(({ key, check, expect, count, versions, state, label, done, fix }) => ({ key, check, expect, count, versions, state, label, done, message: fix?.message ?? '' }));
  return { ...(app ?? {}), problems: shown };
}

// The header's AI line: the page where the parent acts on it (the app's parent screens, or Check this browser).
export async function openAiPage(msg, tabId) {
  const g = await chrome.storage.local.get(['shell', 'account', 'settings']);
  if (!(await headerOpen(g))) return { ok: false, error: 'Unlock with the PIN first.' };
  const page = msg.page === 'checks' ? 'core/pages/check.html#problems' : appOf(g.account).parentPage;
  if (!page) return { ok: false, error: 'This app has no page for that.' };
  const url = chrome.runtime.getURL(page);
  if (tabId != null) await chrome.tabs.update(tabId, { url }); else await chrome.tabs.create({ url });
  return { ok: true, url };
}

// The header's app tiles (mode: 'parent' unless asked, so the parent sees the app first) and Connect (create).
// The profile is the account its site has signed in, in that app; its folder in the repo is found, or given now.
export async function openApp(msg, tabId, host) {
  const g = await chrome.storage.local.get(['shell', 'account', 'accounts', 'settings', ...seenKeys()]);
  if (!(await headerOpen(g))) return { ok: false, error: 'Unlock with the PIN first.' };
  const app = APPS[msg.app];
  if (!app) return { ok: false, error: 'Unknown app.' };
  const site = siteOfApp(app);
  const seen = seenOn(site, g);
  if (!seen.name) {
    return { ok: false, error: seen.signedIn ? `${site.label} did not say which account is signed in. Open ${site.label} again and press Connect there.`
      : `Sign in on ${site.label} itself, then press Connect there.` };
  }
  const key = keyFor(app.id, seen.name);
  const there = inRepo((await repoProfiles()).list, app, seen.name);
  const known = !!(g.accounts?.[key] || there);
  if (!msg.create && !known) return { ok: false, error: `No ${shortLabel(app)} for ${seen.name} yet: press Connect on ${site.label}.` };
  const r = await useProfile(seen.info, { app: app.id, key, folder: there?.folder });
  const parent = msg.create || msg.mode !== 'kid' || app.modes === false;   // an app without modes: the header stays open
  await withState((s) => {
    s.settings.mode = parent ? 'parent' : 'kid';
    if (msg.create && !known) partOf({ app: app.id }).created?.(s);   // the app's starting files
  });
  await chrome.storage.local.set({ shell: { on: false, locked: false } });
  await applySiteRules();
  // A switch syncs anyway. Else (the first profile on this tablet, or the same one again) sync now too: its lists and
  // rules come from GitHub at once, and a new profile writes profile.json, so the server's helper knows it.
  if (!r.switched) sync();
  // From another app's screen on its own site (Instagram's): the YouTube in use.
  const url = appHome(app) ?? (parent ? chrome.runtime.getURL(app.parentPage) : homeUrl(/(^|\.)youtube\.com$/.test(host) ? host : live.host));
  if (tabId != null) await chrome.tabs.update(tabId, { url });
  return { ok: true, url, navigated: tabId != null, created: !known, who: seen.name };
}

// The header's Connect, on the site itself (plain YouTube, Instagram), after its page said who is signed in: that
// account's profile in the site's app. The profile already connected: nothing changes. Known here or in the repo:
// it is loaded. New: it is made, empty. Then the app opens (in parent mode: Connect is the parent's).
export async function connect(tabId, host) {
  const site = siteOfHost(host);
  if (!site) return { ok: false, error: 'Open YouTube or Instagram, sign in there, and press Connect on that page.' };
  const g = await chrome.storage.local.get(['shell', 'account', 'settings', ...seenKeys()]);
  if (!(await headerOpen(g))) return { ok: false, error: 'Unlock with the PIN first.' };
  const seen = seenOn(site, g);
  if (!seen.signedIn) return { ok: false, error: `${site.label} has no account signed in. Sign in on ${site.label} itself, then press Connect.` };
  if (!seen.name) return { ok: false, error: `${site.label} did not say which account is signed in. Reload the page and press Connect again.` };
  const app = Object.values(APPS).find((a) => siteOfApp(a).id === site.id);
  if (!app) return { ok: false, error: `No app uses ${site.label} accounts.` };
  const label = shortLabel(app);
  if (g.account?.key === keyFor(app.id, seen.name)) {
    const runs = !(await shellOf(g)).on;
    return { ok: true, same: true, app: app.id, who: seen.name,
      message: `Already connected: ${seen.name} (${label}). ${runs ? 'Nothing changed.' : `Open ${label} with ${site.id === 'instagram' ? 'App' : 'its tile'}.`}` };
  }
  const r = await openApp({ app: app.id, create: true }, tabId, host);
  if (!r.ok) return r;
  return { ...r, app: app.id,
    message: r.created ? `Connected: ${seen.name}. A new ${label} profile starts now, empty.` : `Connected: ${seen.name}. Its ${label} profile is loaded.` };
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
  if (file?.kidtubeSettings !== 1) return { ok: false, error: 'That file is not a Custom Apps settings file.' };
  const { settings = {} } = await chrome.storage.local.get('settings');
  const strings = (names) => Object.fromEntries(names.filter((k) => typeof file[k] === 'string' && file[k]).map((k) => [k, file[k]]));
  await chrome.storage.local.set({ settings: { ...settings, ...strings(BACKUP_KEYS) }, ...strings(fileKeys()) });
  await chrome.storage.local.remove('repoProfiles');
  const r = await sync();
  return { ok: true, errors: r?.errors ?? [] };
}

// The header's site tiles: no app runs; the plain site (YouTube, Instagram) with the header (KidTube's bar on
// YouTube, the Connect bar on Instagram), where the parent signs in with the site's own buttons and presses Connect.
export async function plainSite(siteId, tabId, host) {
  if (!(await headerOpen())) return { ok: false, error: 'Unlock with the PIN first.' };
  const site = SITES[siteId] ?? SITES.youtube;
  await chrome.storage.local.set({ shell: { on: true, locked: false } });
  await applySiteRules();
  const url = site.home ?? homeUrl(/(^|\.)youtube\.com$/.test(host) ? host : live.host);   // from an app's own page: the YouTube in use
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
  // No profile yet: no app (none is the default one).
  const app = account?.key ? appOf(account) : null;
  return { ok: true, shell: sh, parentMode: parentMode(s), home: homeUrl(live.host),
    settings: app?.parentPage ? chrome.runtime.getURL(`${app.parentPage}#settings`) : null,
    running: sh.on || !app ? null : { email: account?.email ?? null, who: whoOf(account), app: shortLabel(app) } };
}
