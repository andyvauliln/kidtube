// KidTube's files in the profile's folder of the data repo: the rules and the list, the helper's files (memory,
// helper, run status, notes done, runs), the listening keys, the context documents, the plan changes of other
// devices; and what the tablet writes back (activity, rules, transcripts, run requests).
import { TARGET } from '../../../core/lib/target.js';
import { mergeConfig } from '../../../core/lib/merge.js';
import { localParts, nowIso } from '../../../core/lib/time.js';
import { isVideoId } from '../../../core/lib/youtube.js';
import { ghHeaders, contentsUrl, getRepoFile, putRepoFile, explainHttp } from '../../../core/lib/github.js';
import { withState, dataLocation } from '../../../core/background/store.js';
import { applySiteRules } from '../../../core/background/sites.js';
import { sync, fetchDataFile } from '../../../core/background/sync.js';
import { PLAN_ACTIONS, pendingPlan, entryFromRecord } from '../lib/plan.js';
import { loadBundled, effective, contextDocsOf } from './config.js';
import { dropDoneNotes, getMemory, runView } from './parent.js';
import { uploadTranscripts } from './transcripts.js';
import { syncAudio, loadCharacter } from './media.js';

const okConfig = (c) => c && c.schemaVersion === 1 && typeof c === 'object' && !Array.isArray(c);
const okQueue = (q) => q && q.schemaVersion === 1 && Array.isArray(q.videos) && q.videos.every((v) => isVideoId(v.videoId) && Number.isFinite(v.durationSeconds));

// Context documents (parent mode → Context): Markdown in the profile's context/, written by the helper.
async function pullContext(loc, token, etags) {
  const { contextDocs = {} } = await chrome.storage.local.get('contextDocs');
  let changed = false;
  for (const d of await contextDocsOf()) {
    const path = `context/${d}.md`;
    const headers = ghHeaders(token);
    if (contextDocs[d] && etags[path]) headers['If-None-Match'] = etags[path];
    const r = await fetch(contentsUrl(loc, path), { headers, cache: 'no-store' });
    if (r.status === 304 || r.status === 404) continue;
    if (!r.ok) throw new Error(await explainHttp(r.status, loc, token, path));
    contextDocs[d] = { text: await r.text(), at: new Date().toISOString() };
    etags[path] = r.headers.get('etag');
    changed = true;
  }
  if (changed) await chrome.storage.local.set({ contextDocs });
}

// keys.json (<app>/keys.json, beside the profile folders): listening keys the parent put in the private data repo,
// for every tablet and profile of the app. Kept apart from the keys typed in Settings, which win (lib/voice.js).
async function pullKeys(loc, token, etags) {
  const { repoKeys } = await chrome.storage.local.get('repoKeys');
  const headers = ghHeaders(token);
  if (repoKeys && etags['keys.json']) headers['If-None-Match'] = etags['keys.json'];
  const r = await fetch(contentsUrl({ ...loc, base: loc.base.replace(/[^/]+\/$/, '') }, 'keys.json'), { headers, cache: 'no-store' });
  if (r.status === 404) { if (repoKeys) await chrome.storage.local.remove('repoKeys'); return; }
  if (!r.ok) return;
  const j = await r.json();
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  etags['keys.json'] = r.headers.get('etag');
  await chrome.storage.local.set({ repoKeys: { groq: str(j?.groqKey), gemini: str(j?.geminiKey), openrouter: str(j?.openrouterKey) } });
}

// One sync of KidTube's files (core/background/sync.js calls it for a KidTube profile with a folder).
// ctx: { loc, token, data, status, acct } — status.errors collects what went wrong.
export async function syncKidTube({ loc, token, data, status, acct }) {
  const etags = data.etags ?? {};
  const update = {};
  const missing = [];
  for (const [key, path, ok] of [['config', 'parent-config.json', okConfig], ['queue', 'queue.json', okQueue]]) {
    try {
      const r = await fetchDataFile(loc, token, path, data[key] ? etags[path] : null);
      if (r.notModified) continue;
      if (!ok(r.json)) throw new Error(`${path}: not a valid schemaVersion 1 file, keeping the last good copy`);
      update[key] = r.json;
      etags[path] = r.etag;
    } catch (e) {
      if (e.missing) missing.push(path); else status.errors.push(String(e.message ?? e));
    }
  }
  // A new profile: the server makes its starter files within a minute or two (agent/poll.sh → kt.mjs init-profile).
  if (missing.length) status.notes = [`New profile: ${loc.base} has no ${missing.join(' or ')} yet. The server sets it up within a minute or two.`];
  // The helper's files: each is optional (an older data repo may lack it), so a failure is quietly skipped.
  // memory.json: the helper's notes on every video (parent mode: planned videos, summaries, questions).
  let memory = null, helperInfo = null;
  if (token) {
    const optional = async (path, metaKey, use) => {
      try {
        const r = await fetchDataFile(loc, token, path, data[metaKey] ? etags[path] : null);
        if (!r.notModified && use(r.json)) etags[path] = r.etag;
      } catch {}
    };
    await optional('memory.json', 'memoryMeta', (j) => {
      if (j?.schemaVersion !== 1) return false;
      memory = j;
      update.memoryMeta = { updatedAt: j.updatedAt ?? null, processedThrough: j.helper?.processedThrough ?? j.processedThrough ?? null };
      return true;
    });
    // helper.json: how the helper works and its prompt (parent mode → Prompt). Written by the helper each run.
    await optional('helper.json', 'helperMeta', (j) => {
      if (j?.schemaVersion !== 1 || typeof j.prompt !== 'string') return false;
      helperInfo = j;
      update.helperMeta = { updatedAt: j.updatedAt ?? null };
      return true;
    });
    // run-status.json: a run asked for from parent mode (agent/poll.sh on the server writes it).
    await optional('run-status.json', 'runStatus', (j) => j?.schemaVersion === 1 && (update.runStatus = j));
    // notes-done.json: the notes the AI has worked on, deleted from the lists below.
    await optional('notes-done.json', 'notesDone', (j) => Array.isArray(j?.ids) && (update.notesDone = j.ids));
    // runs.json: time, turns and cost of the latest runs (agent/runlog.mjs).
    await optional('runs.json', 'runs', (j) => Array.isArray(j?.runs) && (update.runs = j.runs.slice(-10)));
    try { await pullKeys(loc, token, etags); } catch {}
    try { await pullContext(loc, token, etags); } catch (e) { status.errors.push('Context documents: ' + String(e.message ?? e)); }
  }
  const done = await withState((s) => {
    Object.assign(s.data, update, { etags });
    if (s.notes) dropDoneNotes(s.notes, s.data.notesDone ?? []);
    s.syncStatus = status;
    return true;
  }, { account: acct });
  if (!done) return false;
  if (memory) await chrome.storage.local.set({ memory });
  if (helperInfo) await chrome.storage.local.set({ helperInfo });
  // One cause (usually the token) should show once, not once per file.
  const report = (prefix, msg) => { if (!status.errors.some((x) => msg.includes(x) || x.includes(msg))) status.errors.push(prefix + msg); };
  const rules = await uploadLocalConfig();
  if (rules.saved === 'tablet' && token) report('Rules: ', rules.error.replace(/^Saved on this tablet\. GitHub: /, ''));
  try { await flushOutbox(loc, token); } catch (e) { if (token) report('Saving what he watched: ', String(e.message ?? e)); }
  if (token) {
    try { await pullPlan(loc, token, acct); } catch (e) { report('Changes from other devices: ', String(e.message ?? e)); }
    try { await uploadTranscripts(loc, token); } catch (e) { report('Transcripts: ', String(e.message ?? e)); }
    try { await loadCharacter(loc, token); } catch (e) { report('Talking friend picture: ', String(e.message ?? e)); }
    try { await syncAudio(loc, token); } catch (e) { report('Talking friend recordings: ', String(e.message ?? e)); }
  }
}

// The parent's plan changes made on another device (activity files since the helper last read them),
// so every tablet shows the same lists. Changes the helper has read are already in its files: dropped here.
async function pullPlan(loc, token, acct) {
  const { data = {} } = await chrome.storage.local.get('data');
  const since = data.memoryMeta?.processedThrough ?? null;
  const tz = (await effective({ data })).config.timezone;
  const today = localParts(new Date(), tz).date;
  const from = since ? localParts(new Date(since), tz).date : today;
  const dates = [];
  for (let d = new Date(); dates.length < 4; d = new Date(d - 86400000)) {
    const day = localParts(d, tz).date;
    if (day < from) break;
    dates.push(day);
  }
  const found = [];
  for (const date of dates) {
    const f = await getRepoFile(loc, token, `activity/${date}.json`);
    for (const e of f?.json?.events ?? []) if (['plan', 'prompt'].includes(e.type) && (!since || e.at > since)) found.push(e);
  }
  const memory = await getMemory();
  await withState((s) => {
    const log = (s.planLog ??= { events: [], entries: {}, items: {} });
    const have = new Set((log.events ?? []).map((e) => e.eventId));
    const ops = ((s.notes ??= {}).promptOps ??= []);
    for (const e of found.filter((x) => x.type === 'prompt')) if (!ops.some((o) => o.eventId === e.eventId)) ops.push(e);
    s.notes.promptOps = ops.filter((o) => !since || o.at > since).slice(-100);
    for (const e of found.filter((x) => x.type === 'plan' && PLAN_ACTIONS.includes(x.action))) {
      if (have.has(e.eventId)) continue;
      log.events.push(e);
      const rec = memory?.helper?.videos?.[e.videoId];
      if (e.action === 'today' && rec && !log.entries?.[e.videoId]) {
        (log.entries ??= {})[e.videoId] = entryFromRecord(e.videoId, rec);
        for (const q of rec.content?.quizIds ?? []) if (rec.content.items?.[q]) (log.items ??= {})[q] = rec.content.items[q];
      }
    }
    s.planLog = pendingPlan(log, since);
    if (!s.planLog.events.length) s.planLog = null;
  }, { account: acct });
}

// Notes for the AI wait on the tablet (held) until the parent taps ↻ Update data; then they all go together,
// and the server's notes agent (agent/notes.sh) reads them within a minute.
export async function releaseNotes() {
  await withState((s) => { for (const e of s.outbox) delete e.held; });
}

// Parent mode → Update. Sends what is waiting (notes, what he watched), then writes requests/run.json;
// the server checks every minute and runs the helper (agent/poll.sh), at most a few times a day.
export async function requestRun() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (!settings.token) return { ok: false, error: 'Needs the GitHub token (the header’s account menu → GitHub connection).' };
  const loc = await dataLocation(settings);
  if (!loc.base) return { ok: false, error: 'No profile yet: open YouTube once, signed in.' };
  await releaseNotes();
  await sync();
  const left = await withState((s) => s.outbox.length);
  if (left) return { ok: false, error: 'Could not send your notes to GitHub yet. Check the connection and try again.' };
  const req = { schemaVersion: 1, id: crypto.randomUUID(), at: new Date().toISOString() };
  try {
    for (let i = 0; i < 3; i++) {
      const old = await getRepoFile(loc, settings.token, 'requests/run.json');
      if (await putRepoFile(loc, settings.token, 'requests/run.json', req, old?.sha, 'tablet: run the helper now')) {
        await withState((s) => { s.data.runRequest = { id: req.id, at: req.at }; });
        return { ok: true, ...(await withState((s) => runView(s))) };
      }
    }
    return { ok: false, error: 'GitHub was busy. Try again.' };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  }
}

// Rules from the parent page: used on the tablet at once, then written into parent-config.json
// so the agent sees them. Until GitHub accepts them they stay in localConfig.
export async function saveRules(patch) {
  await withState((s) => { s.localConfig = mergeConfig(s.localConfig ?? {}, patch); });
  await applySiteRules();
  return uploadLocalConfig();
}

async function uploadLocalConfig() {
  const { settings = {}, localConfig, account } = await chrome.storage.local.get(['settings', 'localConfig', 'account']);
  if (!localConfig) return { saved: 'github' };
  const loc = await dataLocation(settings), token = settings.token || '';
  if (!loc.base) return { saved: 'tablet', error: 'No profile yet (open YouTube once), so the rules are saved on this tablet only.' };
  if (!token) return { saved: 'tablet', error: 'No GitHub token yet, so the rules are saved on this tablet only.' };
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await getRepoFile(loc, token, 'parent-config.json');
      const next = { ...mergeConfig(cur?.json ?? { schemaVersion: 1 }, localConfig), schemaVersion: 1, updatedAt: nowIso() };
      if (await putRepoFile(loc, token, 'parent-config.json', next, cur?.sha, 'Rules changed on the tablet')) {
        await withState((s) => {
          s.data.config = next;
          if (s.data.etags) delete s.data.etags['parent-config.json'];
          s.localConfig = null;
        }, { account: account?.key ?? null });
        return { saved: 'github' };
      }
    }
    return { saved: 'tablet', error: 'GitHub was busy; will retry on the next sync.' };
  } catch (e) {
    return { saved: 'tablet', error: `Saved on this tablet. GitHub: ${e.message ?? e}` };
  }
}

// Writes queued events into activity/YYYY-MM-DD.json, de-duplicated by eventId (PLAN.md §3.3).
async function flushOutbox(loc, token) {
  const all = (await chrome.storage.local.get('outbox')).outbox ?? [];
  const outbox = all.filter((e) => !e.held);   // notes wait for ↻ Update data
  const { settings = {}, data = {}, localConfig } = await chrome.storage.local.get(['settings', 'data', 'localConfig']);
  if (!outbox.length) return;
  if (!token) throw new Error('no token; events kept on the tablet');
  const { config, queue } = await effective({ data, settings, localConfig });
  const byDate = {};
  for (const ev of outbox) (byDate[localParts(new Date(ev.at), config.timezone).date] ??= []).push(ev);
  if (!settings.deviceId) await withState((s) => { s.settings.deviceId ??= `tab-${crypto.randomUUID().slice(0, 8)}`; });
  const deviceId = (await chrome.storage.local.get('settings')).settings.deviceId;

  const sent = new Set();
  for (const [date, events] of Object.entries(byDate)) {
    const path = `activity/${date}.json`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await getRepoFile(loc, token, path);
      const file = cur?.json ?? { schemaVersion: 1, date, events: [] };
      const have = new Set(file.events.map((e) => e.eventId));
      file.events.push(...events.filter((e) => !have.has(e.eventId)));
      file.events.sort((a, b) => a.at.localeCompare(b.at));
      file.device = {
        deviceId, extensionVersion: chrome.runtime.getManifest().version, target: TARGET, quizTypes: (await loadBundled()).quizTypes,
        ...(config.updatedAt ? { configUpdatedAt: config.updatedAt } : {}),
        ...(queue.updatedAt ? { queueUpdatedAt: queue.updatedAt } : {}),
        lastSyncAt: nowIso(),
      };
      if (await putRepoFile(loc, token, path, file, cur?.sha, `activity ${date}`)) { events.forEach((e) => sent.add(e.eventId)); break; }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  await withState((s) => { s.outbox = s.outbox.filter((e) => !sent.has(e.eventId)); });
}

