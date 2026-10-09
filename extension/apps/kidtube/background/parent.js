// Parent mode's data: Today, Planned, History, one video's details, the Prompt tab, the notes for the AI,
// and the parent's changes to the plan.
import { visibleVideos } from '../lib/queue.js';
import { localParts } from '../../../core/lib/time.js';
import { isVideoId, thumbUrl } from '../../../core/lib/youtube.js';
import { appOf } from '../../registry.js';
import { PLAN_ACTIONS, applyPlan, applyPlanEvent, entryFromRecord, applyPromptNotes } from '../lib/plan.js';
import { parentMode } from '../../../core/background/store.js';
import { effective } from './config.js';
import { newEvent, fullLang, todayPlayed } from './rules.js';

export const getMemory = async () => (await chrome.storage.local.get('memory')).memory ?? null;

// --- notes for the AI --------------------------------------------------------------------------------------
// The tablet keeps no history of notes: one stays in its list until the server says the AI worked on it
// (notes-done.json, agent/poll.sh), then it is deleted. id: the event's id, to match that list.
function addNote(list, ev) {
  list.push({ id: ev.eventId, at: ev.at, text: ev.comment ?? ev.text });
  list.splice(0, Math.max(0, list.length - 20));
}

// Deletes the notes the AI has worked on, and old ones without an id (saved before 0.9.1, all long handled).
export function dropDoneNotes(notes, doneIds) {
  const done = new Set(doneIds);
  const keep = (list) => (list ?? []).filter((n) => n.id && !done.has(n.id));
  for (const box of [notes?.lists, notes?.videos]) {
    if (!box) continue;
    for (const k of Object.keys(box)) { box[k] = keep(box[k]); if (!box[k].length) delete box[k]; }
  }
}

// The notes card (parent screens): the notes still waiting on this tablet, from every tab, oldest first.
export async function heldNotes(s) {
  const { queue } = await effective(s);
  const recs = records(await getMemory(), s.planLog, queue);
  const titleOf = (id) => cardOf(id, queue.videos.find((v) => v.videoId === id) ?? {}, recs[id] ?? {}, s).title ?? '';
  const notes = s.outbox.filter((e) => e.held && (e.comment || e.text)).map((e) => ({
    id: e.eventId, at: e.at, type: e.type, text: e.comment ?? e.text,
    ...(e.list ? { list: e.list } : {}), ...(e.doc ? { doc: e.doc } : {}),
    ...(e.videoId ? { videoId: e.videoId, title: titleOf(e.videoId) } : {}),
  }));
  return { ok: true, notes };
}

// Deletes notes that were not sent yet (id, or all of them when id is null): from the outbox and the tabs' lists.
export function dropHeld(s, id) {
  const gone = new Set(s.outbox.filter((e) => e.held && (id == null || e.eventId === id)).map((e) => e.eventId));
  if (!gone.size) return { ok: false };
  s.outbox = s.outbox.filter((e) => !gone.has(e.eventId));
  const n = s.notes ?? {};
  for (const box of [n.lists, n.videos]) {
    for (const k of Object.keys(box ?? {})) { box[k] = box[k].filter((x) => !gone.has(x.id)); if (!box[k].length) delete box[k]; }
  }
  if (n.contextNotes) n.contextNotes = n.contextNotes.filter((x) => !gone.has(x.eventId));
  if (n.promptOps) n.promptOps = n.promptOps.filter((x) => !gone.has(x.eventId));
  return { ok: true, removed: gone.size };
}

// 👍 / 👎 / a note for the AI about one video.
export function noteVideo(s, msg) {
  if (!isVideoId(msg.videoId)) return { ok: false };
  const ev = newEvent('parentNote', { videoId: msg.videoId });
  if (typeof msg.liked === 'boolean') ev.liked = msg.liked;
  if (msg.comment) ev.comment = String(msg.comment).trim().slice(0, 2000);
  if (ev.liked === undefined && !ev.comment) return { ok: false };
  if (ev.comment) ev.held = true;   // a note waits on the tablet until ↻ Update data
  s.outbox.push(ev);
  s.notes ??= {};
  if (ev.comment) addNote(((s.notes.videos ??= {})[msg.videoId] ??= []), ev);
  if (typeof ev.liked === 'boolean') (s.notes.liked ??= {})[msg.videoId] = ev.liked;
  return { ok: true };
}

// A message to the helper, or a note for the AI about a whole list (list: today | planned | history | settings).
export function wish(s, msg) {
  const text = String(msg.text ?? '').trim().slice(0, 2000);
  if (!text) return { ok: false };
  const list = ['today', 'planned', 'history', 'settings'].includes(msg.list) ? msg.list : null;
  const ev = { ...newEvent('wish', { text, ...(list ? { list } : {}) }), held: true };
  s.outbox.push(ev);
  if (list) addNote((((s.notes ??= {}).lists ??= {})[list] ??= []), ev);
  return { ok: true };
}

// A note on a context document (parent mode → Context). docs: the current app's document ids.
export function contextNote(s, msg, docs) {
  if (!parentMode(s)) return { ok: false };
  const text = String(msg.text ?? '').trim().slice(0, 2000);
  if (!text || !docs.includes(msg.doc)) return { ok: false };
  const ev = { ...newEvent('context', { doc: msg.doc, text }), held: true };
  s.outbox.push(ev);
  ((s.notes ??= {}).contextNotes ??= []).push(ev);
  s.notes.contextNotes = s.notes.contextNotes.slice(-100);
  return { ok: true };
}

// Adds a standing instruction for the helper, or removes one (the Prompt tab).
export function promptNote(s, msg) {
  const text = String(msg.text ?? '').trim().slice(0, 2000);
  if (!['add', 'remove'].includes(msg.action)) return { ok: false };
  if (msg.action === 'add' && !text) return { ok: false };
  if (msg.action === 'remove' && !/^[A-Za-z0-9-]{8,64}$/.test(msg.noteId ?? '')) return { ok: false };
  const ev = newEvent('prompt', { action: msg.action });
  Object.assign(ev, msg.action === 'add' ? { noteId: ev.eventId, text, held: true } : { noteId: msg.noteId });
  s.outbox.push(ev);
  ((s.notes ??= {}).promptOps ??= []).push(ev);
  return { ok: true, noteId: ev.noteId };
}

// --- the lists ----------------------------------------------------------------------------------------------
// The helper's records (memory.json) with the parent's changes from this tablet on top.
export function records(memory, planLog, queue) {
  const recs = structuredClone(memory?.helper?.videos ?? {});
  for (const v of queue.videos) recs[v.videoId] ??= { title: v.title, channelTitle: v.channelTitle, durationSeconds: v.durationSeconds, lang: v.lang, status: 'today', approved: true, required: v.required ? 'yes' : null, why: v.note };
  for (const u of queue.upcoming ?? []) recs[u.videoId] ??= { title: u.title, status: 'planned', approved: false, required: null };
  for (const e of [...(planLog?.events ?? [])].sort((a, b) => a.at.localeCompare(b.at))) {
    const entry = planLog.entries?.[e.videoId];
    recs[e.videoId] ??= { title: entry?.title ?? '', channelTitle: entry?.channelTitle, durationSeconds: entry?.durationSeconds, status: 'planned', approved: false, required: null };
    applyPlanEvent(recs[e.videoId], e);
  }
  return recs;
}

function cardOf(id, v = {}, r = {}, s) {
  return {
    videoId: id, title: v.title || r.title || s.seen?.[id]?.title || 'Video', channelTitle: v.channelTitle ?? r.channelTitle ?? '',
    durationSeconds: v.durationSeconds || r.durationSeconds || null, thumbnailUrl: thumbUrl(id), lang: v.lang ?? r.lang ?? 'en',
    status: r.status ?? null, approved: !!r.approved, required: v.required !== undefined ? !!v.required : !!r.required, day: r.day ?? null,
    why: r.why ?? v.note ?? '', tooHard: r.content?.tooHard ?? null, hasWords: !!(r.content || v.intro),
    quizCount: (v.quizIds ?? r.content?.quizIds ?? []).length, notes: (s.notes?.videos?.[id] ?? []).length,
    liked: s.notes?.liked?.[id] ?? r.liked ?? null, watchedAt: s.watched[id] ?? r.watchedAt ?? null,
  };
}

export async function parentData(s) {
  const { config, queue } = await effective(s);
  const memory = await getMemory();
  const recs = records(memory, s.planLog, queue);
  // Today = what he sees now (the first queueSize unwatched) plus what he watched; the helper's spares
  // further down the queue wait in Planned until one of these is watched or removed.
  const visible = new Set(visibleVideos(queue, config, s.watched).map((v) => v.videoId));
  const shown = queue.videos.filter((v) => visible.has(v.videoId) || s.watched[v.videoId]);
  const todayIds = new Set(shown.map((v) => v.videoId));
  const today = shown.map((v) => ({ ...cardOf(v.videoId, v, recs[v.videoId], s), required: !!v.required }));
  // Planned: the helper's order (queue.upcoming) first, then its other open videos, newest first.
  const order = [...(queue.upcoming ?? []).map((u) => u.videoId),
    ...Object.entries(recs).sort((a, b) => (b[1].addedAt ?? '').localeCompare(a[1].addedAt ?? '')).map(([id]) => id)];
  const planned = [...new Set(order)].filter((id) => !todayIds.has(id) && ['idea', 'planned', 'today'].includes(recs[id]?.status) && !s.watched[id])
    .map((id) => cardOf(id, {}, recs[id], s));
  const { account = null } = await chrome.storage.local.get('account');
  const played = todayPlayed(s, config);   // starts a new day when the date changed, like the kid's screens
  return {
    account, app: appOf(account).id,
    parentUntil: s.settings.parentUntil || 0, parentMode: parentMode(s), mode: s.settings.mode ?? null,
    today, planned, history: historyDays(s, recs, config), lists: s.notes?.lists ?? {},
    minutes: { played: Math.round(played / 60), max: config.time?.maxMinutesPerDay || 0, stopped: !!s.today?.stopped },
    hasMemory: !!memory, memoryAt: memory?.updatedAt ?? null, queueUpdatedAt: queue.updatedAt ?? null,
    hasToken: !!s.settings.token, waiting: s.outbox.length, sync: s.syncStatus,
  };
}

// What he watched, by day: this tablet's own log, plus what the helper knows from the other devices and earlier.
function historyDays(s, recs, config) {
  const rows = [...(s.history ?? [])].map((h) => ({ ...h }));
  const has = (id, at) => rows.some((h) => h.videoId === id && h.at.slice(0, 10) === at.slice(0, 10));
  for (const [id, at] of Object.entries(s.watched)) if (!has(id, at)) rows.push({ videoId: id, at });
  for (const [id, r] of Object.entries(recs)) if (r.watchedAt && !rows.some((h) => h.videoId === id)) rows.push({ videoId: id, at: r.watchedAt });
  const days = {};
  for (const h of rows) {
    const r = recs[h.videoId] ?? {};
    const quiz = (h.quiz ?? []).map((q) => ({ ...q, prompt: config.quiz?.items?.[q.quizId]?.prompt ?? r.content?.items?.[q.quizId]?.prompt ?? '' }));
    const item = { ...cardOf(h.videoId, { title: h.title || undefined, durationSeconds: h.durationSeconds }, r, s), at: h.at,
      watchedSeconds: h.watchedSeconds ?? null, endReason: h.endReason ?? null, quiz };
    (days[localParts(new Date(h.at), config.timezone).date] ??= []).push(item);
  }
  return Object.entries(days).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 60).map(([date, items]) => ({
    date, minutes: Math.round(items.reduce((n, i) => n + (i.watchedSeconds ?? 0), 0) / 60),
    items: items.sort((a, b) => b.at.localeCompare(a.at)),
  }));
}

export async function videoDetail(s, id) {
  if (!isVideoId(id)) return { ok: false };
  const { config, queue } = await effective(s);
  const memory = await getMemory();
  const recs = records(memory, s.planLog, queue);
  const r = recs[id] ?? {};
  const v = queue.videos.find((x) => x.videoId === id);
  const c = r.content ?? {};
  const where = v ? 'today' : r.status === 'no' ? 'removed' : (s.watched[id] || r.status === 'watched') ? 'watched' : ['idea', 'planned', 'today'].includes(r.status) ? 'planned' : 'other';
  const quizIds = v?.quizIds ?? c.quizIds ?? [];
  const items = quizIds.map((q) => ({ quizId: q, ...(config.quiz?.items?.[q] ?? c.items?.[q] ?? {}) })).filter((i) => i.prompt);
  const p = config.presenter ?? {};
  const lang = fullLang(v?.lang ?? r.lang) ?? p.voice?.lang ?? 'en-US';
  return {
    ok: true, ...cardOf(id, v ?? {}, r, s), where, summary: c.summary ?? '', learned: c.learned ?? [], talkAbout: c.talkAbout ?? [],
    madeFrom: c.source ?? null, intro: v?.intro ?? (c.intro ? { text: c.intro } : null), outro: v?.outro ?? (c.outro ? { text: c.outro } : null),
    items: items.map((i) => ({ ...i, lang: fullLang(i.lang) ?? lang })), notes: s.notes?.videos?.[id] ?? [],
    helperNotes: [r.comment, r.parentComment].filter(Boolean), history: (s.history ?? []).filter((h) => h.videoId === id),
    friend: { name: p.name || 'Zippy', voice: { ...(p.voice ?? {}), lang }, recorded: p.voice?.recorded !== false },
  };
}

// The Prompt tab: what the helper is (helper.json), what it did lately (memory.json), the tablet rules it reads.
export async function helperData(s) {
  const { config } = await effective(s);
  const memory = await getMemory();
  const { helperInfo } = await chrome.storage.local.get('helperInfo');
  const since = s.data.memoryMeta?.processedThrough ?? null;
  const ops = (s.notes?.promptOps ?? []).filter((o) => !since || o.at > since).sort((a, b) => a.at.localeCompare(b.at));
  const helperNotes = memory?.helper?.promptNotes ?? [];
  const known = new Set(helperNotes.map((n) => n.id));
  const p = config.presenter ?? {};
  return {
    ok: true, info: helperInfo ?? null, hasToken: !!s.settings.token, waiting: s.outbox.length,
    lastRunAt: memory?.helper?.lastRunAt ?? null, processedThrough: since, runs: (s.data.runs ?? []).slice().reverse(),
    journal: (memory?.journal ?? []).slice(-7).reverse(),
    noticed: memory?.helper?.noticed ?? '', studyPlan: memory?.helper?.plan ?? '', studyPlanAt: memory?.helper?.planAt ?? null,
    messages: (memory?.helper?.wishes ?? []).slice(-15).reverse(),
    notes: applyPromptNotes(helperNotes, ops).map((n) => ({ ...n, pending: !known.has(n.id) })),
    removing: ops.filter((o) => o.action === 'remove').map((o) => o.noteId),
    rules: {
      maxMinutesPerDay: config.time?.maxMinutesPerDay ?? 0, hours: config.time?.allowed ?? [], queueSize: config.queueSize,
      requiredFirst: config.requiredFirst ?? 'off', minSecondsBeforeLeave: config.minSecondsBeforeLeave ?? 0, allowSkip: !!config.allowSkip,
      minVideoMinutes: Math.round((config.minVideoDurationSeconds ?? 0) / 60), maxVideoMinutes: Math.round((config.maxVideoDurationSeconds ?? 0) / 60),
      quiz: { enabled: !!config.quiz?.enabled, maxAttempts: config.quiz?.maxAttempts ?? 3, onFail: config.quiz?.onFail ?? 'continue' },
      friend: { name: p.name || 'Zippy', intro: !!p.intro, outro: !!p.outro, recorded: p.voice?.recorded !== false, listen: p.voice?.listen?.provider ?? 'cloud' },
      blockSites: !!config.blockOutboundLinks,
    },
  };
}

// The context documents and the parent's notes on them the helper hasn't read yet.
export async function contextData(s) {
  const { contextDocs = {} } = await chrome.storage.local.get('contextDocs');
  const since = s.data.memoryMeta?.processedThrough ?? null;
  return { ok: true, docs: contextDocs, notes: (s.notes?.contextNotes ?? []).filter((n) => !since || n.at > since) };
}

// One change from the parent's screens. Taking an unwatched video off today's list brings the next planned one in.
export async function planChange(s, msg) {
  const id = msg.videoId;
  if (!parentMode(s) || !PLAN_ACTIONS.includes(msg.action) || !isVideoId(id)) return { ok: false };
  const memory = await getMemory();
  const log = (s.planLog ??= { events: [], entries: {}, items: {} });
  log.entries ??= {}; log.items ??= {};
  const before = (await effective(s)).queue;
  const recs = records(memory, log, before);
  const remember = (vid) => {
    const inQueue = before.videos.find((v) => v.videoId === vid);
    const rec = memory?.helper?.videos?.[vid];
    log.entries[vid] ??= inQueue ?? (rec ? entryFromRecord(vid, rec) : { videoId: vid, title: recs[vid]?.title || 'Video' });
    for (const q of log.entries[vid].quizIds ?? []) if (rec?.content?.items?.[q]) log.items[q] = rec.content.items[q];
  };
  const add = (action, vid, value) => {
    const ev = newEvent('plan', { videoId: vid, action, ...(typeof value === 'boolean' ? { value } : {}) });
    remember(vid);
    log.events.push(ev);
    s.outbox.push(ev);
  };
  add(msg.action, id, msg.value);
  let added = null;
  const wasToday = before.videos.some((v) => v.videoId === id);
  if (msg.refill !== false && wasToday && !s.watched[id] && ['notToday', 'drop'].includes(msg.action)) {
    const after = applyPlan(before, log);
    const inToday = new Set(after.videos.map((v) => v.videoId));
    const open = (vid) => vid !== id && !inToday.has(vid) && !s.watched[vid] && ['idea', 'planned'].includes(recs[vid]?.status ?? 'planned');
    added = (after.upcoming ?? []).map((u) => u.videoId).find(open)
      ?? Object.entries(recs).filter(([vid, r]) => open(vid) && r.approved).map(([vid]) => vid)[0] ?? null;
    if (added) add('today', added);
  }
  return { ok: true, added };
}

// What parent mode shows about the latest run asked for: waiting for the server, running, done, failed.
// held: notes on this tablet that ↻ Update data hasn't sent yet.
export function runView(s) {
  const req = s.data.runRequest ?? null;
  const st = s.data.runStatus ?? null;
  const held = s.outbox.filter((e) => e.held).length;
  // Waiting only while no run has started since the request: a run for notes sent without one has its own id.
  if (req && st?.requestId !== req.id && !(st?.startedAt && st.startedAt >= req.at)) return { state: 'queued', at: req.at, message: 'Asked. The server starts it within a minute or two.', held };
  if (!st) return { state: 'none', held };
  return { state: st.state, at: st.finishedAt ?? st.startedAt, message: st.message ?? '', held };
}
