// New versions. Quetta: the browser itself looks at updates.xml only every few hours. When latest.json names a
// newer version, KidTube asks for it (at most every 5 min); the browser downloads it, onUpdateAvailable restarts
// KidTube, and onInstalled reloads YouTube. Orion installs from a .zip by hand.
import { TARGET } from '../lib/target.js';
import { cmpVersion } from '../lib/version.js';
import { LATEST_URL, INSTALL_PAGE } from './constants.js';
import { sync } from './sync.js';

const UPDATE_ASK_MS = 5 * 60 * 1000;
let updateAsked = 0, updateStatus = null;
const installed = () => chrome.runtime.getManifest().version;

export async function latestRelease() {
  try { return await (await fetch(LATEST_URL, { cache: 'no-store' })).json(); } catch { return null; }
}

// Asks the browser to look at updates.xml now. Chrome 109+ gives { status, version }, older ones (status, details).
const askUpdate = () => new Promise((resolve) => {
  try {
    chrome.runtime.requestUpdateCheck((a) => resolve((a && typeof a === 'object' ? a.status : a) ?? 'error'));
  } catch {
    resolve('error');
  }
});

async function askNow() {
  updateAsked = Date.now();
  return (updateStatus = await askUpdate());
}

export async function autoUpdate(latest) {
  if (TARGET === 'orion' || !latest?.version || cmpVersion(latest.version, installed()) <= 0) return null;
  if (Date.now() - updateAsked < UPDATE_ASK_MS) return updateStatus;
  return askNow();
}

// The bottom bar's ↻ Update when there is a newer app (Quetta): ask the browser now, not in 5 min.
export async function updateApp() {
  if (TARGET === 'orion') return { ok: false, error: 'Orion installs a new version from the .zip' };
  return { ok: true, status: await askNow() };
}

// Settings → Update now: the browser's answer, the newest release, and a fresh sync.
export async function checkUpdate() {
  const check = { status: TARGET === 'orion' ? 'manual' : await askNow() };
  const latest = await latestRelease();
  const newer = latest && cmpVersion(latest.version, installed()) > 0;
  return { installed: installed(), check, latest: latest?.version ?? null, installPage: newer ? INSTALL_PAGE : null, download: newer ? latest.zipUrl ?? null : null, sync: await sync() };
}

// The installed version and the newest one (the header, next to the logo). Which newest one depends on how this copy
// was installed (kind): 'quetta' (latest.json; the browser installs it itself, asked here), 'orion' (orion/latest.json;
// a .zip from the install page, by hand), 'dev' (an unpacked copy from git, desktop Chrome: the version on GitHub's
// main; git pull, then Reload in chrome://extensions). Kept 5 minutes: every header asks.
const VERSION_MS = 5 * 60 * 1000;
const DEV_MANIFEST = 'https://raw.githubusercontent.com/andyvauliln/kidtube/main/extension/manifest.json';
let versionKept = null, versionAt = 0;
const isDev = () => new Promise((resolve) => {
  try { chrome.management.getSelf((m) => { void chrome.runtime.lastError; resolve(m?.installType === 'development'); }); } catch { resolve(false); }
});
async function devLatest() {
  try { return { version: (await (await fetch(`${DEV_MANIFEST}?t=${Date.now()}`, { cache: 'no-store' })).json()).version }; } catch { return null; }
}
export async function appVersion() {
  if (versionKept && Date.now() - versionAt < VERSION_MS && versionKept.installed === installed()) return versionKept;
  const kind = TARGET === 'orion' ? 'orion' : (await isDev()) ? 'dev' : 'quetta';
  const latest = kind === 'dev' ? await devLatest() : await latestRelease();
  const newer = !!latest?.version && cmpVersion(latest.version, installed()) > 0;
  versionKept = { ok: true, installed: installed(), target: TARGET, kind, latest: latest?.version ?? null, newer,
    updating: newer && kind === 'quetta' ? await autoUpdate(latest) : null, download: latest?.zipUrl ?? null, installPage: INSTALL_PAGE };
  versionAt = Date.now();
  return versionKept;
}

// The header's new version (a tap on it). Quetta: the browser installs it now and the app restarts. Orion: the install
// page in a new tab (its .zip; opening it also refreshes the copy of the connection, content/backup.js). An unpacked
// copy: Chrome's page of this extension, where Reload loads it after git pull.
export async function openUpdate() {
  const v = await appVersion();
  if (v.kind === 'quetta') return { ok: true, kind: v.kind, status: (await updateApp()).status };
  const url = v.kind === 'dev' ? `chrome://extensions/?id=${chrome.runtime.id}` : v.installPage;
  await chrome.tabs.create({ url });
  return { ok: true, kind: v.kind, url };
}
