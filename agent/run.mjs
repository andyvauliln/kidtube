#!/usr/bin/env node
// The KidTube helper: runs once a day (see agent/README.md).
//   node agent/run.mjs                    one full run: read, plan, write, commit
//   node agent/run.mjs --dry              the same, but writes nothing (prints the plan)
//   node agent/run.mjs --no-search        no new ideas today: transcripts, words and questions for the list
//   node agent/run.mjs --rewrite          also write today's words and questions again (after a prompt change)
//   node agent/run.mjs schedule           puts the daily run into this server's crontab (config.schedule)
// KIDTUBE_DATA_DIR / KIDTUBE_STATE_DIR override the folders (the cloud runner uses them).
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createLLM } from './lib/llm.mjs';
import { syncClone, commitAndPush, readJson, writeJson, activitySince, transcript } from './lib/data.mjs';
import { applyActivity, applyPromptNotes, composeToday, markToday, upcoming, freshCandidates, backlogText, ideasAllowed } from './lib/plan.mjs';
import { buildQuiz, templateCatalog } from './lib/quiz.mjs';
import { understandPrompt, choosePrompt, contentPrompt, notesPrompt } from './lib/prompts.mjs';
import { search } from '../tools/video-info.mjs';
import { helperInfo } from './lib/info.mjs';
import { createGemini } from './lib/gemini.mjs';
import { locate } from './lib/profile.mjs';
import { parseMoods, moodLine } from './lib/moods.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const home = (p) => p.replace(/^~(?=\/)/, homedir());
const iso = (d = new Date()) => d.toISOString().replace(/\.\d+Z$/, 'Z');
const log = (...a) => console.log(`[${iso().slice(11, 19)}]`, ...a);
const hash = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 12);

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const NO_SEARCH = args.includes('--no-search'); // re-plan and re-write only, no new ideas
const REWRITE = args.includes('--rewrite');     // write today's words and questions again
const cmd = args.find((a) => !a.startsWith('--')) ?? 'run';

const config = JSON.parse(readFileSync(join(ROOT, 'agent/config.json'), 'utf8'));
// One profile per run (KIDTUBE_PROFILE); the clone, the log and the API quotas are shared (agent/lib/profile.mjs).
const where = locate(config);
const { cloneDir, dataDir, stateDir, stateRoot } = where;
const PROFILE = where.profile?.path ?? '';
mkdirSync(stateDir, { recursive: true });
const env = { ...readEnv(home(config.envFile)), ...process.env };

function readEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n')
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
}

function localDate(tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}

// One run at a time (a slow model call can outlast the schedule). Not run.lock: daily.sh and poll.sh flock that file.
const lock = join(stateDir, 'run.pid');
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, 'utf8'));
  try { process.kill(pid, 0); console.error(`another run is going (pid ${pid})`); process.exit(1); } catch { /* stale */ }
}
writeFileSync(lock, String(process.pid));
process.on('exit', () => { try { unlinkSync(lock); } catch {} });

try {
  if (cmd === 'schedule') schedule();
  else await run();
} catch (e) {
  log('FAILED:', e.stack ?? e.message);
  process.exitCode = 1;
}

// One crontab line, tagged so it can be replaced: the run's output goes to state/helper.log.
function schedule() {
  const tag = '# kidtube-helper';
  const line = `${config.schedule} cd ${ROOT} && PATH=${dirname(process.execPath)}:$HOME/.local/bin:/usr/bin:/bin agent/daily.sh >> ${join(stateRoot, 'helper.log')} 2>&1 ${tag}`;
  let current = '';
  try { current = execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch {}
  const next = `${current.split('\n').filter((l) => l && !l.includes(tag)).concat(line).join('\n')}\n`;
  if (DRY) return log(`would install:\n${line}`);
  execFileSync('crontab', ['-'], { input: next });
  log(`installed: ${line}`);
}

async function run() {
  if (!env.OPENROUTER_API_KEY) throw new Error(`OPENROUTER_API_KEY is missing in ${config.envFile}`);
  syncClone(cloneDir, config.dataRepo);
  const paths = { memory: join(dataDir, 'memory.json'), queue: join(dataDir, 'queue.json'), config: join(dataDir, 'parent-config.json') };
  const memory = readJson(paths.memory);
  const queue = readJson(paths.queue);
  const pc = readJson(paths.config);
  const helper = (memory.helper ??= { videos: {} });
  const videos = helper.videos;
  const D = where.defaults;
  const tz = /\//.test(pc.timezone ?? '') ? pc.timezone : config.timezone;
  const today = localDate(tz);
  const journal = [];
  const transcriptsInDry = new Map();
  const problems = [];
  log(`run for ${today}${DRY ? ' (dry)' : ''}`);

  // Videos already on the list before the helper existed.
  for (const v of queue.videos) {
    if (videos[v.videoId]) continue;
    videos[v.videoId] = { title: v.title, channelId: v.channelId, channelTitle: v.channelTitle, durationSeconds: v.durationSeconds,
      lang: v.lang ?? 'en', topics: [], why: v.note ?? 'On the starter list.', addedAt: v.addedAt, status: 'today', approved: true, required: v.required ? 'yes' : null, day: null };
  }

  // 1. What happened on the tablet.
  const since = helper.processedThrough ?? memory.processedThrough ?? null;
  const { events, devices } = activitySince(dataDir, since);
  const news = applyActivity(videos, events, { minSecondsBeforeLeave: pc.minSecondsBeforeLeave ?? 120 });
  helper.promptNotes = applyPromptNotes(helper.promptNotes ?? [], news.prompt);
  const quizTypes = devices.at(-1)?.quizTypes ?? ['text', 'choice'];
  log(`activity: ${events.length} events, ${news.watched.length} watches, ${news.wishes.length} messages`);

  // 2. The parent's words, all from parent mode on the tablet: messages, notes on videos, the Prompt tab.
  // What the helper noticed and the study plan are its own notes from earlier runs (memory.json).
  helper.wishes = [...(helper.wishes ?? []), ...news.wishes].slice(-60);
  let wishes = helper.wishes.slice(-30).map((w) => `- ${w.at.slice(0, 10)}: ${w.aboutList ? `(about the ${w.aboutList} list) ` : ''}${w.text.replace(/\n+/g, ' ')}`).join('\n');
  const about = '';
  const noticed = helper.noticed ?? '';
  const plan = helper.plan ?? '';
  const comments = news.notes.filter((n) => n.comment).map((n) => ({ videoId: n.videoId, title: n.title, comment: n.comment }));
  const planComments = [];
  const templates = templateCatalog();
  if (comments.length) log(`parent comments: ${comments.length}`);
  // The parent's changes to the helper's instructions (parent screens → Prompt) count as wishes here.
  if (helper.promptNotes.length) wishes += `\n## The parent's standing instructions for the helper\n${helper.promptNotes.map((n) => `- ${n.text}`).join('\n')}`;

  const llm = createLLM({ apiKey: env.OPENROUTER_API_KEY, stateDir: stateRoot, config: { ...config.llm, openrouter: config.openrouter }, log });

  // 3. What to look for.
  let want = { summary: '', searches: [], videosPerDay: pc.queueSize ?? D.videosPerDay, newIdeas: D.newIdeas, languageMins: D.languageMins, requiredFirst: D.requiredFirst };
  try {
    const p = understandPrompt({ today, wishes, about, noticed, plan, news, backlog: backlogText(videos), comments });
    want = { ...want, ...(await llm.json('understand', p)) };
  } catch (e) { problems.push(e.message); }
  const perDay = clamp(want.videosPerDay, 1, 20, pc.queueSize ?? D.videosPerDay);
  // No searching once the plan is full; otherwise no more ideas than Gemini can transcribe today.
  const room = ideasAllowed(videos, { target: D.planTarget ?? 50, perDay,
    geminiLeft: createGemini({ apiKey: env.GEMINI_API_KEY ?? '', stateDir: stateRoot, config: config.transcripts, today, log: () => {} }).left().videos });
  const newIdeas = Math.min(clamp(want.newIdeas, 0, 15, D.newIdeas), room.allowed);
  log(`plan: ${room.open} open videos (target ${room.target}), new ideas allowed today: ${newIdeas}`);
  const languageMins = Object.fromEntries(Object.entries(want.languageMins ?? {}).filter(([l, n]) => /^[a-z]{2}$/.test(l) && Number.isInteger(n) && n > 0).map(([l, n]) => [l, Math.min(n, perDay)]));
  const maxSeconds = Math.min(pc.maxVideoDurationSeconds || 1e9, (Number(want.maxMinutes) || 1e9) * 60);
  const minSeconds = Math.max(pc.minVideoDurationSeconds ?? 60, (Number(want.minMinutes) || 0) * 60);

  // 4. Search YouTube and let the model pick new ideas.
  const newIds = [];
  if (newIdeas > 0 && want.searches.length && !NO_SEARCH) {
    const results = [];
    for (const s of want.searches.slice(0, 8)) {
      try {
        const found = await search(s.query, D.searchResults);
        results.push(...found.filter((r) => r.channelId).map((r) => ({ ...r, lang: /[а-яё]/i.test(r.title) ? 'ru' : (s.lang ?? 'en').slice(0, 2), search: s })));
        log(`  search "${s.query}" (${s.lang ?? 'en'}): ${found.length} results`);
      } catch (e) { problems.push(`search “${s.query}”: ${e.message}`); }
    }
    const candidates = freshCandidates(results, videos, { minSeconds, maxSeconds, blockedChannelIds: pc.blockedChannelIds, badChannels: helper.badChannels ?? [] });
    log(`search: ${results.length} results, ${candidates.length} new and the right length`);
    if (candidates.length) {
      try {
        const out = await llm.json('choose', choosePrompt({ want, candidates: candidates.slice(0, 60), about, noticed, backlog: backlogText(videos), newIdeas }));
        for (const p of out.picks.slice(0, newIdeas)) {
          const c = candidates.find((x) => x.videoId === p.videoId);
          const must = ['yes', 'today'].includes(p.mustWatch) ? p.mustWatch : null;
          videos[c.videoId] = { title: c.title, channelId: c.channelId, channelTitle: c.channelTitle, durationSeconds: c.durationSeconds,
            lang: /^[a-z]{2}$/.test(p.lang ?? '') ? p.lang : c.lang, topics: Array.isArray(p.topics) ? p.topics.slice(0, 5).map(String) : [],
            why: String(p.why ?? '').slice(0, 500), addedAt: iso(), status: 'idea', approved: false, required: must, day: must === 'today' ? today : null };
          newIds.push(c.videoId);
        }
        for (const b of out.badChannels ?? []) {
          const ch = candidates.find((c) => c.channelTitle === b.channelTitle)?.channelId;
          if (ch) helper.badChannels = [...new Set([...(helper.badChannels ?? []), ch])].slice(-200);
        }
      } catch (e) { problems.push(e.message); }
    }
  }
  journal.push(`${newIds.length} new ideas`);

  // 5. Today's list: approved first, must-watch first, language minimums.
  const todayIds = composeToday(videos, { today, count: perDay, languageMins, blockedChannelIds: pc.blockedChannelIds });
  markToday(videos, todayIds);
  journal.push(`today: ${todayIds.length} videos`);

  // 6a. Transcripts: Gemini watches the videos (today's first, then new ideas, then planned ones),
  // within the daily limits in config.transcripts. The tablet still uploads them too when it is on.
  if (env.GEMINI_API_KEY && config.transcripts?.provider === 'gemini') {
    const gemini = createGemini({ apiKey: env.GEMINI_API_KEY, stateDir: stateRoot, config: config.transcripts, today, log });
    let got = 0;
    for (const id of [...new Set([...todayIds, ...newIds, ...upcoming(videos, todayIds, { today }).map((u) => u.videoId)])]) {
      const old = transcript(dataDir, id);
      if (old?.available) continue;
      const v = videos[id];
      if (!gemini.fits(v.durationSeconds)) { if (gemini.quotaGone) break; continue; }
      try {
        const file = await gemini.transcribe({ videoId: id, ...v });
        if (!DRY) writeJson(join(dataDir, 'transcripts', `${id}.json`), file);
        else transcriptsInDry.set(id, file);
        got++;
      } catch (e) { problems.push(`transcript ${id}: ${e.message}`); }
    }
    const left = gemini.left();
    journal.push(`${got} transcripts from Gemini (left today: ${left.videos} videos, ${Math.round(left.seconds / 60)} min)`);
  }

  // 6b. The friend's words and the quiz, from the transcript.
  const quizOn = !!pc.quiz?.enabled;
  const friend = { name: pc.presenter?.name || 'Zippy' };
  const usable = templates.filter((t) => quizTypes.includes(TEMPLATE_TYPE(t)));
  let written = 0;
  // Today's list and new ideas, then planned videos whose transcript has arrived since their words were written.
  const later = upcoming(videos, todayIds, { today }).map((u) => u.videoId)
    .filter((id) => (transcriptsInDry.get(id) ?? transcript(dataDir, id))?.available && videos[id].content?.source !== 'transcript');
  for (const id of [...new Set([...todayIds, ...newIds, ...later])]) {
    const v = videos[id];
    const tr = transcriptsInDry.get(id) ?? transcript(dataDir, id);
    const source = tr?.available ? 'transcript' : 'title';
    const again = REWRITE && todayIds.includes(id);
    if (v.content && !again && (v.content.source === 'transcript' || source === 'title')) continue;
    if (written >= D.contentPerRun) break;
    try {
      const out = await llm.json(`words for ${id}`, contentPrompt({ video: v, transcript: tr, friend, about, want, templates: usable, quizOn, maxQuestions: D.maxQuestions }));
      const { items, ids } = quizOn ? buildQuiz(id, out.quiz, v.lang === 'ru' ? 'ru' : null, { max: D.maxQuestions }) : { items: {}, ids: [] };
      // unknown [mood] tags are just dropped here
      const intro = parseMoods(out.intro), outro = parseMoods(out.outro);
      v.content = { source, at: iso(), summary: String(out.summary ?? ''), learned: list(out.learned), intro: intro.text.slice(0, 600), outro: outro.text.slice(0, 600),
        ...(intro.moods.length ? { introMoods: intro.moods } : {}), ...(outro.moods.length ? { outroMoods: outro.moods } : {}), talkAbout: list(out.talkAbout), quizIds: ids, items,
        ...(source === 'transcript' && typeof out.tooHardFor4 === 'string' && out.tooHardFor4.trim() ? { tooHard: out.tooHardFor4.trim().slice(0, 300) } : {}) };
      written++;
    } catch (e) { problems.push(e.message); }
  }
  journal.push(`${written} videos got words and questions`);

  // 7. The files the tablet reads.
  const items = {};
  queue.videos = todayIds.map((id) => {
    const v = videos[id];
    Object.assign(items, v.content?.items ?? {});
    return {
      videoId: id, title: v.title.slice(0, 200), channelId: v.channelId, ...(v.channelTitle ? { channelTitle: v.channelTitle.slice(0, 200) } : {}),
      durationSeconds: v.durationSeconds, thumbnailUrl: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, addedAt: v.addedAt ?? iso(),
      ...(v.lang && v.lang !== 'en' ? { lang: v.lang } : {}),
      ...(v.required ? { required: true } : {}),
      ...(v.content?.intro ? { intro: moodLine(v.content.intro, v.content.introMoods) } : {}),
      ...(v.content?.outro ? { outro: moodLine(v.content.outro, v.content.outroMoods) } : {}),
      ...(v.content?.quizIds?.length ? { quizIds: v.content.quizIds } : {}),
      ...(v.why ? { note: v.why.slice(0, 500) } : {}),
    };
  });
  queue.upcoming = upcoming(videos, todayIds, { today });
  queue.updatedAt = iso();
  pc.quiz = { ...(pc.quiz ?? {}), items: { ...Object.fromEntries(Object.entries(pc.quiz?.items ?? {}).filter(([id]) => (pc.quiz?.defaultIds ?? []).includes(id))), ...items } };
  if (['first', 'mix', 'off'].includes(want.requiredFirst)) pc.requiredFirst = want.requiredFirst;
  pc.updatedAt = iso();

  // 8. What the helper noticed, the study plan, the diary.
  const wishesHash = hash(wishes + about);
  const rewritePlan = !plan.trim() || !helper.planAt || planComments.length > 0 || helper.wishesHash !== wishesHash
    || Date.now() - Date.parse(helper.planAt) > D.planEveryDays * 864e5;
  let notes = null;
  try {
    notes = await llm.json('notes', notesPrompt({ today, wishes, about, noticed, plan, news, comments, planComments, rewritePlan, journal: journal.join('; '),
      rules: { minutesPerDay: pc.time?.maxMinutesPerDay, watchingHours: pc.time?.allowed, videosPerDay: perDay, longestVideoMinutes: Math.round(maxSeconds / 60), questionsOn: !!pc.quiz?.enabled } }));
  } catch (e) { problems.push(e.message); }

  const lastEvent = events.map((e) => e.at).sort().at(-1);
  helper.processedThrough = lastEvent && lastEvent > (since ?? '') ? lastEvent : since;
  memory.processedThrough = helper.processedThrough ?? memory.processedThrough;
  helper.lastRunAt = iso();
  helper.wishesHash = wishesHash;
  // What it noticed and the study plan: parent mode → Prompt shows them.
  if (notes?.noticed) helper.noticed = String(notes.noticed).slice(0, 6000);
  if (notes?.plan && rewritePlan) { helper.plan = String(notes.plan).slice(0, 8000); helper.planAt = iso(); }
  helper.models = llm.usedModels().slice(-10);
  memory.updatedAt = iso();
  memory.shown = [...new Set([...(memory.shown ?? []), ...todayIds])].slice(-500);
  memory.journal = [...(memory.journal ?? []), { at: iso(), summary: `${notes?.diary ?? ''} (${journal.join(', ')})${problems.length ? ` Problems: ${problems.length}` : ''}`.trim().slice(0, 1000) }].slice(-200);

  writeJson(paths.queue, queue);
  writeJson(paths.config, pc);
  writeJson(paths.memory, memory);
  writeJson(join(dataDir, 'helper.json'), helperInfo(ROOT, config, where));

  if (DRY) {
    writeJson(join(stateDir, 'dry-run.json'), { today: todayIds, newIds, want, notes, videos: Object.fromEntries([...todayIds, ...newIds].map((id) => [id, videos[id]])) });
    log(`DRY RUN: nothing written (details in ${join(stateDir, 'dry-run.json')}). Today:`);
    for (const q of queue.videos) log(`  ${q.required ? '⭐' : '  '} ${q.videoId} ${q.lang ?? 'en'} ${q.title}${q.intro ? '' : ' (no words yet)'}`);
    log('want:', JSON.stringify({ ...want, searches: want.searches.map((s) => s.query) }));
    if (problems.length) log('problems:', problems.join('\n  '));
    syncClone(cloneDir, config.dataRepo); // throw the local changes away
    return;
  }

  // 9. Check the files exactly like CI does, then save them to GitHub.
  try {
    execFileSync(process.execPath, [join(ROOT, 'tools/validate.mjs'), dataDir], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.split('\n').filter((l) => /FAIL|^\s{4,}/.test(l)).slice(0, 20).join('\n');
    syncClone(cloneDir, config.dataRepo);
    throw new Error(`the new files did not pass the checks, nothing was saved:\n${out}`);
  }
  commitAndPush(cloneDir, `helper: ${today}: ${journal.join(', ')}${PROFILE ? ` (${PROFILE})` : ''}`);
  writeFileSync(join(stateDir, 'last-save'), today);
  log('saved to GitHub');

  if (problems.length) log('problems:\n  ' + problems.join('\n  '));
  log(`done: ${journal.join(', ')}; ${llm.calls} model calls`);
}

function clamp(n, min, max, dflt) { return Number.isInteger(n) && n >= min && n <= max ? n : dflt; }
function list(x) { return Array.isArray(x) ? x.map(String).filter(Boolean).slice(0, 6) : []; }
function TEMPLATE_TYPE(t) { return t.answer === 'choice' || t.id === 'video-choice' || t.id === 'bigger' ? 'choice' : 'voice'; }
