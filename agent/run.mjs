#!/usr/bin/env node
// The KidTube helper: runs once a day (see agent/README.md).
//   node agent/run.mjs                    one full run: read, plan, write, commit, update Notion
//   node agent/run.mjs --dry              the same, but writes nothing (prints the plan)
//   node agent/run.mjs --no-search        no new ideas today: transcripts, words and questions for the list
//   node agent/run.mjs --rewrite          also write today's words and questions again (after a prompt change)
//   node agent/run.mjs setup-notion <url> creates the Notion pages under a page shared with the connection
//   node agent/run.mjs schedule           puts the daily run into this server's crontab (config.schedule)
// KIDTUBE_DATA_DIR / KIDTUBE_STATE_DIR override the folders (the cloud runner uses them).
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createLLM } from './lib/llm.mjs';
import { createNotion } from './lib/notion.mjs';
import { syncClone, commitAndPush, readJson, writeJson, activitySince, transcript } from './lib/data.mjs';
import { applyActivity, applyNotionRow, composeToday, markToday, upcoming, freshCandidates, backlogText } from './lib/plan.mjs';
import { buildQuiz, templateCatalog } from './lib/quiz.mjs';
import { understandPrompt, choosePrompt, contentPrompt, notesPrompt } from './lib/prompts.mjs';
import { setupWorkspace, readVideoRows, readTemplates, videoProps, videoMarkdown } from './lib/workspace.mjs';
import { search } from '../tools/video-info.mjs';
import { createGemini } from './lib/gemini.mjs';

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
const dataDir = home(process.env.KIDTUBE_DATA_DIR ?? config.dataDir);
const stateDir = home(process.env.KIDTUBE_STATE_DIR ?? config.stateDir);
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

// One run at a time (a slow model call can outlast the schedule).
const lock = join(stateDir, 'run.lock');
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, 'utf8'));
  try { process.kill(pid, 0); console.error(`another run is going (pid ${pid})`); process.exit(1); } catch { /* stale */ }
}
writeFileSync(lock, String(process.pid));
process.on('exit', () => { try { unlinkSync(lock); } catch {} });

try {
  if (cmd === 'setup-notion') await setupNotion(args[args.indexOf('setup-notion') + 1]);
  else if (cmd === 'schedule') schedule();
  else await run();
} catch (e) {
  log('FAILED:', e.stack ?? e.message);
  process.exitCode = 1;
}

// One crontab line, tagged so it can be replaced: the run's output goes to state/helper.log.
function schedule() {
  const tag = '# kidtube-helper';
  const line = `${config.schedule} cd ${ROOT} && ${process.execPath} agent/run.mjs >> ${join(stateDir, 'helper.log')} 2>&1 ${tag}`;
  let current = '';
  try { current = execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch {}
  const next = `${current.split('\n').filter((l) => l && !l.includes(tag)).concat(line).join('\n')}\n`;
  if (DRY) return log(`would install:\n${line}`);
  execFileSync('crontab', ['-'], { input: next });
  log(`installed: ${line}`);
}

async function setupNotion(url) {
  const pageId = String(url ?? '').match(/([0-9a-f]{32}|[0-9a-f-]{36})(?:\?|$)/i)?.[1];
  if (!pageId) throw new Error('usage: node agent/run.mjs setup-notion <link to a Notion page shared with the helper connection>');
  if (!env.NOTION_TOKEN) throw new Error(`NOTION_TOKEN is missing in ${config.envFile}`);
  syncClone(dataDir, config.dataRepo);
  const memPath = join(dataDir, 'memory.json');
  const memory = readJson(memPath);
  memory.helper ??= { videos: {} };
  const notion = createNotion({ token: env.NOTION_TOKEN, log });
  memory.helper.notion = await setupWorkspace(notion, pageId, memory.helper.notion?.parentPage === pageId ? memory.helper.notion : {}, log);
  writeJson(memPath, memory);
  if (!DRY) commitAndPush(dataDir, 'helper: Notion pages');
  log('Notion is ready:', JSON.stringify(memory.helper.notion));
}

async function run() {
  if (!env.OPENROUTER_API_KEY) throw new Error(`OPENROUTER_API_KEY is missing in ${config.envFile}`);
  syncClone(dataDir, config.dataRepo);
  const paths = { memory: join(dataDir, 'memory.json'), queue: join(dataDir, 'queue.json'), config: join(dataDir, 'parent-config.json') };
  const memory = readJson(paths.memory);
  const queue = readJson(paths.queue);
  const pc = readJson(paths.config);
  const helper = (memory.helper ??= { videos: {} });
  const videos = helper.videos;
  const D = config.defaults;
  const tz = /\//.test(pc.timezone ?? '') ? pc.timezone : config.timezone;
  const today = localDate(tz);
  const journal = [];
  const transcriptsInDry = new Map();
  const problems = [];
  const touched = new Set();      // Notion rows to write
  const rewritten = new Set();    // Notion page bodies to write
  log(`run for ${today}${DRY ? ' (dry)' : ''}`);

  // Videos already on the list before the helper existed.
  for (const v of queue.videos) {
    if (videos[v.videoId]) continue;
    videos[v.videoId] = { title: v.title, channelId: v.channelId, channelTitle: v.channelTitle, durationSeconds: v.durationSeconds,
      lang: v.lang ?? 'en', topics: [], why: v.note ?? 'On the starter list.', addedAt: v.addedAt, status: 'today', approved: true, required: v.required ? 'yes' : null, day: null };
    touched.add(v.videoId);
  }

  // 1. What happened on the tablet.
  const since = helper.processedThrough ?? memory.processedThrough ?? null;
  const { events, devices } = activitySince(dataDir, since);
  const news = applyActivity(videos, events, { minSecondsBeforeLeave: pc.minSecondsBeforeLeave ?? 120 });
  for (const w of news.watched) if (videos[w.videoId]) touched.add(w.videoId);
  for (const q of news.quiz) if (videos[q.videoId]) touched.add(q.videoId);
  for (const n of news.notes) if (videos[n.videoId]) touched.add(n.videoId);
  const quizTypes = devices.at(-1)?.quizTypes ?? ['text', 'choice'];
  log(`activity: ${events.length} events, ${news.watched.length} watches, ${news.wishes.length} messages`);

  // 2. Notion: the parent's pages and the table.
  const notion = env.NOTION_TOKEN && helper.notion?.videosDataSource ? createNotion({ token: env.NOTION_TOKEN, log }) : null;
  const ws = helper.notion;
  let wishes = '', about = '', noticed = '', plan = '';
  const comments = [];
  let planComments = [];
  let templates = templateCatalog();
  if (notion) {
    [wishes, about, noticed, plan] = await Promise.all([ws.wishesPage, ws.aboutPage, ws.noticedPage, ws.planPage].map((id) => notion.markdown(id).catch((e) => { problems.push(e.message); return ''; })));
    const rows = await readVideoRows(notion, ws);
    for (const [id, row] of Object.entries(rows)) {
      const v = videos[id];
      if (!v) continue;
      v.notionPageId = row.pageId;
      if (applyNotionRow(v, row)) comments.push({ videoId: id, title: v.title, comment: v.parentComment, approved: v.approved, status: v.status });
      if (row.isNew) touched.add(id); // clears the "Added today" mark
    }
    // Comments written on the pages themselves (needs the connection's "Read comments" permission).
    const seen = new Set(helper.seenComments ?? []);
    const recent = Object.entries(videos).filter(([, v]) => v.notionPageId && (v.status !== 'watched' || (v.watchedAt ?? '') > iso(new Date(Date.now() - 3 * 864e5))));
    for (const [id, v] of recent) {
      const list = await notion.comments(v.notionPageId).catch(() => null);
      for (const c of list ?? []) if (!seen.has(c.id)) { seen.add(c.id); comments.push({ videoId: id, title: v.title, comment: c.text }); }
    }
    for (const c of (await notion.comments(ws.planPage).catch(() => null)) ?? []) {
      if (!seen.has(c.id)) { seen.add(c.id); planComments.push(c.text); }
    }
    for (const c of (await notion.comments(ws.aboutPage).catch(() => null)) ?? []) {
      if (!seen.has(c.id)) { seen.add(c.id); comments.push({ page: 'About him', comment: c.text }); }
    }
    helper.seenComments = [...seen].slice(-2000);
    // Videos the helper knew before Notion was connected (or whose row was deleted) get a row.
    for (const [id, v] of Object.entries(videos)) {
      if (rows[id]) continue;
      if (v.notionPageId) delete v.notionPageId;
      if (v.status !== 'watched' || (v.watchedAt ?? '') > iso(new Date(Date.now() - 14 * 864e5))) touched.add(id);
    }
    const custom = (await readTemplates(notion, ws).catch(() => [])).filter((t) => t.use);
    const builtIn = new Set(custom.filter((t) => t.kind === 'Built-in').map((t) => t.id));
    templates = [...templateCatalog().filter((t) => builtIn.size === 0 || builtIn.has(t.id)),
      ...custom.filter((t) => t.kind === 'Custom').map((t) => ({ id: t.answer === 'choice' ? 'video-choice' : 'video-voice', title: t.name, howItWorks: `${t.howItWorks} (custom template “${t.name}” from the parent)`, params: {}, example: t.example }))];
    // Messages sent from the tablet go to the wishes page, so everything the parent wants is in one place.
    if (news.wishes.length && !DRY) {
      const md = news.wishes.map((w) => `- ${w.at.slice(0, 10)}: ${w.text.replace(/\n+/g, ' ')}`).join('\n');
      await notion.addMarkdown(ws.wishesPage, md).catch((e) => problems.push(`wishes page: ${e.message}`));
      wishes += `\n${md}`;
    }
  } else {
    log('Notion is not set up: using the defaults and the tablet messages only');
    wishes = news.wishes.map((w) => `- ${w.text}`).join('\n');
  }
  if (comments.length) log(`parent comments: ${comments.length}`);

  const llm = createLLM({ apiKey: env.OPENROUTER_API_KEY, stateDir, config: config.llm, log });

  // 3. What to look for.
  let want = { summary: '', searches: [], videosPerDay: D.videosPerDay, newIdeas: D.newIdeas, languageMins: D.languageMins, requiredFirst: D.requiredFirst };
  try {
    const p = understandPrompt({ today, wishes, about, noticed, plan, news, backlog: backlogText(videos), comments });
    want = { ...want, ...(await llm.json('understand', p)) };
  } catch (e) { problems.push(e.message); }
  const perDay = clamp(want.videosPerDay, 1, 20, D.videosPerDay);
  const newIdeas = clamp(want.newIdeas, 0, 15, D.newIdeas);
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
          touched.add(c.videoId);
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
  for (const [id, v] of Object.entries(videos)) if (v.status === 'today' && !todayIds.includes(id)) touched.add(id);
  markToday(videos, todayIds);
  todayIds.forEach((id) => touched.add(id));
  journal.push(`today: ${todayIds.length} videos`);

  // 6a. Transcripts: Gemini watches the videos (today's first, then new ideas, then planned ones),
  // within the daily limits in config.transcripts. The tablet still uploads them too when it is on.
  if (env.GEMINI_API_KEY && config.transcripts?.provider === 'gemini') {
    const gemini = createGemini({ apiKey: env.GEMINI_API_KEY, stateDir, config: config.transcripts, today, log });
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
      v.content = { source, at: iso(), summary: String(out.summary ?? ''), learned: list(out.learned), intro: out.intro.trim().slice(0, 600), outro: out.outro.trim().slice(0, 600), talkAbout: list(out.talkAbout), quizIds: ids, items };
      rewritten.add(id);
      touched.add(id);
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
      ...(v.content?.intro ? { intro: { text: v.content.intro } } : {}),
      ...(v.content?.outro ? { outro: { text: v.content.outro } } : {}),
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
  if (notes?.plan && rewritePlan) helper.planAt = iso();
  helper.models = llm.usedModels().slice(-10);
  memory.updatedAt = iso();
  memory.shown = [...new Set([...(memory.shown ?? []), ...todayIds])].slice(-500);
  memory.journal = [...(memory.journal ?? []), { at: iso(), summary: `${notes?.diary ?? ''} (${journal.join(', ')})${problems.length ? ` Problems: ${problems.length}` : ''}`.trim().slice(0, 1000) }].slice(-200);

  writeJson(paths.queue, queue);
  writeJson(paths.config, pc);
  writeJson(paths.memory, memory);

  if (DRY) {
    writeJson(join(stateDir, 'dry-run.json'), { today: todayIds, newIds, want, notes, videos: Object.fromEntries([...todayIds, ...newIds].map((id) => [id, videos[id]])) });
    log(`DRY RUN: nothing written (details in ${join(stateDir, 'dry-run.json')}). Today:`);
    for (const q of queue.videos) log(`  ${q.required ? '⭐' : '  '} ${q.videoId} ${q.lang ?? 'en'} ${q.title}${q.intro ? '' : ' (no words yet)'}`);
    log('want:', JSON.stringify({ ...want, searches: want.searches.map((s) => s.query) }));
    if (problems.length) log('problems:', problems.join('\n  '));
    syncClone(dataDir, config.dataRepo); // throw the local changes away
    return;
  }

  // 9. Check the files exactly like CI does, then save them to GitHub.
  try {
    execFileSync(process.execPath, [join(ROOT, 'tools/validate.mjs'), dataDir], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.split('\n').filter((l) => /FAIL|^\s{4,}/.test(l)).slice(0, 20).join('\n');
    syncClone(dataDir, config.dataRepo);
    throw new Error(`the new files did not pass the checks, nothing was saved:\n${out}`);
  }
  commitAndPush(dataDir, `helper: ${today}: ${journal.join(', ')}`);
  log('saved to GitHub');

  // 10. Notion: rows, video pages, noticed, plan, diary.
  if (notion) {
    const order = new Map(todayIds.map((id, i) => [id, i + 1]));
    for (const id of touched) {
      const v = videos[id];
      try {
        const props = videoProps(id, v, { order: order.get(id) ?? null, isNew: newIds.includes(id) });
        const md = videoMarkdown(id, v, { items: v.content?.items ?? {}, transcript: rewritten.has(id) || !v.notionPageId ? transcript(dataDir, id) : null });
        if (!v.notionPageId) v.notionPageId = (await notion.createPage({ dataSource: ws.videosDataSource, properties: props, markdown: md })).id;
        else {
          await notion.updatePage(v.notionPageId, props);
          if (rewritten.has(id)) await notion.setMarkdown(v.notionPageId, md);
        }
      } catch (e) { problems.push(`Notion row ${id}: ${e.message}`); }
    }
    if (notes?.noticed) await notion.setMarkdown(ws.noticedPage, `*Updated ${today} by the helper.*\n${notes.noticed}`).catch((e) => problems.push(e.message));
    if (notes?.plan && rewritePlan) await notion.setMarkdown(ws.planPage, `*Written ${today} by the helper. Comment on any line and it will be taken into account on the next run.*\n${notes.plan}`).catch((e) => problems.push(e.message));
    const diary = [`## ${today}`, notes?.diary ?? '', `- ${journal.join('\n- ')}`, ...(problems.length ? ['### Problems', ...problems.map((p) => `- ${p.replace(/\n/g, ' ').slice(0, 300)}`)] : [])].join('\n');
    await notion.addMarkdown(ws.diaryPage, diary, 'start').catch((e) => problems.push(e.message));
    // Page ids of new rows are worth keeping.
    writeJson(paths.memory, memory);
    commitAndPush(dataDir, 'helper: Notion page links');
  }
  if (problems.length) log('problems:\n  ' + problems.join('\n  '));
  log(`done: ${journal.join(', ')}; ${llm.calls} model calls`);
}

function clamp(n, min, max, dflt) { return Number.isInteger(n) && n >= min && n <= max ? n : dflt; }
function list(x) { return Array.isArray(x) ? x.map(String).filter(Boolean).slice(0, 6) : []; }
function TEMPLATE_TYPE(t) { return t.answer === 'choice' || t.id === 'video-choice' || t.id === 'bigger' ? 'choice' : 'voice'; }
