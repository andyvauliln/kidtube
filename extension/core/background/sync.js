// GitHub sync: when it runs, where the profile's folder is, and profile.json. Everything else in the folder
// belongs to the profile's app, whose part syncs it (apps.js sync).
import { nowIso } from '../lib/time.js';
import { ghHeaders, contentsUrl, getRepoFile, putRepoFile, explainHttp } from '../lib/github.js';
import { PAGES_URL, BACKUP_KEYS } from './constants.js';
import { withState, dataLocation } from './store.js';
import { applySiteRules } from './sites.js';
import { partOf } from './apps.js';

// profile.json: who this folder belongs to. The helper on the server finds new profiles by it.
async function writeProfileFile(loc, token) {
  const { account } = await chrome.storage.local.get('account');
  if (await getRepoFile(loc, token, 'profile.json')) return;
  await putRepoFile(loc, token, 'profile.json', {
    schemaVersion: 1, app: account.app, folder: account.folder, email: account.email ?? null, name: account.name ?? null, createdAt: nowIso(),
  }, null, `new profile ${account.app}/${account.folder}`);
}

// One file of the profile's folder: { json, etag }, or { notModified } when the etag still matches.
// A missing file throws an error with missing = true.
export async function fetchDataFile(loc, token, path, etag) {
  const headers = ghHeaders(token);
  if (etag) headers['If-None-Match'] = etag;
  const r = await fetch(contentsUrl(loc, path), { headers, cache: 'no-store' });
  if (r.status === 304) return { notModified: true };
  if (!r.ok) {
    const e = new Error(await explainHttp(r.status, loc, token, path));
    e.missing = r.status === 404 && e.message.endsWith(`${path} is missing in ${loc.repo}.`);   // the repo is fine, the file isn't there
    throw e;
  }
  return { json: await r.json(), etag: r.headers.get('etag') };
}

// Syncs run one after another, so a sync asked for after Save always uses the new token.
let syncChain = Promise.resolve();
export function sync() {
  const run = syncChain.then(doSync);
  syncChain = run.catch(() => {});
  return run;
}

// After he finishes a video or answers: one sync a little later, so what he did reaches the helper soon.
let syncTimer = null;
export function syncSoon(ms = 20000) { clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(), ms); }

// A KidTube screen opened: fetch the newest list if the last sync is a few minutes old. The screens ask for
// their state every second, so the check itself runs at most twice a minute.
let staleCheckedAt = 0;
export async function syncIfStale(minutes) {
  if (Date.now() - staleCheckedAt < 30000) return;
  staleCheckedAt = Date.now();
  const at = await withState((s) => s.syncStatus?.at ?? null);   // per account, like everything in the state
  if (!at || Date.now() - Date.parse(at) > minutes * 60000) sync();
}

async function doSync() {
  const { settings = {}, data = {}, account } = await chrome.storage.local.get(['settings', 'data', 'account']);
  const acct = account?.key ?? null;   // a switch to another account during this sync drops what it fetched
  const loc = await dataLocation(settings);
  const token = settings.token || '';
  const status = { at: new Date().toISOString(), errors: [] };
  if (!loc.base) {   // no YouTube account seen yet, so no profile: the app's built-in files until one is
    status.errors.push('Waiting for the YouTube account: open YouTube once, signed in. Until then the built-in list is used.');
  } else {
    const app = partOf(account);
    if (token && !data.profileFile) {
      try { await writeProfileFile(loc, token); await withState((s) => { s.data.profileFile = true; }, { account: acct }); }
      catch (e) { if (!app.sync) status.errors.push(e.message); }   // an app with files of its own reports the cause there
    }
    try {
      if (app.sync && (await app.sync({ loc, token, data, status, acct })) === false) return status;   // the profile changed meanwhile
    } catch (e) { status.errors.push(String(e.message ?? e)); }
  }
  status.errors = [...new Set(status.errors)];
  await applySiteRules();
  await withState((s) => { s.syncStatus = status; }, { account: acct });
  return status;
}

// The copy of the connection kept on the install page (core/content/backup.js). Only that page may ask.
export async function settingsBackup(sender, saved) {
  if (!String(sender?.url ?? '').startsWith(PAGES_URL)) return { ok: false };
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (!settings.token && saved?.kidtubeSettings === 1 && typeof saved.token === 'string' && saved.token) {
    const back = Object.fromEntries(BACKUP_KEYS.filter((k) => typeof saved[k] === 'string').map((k) => [k, saved[k]]));
    await chrome.storage.local.set({ settings: { ...settings, ...back } });
    sync();
    return { ok: true, restored: true };
  }
  if (!settings.token) return { ok: true };
  return { ok: true, backup: { kidtubeSettings: 1, savedAt: new Date().toISOString(), ...Object.fromEntries(BACKUP_KEYS.filter((k) => settings[k]).map((k) => [k, settings[k]])) } };
}
