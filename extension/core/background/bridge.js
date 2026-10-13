// Dev mode (docs/plans/DEVICE-BRIDGE.md): the server's AI agents test this tablet. Off by default; only the apps
// header's Dev mode card turns it on (at the unlocked header or in parent mode, as the GitHub connection).
// While it is on, the service worker keeps a WebSocket to the bridge server (agent/devices/relay.mjs: BRIDGE_URL,
// or settings.bridgeUrl) and answers its commands. Every command is a fixed handler here or in the page
// (core/ui/bridge.js): no code comes from the server. What it never does: the messages in REFUSED (the GitHub
// connection, the settings file, dev mode, the rules, the minutes, the reports) and, in the pages, taps and typing
// inside data-bridge="no" (the PIN, the rules, the GitHub card) and on the PIN page.
// The key is made on this tablet; its SHA-256 goes to devices/<device>/bridge.json in the data repo, where the relay
// reads it. Every command is a step (core/checks/runner.js) and counts in storage "bridgeLog" (the header shows it,
// the pages show "AI is testing" for a few seconds: core/ui/bridge.js).
import { TARGET } from '../lib/target.js';
import { getRepoFile, putRepoFile } from '../lib/github.js';
import { redact, safeUrl } from '../checks/kit.js';
import { step, stepsNow, contextNow, checksView, deviceIdNow } from '../checks/runner.js';
import { BRIDGE_URL, DEFAULT_REPO } from './constants.js';
import { withState } from './store.js';

export const BRIDGE_ALARM = 'bridge';
const PING_MS = 20000;                          // keeps the socket, and with it the service worker, alive
const LIFE = { hour: 3600e3, day: 86400e3 };    // how long dev mode stays on; 'never': until the parent turns it off
// Messages the bridge never sends: what only the parent changes, dev mode itself, and the reports (the evidence).
const REFUSED = new Set(['devMode', 'devStop', 'bridgeFrame', 'connectGitHub', 'exportSettings', 'importSettings',
  'settingsBackup', 'saveRules', 'resetToday', 'clearChecks']);
const SECRET_TYPE = /pin|token|secret|password/i;
const PAGE_WAIT = 1200;                         // a snapshot: the frames that answered by then
// Pictures of the screen (tabs.captureVisibleTab) need every site's permission: optional, asked for by the header's
// card (the parent's tap) and given back when dev mode turns off.
export const PICTURES = '<all_urls>';

let handle = null;      // core/background/messages.js handle, from main.js (no import cycle)
let ws = null, pinger = null, retry = 0, retryTimer = null, connected = false, lastError = null;
const pending = new Map();   // page requests: id → { frames, all, resolve, timer }

export function startBridge(h) {
  handle = h;
  bridgeUp().catch(() => {});
}

const settingsNow = async () => (await chrome.storage.local.get('settings')).settings ?? {};

// --- on and off ---------------------------------------------------------------------------------------------------
// The header's card (the 'devMode' message). on: a new key, the file in the data repo, then the socket.
// life: 'hour', 'day' or 'never'; url: another bridge server, '' for this server.
export async function setDevMode({ on = false, life = 'never', url = '' } = {}) {
  const st = await settingsNow();
  if (on && !st.token) return { ok: false, error: 'Connect GitHub first: the server finds this tablet’s key in the data repo.' };
  const custom = String(url ?? '').trim();
  if (on && custom && !/^wss?:\/\/[^\s/]+/.test(custom)) return { ok: false, error: 'The bridge server is a wss:// address.' };
  const key = on ? hex(crypto.getRandomValues(new Uint8Array(32))) : null;
  await withState((s) => {
    s.settings.devMode = !!on;
    if (on) Object.assign(s.settings, { devKey: key, devUntil: LIFE[life] ? Date.now() + LIFE[life] : null, bridgeUrl: custom || null });
    else { delete s.settings.devKey; delete s.settings.devUntil; }
  });
  if (on) await chrome.storage.local.set({ bridgeLog: { n: 0, at: null, cmd: null } });
  let error = null;
  try { await publish({ ...(await settingsNow()) }, !!on); } catch (e) { error = String(e?.message ?? e); }
  if (on && error) {
    await withState((s) => { s.settings.devMode = false; delete s.settings.devKey; });
    return { ok: false, error: `Dev mode stays off: ${error}` };
  }
  if (on) await bridgeUp(); else { down(); await chrome.permissions?.remove?.({ origins: [PICTURES] }).catch(() => {}); }
  // Off while GitHub is out of reach: off on this tablet anyway (the relay closed the socket already).
  return { ok: true, dev: await devView(), ...(error ? { warning: error } : {}) };
}

// devices/<device>/bridge.json at the top of the data repo: what the relay accepts (agent/devices/relay.mjs).
async function publish(st, on) {
  const loc = { repo: st.repo || DEFAULT_REPO, base: '' };
  const device = await deviceIdNow();
  const path = `devices/${device}/bridge.json`;
  const m = chrome.runtime.getManifest();
  const file = { schemaVersion: 1, device, on, keyHash: on ? await sha256(st.devKey) : null,
    until: on && st.devUntil ? new Date(st.devUntil).toISOString() : null, url: st.bridgeUrl || BRIDGE_URL,
    version: m.version, target: TARGET, kidtubeDevice: st.deviceId ?? null, userAgent: globalThis.navigator?.userAgent ?? null,
    at: new Date().toISOString() };
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await getRepoFile(loc, st.token, path);
    if (await putRepoFile(loc, st.token, path, file, cur?.sha, `dev mode ${on ? 'on' : 'off'}: ${device}`)) return;
  }
  throw new Error(`GitHub kept refusing ${path}.`);
}

// What the header's card shows.
export async function devView() {
  const { settings: st = {}, bridgeLog = null } = await chrome.storage.local.get(['settings', 'bridgeLog']);
  return { on: !!st.devMode, until: st.devUntil ?? null, url: st.bridgeUrl || BRIDGE_URL, defaultUrl: BRIDGE_URL,
    connected: !!st.devMode && connected, error: st.devMode && !connected ? lastError : null,
    pictures: !!(await chrome.permissions?.contains?.({ origins: [PICTURES] }).catch(() => false)),
    device: await deviceIdNow(), actions: bridgeLog };
}

// --- the socket ---------------------------------------------------------------------------------------------------
// After a start, every minute (the alarm) and after the card: connected while dev mode is on, closed otherwise.
export async function bridgeUp() {
  const st = await settingsNow();
  if (!st.devMode) { down(); return; }
  if (st.devUntil && st.devUntil < Date.now()) { await setDevMode({ on: false }); return; }
  chrome.alarms.create(BRIDGE_ALARM, { periodInMinutes: 1 });
  if (ws && ws.readyState <= 1) return;
  if (typeof WebSocket !== 'function') { lastError = 'This browser has no WebSocket in the background.'; return; }
  let sock;
  try { sock = ws = new WebSocket(st.bridgeUrl || BRIDGE_URL); } catch (e) { lastError = String(e?.message ?? e); later(); return; }
  sock.onopen = async () => {
    const m = chrome.runtime.getManifest();
    sock.send(JSON.stringify({ type: 'hello', device: await deviceIdNow(), key: st.devKey, version: m.version, target: TARGET,
      kidtubeDevice: st.deviceId ?? null, userAgent: globalThis.navigator?.userAgent ?? null }));
    clearInterval(pinger);
    pinger = setInterval(() => { if (sock.readyState === 1) sock.send('{"type":"ping"}'); }, PING_MS);
  };
  sock.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'welcome') { connected = true; retry = 0; lastError = null; }
    else if (m.type === 'refused') lastError = `The bridge server refused this tablet: ${m.error ?? 'no reason given'}.`;
    else if (m.type === 'cmd') run(sock, m);
  };
  sock.onerror = () => { lastError ??= 'The bridge server could not be reached.'; };
  sock.onclose = () => {
    if (ws !== sock) return;
    clearInterval(pinger);
    ws = null; connected = false;
    later();
  };
}
// Again in 5 s, 15 s, then every minute (the alarm tries every minute too).
function later() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => bridgeUp().catch(() => {}), [5000, 15000, 60000][Math.min(retry++, 2)]);
}
function down() {
  clearTimeout(retryTimer);
  clearInterval(pinger);
  chrome.alarms.clear?.(BRIDGE_ALARM);
  const s = ws;
  ws = null; connected = false; lastError = null;
  s?.close();
}

// --- the commands ---------------------------------------------------------------------------------------------------
async function run(sock, { id, cmd, args = {} }) {
  let out;
  try {
    const st = await settingsNow();
    if (!st.devMode) throw new Error('Dev mode is off on this tablet.');
    if (st.devUntil && st.devUntil < Date.now()) { setDevMode({ on: false }); throw new Error('Dev mode ended on this tablet.'); }
    const fn = COMMANDS[cmd];
    if (!fn) throw new Error(`Unknown command “${cmd}”. Known: ${Object.keys(COMMANDS).join(', ')}.`);
    const log = (await chrome.storage.local.get('bridgeLog')).bridgeLog ?? { n: 0 };
    await chrome.storage.local.set({ bridgeLog: { n: (log.n ?? 0) + 1, at: Date.now(), cmd } });
    out = { ok: true, result: await fn(args ?? {}) };
  } catch (e) {
    out = { ok: false, error: String(e?.message ?? e) };
  }
  step({ kind: 'ai', type: cmd, label: args?.do ?? args?.msg?.type ?? args?.url ?? undefined, ok: out.ok });
  if (sock.readyState === 1) sock.send(JSON.stringify({ type: 'answer', id, ...out }));
}

const COMMANDS = {
  // Everything a report has, now: the build, the browser, the profile, the sync, the checks, the last steps, the tabs.
  state: async () => ({ device: await deviceIdNow(), dev: await devView(), context: await contextNow(),
    tabs: await tabsNow(), checks: await checksView(), steps: stepsNow() }),
  // Stored keys, redacted (no token, key, PIN hash, names or texts).
  storage: async ({ keys }) => {
    if (!Array.isArray(keys) || !keys.length) throw new Error('Name the keys: { keys: ["settings", …] }.');
    return redact(await chrome.storage.local.get(keys));
  },
  tabs: () => tabsNow(),
  // A message, as one of the extension's pages sends it: the same handler, the same checks after it.
  message: async ({ msg, tab }) => {
    const type = msg?.type;
    if (!type) throw new Error('No message: { msg: { type: … } }.');
    if (REFUSED.has(type) || SECRET_TYPE.test(type)) {
      throw new Error(`Refused in dev mode: “${type}”. The PIN, the rules, the minutes, the GitHub connection, the settings file, the reports and dev mode stay with the parent.`);
    }
    const t = await tabOf(tab);
    return handle(msg, { id: chrome.runtime.id, url: chrome.runtime.getURL('core/background/bridge.js'), ...(t ? { tab: { id: t.id, url: t.url } } : {}) });
  },
  // A tab to an address (the guard still decides, as for a tap): a web page or one of the extension's pages.
  navigate: async ({ url, tab, newTab = false }) => {
    const to = addressOf(url);
    if (newTab) { const t = await chrome.tabs.create({ url: to }); return { tab: t?.id ?? null, url: to }; }
    const t = await tabOf(tab);
    if (!t) throw new Error('No tab to navigate.');
    await chrome.tabs.update(t.id, { url: to });
    return { tab: t.id, url: to };
  },
  // What the tab shows, as a JPEG data URL (the tab comes to the front first).
  screenshot: async ({ tab, quality = 60 }) => {
    const t = await tabOf(tab);
    if (!t) throw new Error('No tab.');
    if (!(await chrome.permissions?.contains?.({ origins: [PICTURES] }).catch(() => false))) {
      throw new Error('No pictures: the parent has not allowed them (apps header → Dev mode → Allow screen pictures, on a page of the app).');
    }
    if (!t.active) await chrome.tabs.update(t.id, { active: true });
    const image = await chrome.tabs.captureVisibleTab(t.windowId, { format: 'jpeg', quality: Math.max(20, Math.min(90, Number(quality) || 60)) });
    return { tab: t.id, url: t.url, image };
  },
  // The page's own part (core/ui/bridge.js): do = snapshot | tap | type | scroll | wait | errors.
  page: (args) => page(args),
};

async function tabsNow() {
  const tabs = (await chrome.tabs.query({})) ?? [];
  return tabs.map((t) => ({ id: t.id, url: String(t.url ?? '').slice(0, 300), title: String(t.title ?? '').slice(0, 120), active: !!t.active, windowId: t.windowId }));
}
// The tab asked for, else the one in front.
async function tabOf(tab) {
  if (tab != null) return chrome.tabs.get(Number(tab));
  return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))?.[0] ?? (await chrome.tabs.query({ active: true }))?.[0] ?? null;
}
// "core/pages/check.html" → the extension's page; http(s) as it is; nothing else (javascript:, data:, chrome:).
function addressOf(url) {
  const u = String(url ?? '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith(chrome.runtime.getURL(''))) return u;
  if (u && !/^[a-z][a-z0-9+.-]*:/i.test(u)) return chrome.runtime.getURL(u.replace(/^\/+/, ''));
  throw new Error(`Not an address dev mode opens: ${safeUrl(u) || '(empty)'}.`);
}

// A page request goes to every frame of the tab: content scripts get it through tabs.sendMessage, the extension's
// own pages through runtime.sendMessage (they compare the tab id). A frame answers with the 'bridgeFrame' message.
// ref "<frame>:<n>" (from a snapshot) names the frame; a snapshot without one collects every frame.
async function page({ do: what = 'snapshot', tab, ref = null, frame = null, ...args } = {}) {
  const t = await tabOf(tab);
  if (!t) throw new Error('No tab.');
  const id = crypto.randomUUID();
  const fid = ref ? String(ref).split(':')[0] : frame;
  const all = what === 'snapshot' && !fid;
  const wait = all ? PAGE_WAIT : Math.min(Number(args.ms ?? 0) || 0, 15000) + 5000;
  const answer = new Promise((resolve) => {
    pending.set(id, { frames: [], all, resolve, timer: setTimeout(() => finish(id), wait) });
  });
  const msg = { type: 'bridgePage', id, tabId: t.id, fid, do: what, args: { ...args, ref } };
  try { chrome.tabs.sendMessage(t.id, msg, () => void chrome.runtime.lastError); } catch {}
  try { chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError); } catch {}
  const frames = await answer;
  if (!frames.length) {
    throw new Error(`No page answered in tab ${t.id} (${safeUrl(t.url ?? '')}). Still loading, or a site without the app's scripts.`);
  }
  return all ? { tab: t.id, url: t.url, frames } : frames[0];
}
// A frame's answer (the 'bridgeFrame' message, core/background/messages.js).
export function frameAnswer(msg) {
  const p = pending.get(msg?.id);
  if (!p) return { ok: false };
  p.frames.push({ frame: msg.fid, url: msg.url, top: !!msg.top, ...(msg.result ?? {}) });
  if (!p.all) finish(msg.id);
  return { ok: true };
}
function finish(id) {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(p.frames);
}

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(text) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}
