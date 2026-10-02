// The helper's Notion pages: wishes, about him, what the helper noticed, study plan, diary,
// the Videos table (with its views) and the Quiz templates table.
import { prop, readProp, esc } from './notion.mjs';
import { templateCatalog } from './quiz.mjs';

export const STATUS = { idea: 'Idea', planned: 'Planned', today: 'Today', watched: 'Watched', no: 'No' };
const STATUS_BACK = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [v, k]));
const REQUIRED = { yes: 'Must watch', today: 'Must watch today' };
const REQUIRED_BACK = Object.fromEntries(Object.entries(REQUIRED).map(([k, v]) => [v, k]));

const VIDEO_PROPS = {
  Title: { title: {} },
  Status: { select: { options: [
    { name: 'Idea', color: 'yellow' }, { name: 'Planned', color: 'blue' }, { name: 'Today', color: 'orange' },
    { name: 'Watched', color: 'green' }, { name: 'No', color: 'red' }] } },
  Approved: { checkbox: {} },
  'Must watch': { select: { options: [{ name: 'Must watch', color: 'purple' }, { name: 'Must watch today', color: 'red' }] } },
  'Parent comment': { rich_text: {} },
  Day: { date: {} },
  Order: { number: {} },
  New: { checkbox: {} },
  Added: { date: {} },
  Language: { select: { options: [{ name: 'en', color: 'blue' }, { name: 'ru', color: 'red' }] } },
  Topics: { multi_select: {} },
  Channel: { rich_text: {} },
  Minutes: { number: {} },
  Why: { rich_text: {} },
  Video: { url: {} },
  'Video ID': { rich_text: {} },
  Watched: { date: {} },
  Reaction: { rich_text: {} },
  'Made from': { select: { options: [{ name: 'Transcript', color: 'green' }, { name: 'Title only', color: 'gray' }] } },
};

const TEMPLATE_PROPS = {
  Name: { title: {} },
  Kind: { select: { options: [{ name: 'Built-in', color: 'gray' }, { name: 'Custom', color: 'purple' }] } },
  'Template id': { rich_text: {} },
  Skill: { rich_text: {} },
  Answer: { select: { options: [{ name: 'voice', color: 'green' }, { name: 'choice', color: 'blue' }, { name: 'text', color: 'gray' }] } },
  'How it works': { rich_text: {} },
  Example: { rich_text: {} },
  'Use it': { checkbox: {} },
};

const WISHES = `<callout icon="✍️">
	Write what you want in plain words. The helper reads this page on every run. Messages you send from the tablet (“Message to the helper”) are added at the bottom.
</callout>
## Always
- He is 4–5 years old. Calm, kind, slow-paced videos. No pranks, no screaming, no scary things, no toy unboxing.
- Languages: English and Russian.
- Videos 3 to 15 minutes long.
## This month
- Numbers to 10: counting, plus and minus.
## This week
-
## Today
-
## Numbers
- Videos per day: 6
- New ideas per day: 6
- At least Russian videos per day: 2
- Must-watch order: first (first = must-watch videos first, mix = one must-watch then one free choice, off = only a mark)
## Messages from the tablet
`;

const ABOUT = `<callout icon="🧒">
	Your document about him. The helper reads it on every run but never changes it; what the helper learns goes to “What the helper noticed”.
</callout>
## Name and age
-
## Languages he speaks
-
## What he loves
-
## What he doesn't like
-
## What he is learning now
-
## Notes
-
`;

export async function setupWorkspace(notion, parentPage, ids = {}, log = console.log) {
  const out = { ...ids, parentPage };
  const page = async (key, title, icon, markdown) => {
    if (out[key]) return;
    out[key] = (await notion.createPage({ parentPage, title, icon, markdown })).id;
    log(`created page: ${title}`);
  };
  await page('wishesPage', 'Wishes and settings', '⚙️', WISHES);
  await page('aboutPage', 'About him', '🧒', ABOUT);
  await page('noticedPage', 'What the helper noticed', '🔎', '*The helper rewrites this page after it learns something new about him.*');
  await page('planPage', 'Study plan', '📚', '*The helper writes the plan on its first run. Comment on any line (select it → Comment) and the helper will take it into account.*');
  await page('diaryPage', 'Helper diary', '📓', '*What the helper did on each run, newest first.*');
  if (!out.videosDataSource) {
    const db = await notion.createDatabase({ parentPage, title: 'Videos', icon: '🎬', properties: VIDEO_PROPS });
    Object.assign(out, { videosDatabase: db.databaseId, videosDataSource: db.dataSourceId });
    log('created table: Videos');
    const view = async (name, type, filter, sorts) => {
      try { await notion.createView({ database_id: db.databaseId, data_source_id: db.dataSourceId, name, type, ...(filter ? { filter } : {}), ...(sorts ? { sorts } : {}) }); }
      catch (e) { log(`  view “${name}” not created: ${e.message}`); }
    };
    const status = (s) => ({ property: 'Status', select: { equals: s } });
    await view('Added today', 'table', { property: 'New', checkbox: { equals: true } }, [{ property: 'Order', direction: 'ascending' }]);
    await view('Today', 'table', status('Today'), [{ property: 'Order', direction: 'ascending' }]);
    await view('Planned', 'table', { or: [status('Planned'), status('Idea')] }, [{ property: 'Day', direction: 'ascending' }]);
    await view('Watched', 'table', status('Watched'), [{ property: 'Watched', direction: 'descending' }]);
  }
  if (!out.templatesDataSource) {
    const db = await notion.createDatabase({ parentPage, title: 'Quiz templates', icon: '🧩', properties: TEMPLATE_PROPS });
    Object.assign(out, { templatesDatabase: db.databaseId, templatesDataSource: db.dataSourceId });
    log('created table: Quiz templates');
    for (const t of templateCatalog()) {
      await notion.createPage({ dataSource: out.templatesDataSource, properties: {
        Name: prop.title(t.title), Kind: prop.select('Built-in'), 'Template id': prop.text(t.id), Skill: prop.text(t.skill),
        Answer: prop.select(t.answer), 'How it works': prop.text(t.howItWorks), Example: prop.text(t.example), 'Use it': prop.check(true),
      } });
    }
  }
  return out;
}

// Rows of the Videos table → { videoId: { pageId, status, approved, required, day, comment, order } }
export async function readVideoRows(notion, ws) {
  const rows = await notion.query(ws.videosDataSource);
  const out = {};
  for (const r of rows) {
    const p = r.properties;
    const videoId = readProp(p['Video ID']);
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId ?? '')) continue;
    out[videoId] = {
      pageId: r.id, edited: r.last_edited_time,
      status: STATUS_BACK[readProp(p.Status)] ?? null,
      approved: readProp(p.Approved) ?? false,
      required: REQUIRED_BACK[readProp(p['Must watch'])] ?? null,
      day: readProp(p.Day) ?? null,
      comment: readProp(p['Parent comment']) ?? '',
      isNew: readProp(p.New) ?? false,
    };
  }
  return out;
}

export async function readTemplates(notion, ws) {
  const rows = await notion.query(ws.templatesDataSource);
  return rows.map((r) => ({
    name: readProp(r.properties.Name), kind: readProp(r.properties.Kind), id: readProp(r.properties['Template id']),
    skill: readProp(r.properties.Skill), answer: readProp(r.properties.Answer), howItWorks: readProp(r.properties['How it works']),
    example: readProp(r.properties.Example), use: readProp(r.properties['Use it']) !== false,
  }));
}

export function videoProps(id, v, { order = null, isNew = false } = {}) {
  return {
    Title: prop.title(v.title),
    Status: prop.select(STATUS[v.status] ?? 'Idea'),
    Approved: prop.check(v.approved),
    'Must watch': prop.select(REQUIRED[v.required] ?? null),
    Day: prop.date(v.day),
    Order: prop.number(order),
    New: prop.check(isNew),
    Added: prop.date(v.addedAt?.slice(0, 10)),
    Language: prop.select(v.lang ?? null),
    Topics: prop.multi(v.topics),
    Channel: prop.text(v.channelTitle ?? ''),
    Minutes: prop.number(Math.round((v.durationSeconds ?? 0) / 6) / 10),
    Why: prop.text(v.why ?? ''),
    Video: prop.url(`https://www.youtube.com/watch?v=${id}`),
    'Video ID': prop.text(id),
    Watched: prop.date(v.watchedAt?.slice(0, 10) ?? null),
    Reaction: prop.text(reaction(v)),
    'Made from': prop.select(v.content ? (v.content.source === 'transcript' ? 'Transcript' : 'Title only') : null),
  };
}

function reaction(v) {
  const bits = [];
  if (v.liked === true) bits.push('👍');
  if (v.liked === false) bits.push('👎');
  if (v.comment) bits.push(`“${v.comment}”`);
  for (const q of v.quiz ?? []) bits.push(`${q.result === 'passed' ? '✅' : q.result === 'failed' ? '❌' : '⏭️'} ${q.quizId}`);
  return bits.join(' ');
}

// The page body of one video. The parent writes in “Parent comment” or as Notion comments.
export function videoMarkdown(id, v, { items = {}, transcript = null } = {}) {
  const c = v.content ?? {};
  const lines = [
    `<video src="https://www.youtube.com/watch?v=${id}"></video>`,
    `<callout icon="💬">`,
    `\tWrite what you think in the **Parent comment** field or as a comment on this page. The helper rewrites this page text.`,
    `</callout>`,
    `## Why this video`,
    esc(v.why || '—'),
    `## What it's about`,
    esc(c.summary || '—'),
    ...(c.learned?.length ? ['### New things he learns', ...c.learned.map((x) => `- ${esc(x)}`)] : []),
    `## Before the video (the friend says)`,
    `> ${esc(c.intro || '—')}`,
    `## After the video (the friend says)`,
    `> ${esc(c.outro || '—')}`,
    `## Things to talk about`,
    ...(c.talkAbout?.length ? c.talkAbout.map((x) => `- ${esc(x)}`) : ['—']),
    `## Quiz`,
    ...((c.quizIds ?? []).length ? c.quizIds.map((qid) => quizLine(qid, items[qid])) : ['No questions for this video.']),
    ...(c.source !== 'transcript' ? ['', `*Written from the title only. The tablet fetches the transcript; the helper rewrites this page once it arrives.*`] : []),
  ];
  if (transcript?.available && transcript.text) {
    const text = transcript.text.length > 12000 ? `${transcript.text.slice(0, 12000)}\n…` : transcript.text;
    lines.push(`## Transcript {toggle="true"}`, ...text.split('\n').map((l) => `\t${esc(l)}`));
  }
  return lines.join('\n');
}

function quizLine(id, item) {
  if (!item) return `- ${esc(id)}`;
  const answer = item.answer.kind === 'choice' ? `${item.answer.options.map((o) => (o === item.answer.correct ? `**${esc(o)}**` : esc(o))).join(' / ')}` : item.answer.accept.map(esc).join(', ');
  return `- ${esc(item.prompt)} → ${answer} *(${item.type === 'voice' ? 'he says it' : item.type === 'choice' ? 'he taps it' : 'he types it'})*`;
}
