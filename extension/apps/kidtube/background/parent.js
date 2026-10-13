// Parent mode's data: Today, Planned, History, one video's details, the Prompt tab, the notes for the AI,
// and the parent's changes to the plan.
import { visibleVideos } from '../lib/queue.js';
import { localParts } from '../../../core/lib/time.js';
import { isVideoId, thumbUrl } from '../../../core/lib/youtube.js';
import { appOf } from '../../registry.js';
import { PLAN_ACTIONS, applyPlan, applyPlanEvent, entryFromRecord, applyPromptNotes } from '../lib/plan.js';
import { TARGET } from '../../../core/lib/target.js';
import { parentMode, folderShown } from '../../../core/background/store.js';
import { effective } from './config.js';
import { newEvent, fullLang, todayPlayed } from './rules.js';

export const getMemory = async () => (await chrome.storage.local.get('memory')).memory ?? null;

// --- notes for the AI --------------------------------------------------------------------------------------
// The tablet keeps no history of notes: one stays in its list until the server says the AI worked on it
// (notes-done.json, agent/poll.sh), then it is deleted. id: the event's id, to match that list.
// A question for the AI: the ❓ Question box on its row in the header's list, or a "?" in the words. The server's
// notes agent answers it (answers.json); until then it stays in the header's list as waiting.
// Every note is followed the same way once sent (s.notes.questions; ask: false for a note that is not a question):
// the agent writes what it did about it in answers.json too, and the row's Details shows that.
const isQuestion = (msg, text) => msg.ask === true || /\?/.test(String(text ?? ''));
function trackQuestion(s, ev) {
  if (!ev.held || !(ev.comment ?? ev.text)) return;
  const qs = ((s.notes ??= {}).questions ??= []);
  qs.push({ id: ev.eventId, at: ev.at, type: ev.type, text: ev.comment ?? ev.text, ask: !!ev.ask,
    ...(ev.list ? { list: ev.list } : {}), ...(ev.section ? { section: ev.section } : {}), ...(ev.videoId ? { videoId: ev.videoId } : {}), ...(ev.doc ? { doc: ev.doc } : {}) });
  s.notes.questions = qs.slice(-30);
}
// Saved before 0.12.16, only questions were followed (no ask field).
const asks = (q) => q.ask !== false;

// A recorded note no speech service on the tablet could write down (they refuse some countries): its recording goes
// to the server, which writes it down (background/voice.js). Until then the note has a stand-in text and ev.voice
// = { id, state: upload | server | failed, seconds, error }; it can't be sent or edited.
const voiceOf = (msg) => (msg.voice?.id ? { voice: { id: msg.voice.id, state: 'upload', seconds: msg.voice.seconds ?? 0 } } : {});

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
    ...(e.list ? { list: e.list } : {}), ...(e.section ? { section: e.section } : {}), ...(e.doc ? { doc: e.doc } : {}),
    ...(e.videoId ? { videoId: e.videoId, title: titleOf(e.videoId) } : {}),
    ...(e.context ? { attached: Object.keys(e.context) } : {}), ...(e.offer ? { offered: Object.keys(e.offer) } : {}), ...(e.ask ? { ask: true } : {}), ...(e.voice ? { voice: e.voice } : {}),
  }));
  return { ok: true, notes };
}

// Changes the words of a note not sent yet (the header's Edit): in the outbox and in the tabs' lists.
export function editHeld(s, id, text) {
  const words = String(text ?? '').trim().slice(0, 2000);
  const ev = s.outbox.find((e) => e.held && e.eventId === id && (e.comment || e.text));
  if (!ev || !words) return { ok: false, error: ev ? 'The note is empty: type something, or delete it.' : 'This note was sent already: it can’t be changed now.' };
  if (ev.voice && ev.voice.state !== 'failed') return { ok: false, error: 'The server is still writing this recording down: wait for its words.' };
  return setWords(s, ev, words);
}

// The note's words, everywhere it shows (the outbox, the tabs' lists, the questions). Also the server's words for a
// recorded note (background/voice.js).
export function setWords(s, ev, words) {
  const id = ev.eventId;
  delete ev.voice;
  if (ev.comment) ev.comment = words; else ev.text = words;
  const n = s.notes ?? {};
  for (const box of [n.lists, n.videos]) for (const list of Object.values(box ?? {})) for (const x of list) if (x.id === id) x.text = words;
  for (const x of [...(n.contextNotes ?? []), ...(n.promptOps ?? [])]) if (x.eventId === id) x.text = words;
  for (const q of n.questions ?? []) if (q.id === id) q.text = words;
  if (!ev.ask && /\?/.test(words)) { ev.ask = true; for (const q of n.questions ?? []) if (q.id === id) q.ask = true; }   // edited into a question
  return { ok: true };
}

// The checkboxes on a note's row in the header's list, until it is sent: 📄 This screen and ⚙️ App data (kept with
// the note when it was made, in ev.offer, and only sent when ticked: ev.context), and ❓ Question (ev.ask).
export async function attachHeld(s, id, what, on) {
  const ev = s.outbox.find((e) => e.held && e.eventId === id && (e.comment || e.text));
  if (!ev) return { ok: false, error: 'This note is not here any more: it was sent or deleted.' };
  if (what === 'ask') {
    if (on) ev.ask = true; else delete ev.ask;
    for (const q of s.notes?.questions ?? []) if (q.id === id) q.ask = !!on;
    return { ok: true };
  }
  if (!['screen', 'app'].includes(what)) return { ok: false, error: 'Unknown checkbox.' };
  const ctx = (ev.context ??= {}), offer = (ev.offer ??= {});
  if (on) {
    // App data a note was made without (before 0.12.16): the app's state now.
    const v = offer[what] ?? (what === 'app' ? await appState(s) : null);
    if (!v) return { ok: false, error: 'This note was saved without the screen: only notes made from now on have it.' };
    ctx[what] = v; delete offer[what];
  } else if (ctx[what]) { offer[what] = ctx[what]; delete ctx[what]; }
  if (!Object.keys(ctx).length) delete ev.context;
  if (!Object.keys(offer).length) delete ev.offer;
  return { ok: true };
}

// A note made from the parent screens (msg.offer): what This screen and App data would add is kept with it
// (ev.offer, never sent) until its row's checkbox attaches it. make(ctx) adds the note to the outbox.
export async function madeWith(s, msg, make) {
  const ctx = await noteContext(s, msg);
  if (!msg.offer) return make(ctx);
  const n = s.outbox.length;
  const r = make(null);
  const ev = s.outbox[n];
  if (r?.ok && ctx && ev?.held) ev.offer = ctx;
  return r;
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
  if (n.questions) n.questions = n.questions.filter((q) => !gone.has(q.id));
  return { ok: true, removed: gone.size };
}

// The notes and questions already sent, for the header's list: waiting for the AI, answered (answers.json from the
// server's notes agent: the answer, or what it did about a note), or worked on with no answer (notes-done.json has
// it, answers.json not; result: what the run said then). Answered questions go after 7 days, the rest after 3;
// "Got it" (dismissQuestion) removes one at once.
const DAY = 86400000;
export function questionsView(s, now = Date.now()) {
  const held = new Set(s.outbox.filter((e) => e.held).map((e) => e.eventId));
  const answers = Array.isArray(s.data.answers) ? s.data.answers : [];
  const done = new Set(s.data.notesDone ?? []);
  const out = [];
  for (const q of s.notes?.questions ?? []) {
    if (held.has(q.id)) continue;   // not sent yet: a note row with Edit, Delete, Send
    const a = answers.find((x) => x?.eventId === q.id && typeof x.answer === 'string');
    const state = a ? 'answered' : done.has(q.id) ? 'none' : 'waiting';
    if (now - Date.parse(a?.at ?? q.at) > (a && asks(q) ? 7 : 3) * DAY) continue;
    out.push({ ...q, ask: asks(q), state, ...(a ? { answer: a.answer.slice(0, 2000), answeredAt: a.at ?? null, report: a.report ?? q.report ?? null } : {}) });
  }
  return out;
}
// A sent note the AI has worked on (notes-done.json) keeps what its run said (run-status.json): the Details of a
// note the agent wrote no answer for. The next run's status replaces the file, so it is kept at the first sync.
export function keepResults(s) {
  const done = new Set(s.data.notesDone ?? []);
  const st = s.data.runStatus;
  if (!st?.message || !['done', 'failed'].includes(st.state)) return;
  for (const q of s.notes?.questions ?? []) {
    if (q.result || !done.has(q.id) || (st.finishedAt ?? '') < q.at) continue;
    q.result = String(st.message).slice(0, 1000);
    if (typeof st.report === 'string') q.report = st.report;   // the run's report: the note's Details opens it
  }
}

export function dismissQuestion(s, id) {
  const qs = s.notes?.questions ?? [];
  if (!qs.some((q) => q.id === id)) return { ok: false, error: 'This question is not here any more.' };
  s.notes.questions = qs.filter((q) => q.id !== id);
  return { ok: true };
}

// What the parent attached to a note (the notes card's This screen / App data), cut to the sizes in
// schemas/activity.schema.json noteContext. msg.screen: the page's own snapshot; msg.withApp: the app's state now.
// null when nothing is attached.
export async function noteContext(s, msg) {
  const out = {};
  const sc = msg.screen && typeof msg.screen === 'object' ? msg.screen : null;
  if (sc) {
    const cut = { where: 200, title: 200, path: 300, text: 8000, viewport: 40, userAgent: 400 };
    out.screen = Object.fromEntries(Object.entries(cut).filter(([k]) => typeof sc[k] === 'string' && sc[k]).map(([k, n]) => [k, sc[k].slice(0, n)]));
  }
  if (msg.withApp) out.app = await appState(s);
  return Object.keys(out).length ? out : null;
}

// The app's state for a note: version and build, profile, mode, the rules in force (quiz items only counted),
// today's list, time played, and how the last sync went.
async function appState(s) {
  const { config, queue } = await effective(s);
  const { quiz, presenter, ...rules } = config;
  const { phrases, ...friend } = presenter ?? {};
  return {
    version: chrome.runtime.getManifest().version, target: TARGET, profile: await folderShown(), mode: parentMode(s) ? 'parent' : 'kid',
    rules: { ...rules, presenter: friend, quiz: quiz ? { ...quiz, items: Object.keys(quiz.items ?? {}).length } : null },
    list: queue.videos.slice(0, 20).map((v) => ({ videoId: v.videoId, title: v.title, ...(v.required ? { required: true } : {}), ...(s.watched[v.videoId] ? { watched: true } : {}) })),
    playedMinutesToday: Math.round(todayPlayed(s, config) / 60),
    sync: { at: s.syncStatus?.at ?? null, errors: (s.syncStatus?.errors ?? []).slice(0, 5) },
    waitingEvents: s.outbox.length,
  };
}

// 👍 / 👎 / a note for the AI about one video. ctx: noteContext's answer.
export function noteVideo(s, msg, ctx = null) {
  if (!isVideoId(msg.videoId)) return { ok: false };
  const ev = { ...newEvent('parentNote', { videoId: msg.videoId }), ...voiceOf(msg) };
  if (typeof msg.liked === 'boolean') ev.liked = msg.liked;
  if (msg.comment) ev.comment = String(msg.comment).trim().slice(0, 2000);
  if (ev.liked === undefined && !ev.comment) return { ok: false };
  if (ev.comment) { ev.held = true; if (ctx) ev.context = ctx; if (isQuestion(msg, ev.comment)) ev.ask = true; }   // a note waits on the tablet until ↻ Update
  s.outbox.push(ev);
  trackQuestion(s, ev);
  s.notes ??= {};
  if (ev.comment) addNote(((s.notes.videos ??= {})[msg.videoId] ??= []), ev);
  if (typeof ev.liked === 'boolean') (s.notes.liked ??= {})[msg.videoId] = ev.liked;
  return { ok: true };
}

// A message to the helper, or a note for the AI about a whole list (list: today | planned | history | settings).
// section: the Settings box it is about (⛶ One box), its title.
export function wish(s, msg, ctx = null) {
  const text = String(msg.text ?? '').trim().slice(0, 2000);
  if (!text) return { ok: false };
  const list = ['today', 'planned', 'history', 'settings'].includes(msg.list) ? msg.list : null;
  const section = list === 'settings' && typeof msg.section === 'string' ? msg.section.trim().slice(0, 60) : '';
  const ev = { ...newEvent('wish', { text, ...(list ? { list } : {}), ...(section ? { section } : {}), ...(ctx ? { context: ctx } : {}), ...(isQuestion(msg, text) ? { ask: true } : {}) }), held: true, ...voiceOf(msg) };
  s.outbox.push(ev);
  trackQuestion(s, ev);
  if (list) addNote((((s.notes ??= {}).lists ??= {})[list] ??= []), ev);
  return { ok: true };
}

// A note on a context document (parent mode → Context). docs: the current app's document ids.
export function contextNote(s, msg, docs, ctx = null) {
  if (!parentMode(s)) return { ok: false };
  const text = String(msg.text ?? '').trim().slice(0, 2000);
  if (!text || !docs.includes(msg.doc)) return { ok: false };
  const ev = { ...newEvent('context', { doc: msg.doc, text, ...(ctx ? { context: ctx } : {}), ...(isQuestion(msg, text) ? { ask: true } : {}) }), held: true, ...voiceOf(msg) };
  s.outbox.push(ev);
  trackQuestion(s, ev);
  ((s.notes ??= {}).contextNotes ??= []).push(ev);
  s.notes.contextNotes = s.notes.contextNotes.slice(-100);
  return { ok: true };
}

// Adds a standing instruction for the helper, or removes one (the Prompt tab).
export function promptNote(s, msg, ctx = null) {
  const text = String(msg.text ?? '').trim().slice(0, 2000);
  if (!['add', 'remove'].includes(msg.action)) return { ok: false };
  if (msg.action === 'add' && !text) return { ok: false };
  if (msg.action === 'remove' && !/^[A-Za-z0-9-]{8,64}$/.test(msg.noteId ?? '')) return { ok: false };
  const ev = newEvent('prompt', { action: msg.action });
  Object.assign(ev, msg.action === 'add' ? { noteId: ev.eventId, text, held: true, ...(ctx ? { context: ctx } : {}), ...(isQuestion(msg, text) ? { ask: true } : {}), ...voiceOf(msg) } : { noteId: msg.noteId });
  s.outbox.push(ev);
  trackQuestion(s, ev);
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
    parentMode: parentMode(s), mode: s.settings.mode ?? null,
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
// How his spoken answers are heard, in the words of Settings → Hearing his answers ('cloud' is the default;
// 'openrouter' is what tablets before 0.8.7 saved for the same thing).
export const listenLabel = (provider) => (provider === 'device' ? 'the tablet’s own speech recognition'
  : 'recorded and sent: free Groq and Gemini first, then paid OpenRouter');

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
      friend: { name: p.name || 'Zippy', intro: !!p.intro, outro: !!p.outro, recorded: p.voice?.recorded !== false, listen: listenLabel(p.voice?.listen?.provider) },
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
// held: notes on this tablet that ↻ Update hasn't sent yet.
const LATE_MS = 10 * 60000;
export function runView(s) {
  const req = s.data.runRequest ?? null;
  const st = s.data.runStatus ?? null;
  const held = s.outbox.filter((e) => e.held).length;
  // Waiting only while no run has started since the request: a run for notes sent without one has its own id.
  if (req && st?.requestId !== req.id && !(st?.startedAt && st.startedAt >= req.at)) {
    // Not started in 10 minutes (the server is off, or it missed the request): ↻ Update can ask again.
    if (Date.now() - Date.parse(req.at) > LATE_MS) return { state: 'late', at: req.at, message: 'The server has not started it in 10 minutes. Tap ↻ Update to ask again.', held };
    return { state: 'queued', at: req.at, message: 'Asked. The server starts it within a minute or two.', held };
  }
  if (!st) return { state: 'none', held };
  return { state: st.state, at: st.finishedAt ?? st.startedAt, message: st.message ?? '', held, report: st.report ?? null };
}
