// New versions. Quetta: the browser itself looks at updates.xml only every few hours. When latest.json names a
// newer version, KidTube asks for it (at most every 5 min); the browser downloads it, onUpdateAvailable restarts
// KidTube, and onInstalled reloads YouTube. Orion installs from a .zip by hand.
import { TARGET } from '../lib/target.js';
import { cmpVersion } from '../lib/version.js';
import { LATEST_URL, INSTALL_PAGE } from './constants.js';
import { sync } from './sync.js';
import { step } from '../checks/runner.js';

// Chrome (and Quetta) refuse requestUpdateCheck when it comes often ("throttled"), and then do not look at all: before
// 0.12.8 KidTube asked every 5 minutes and the tablet stayed on 0.12.2 for hours (2026-10-13). Now: once when a new
// version shows up, then at most every 30 minutes, and at once on the parent's tap. The state is kept in storage
// (updateState) so a restarted worker does not ask again: { version, since, askedAt, status, tries }.
const ASK_GAP_MS = 30 * 60000;
const MANUAL_AFTER_MS = 10 * 60000;   // asked, and still not installed 10 minutes later: offer the install page
const installed = () => chrome.runtime.getManifest().version;

export async function latestRelease(ms = 30000) {
  try { return await (await fetch(LATEST_URL, { cache: 'no-store', signal: AbortSignal.timeout(ms) })).json(); } catch { return null; }
}

// Asks the browser to look at updates.xml now. Chrome 109+ gives { status, version }, older ones (status, details).
const askUpdate = () => new Promise((resolve) => {
  try {
    chrome.runtime.requestUpdateCheck((a) => resolve((a && typeof a === 'object' ? a.status : a) ?? 'error'));
  } catch {
    resolve('error');
  }
});

async function loadState(version) {
  const { updateState: st } = await chrome.storage.local.get('updateState');
  return st?.version === version ? st : { version, since: Date.now(), askedAt: 0, status: null, tries: 0 };
}
async function askNow(version) {
  const st = await loadState(version ?? null);
  // Kept before the browser answers: one that never answers is not asked again at once (status 'asking').
  await chrome.storage.local.set({ updateState: { ...st, askedAt: Date.now(), status: 'asking', tries: st.tries + 1 } });
  const status = await askUpdate();
  const next = { ...st, askedAt: Date.now(), status, tries: st.tries + 1 };
  await chrome.storage.local.set({ updateState: next });
  step({ kind: 'update', type: status, label: version ?? '' });
  return next;
}

export async function autoUpdate(latest) {
  if (TARGET === 'orion' || !latest?.version || cmpVersion(latest.version, installed()) <= 0) return null;
  const st = await loadState(latest.version);
  if (st.askedAt && Date.now() - st.askedAt < ASK_GAP_MS) return st;
  return askNow(latest.version);
}

// The bottom bar's ↻ Update when there is a newer app (Quetta): ask the browser now, not in 30 min.
export async function updateApp() {
  if (TARGET === 'orion') return { ok: false, error: 'Orion installs a new version from the .zip' };
  return { ok: true, status: (await askNow((await latestRelease())?.version)).status };
}

// Settings → Update now: the browser's answer, the newest release, and a fresh sync.
export async function checkUpdate() {
  const latest = await latestRelease();
  const check = { status: TARGET === 'orion' ? 'manual' : (await askNow(latest?.version)).status };
  const newer = latest && cmpVersion(latest.version, installed()) > 0;
  return { installed: installed(), check, latest: latest?.version ?? null, installPage: newer ? INSTALL_PAGE : null, download: newer ? latest.zipUrl ?? null : null, sync: await sync() };
}

// The installed version and the newest one (the header, next to the logo). Which newest one depends on how this copy
// was installed (kind): 'quetta' (latest.json; the browser installs it itself, asked here), 'orion' (orion/latest.json;
// a .zip from the install page, by hand), 'dev' (an unpacked copy from git, desktop Chrome: the version on GitHub's
// main; git pull, then Reload in chrome://extensions). Kept 5 minutes: every header asks.
// The page waits 8 s (core/lib/ask.js): latest.json gets 5 s, the browser's update check 1.5 s (it goes on after the
// answer, its status shows in the next one). A slow tablet took 10.4 s waiting for both (0.12.2).
const VERSION_MS = 5 * 60 * 1000, LATEST_MS = 5000, UPDATE_WAIT_MS = 1500;
const within = (p, ms, late) => Promise.race([p, new Promise((r) => setTimeout(() => r(late), ms))]);
const DEV_MANIFEST = 'https://raw.githubusercontent.com/andyvauliln/kidtube/main/extension/manifest.json';
let versionKept = null, versionAt = 0;
// How this copy was installed (chrome.management): 'normal' (a .crx: the browser can update it from updates.xml),
// 'development' (unpacked: a folder or a .zip; the browser never updates it), 'sideload', 'other'.
export const installTypeOf = () => new Promise((resolve) => {
  try { chrome.management.getSelf((m) => { void chrome.runtime.lastError; resolve(m?.installType ?? null); }); } catch { resolve(null); }
});
const android = () => /Android/i.test(globalThis.navigator?.userAgent ?? '');
async function devLatest() {
  try { return { version: (await (await fetch(`${DEV_MANIFEST}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(LATEST_MS) })).json()).version }; } catch { return null; }
}
// phase (Quetta, a newer one): installing (the browser said update_available a short time ago: it downloads it and
// KidTube restarts), waiting (the browser was asked; it looks again by itself), manual (installed from a .zip, or still
// not installed 10 minutes after asking: the install page's .crx, by hand). Installed: newer is false, one version.
export function phaseOf(st, installType, now = Date.now()) {
  if (installType === 'development') return { phase: 'manual', why: 'zip' };
  if (st?.status === 'update_available' && now - st.askedAt < 5 * 60000) return { phase: 'installing' };
  if (st?.askedAt && now - st.since >= MANUAL_AFTER_MS) return { phase: 'manual', why: st.status ?? 'error' };
  return { phase: 'waiting', why: st?.status ?? null };
}
// What each release changed and what to test (latest.json changes, written by build/ship.mjs; the parent's note,
// 2026-10-14): coming, the releases above this one (newest first); here, the one this tablet runs (null: none written).
const line = (x) => typeof x === 'string' && x.trim() ? [x.trim().slice(0, 400)] : [];
const entryOf = (c) => ({ version: c.version, at: typeof c.at === 'string' ? c.at : '',
  changed: (Array.isArray(c.changed) ? c.changed : []).flatMap(line).slice(0, 12), test: (Array.isArray(c.test) ? c.test : []).flatMap(line).slice(0, 12) });
export function changesOf(latest, version) {
  const all = (Array.isArray(latest?.changes) ? latest.changes : []).filter((c) => typeof c?.version === 'string').map(entryOf);
  return { coming: all.filter((c) => cmpVersion(c.version, version) > 0), here: all.find((c) => c.version === version) ?? null };
}
export async function appVersion({ fresh = false } = {}) {
  if (!fresh && versionKept && Date.now() - versionAt < VERSION_MS && versionKept.installed === installed()) return versionKept;
  const installType = await installTypeOf();
  // An unpacked copy on a computer is a copy from git; on Android it is a .zip installed in Quetta.
  const kind = TARGET === 'orion' ? 'orion' : installType === 'development' && !android() ? 'dev' : 'quetta';
  const latest = kind === 'dev' ? await devLatest() : await latestRelease(LATEST_MS);
  const newer = !!latest?.version && cmpVersion(latest.version, installed()) > 0;
  if (latest && !newer) await chrome.storage.local.remove('updateState');
  // The browser's answer at most 1.5 s; a later one is in updateState for the next read (the header reads it again).
  const quetta = newer && kind === 'quetta' && installType !== 'development';
  const st = quetta ? (await within(autoUpdate(latest), UPDATE_WAIT_MS, null)) ?? (await loadState(latest.version)) : null;
  const answer = { ok: true, installed: installed(), target: TARGET, kind, installType, latest: latest?.version ?? null, newer,
    ...(newer && kind === 'quetta' ? { ...phaseOf(st, installType), status: st?.status ?? null, askedAt: st?.askedAt ?? null } : {}),
    updating: st?.status ?? null, download: latest?.zipUrl ?? null, installPage: INSTALL_PAGE, changes: changesOf(latest, installed()) };
  // A latest.json that did not come back is not kept: the next header asks again.
  if (latest) [versionKept, versionAt] = [answer, Date.now()];
  return answer;
}

// The header's new version (a tap on it). Quetta: the browser installs it now and the app restarts. Orion: the install
// page in a new tab (its .zip; opening it also refreshes the copy of the connection, content/backup.js). An unpacked
// copy: Chrome's page of this extension, where Reload loads it after git pull.
// manual: the parent chose "by hand" (or the phase says so): the install page, whose .crx installs over this one.
export async function openUpdate(msg = {}) {
  const v = await appVersion();
  if (v.kind === 'quetta' && !msg.manual && v.phase !== 'manual') {
    // The browser's answer, 5 s at most (the header waits 15): later, the label follows it (updateState).
    const st = await within(askNow(v.latest), 5000, { status: 'asking' });
    versionAt = 0;   // the header reads the new phase at once
    return { ok: true, kind: v.kind, status: st.status, latest: v.latest };
  }
  const url = v.kind === 'dev' ? `chrome://extensions/?id=${chrome.runtime.id}` : v.installPage;
  await chrome.tabs.create({ url });
  return { ok: true, kind: v.kind, url, manual: v.kind === 'quetta', why: v.why ?? null, latest: v.latest };
}
