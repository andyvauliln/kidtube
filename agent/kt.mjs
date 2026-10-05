#!/usr/bin/env node
// The helper's toolkit. Claude runs the daily session (agent/DAILY.md) and calls these commands;
// every command prints JSON. The work in progress lives in <stateDir>/session.json until `save`.
//
//   node agent/kt.mjs start                     fresh data, apply the tablet's activity, show everything
//   node agent/kt.mjs ideas                      how many new ideas are allowed today (plan size, Gemini limit)
//   node agent/kt.mjs videos [status...]        the helper's videos (compact)
//   node agent/kt.mjs search "<query>" [n] [lang]   YouTube search, only new videos of the right length
//   node agent/kt.mjs add '<json array>'        new ideas from search results: [{videoId, why, topics, lang, required}]
//   node agent/kt.mjs today [--suggest | id,id,...]  today's list: the suggested order, or set it
//   node agent/kt.mjs transcribe [id...]         Gemini transcripts within today's limits (default: who needs one)
//   node agent/kt.mjs transcript <id>            print a transcript (and what is on screen)
//   node agent/kt.mjs ask <id> "<question>"      ask Gemini something about the video itself
//   node agent/kt.mjs words <id> '<json>'        {summary, learned, intro, outro, talkAbout, quiz, tooHard}: checked, quiz built
//   node agent/kt.mjs notes '<json>'             {diary, noticed, plan, requiredFirst}: shown in parent mode
//   node agent/kt.mjs save                       voices, files, checks, commit + push
//   node agent/kt.mjs info                       publish helper.json now (what the parent sees in the Prompt tab)
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncClone, commitAndPush, readJson, writeJson, activitySince, transcript } from './lib/data.mjs';
import { applyActivity, applyPromptNotes, composeToday, markToday, upcoming, freshCandidates, ideasAllowed, OPEN } from './lib/plan.mjs';
import { helperInfo } from './lib/info.mjs';
import { buildQuiz, templateCatalog } from './lib/quiz.mjs';
import { tooHard } from './lib/prompts.mjs';
import { createGemini } from './lib/gemini.mjs';
import { createVoices, audioPath } from './lib/voices.mjs';
import { search } from '../tools/video-info.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const home = (p) => p.replace(/^~(?=\/)/, homedir());
const iso = (d = new Date()) => d.toISOString().replace(/\.\d+Z$/, 'Z');
const config = JSON.parse(readFileSync(join(ROOT, 'agent/config.json'), 'utf8'));
const dataDir = home(process.env.KIDTUBE_DATA_DIR ?? config.dataDir);
const stateDir = home(process.env.KIDTUBE_STATE_DIR ?? config.stateDir);
mkdirSync(stateDir, { recursive: true });
const env = { ...readEnv(home(config.envFile)), ...process.env };
const SESSION = join(stateDir, 'session.json');
const D = config.defaults;
// Videos per day = the parent's "Videos on the home screen" (parent mode → Settings).
const perDay = () => readJson(join(dataDir, 'parent-config.json'))?.queueSize ?? D.videosPerDay;
// A line in the daily log (helper.log), next to what daily.sh writes.
const log = (msg) => { try { appendFileSync(join(stateDir, 'helper.log'), `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`); } catch {} };
const ready = (videos) => new Set(Object.keys(videos).filter((id) => transcript(dataDir, id)?.available));
const gemFor = (s) => createGemini({ apiKey: env.GEMINI_API_KEY ?? '', stateDir, config: config.transcripts, today: s.today, log: () => {} });
const ideas = (s) => {
  const r = ideasAllowed(s.videos, { target: D.planTarget ?? 50, geminiLeft: gemFor(s).left().videos, perDay: perDay() });
  return { ...r, addedToday: s.newIds.length, stillAllowed: Math.max(0, r.allowed - s.newIds.length) };
};

function readEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n')
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
}
const out = (x) => { console.log(JSON.stringify(x, null, 1)); };
const fail = (msg) => { out({ ok: false, error: msg }); process.exit(1); };
const parse = (s, what) => { try { return JSON.parse(s); } catch { return fail(`${what}: not valid JSON`); } };
const load = () => (existsSync(SESSION) ? JSON.parse(readFileSync(SESSION, 'utf8')) : fail('no session: run `start` first'));
const store = (s) => writeFileSync(SESSION, JSON.stringify(s));
function localDate(tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}
const paths = { memory: join(dataDir, 'memory.json'), queue: join(dataDir, 'queue.json'), config: join(dataDir, 'parent-config.json') };
const brief = (id, v) => ({ videoId: id, title: v.title, lang: v.lang, status: v.status, approved: !!v.approved, required: v.required ?? null, day: v.day ?? null,
  minutes: Math.round((v.durationSeconds ?? 0) / 6) / 10, channel: v.channelTitle, topics: v.topics ?? [],
  transcript: transcript(dataDir, id)?.available ? (transcript(dataDir, id).source ?? 'tablet') : null,
  words: v.content ? v.content.source : null, tooHard: v.content?.tooHard ?? null });

const [cmd = 'help', ...args] = process.argv.slice(2);
const commands = {
  // ---------------------------------------------------------------------------------------------
  start() {
    syncClone(dataDir, config.dataRepo);
    const memory = readJson(paths.memory);
    const queue = readJson(paths.queue);
    const pc = readJson(paths.config);
    const helper = (memory.helper ??= { videos: {} });
    const tz = /\//.test(pc.timezone ?? '') ? pc.timezone : config.timezone;
    const today = localDate(tz);
    for (const v of queue.videos) {
      helper.videos[v.videoId] ??= { title: v.title, channelId: v.channelId, channelTitle: v.channelTitle, durationSeconds: v.durationSeconds,
        lang: v.lang ?? 'en', topics: [], why: v.note ?? 'On the starter list.', addedAt: v.addedAt, status: 'today', approved: true, required: v.required ? 'yes' : null, day: null };
    }
    const since = helper.processedThrough ?? memory.processedThrough ?? null;
    const { events, devices } = activitySince(dataDir, since);
    const news = applyActivity(helper.videos, events, { minSecondsBeforeLeave: pc.minSecondsBeforeLeave ?? 120 });
    const lastEvent = events.map((e) => e.at).sort().at(-1);
    const gem = createGemini({ apiKey: env.GEMINI_API_KEY ?? '', stateDir, config: config.transcripts, today, log: () => {} });
    const s = { today, tz, startedAt: iso(), videos: helper.videos, processedThrough: lastEvent && lastEvent > (since ?? '') ? lastEvent : since,
      newIds: [], todayIds: null, searchCache: {}, notes: null, rewritten: [], touched: [...new Set([...news.watched, ...news.quiz, ...news.notes, ...news.plan].map((x) => x.videoId).filter((id) => helper.videos[id]))],
      quizTypes: devices.at(-1)?.quizTypes ?? ['text', 'choice'], wishes: news.wishes,
      // The parent's messages from the tablet, kept.
      wishesAll: [...(helper.wishes ?? []), ...news.wishes].slice(-60), tabletEdited: news.edited,
      promptNotes: applyPromptNotes(helper.promptNotes ?? [], news.prompt) };
    store(s);
    const counts = {};
    for (const v of Object.values(helper.videos)) counts[v.status] = (counts[v.status] ?? 0) + 1;
    const { edited, prompt, ...tablet } = news;
    out({ ok: true, today, timezone: tz, since,
      promptNotes: s.promptNotes.map((n) => n.text),
      tablet: { device: devices.at(-1) ?? null, ...tablet },
      rules: { minutesPerDay: pc.time?.maxMinutesPerDay, hours: pc.time?.allowed, maxVideoMinutes: Math.round((pc.maxVideoDurationSeconds ?? 0) / 60), minVideoMinutes: Math.round((pc.minVideoDurationSeconds ?? 0) / 60),
        queueSize: pc.queueSize, requiredFirst: pc.requiredFirst ?? 'first', questionsOn: !!pc.quiz?.enabled, friend: pc.presenter?.name, blockedChannels: pc.blockedChannelIds ?? [] },
      defaults: { ...D, videosPerDay: pc.queueSize ?? D.videosPerDay }, videoCounts: counts, newIdeas: ideas(s),
      geminiLeftToday: gem.left(), voices: { speak: config.voices?.speak?.provider ?? 'device', listen: pc.presenter?.voice?.listen?.provider ?? 'device' },
      wishesHistory: (helper.wishes ?? []).slice(-30), noticed: helper.noticed ?? '', studyPlan: helper.plan ?? '', studyPlanAt: helper.planAt ?? null, recentDiary: (memory.journal ?? []).slice(-5),
      quizTemplates: templateCatalog().map((t) => ({ id: t.id, answer: t.answer, howItWorks: t.howItWorks, params: t.params })) });
  },

  ideas() {
    out(ideas(load()));
  },

  videos() {
    const s = load();
    const want = new Set(args.length ? args : [...OPEN]);
    out(Object.entries(s.videos).filter(([, v]) => want.has(v.status)).map(([id, v]) => brief(id, v)));
  },

  async search() {
    const s = load();
    const [query, n = '10', lang] = args;
    if (!query) fail('search "<query>" [n] [lang]');
    const pc = readJson(paths.config);
    let found;
    try { found = await search(query, Number(n)); }
    catch { await new Promise((r) => setTimeout(r, 5000)); try { found = await search(query, Number(n)); } catch (e) { log(`search "${query}" (${lang ?? 'en'}): failed: ${e.cause?.message ?? e.message}`); fail(`search failed: ${e.cause?.message ?? e.message}`); } }
    const results = found.filter((r) => r.channelId)
      .map((r) => ({ ...r, lang: /[а-яё]/i.test(r.title) ? 'ru' : (lang ?? 'en').slice(0, 2) }));
    const fresh = freshCandidates(results, s.videos, { minSeconds: pc.minVideoDurationSeconds ?? 60, maxSeconds: pc.maxVideoDurationSeconds || 1200,
      blockedChannelIds: pc.blockedChannelIds, badChannels: readJson(paths.memory).helper?.badChannels ?? [] });
    for (const r of fresh) s.searchCache[r.videoId] = { ...r, query };
    log(`search "${query}" (${lang ?? 'en'}): ${results.length} results, ${fresh.length} new`);
    store(s);
    out(fresh.map((r) => ({ videoId: r.videoId, title: r.title, channel: r.channelTitle, minutes: Math.round(r.durationSeconds / 6) / 10, lang: r.lang })));
  },

  add() {
    const s = load();
    const picks = parse(args[0], 'add');
    const added = [];
    let room = ideas(s).stillAllowed;
    for (const p of picks) {
      const c = s.searchCache[p.videoId];
      if (!c) { out({ ok: false, error: `${p.videoId} is not from a search in this session` }); continue; }
      if (room-- <= 0) { out({ ok: false, error: `no more new ideas today (plan size or Gemini limit): ${p.videoId} not added` }); continue; }
      const must = ['yes', 'today'].includes(p.required) ? p.required : null;
      s.videos[p.videoId] = { title: c.title, channelId: c.channelId, channelTitle: c.channelTitle, durationSeconds: c.durationSeconds,
        lang: /^[a-z]{2}$/.test(p.lang ?? '') ? p.lang : c.lang, topics: (p.topics ?? []).slice(0, 5).map(String), why: String(p.why ?? '').slice(0, 500),
        addedAt: iso(), status: 'idea', approved: false, required: must, day: must === 'today' ? s.today : null };
      s.newIds.push(p.videoId);
      s.touched.push(p.videoId);
      added.push(p.videoId);
    }
    store(s);
    log(`added ${added.length} new ideas: ${added.join(', ')}`);
    out({ ok: true, added, newIdeas: ideas(s) });
  },

  today() {
    const s = load();
    const pc = readJson(paths.config);
    const arg = args[0] ?? '--suggest';
    if (arg === '--suggest') {
      const langs = Object.fromEntries((args.slice(1).join(' ').match(/\b([a-z]{2})=(\d+)/g) ?? []).map((x) => x.split('=')).map(([l, n]) => [l, Number(n)]));
      const count = Number(args.find((a) => /^\d+$/.test(a)) ?? perDay());
      return out({ suggested: composeToday(s.videos, { today: s.today, count, languageMins: langs, blockedChannelIds: pc.blockedChannelIds, ready: ready(s.videos) }).map((id) => brief(id, s.videos[id])) });
    }
    const ids = arg.split(',').map((x) => x.trim()).filter(Boolean);
    const bad = ids.filter((id) => !s.videos[id] || !OPEN.has(s.videos[id].status));
    if (bad.length) fail(`not on the list of open videos: ${bad.join(', ')}`);
    for (const [id, v] of Object.entries(s.videos)) if (v.status === 'today' && !ids.includes(id)) s.touched.push(id);
    markToday(s.videos, ids);
    s.todayIds = ids;
    s.touched.push(...ids);
    store(s);
    out({ ok: true, today: ids.map((id) => brief(id, s.videos[id])) });
  },

  async transcribe() {
    const s = load();
    if (!env.GEMINI_API_KEY) fail('GEMINI_API_KEY is missing');
    const gem = createGemini({ apiKey: env.GEMINI_API_KEY, stateDir, config: config.transcripts, today: s.today, log: () => {} });
    const likelyToday = s.todayIds ?? composeToday(s.videos, { today: s.today, count: perDay() + (D.spares ?? 0), blockedChannelIds: readJson(paths.config).blockedChannelIds });
    const order = args.length ? args : [...new Set([...likelyToday, ...s.newIds, ...upcoming(s.videos, likelyToday, { today: s.today }).map((u) => u.videoId)])];
    const done = [], skipped = [], errors = [];
    for (const id of order) {
      const v = s.videos[id];
      if (!v || transcript(dataDir, id)?.available) continue;
      if (!gem.fits(v.durationSeconds)) { skipped.push(id); if (gem.quotaGone) break; continue; }
      try { writeJson(join(dataDir, 'transcripts', `${id}.json`), await gem.transcribe({ videoId: id, ...v })); done.push(id); }
      catch (e) { errors.push(`${id}: ${e.message.slice(0, 200)}`); }
    }
    log(`transcripts: ${done.length} made, ${skipped.length} over today's limit, ${errors.length} failed`);
    out({ ok: true, done, skipped, errors, left: gem.left(), newIdeas: ideas(s) });
  },

  transcript() {
    const t = transcript(dataDir, args[0]);
    if (!t?.available) fail('no transcript yet');
    out({ videoId: args[0], lang: t.lang, source: t.source ?? 'tablet', text: t.text, onScreen: t.onScreen ?? '' });
  },

  async ask() {
    const s = load();
    const [id, question] = args;
    const v = s.videos[id];
    if (!v || !question) fail('ask <videoId> "<question>"');
    const gem = createGemini({ apiKey: env.GEMINI_API_KEY, stateDir, config: config.transcripts, today: s.today, log: () => {} });
    try { out({ ok: true, answer: await gem.ask({ videoId: id, ...v }, question), left: gem.left() }); }
    catch (e) { fail(e.message); }
  },

  words() {
    const s = load();
    const [id, json] = args;
    const v = s.videos[id];
    if (!v) fail(`unknown video ${id}`);
    const w = parse(json, 'words');
    const ru = (v.lang ?? 'en').startsWith('ru');
    const problems = [];
    if (!w.intro?.trim() || w.intro.length > 450) problems.push('intro: 1–450 characters');
    if (!w.outro?.trim() || w.outro.length > 600) problems.push('outro: 1–600 characters');
    if (ru && !/[а-яё]/i.test(w.intro ?? '')) problems.push('the video is Russian: intro and outro in Russian');
    const hard = tooHard(w.quiz);
    if (hard) problems.push(`answer too hard for a 4-year-old: "${hard}" (1–2 everyday words or a number up to 20)`);
    const pc = readJson(paths.config);
    const { items, ids } = pc.quiz?.enabled ? buildQuiz(id, w.quiz, ru ? 'ru' : null, { max: D.maxQuestions }) : { items: {}, ids: [] };
    if (pc.quiz?.enabled && (w.quiz ?? []).length && !ids.length) problems.push('no question could be made from "quiz": check template names and fields');
    const types = new Set(s.quizTypes);
    for (const qid of ids) if (!types.has(items[qid].type)) problems.push(`question ${qid} is "${items[qid].type}", the tablet only shows ${[...types].join(', ')}`);
    if (problems.length) return fail(problems.join('; '));
    const tr = transcript(dataDir, id);
    v.content = { source: tr?.available ? 'transcript' : 'title', at: iso(), summary: String(w.summary ?? ''), learned: (w.learned ?? []).map(String).slice(0, 6),
      intro: w.intro.trim(), outro: w.outro.trim(), talkAbout: (w.talkAbout ?? []).map(String).slice(0, 6), quizIds: ids, items,
      ...(tr?.available && typeof w.tooHard === 'string' && w.tooHard.trim() ? { tooHard: w.tooHard.trim().slice(0, 300) } : {}) };
    s.rewritten.push(id);
    s.touched.push(id);
    store(s);
    out({ ok: true, videoId: id, questions: ids.map((q) => ({ id: q, prompt: items[q].prompt, answer: items[q].answer })) });
  },

  notes() {
    const s = load();
    s.notes = { ...(s.notes ?? {}), ...parse(args[0], 'notes') };
    store(s);
    out({ ok: true });
  },

  async save() {
    const s = load();
    if (!s.todayIds) fail('set today’s list first: `today id,id,...`');
    const memory = readJson(paths.memory);
    const queue = readJson(paths.queue);
    const pc = readJson(paths.config);
    const helper = (memory.helper ??= {});
    helper.videos = s.videos;
    const items = {};
    // Spares: ready videos (words written) after today's list. The tablet shows the first queueSize videos
    // he hasn't watched, so when one is watched or removed the next spare takes its place.
    const spares = composeToday(Object.fromEntries(Object.entries(s.videos).filter(([id, v]) => !s.todayIds.includes(id) && v.content)),
      { today: s.today, count: D.spares ?? 10, blockedChannelIds: pc.blockedChannelIds, ready: ready(s.videos) });
    queue.videos = [...s.todayIds, ...spares].map((id) => {
      const v = s.videos[id];
      Object.assign(items, v.content?.items ?? {});
      return {
        videoId: id, title: v.title.slice(0, 200), channelId: v.channelId, ...(v.channelTitle ? { channelTitle: v.channelTitle.slice(0, 200) } : {}),
        durationSeconds: v.durationSeconds, thumbnailUrl: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, addedAt: v.addedAt ?? iso(),
        ...(v.lang && v.lang !== 'en' ? { lang: v.lang } : {}), ...(v.required ? { required: true } : {}),
        ...(v.content?.intro ? { intro: { text: v.content.intro } } : {}), ...(v.content?.outro ? { outro: { text: v.content.outro } } : {}),
        ...(v.content?.quizIds?.length ? { quizIds: v.content.quizIds } : {}), ...(v.why ? { note: v.why.slice(0, 500) } : {}),
      };
    });
    queue.upcoming = upcoming(s.videos, [...s.todayIds, ...spares], { today: s.today });
    queue.updatedAt = iso();
    pc.quiz = { ...(pc.quiz ?? {}), items: { ...Object.fromEntries(Object.entries(pc.quiz?.items ?? {}).filter(([qid]) => (pc.quiz?.defaultIds ?? []).includes(qid))), ...items } };
    if (s.notes?.requiredFirst && ['first', 'mix', 'off'].includes(s.notes.requiredFirst)) pc.requiredFirst = s.notes.requiredFirst;
    pc.updatedAt = iso();
    const voiceReport = await makeVoices(queue, pc, s);
    // Unused recordings were just removed: drop links to them from the other saved videos too.
    for (const v of Object.values(s.videos)) for (const it of Object.values(v.content?.items ?? {})) for (const k of ['audioRef', 'answerAudioRef']) {
      if (it[k]?.startsWith('repo:') && !existsSync(join(dataDir, it[k].slice(5)))) delete it[k];
    }
    helper.processedThrough = s.processedThrough;
    if (s.promptNotes) helper.promptNotes = s.promptNotes;
    memory.processedThrough = s.processedThrough ?? memory.processedThrough;
    helper.lastRunAt = iso();
    helper.wishes = s.wishesAll ?? helper.wishes ?? [];
    // What it noticed and the study plan live in memory.json; parent mode → Prompt shows them.
    if (s.notes?.noticed) helper.noticed = String(s.notes.noticed).slice(0, 6000);
    if (s.notes?.plan) { helper.plan = String(s.notes.plan).slice(0, 8000); helper.planAt = iso(); }
    memory.updatedAt = iso();
    memory.shown = [...new Set([...(memory.shown ?? []), ...s.todayIds])].slice(-500);
    memory.journal = [...(memory.journal ?? []), { at: iso(), summary: String(s.notes?.diary ?? `${s.newIds.length} new ideas, ${s.todayIds.length} today`).slice(0, 1000) }].slice(-200);
    writeJson(paths.queue, queue);
    writeJson(paths.config, pc);
    writeJson(paths.memory, memory);
    writeJson(join(dataDir, 'helper.json'), helperInfo(ROOT, config));
    try { execFileSync(process.execPath, [join(ROOT, 'tools/validate.mjs'), dataDir], { encoding: 'utf8', stdio: 'pipe' }); }
    catch (e) {
      const why = `${e.stdout ?? ''}${e.stderr ?? ''}`.split('\n').filter((l) => /FAIL|^\s{4,}/.test(l)).slice(0, 20).join('\n');
      syncClone(dataDir, config.dataRepo);
      return fail(`the files did not pass the checks, nothing was saved:\n${why}`);
    }
    commitAndPush(dataDir, `helper: ${s.today}: ${s.todayIds.length} today, ${s.newIds.length} new ideas`);
    writeFileSync(join(stateDir, 'last-save'), s.today);
    s.saved = true;
    store(s);
    out({ ok: true, today: s.todayIds, spares, newIdeas: s.newIds, voices: voiceReport });
  },

  info() {
    // A daily session works in the same clone: wait for it (save writes helper.json anyway).
    const cur = existsSync(SESSION) ? JSON.parse(readFileSync(SESSION, 'utf8')) : null;
    if (cur && !cur.saved && Date.now() - Date.parse(cur.startedAt) < 3 * 3600e3) fail('a daily session is running; its save publishes helper.json');
    syncClone(dataDir, config.dataRepo);
    writeJson(join(dataDir, 'helper.json'), helperInfo(ROOT, config));
    out({ ok: true, pushed: commitAndPush(dataDir, 'helper: helper.json (how the helper works)') });
  },

  help() { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n')); },
};


// Recorded voice for every line the friend says today (config voices.speak).
async function makeVoices(queue, pc, s) {
  const cfg = config.voices?.speak ?? { provider: 'device' };
  const voices = createVoices({ env, cfg });
  const want = new Set();
  const report = { provider: cfg.provider, made: 0, kept: 0, skipped: 0, errors: [] };
  // Gemini can be slow or overloaded (3 models × 60 s per line): after this budget the rest is
  // left to the tablet's own voice and recorded on a later run, so save always finishes.
  const deadline = Date.now() + (cfg.maxMinutes ?? 8) * 60000;
  if (!voices.enabled) {
    // Device voice: drop recorded lines so the tablet speaks everything itself.
    for (const v of queue.videos) { delete v.intro?.audioRef; delete v.outro?.audioRef; }
    for (const it of Object.values(pc.quiz.items)) { delete it.audioRef; delete it.answerAudioRef; }
    if (pc.presenter) { delete pc.presenter.phrases; delete pc.presenter.catchphraseAudioRef; }
  } else {
    const make = async (text, lang) => {
      const path = audioPath(text, lang, cfg);
      want.add(path);
      if (existsSync(join(dataDir, path))) { report.kept++; return `repo:${path}`; }
      if (Date.now() > deadline || voices.quotaGone) { report.skipped++; return null; }
      try {
        const mp3 = await voices.speak(text);
        mkdirSync(join(dataDir, 'audio'), { recursive: true });
        writeFileSync(join(dataDir, path), mp3);
        report.made++;
        return `repo:${path}`;
      } catch (e) { report.errors.push(`${text.slice(0, 40)}: ${e.message.slice(0, 160)}`); return null; }
    };
    for (const v of queue.videos) {
      const lang = v.lang ?? 'en';
      for (const k of ['intro', 'outro']) if (v[k]?.text) { const ref = await make(v[k].text, lang); if (ref) v[k].audioRef = ref; else delete v[k].audioRef; }
    }
    for (const it of Object.values(pc.quiz.items)) {
      const lang = it.lang ?? 'en';
      const ref = await make(it.prompt, lang);
      if (ref) it.audioRef = ref; else delete it.audioRef;
      const answer = it.answer.kind === 'choice' ? it.answer.correct : it.answer.accept[0];
      const aref = await make(lang.startsWith('ru') ? `Хорошая попытка! Правильный ответ: ${answer}.` : `Good try! The answer is ${answer}.`, lang);
      if (aref) it.answerAudioRef = aref; else delete it.answerAudioRef;
    }
    const p = (pc.presenter ??= {});
    if (p.catchphrase) { const ref = await make(p.catchphrase, 'en'); if (ref) p.catchphraseAudioRef = ref; else delete p.catchphraseAudioRef; }
    const name = p.name || 'Zippy';
    const langs = [...new Set(['en', ...queue.videos.map((v) => (v.lang ?? 'en').slice(0, 2))])].filter((l) => PHRASES[l]);
    p.phrases = {};
    for (const l of langs) {
      p.phrases[l] = {};
      for (const [key, texts] of Object.entries(PHRASES[l])) {
        p.phrases[l][key] = [];
        for (const t of texts) { const text = t.replace('{name}', name); const ref = await make(text, l); p.phrases[l][key].push(ref ? { text, audioRef: ref } : { text }); }
      }
    }
  }
  // Recordings nobody uses any more are removed, so the repo stays small.
  const adir = join(dataDir, 'audio');
  if (existsSync(adir)) for (const f of readdirSync(adir)) if (!want.has(`audio/${f}`)) unlinkSync(join(adir, f));
  return report;
}

// What the friend says around the questions; recorded once per language (talk.js has the same lines as text).
const PHRASES = {
  en: { praise: ['Yes! Great job!', 'Correct! You’re so smart!', 'That’s right! Hooray!'], retry: ['Hmm, not quite. Try again!', 'Almost! One more try!'],
    hello: ['Hi, it’s {name}! I have a question for you.'], rewatch: ['Let’s watch it one more time and listen carefully!'],
    stop: ['That’s all for today. Let’s try again tomorrow. Bye bye!'], great: ['You did great! Now pick the next video.'], tried: ['Good job trying! Now pick the next video.'] },
  ru: { praise: ['Да! Молодец!', 'Правильно! Ты такой умный!', 'Верно! Ура!'], retry: ['Хм, не совсем. Попробуй ещё!', 'Почти! Ещё разок!'],
    hello: ['Привет, это {name}! У меня есть вопрос.'], rewatch: ['Давай посмотрим ещё раз и будем слушать внимательно!'],
    stop: ['На сегодня всё. Попробуем завтра. Пока-пока!'], great: ['Ты молодец! Теперь выбери следующее видео.'], tried: ['Ты хорошо старался! Теперь выбери следующее видео.'] },
};

if (!commands[cmd]) fail(`unknown command ${cmd}; try help`);
await commands[cmd]();
