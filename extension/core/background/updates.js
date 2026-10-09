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

// The installed version and the newest release (the parent page's bottom bar). Quetta asks for the update itself
// (updating: the browser's answer); Orion gets a download link.
export async function appVersion() {
  const latest = await latestRelease();
  const newer = !!latest && cmpVersion(latest.version, installed()) > 0;
  return { ok: true, installed: installed(), target: TARGET, latest: latest?.version ?? null, newer,
    updating: newer ? await autoUpdate(latest) : null, download: latest?.zipUrl ?? null, installPage: INSTALL_PAGE };
}
