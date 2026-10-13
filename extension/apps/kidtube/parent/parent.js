// Parent mode: today's list, the planned videos and what he watched, each video's details and its quiz.
// Changes go to the background (background/parent.js planChange), which applies them on this tablet at once and logs them for the helper.
import { ask } from '../../../core/lib/ask.js';
import { APPS } from '../../registry.js';
import { say, listen, recordedUrl } from '../lib/voice.js';
import { el, btn, toast, runNow, notesDock, promptNotesBox, hooks, upDown, slideIn, holdPage, editOnDoubleTap } from './kit.js';
import { mountSettings, settingsBox } from './settings.js';
import { isCorrect, correctText } from '../lib/mark.js';
import { renderMarkdown, promptSteps } from './markdown.js';

const $ = (id) => document.getElementById(id);
const view = $('view');
let data = null;

const mins = (s) => (s ? `${Math.max(1, Math.round(s / 60))} min` : '');
const when = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayLabel = (date) => {
  const d = new Date(`${date}T12:00:00`);
  const diff = Math.round((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
};

// --- the bar at the bottom: ↻ Update (left), Parent | Kid (middle), the 🎤 (right) ------------------------------
// No notifications here (2026-10-13, the parent's request): the notes, the run's state and the problems are in the
// header's list (core/ui/header.js, core/background/inbox.js). ↻ Update sends all the notes and asks the helper for
// new data (the AI run); it rests while a run waits or works. The app's own new version is in the header too.
let runTimer = null;
async function showDock(fresh = false) {
  if (fresh) await ask({ type: 'sync' });
  const r = await ask({ type: 'runStatus' });
  if (!r?.ok) return;
  const working = r.state === 'queued' || r.state === 'running';
  const b = btn('↻ Update', async () => {
    b.disabled = true;
    const ok = await runNow();
    if (!ok) b.disabled = false;
  }, 'small');
  b.disabled = working;
  b.title = working ? 'The AI run is on its way: the header’s 🔔 list shows where it is'
    : r.held ? `Sends your ${r.held} note${r.held === 1 ? '' : 's'} to the AI and asks it for new data` : 'Asks the AI for new data with what he watched';
  $('run').replaceChildren(b);
  clearTimeout(runTimer);
  // While the run waits or works: look again every 30 s; when it is done, the lists are drawn again.
  if (working) runTimer = setTimeout(async () => {
    await showDock(true);
    const now = await ask({ type: 'runStatus' });
    if (now?.state === 'done') refresh();
  }, 30000);
}

hooks.afterUndo = () => refresh();
hooks.afterRun = () => showDock();


// --- the apps header (core/ui/header.js), the Parent | Kid switch, loading ----------------------------------
globalThis.KidTubeHeader.mount($('appHeader'));
$('mode').replaceChildren(globalThis.KidTubeHeader.modeSwitch('parent'));

const W = globalThis.KidTubeWatch;   // the checks (core/ui/watch.js)
W?.watchTaps(document, 'parent');
let loadChecked = false;
async function refresh() {
  const r = await ask({ type: 'parentData' });
  if (!loadChecked) {
    loadChecked = true;
    W?.check({ id: 'parent.loads', area: 'parent', expect: 'The parent screens get their data from the background',
      code: ['apps/kidtube/parent/parent.js refresh', 'apps/kidtube/background/parent.js parentData'] }, (t) => {
      t.ok('answer to "parentData"', !!r && r.ok !== false, r ?? 'no answer in 8 s', 'the lists');
    });
  }
  if (!r || r.ok === false) { view.replaceChildren(el('p', 'err', 'KidTube’s background did not answer. Close this page and open it again.')); return; }
  data = r;
  // These are KidTube's screens: a profile with another app goes to that app's page.
  if (r.app && r.app !== 'kidtube') { location.replace(chrome.runtime.getURL(APPS[r.app]?.page ?? 'core/pages/pin.html')); return; }
  // Parent mode is off (switched off in another tab, or an old link): the PIN page turns it on.
  // (Kid in the header: the background is taking this tab to his list.)
  if (!r.parentMode) { if (globalThis.kidtubeLeaving) return; location.replace(chrome.runtime.getURL('core/pages/pin.html?for=parent')); return; }
  if (!$('run').childElementCount) { showDock(); checkDock(); }
  $('nToday').textContent = r.today.filter((v) => !v.watchedAt).length;
  $('nPlanned').textContent = r.planned.length;
  render();
}

// --- routing: #today, #planned, #history, #prompt, #settings, #v=<videoId> ----------------
const TABS = ['today', 'planned', 'history', 'context', 'prompt', 'settings'];
function route() {
  const h = location.hash.slice(1);
  const m = h.match(/^v=([A-Za-z0-9_-]{11})/);
  return m ? { video: m[1] } : { tab: TABS.includes(h) ? h : 'today' };
}
let lastTab = 'today', shownTab = null;
function render() {
  if (!data?.parentMode) return;
  const r = route();
  for (const a of document.querySelectorAll('.tabs a')) {
    a.classList.toggle('on', a.dataset.tab === (r.tab ?? lastTab));
    if (a.classList.contains('on')) a.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  }
  // Only Context in 🔳 Full screen and Prompt in 🔳 One box keep the swipe for themselves (renderContext, renderPrompt).
  view.classList.remove('noswipe');
  if (r.video) { shownTab = null; holdPage(false); return renderDetail(r.video); }
  // The settings page keeps its own state: redrawn only when you come to the tab.
  if (r.tab === 'settings' && shownTab === 'settings') return;
  // Another tab: out of 🔳 (pull-to-refresh back, full screen left); the tab's own mode sets it again when drawn.
  if (shownTab !== r.tab) { holdPage(false); scrollTo(0, 0); checkTab(r.tab); }
  lastTab = shownTab = r.tab;
  if (r.tab === 'planned') return renderPlanned();
  if (r.tab === 'history') return renderHistory();
  if (r.tab === 'context') return renderContext();
  if (r.tab === 'prompt') return renderPrompt();
  if (r.tab === 'settings') return renderSettings();
  return renderToday();
}
addEventListener('hashchange', render);

// The bottom bar as the parent asked (2026-10-09): left ↻ Update, middle Parent | Kid, right the 🎤, fixed to the
// bottom, and no time of the last update. The version moved to the header (2026-10-12).
function checkDock() {
  W?.check({ id: 'parent.dock', area: 'parent', expect: 'The bottom bar: ↻ Update on the left, Parent | Kid in the middle, 🎤 on the right, no update time',
    code: ['apps/kidtube/parent/parent.html footer.dock', 'apps/kidtube/parent/parent.js showDock'] }, (t) => {
    const dock = document.querySelector('footer.dock');
    if (!t.has('footer.dock', dock)) return;
    const box = dock.getBoundingClientRect();
    t.eq('the bar is fixed', 'fixed', getComputedStyle(dock).position);
    t.ok('the bar sits at the bottom', Math.abs(box.bottom - innerHeight) < 2, Math.round(box.bottom), `${innerHeight}`);
    t.ok('↻ Update', /Update|working|Waiting/.test($('run').textContent), $('run').textContent, 'the Update button');
    t.ok('Parent | Kid', $('mode').childElementCount > 0, 'empty', 'the switch');
    t.ok('🎤', $('mic').childElementCount > 0, 'empty', 'the notes button');
    t.ok('no update time', !/\d{1,2}:\d{2}/.test(dock.textContent), dock.textContent.trim().slice(0, 80), 'no time in the bar');
  }, 5000);
}

// A tab tapped: it is marked, and its screen has something on it.
function checkTab(tab) {
  W?.check({ id: `parent.tab.${tab}`, area: 'parent', expect: `The ${tab} tab shows its screen`,
    code: ['apps/kidtube/parent/parent.js render'] }, (t) => {
    if (route().tab !== tab) return t.skip('another tab now');
    t.eq('the marked tab', tab, document.querySelector('.tabs a.on')?.dataset.tab ?? null);
    t.ok('the screen', view.childElementCount > 0, 'empty', 'something drawn');
    // Settings uses the whole page (2026-10-08: no half-height box with its own scroll).
    if (tab === 'settings') {
      const boxed = [...view.querySelectorAll('*')].filter((n) => !/^(TEXTAREA|PRE|SELECT|INPUT|CODE)$/.test(n.tagName)
        && /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 4 && n.clientHeight < innerHeight * 0.8);
      t.ok('no box with its own scroll', !boxed.length, boxed.map((n) => `${n.tagName.toLowerCase()}.${n.className}`).slice(0, 3), 'the page scrolls');
    }
  }, 3000);
}

// Swipe left / right between the tabs (on a video's page, swipe right goes back).
let touch = null;
document.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  touch = e.touches.length === 1 && !e.target.closest?.('textarea, input, select, pre, .tabs, .noswipe') ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!touch || !data?.parentMode) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
  touch = null;
  if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
  slide(dx < 0 ? 1 : -1);
}, { passive: true });
function slide(dir) {
  const r = route();
  if (r.video) { if (dir < 0) { animate(-1); location.hash = lastTab; } return; }
  const next = TABS[TABS.indexOf(r.tab) + dir];
  if (!next) return;
  animate(dir);
  location.hash = next;
}
function animate(dir) {
  view.classList.remove('from-left', 'from-right');
  void view.offsetWidth;
  view.classList.add(dir > 0 ? 'from-right' : 'from-left');
}

// --- shared pieces ---------------------------------------------------------------------------------

async function plan(action, videoId, extra = {}) {
  const r = await ask({ type: 'plan', action, videoId, ...extra });
  if (!r?.ok) { toast('That didn’t work. Is parent mode still on?'); await refresh(); return null; }
  return r;
}

function chipsOf(v, where) {
  const c = el('div', 'chips');
  const add = (text, cls = '') => c.append(el('span', `chip ${cls}`, text));
  if (v.required) add('⭐ Must watch', 'star');
  if (where === 'today' && v.watchedAt) add('✓ Watched', 'ok');
  if (where === 'planned') add(v.approved ? '✓ Approved' : 'Idea', v.approved ? 'ok' : '');
  if (where === 'planned' && v.day) add(`Day ${v.day}`);
  if (v.tooHard) add('⚠️ maybe too hard', 'warn');
  if (v.lang && v.lang !== 'en') add(v.lang.toUpperCase());
  if (!v.hasWords) add('no words yet');
  if (v.quizCount) add(`${v.quizCount} question${v.quizCount > 1 ? 's' : ''}`);
  if (v.liked === true) add('👍'); if (v.liked === false) add('👎');
  if (v.notes) add(`📝 ${v.notes}`);
  return c;
}

function thumbOf(v, big = false) {
  const t = el('button', 'thumb');
  const img = Object.assign(document.createElement('img'), { src: v.thumbnailUrl, alt: '', loading: 'lazy' });
  t.append(img);
  if (v.durationSeconds && !big) t.append(el('span', 'len', mins(v.durationSeconds)));
  if (v.required && !big) t.append(el('span', 'star', '⭐'));
  return t;
}

const open = (v) => { location.hash = `v=${v.videoId}`; };

// Card actions for each list.
function actionsFor(v, where, { onDone = refresh } = {}) {
  const a = el('div', 'actions');
  if (where === 'today' || where === 'planned') {
    a.append(btn(v.required ? '⭐ Must watch' : '☆ Must watch', async () => {
      if (await plan('required', v.videoId, { value: !v.required })) { toast(v.required ? 'Not a must-watch any more.' : 'Now a must-watch ⭐'); await onDone(); }
    }, v.required ? 'on' : ''));
  }
  if (where === 'planned') {
    a.append(btn(v.approved ? '✓ Approved' : 'Approve', async () => {
      if (await plan('approve', v.videoId, { value: !v.approved })) { toast(v.approved ? 'Approval taken back.' : 'Approved ✓'); await onDone(); }
    }, v.approved ? 'ok' : ''));
    a.append(btn('→ Today', async () => {
      if (await plan('today', v.videoId)) { toast('On today’s list now.', () => plan('notToday', v.videoId, { refill: false })); await onDone(); }
    }));
    a.append(btn('✕ Remove', async () => {
      if (await plan('drop', v.videoId)) { toast('Removed from the plan.', () => plan('restore', v.videoId)); await onDone(); }
    }));
  }
  if (where === 'today') {
    a.append(btn('✕ Remove', async () => {
      const r = await plan('notToday', v.videoId);
      if (!r) return;
      const next = r.added ? data.planned.find((p) => p.videoId === r.added)?.title : null;
      toast(next ? `Removed. Next from the plan: “${next}”` : 'Removed from today (back to Planned).', async () => {
        await plan('today', v.videoId, { refill: false });
        if (r.added) await plan('notToday', r.added, { refill: false });
      });
      await onDone();
    }));
  }
  if (where === 'history') {
    a.append(btn('👍', async () => { await ask({ type: 'note', videoId: v.videoId, liked: true }); toast('👍 saved'); await onDone(); }, v.liked === true ? 'ok' : ''));
    a.append(btn('👎', async () => { await ask({ type: 'note', videoId: v.videoId, liked: false }); toast('👎 saved'); await onDone(); }, v.liked === false ? 'on' : ''));
  }
  return a;
}

function row(v, where) {
  const r = el('div', `row${where === 'today' && v.watchedAt ? ' done' : ''}`);
  const t = thumbOf(v);
  t.addEventListener('click', () => open(v));
  const info = el('div');
  const title = el('div', 'title', v.title);
  title.addEventListener('click', () => open(v));
  const meta = [v.channelTitle, mins(v.durationSeconds), where === 'history' && v.at ? `at ${when(v.at)}` : '',
    where === 'today' && v.watchedAt ? `watched ${new Date(v.watchedAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''].filter(Boolean).join(' · ');
  info.append(title, el('div', 'meta', meta), chipsOf(v, where));
  if (where === 'history' && v.watchedSeconds != null) {
    const ended = { ended: 'to the end', leftAfterLock: 'left early', closeAfter: 'time for this video was up', timeUp: 'daily time ran out', closed: 'closed', blockedOnLoad: 'blocked' }[v.endReason] ?? '';
    info.append(el('div', 'meta', `Watched ${mins(v.watchedSeconds) || 'under a minute'}${v.durationSeconds ? ` of ${mins(v.durationSeconds)}` : ''}${ended ? ` · ${ended}` : ''}`));
  }
  for (const q of v.quiz ?? []) info.append(el('div', 'quizline', `${q.result === 'passed' ? '✅' : q.result === 'failed' ? '❌' : '⏭️'} ${q.prompt || q.quizId}${q.attempts > 1 ? ` (${q.attempts} tries)` : ''}`));
  if (where === 'planned' && v.why) info.append(el('div', 'why', v.why));
  info.append(actionsFor(v, where));
  r.append(t, info);
  return r;
}

function syncLine() {
  const bits = [];
  if (!data.hasToken) bits.push('No GitHub token for this account yet: changes stay on this tablet (the header’s account menu → GitHub connection).');
  else if (data.waiting) bits.push(`${data.waiting} change${data.waiting > 1 ? 's' : ''} waiting to upload.`);
  if (data.sync?.errors?.length) bits.push(`Sync problem: ${data.sync.errors[0]}`);
  else if (data.sync?.notes?.length) bits.push(data.sync.notes[0]);
  return el('p', 'muted', bits.join(' '));
}

// --- the three lists -------------------------------------------------------------------------------

// The day at a glance: videos watched, minutes used, must-watch videos left.
function stat(value, unit, label, { bar = null, tone = '' } = {}) {
  const box = el('div', `stat${tone ? ` ${tone}` : ''}`);
  const b = el('b', '', String(value));
  if (unit) b.append(el('small', '', ` ${unit}`));
  box.append(b, el('span', '', label));
  if (bar != null) { const track = el('div', 'bar'); const fill = el('i'); fill.style.width = `${Math.round(Math.max(0, Math.min(1, bar)) * 100)}%`; track.append(fill); box.append(track); }
  return box;
}
function statsRow() {
  const vs = data.today;
  const watched = vs.filter((v) => v.watchedAt).length;
  const stars = vs.filter((v) => v.required), starsLeft = stars.filter((v) => !v.watchedAt).length;
  const m = data.minutes ?? { played: 0, max: 0 };
  const used = m.max ? m.played / m.max : 0;
  const row = el('div', 'stats');
  row.append(
    stat(watched, `of ${vs.length}`, 'videos watched today', { bar: vs.length ? watched / vs.length : 0 }),
    stat(m.played, m.max ? `of ${m.max} min` : 'min', m.stopped ? 'minutes · stopped for today' : m.max ? 'minutes of screen time' : 'minutes, no limit set',
      { bar: m.max ? used : null, tone: m.stopped || used >= 1 ? 'bad' : used >= .8 ? 'warn' : '' }),
    stat(starsLeft, stars.length ? `of ${stars.length}` : '', 'must-watch ⭐ left', { bar: stars.length ? 1 - starsLeft / stars.length : null }),
  );
  return row;
}

function renderToday() {
  const vs = data.today;
  const head = el('div', 'box');
  head.append(el('h2', '', 'What he sees today'),
    el('p', 'muted', 'His list in his order: the first unwatched videos, then the ones he watched. Removing a video brings the next planned one in.'),
    syncLine());
  view.replaceChildren(statsRow(), head, ...(vs.length ? vs.map((v) => row(v, 'today')) : [el('p', 'muted', 'Nothing on today’s list.')]));
}

function renderPlanned() {
  const head = el('div', 'box');
  head.append(el('h2', '', 'Planned and ideas'),
    el('p', 'muted', data.hasMemory ? 'The helper’s next picks, in its order. Approve, make a must-watch, move to today or remove. The helper reads your changes on its next run.'
      : 'Planned videos show here once the tablet has the helper’s notes (memory.json; needs the GitHub token).'),
    syncLine());
  view.replaceChildren(head, ...(data.planned.length ? data.planned.map((v) => row(v, 'planned')) : [el('p', 'muted', 'Nothing planned yet.')]));
}

function renderHistory() {
  const head = el('div', 'box');
  head.append(el('h2', '', 'What he watched'), el('p', 'muted', 'By day. Tap a video to see its questions and how he answered.'));
  const parts = [head];
  for (const d of data.history) {
    const h = el('div', 'day');
    h.append(el('h2', '', dayLabel(d.date)), el('span', 'muted', `${d.items.length} video${d.items.length === 1 ? '' : 's'}${d.minutes ? ` · ${d.minutes} min` : ''}`));
    parts.push(h, ...d.items.map((v) => row(v, 'history')));
  }
  if (!data.history.length) parts.push(el('p', 'muted', 'Nothing watched yet.'));
  view.replaceChildren(...parts);
}

// --- Prompt: how the helper works, its settings, its prompt, and your changes to it ------------------

const DAYS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const ORDER = { first: 'must-watch videos first, the others wait', mix: 'one must-watch, then one free choice', off: 'the ⭐ is only a mark' };
const ON_FAIL = { continue: 'he goes on', rewatch: 'he watches it again (once a day)', stopForToday: 'no more videos today' };

// "30 3 * * *" in UTC → "every day at 06:30" in this tablet's time.
function scheduleText(cron, tz) {
  const m = String(cron).match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (!m) return `cron “${cron}” (${tz})`;
  const d = new Date();
  if (tz === 'UTC') d.setUTCHours(Number(m[2]), Number(m[1]), 0, 0); else d.setHours(Number(m[2]), Number(m[1]), 0, 0);
  return `every day at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (your time; ${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')} ${tz})`;
}

function table(rows) {
  const dl = el('dl', 'kv');
  for (const [k, v] of rows) if (v !== undefined && v !== null && v !== '') dl.append(el('dt', '', k), el('dd', '', String(v)));
  return dl;
}
function fold(title, ...body) {
  const d = el('details', 'fold');
  d.append(el('summary', '', title), ...body);
  return d;
}

// The parent's notes (2026-10-13): the tab in boxes, each with where its words come from, how the helper uses them
// and why the box is here (ABOUT); a first box shows how it all fits together, and the last one every prompt it reads.
// 🔳 One box as in Settings: one box on the whole screen, a swipe up (or ↓) for the next. A double tap on a text of a
// prompt (or of what it noticed, its study plan) makes it editable: Save sends the change as a note (kit.js editOnDoubleTap).
const ABOUT = {
  flow: { chip: 'Overview', from: 'This app: how the helper is built (agent/ on the server).', used: 'Not by the helper: it is for you.', why: 'The whole picture first: who starts it, what it reads, what it makes.' },
  runs: { chip: 'Runs', from: 'The server’s run log and the helper’s diary (memory.json).', used: 'The diary is read on the next run, so it remembers what it did.', why: 'To see that it ran, how long it took and what it cost.' },
  noticed: { chip: 'Noticed', from: 'The helper writes it in memory.json (step “notes”).', used: 'Read on every run when it picks videos and writes questions.', why: 'What it has learned about him. Double-tap a paragraph to correct it.' },
  plan: { chip: 'Study plan', from: 'The helper writes it in memory.json every few days.', used: 'It picks the subjects of new videos from it.', why: 'The longer view. Double-tap a paragraph to change it.' },
  messages: { chip: 'Messages', from: 'Your 🎤 notes on the other tabs, kept in memory.json.', used: 'Read on every run; your words win over its own ideas.', why: 'So you see what it still keeps in mind.' },
  changes: { chip: 'Your changes', from: 'Your 🎤 notes on this tab, and your edits (double tap).', used: 'Added to its prompt on every run. The AI on the server may also change the prompt files with them.', why: 'Your standing rules for the helper, with Remove.' },
  steps: { chip: 'Steps', from: 'agent/DAILY.md in the code (GitHub).', used: 'The order of every run: it does step 1, then step 2…', why: 'What it does, step by step. Double-tap a text to change it.' },
  skills: { chip: 'Skills', from: '.claude/skills/helper-*/SKILL.md in the code.', used: 'Loaded only when the run reaches that step: the long how-to for it.', why: 'The details of the big steps. Double-tap a text to change it.' },
  settings: { chip: 'Settings', from: 'agent/config.json on the server, and the Settings tab on this tablet.', used: 'Its numbers (how many videos, questions, voices) and the tablet’s rules.', why: 'To change one: the Settings tab, or a 🎤 note here.' },
  io: { chip: 'Reads & writes', from: 'helper.json: made from agent/kt.mjs (its toolkit) on every run.', used: 'The toolkit is the only way it reads and changes the data.', why: 'What it may touch, and what it can’t.' },
  prompts: { chip: 'All prompts', from: 'The prompt files in the code (GitHub), as the last run used them.', used: 'Rules first, then the steps, then your changes; the skills at their steps.', why: 'Every prompt in full. Double-tap a text to change it.' },
};
let promptFull = false, promptAt = 'flow', promptStep = 0;
let promptDraw = null;   // redraws the boxes of the page on the screen (renderPrompt)

function aboutBox(a) {
  const dl = el('dl', 'about');
  for (const [k, v] of [['From', a.from], ['Used', a.used], ['Why', a.why]]) dl.append(el('dt', '', k), el('dd', '', v));
  return dl;
}
// Markdown that can be edited with a double tap: source names the file the words are in.
const editable = (md, source) => { const n = renderMarkdown(md); n.dataset.source = source; return n; };

async function renderPrompt() {
  const h = await ask({ type: 'helperData' });
  if (route().tab !== 'prompt') return;
  if (!h?.ok) { view.replaceChildren(el('p', 'err', 'Could not load the helper’s description.')); return; }
  const info = h.info;
  const boxes = [];
  const box = (id, title, ...body) => { const b = el('div', 'box pbox'); b.dataset.box = id; b.append(el('h2', '', title), aboutBox(ABOUT[id]), ...body); boxes.push(b); return b; };
  const run = info?.run;

  // 0. How it all fits together.
  const flow = el('ol', 'flow');
  flow.append(...[
    `The server starts it ${run ? scheduleText(run.schedule, run.timezone) : 'every night'}, or when you tap ↻ Update.`,
    run?.runner === 'node' ? 'The fixed program (agent/run.mjs) does the steps with OpenRouter text models.'
      : `Claude Code${run?.model ? ` (${run.model})` : ''} reads its rules (agent/SYSTEM.md), then the steps (agent/DAILY.md), with your changes added at the end.`,
    'At the big steps it loads a skill: the long how-to for finding videos, for writing the words and questions, and for its notes.',
    'It works only through its toolkit (node agent/kt.mjs): it reads what he watched and your notes, searches YouTube, asks Gemini to watch a video, and saves.',
    'It saves the lists and the words to GitHub (kidtube-data). This tablet gets them on its next sync.',
    'Your 🎤 notes go another way too: within minutes the AI on the server (agent/NOTES.md) reads them, changes the app or these prompts, and answers your questions.',
  ].map((t) => el('li', '', t)));
  box('flow', 'How it all fits together', flow);

  // 1. When and how it runs.
  const howBody = [];
  if (run) {
    howBody.push(el('p', '', `Runs ${scheduleText(run.schedule, run.timezone)}. ${run.runner === 'claude'
      ? `Claude Code (${run.model}) reads the prompt and does the work with its toolkit${run.maxTurns ? `, in up to ${run.maxTurns} steps` : ''}.`
      : 'The fixed program (agent/run.mjs) does the work with OpenRouter text models.'}${run.fallbackToNode ? ' If Claude can’t run and nothing was saved that day, the backup program does the same steps with OpenRouter models.' : ''}`));
  } else {
    howBody.push(el('p', 'muted', h.hasToken ? 'The helper hasn’t published its description yet. It does on its next run.' : 'Needs the GitHub token for this account (the header’s account menu → GitHub connection).'));
  }
  howBody.push(el('p', 'muted', h.lastRunAt ? `Last run: ${new Date(h.lastRunAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. It had read the tablets up to ${h.processedThrough ? new Date(h.processedThrough).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}.` : 'No run seen yet.'));
  if (h.runs?.length) {
    const ul = el('ul', 'notes');
    ul.append(...h.runs.slice(0, 7).map((r) => el('li', '', `${new Date(r.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${r.kind === 'request' ? 'on request' : 'nightly'} · ${r.ok ? 'ok' : 'failed'}${r.minutes != null ? ` · ${r.minutes} min` : ''}${r.turns != null ? ` · ${r.turns} steps` : ''}${r.costUsd != null ? ` · $${r.costUsd}` : ''}`)));
    howBody.push(fold('Latest runs (time, steps, cost)', ul));
  }
  if (h.journal[0]) {
    howBody.push(el('h3', '', 'Its latest diary'), el('p', '', h.journal[0].summary));
    if (h.journal.length > 1) howBody.push(fold('Earlier days', ...h.journal.slice(1).map((j) => el('p', '', `${new Date(j.at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}: ${j.summary}`))));
  }
  box('runs', 'When it runs, and its diary', ...howBody);

  // What it learned about him, its study plan, and the messages it has from you (all in memory.json).
  if (h.noticed) box('noticed', 'What it noticed', editable(h.noticed, 'memory.json (what it noticed)'));
  if (h.studyPlan) box('plan', 'Study plan', ...(h.studyPlanAt ? [el('p', 'muted', `Written ${new Date(h.studyPlanAt).toLocaleDateString()}.`)] : []), editable(h.studyPlan, 'memory.json (the study plan)'));
  if (h.messages?.length) {
    const ul = el('ul', 'notes');
    ul.append(...h.messages.map((m) => el('li', '', `${m.at.slice(0, 10)}: ${m.aboutList ? `(${m.aboutList}) ` : ''}${m.text}`)));
    box('messages', 'Your messages it keeps in mind', ul);
  }

  // 2. Your changes to the prompt.
  box('changes', 'Your changes to the prompt', ...promptNotesBox(h.notes, () => { if (route().tab === 'prompt') renderPrompt(); }));

  // 3. The run, step by step (straight from the prompt).
  if (info?.prompt) {
    const { steps, after } = promptSteps(info.prompt);
    const daily = info.prompts?.[1]?.file ?? 'agent/DAILY.md';
    const ol = el('div', 'steps');
    for (const st of steps) {
      const d = el('details', 'step');
      const sum = el('summary');
      sum.append(el('span', 'n', String(st.n)), el('span', '', st.title));
      d.append(sum, editable(st.body, `${daily} (step ${st.n}, ${st.title})`));
      ol.append(d);
    }
    box('steps', 'What it does, step by step', el('p', 'muted', 'Tap a step to see exactly what the prompt tells it.'), ol, ...(after ? [editable(after, daily)] : []));
  }
  if (info?.skills?.length) {
    box('skills', 'Step details (skills)', ...info.skills.map((s) => fold(s.text.match(/^# (.+)/m)?.[1] ?? s.name,
      el('p', 'muted', `${s.file ?? `.claude/skills/${s.name}/SKILL.md`}`), editable(s.text.replace(/^# .+\n/, ''), s.file ?? `.claude/skills/${s.name}/SKILL.md`))));
  }

  // 4. The settings it uses.
  const r = h.rules;
  const setBody = [];
  if (info) {
    const d = info.defaults ?? {};
    setBody.push(el('h3', '', 'Its numbers'), el('p', 'muted', 'Videos per day follows “Videos on the home screen” in Settings. Your messages and prompt notes win over the others.'), table([
      ['Videos per day', r?.queueSize ?? d.videosPerDay], ['New ideas per day', d.newIdeas],
      ['Language minimums', Object.entries(d.languageMins ?? {}).map(([l, n]) => `${l}: ${n}`).join(', ') || 'none'],
      ['Must-watch order', ORDER[d.requiredFirst] ?? d.requiredFirst], ['Questions per video', d.maxQuestions],
      ['Results per search', d.searchResults], ['Videos it writes words for per run', d.contentPerRun], ['New study plan every', d.planEveryDays ? `${d.planEveryDays} days` : ''],
    ]));
    const t = info.transcripts ?? {};
    setBody.push(el('h3', '', 'Watching videos (transcripts)'), table([
      ['Done by', t.provider === 'gemini' ? 'Google Gemini (free tier), from the public video link' : t.provider],
      ['Per day', `${t.maxVideosPerDay ?? '—'} videos, ${t.maxMinutesPerDay ?? '—'} minutes of video`], ['Waits per model', t.secondsPerRequest ? `${t.secondsPerRequest} s` : ''],
      ['Models, in order', (t.models ?? []).join(', ')],
    ]));
    const v = info.voices ?? {};
    setBody.push(el('h3', '', 'The friend’s recorded voice'), table([
      ['Made by', { device: 'nobody: the tablet speaks every line itself', gemini: 'Gemini speech (free)', openrouter: 'OpenRouter (paid)' }[v.provider] ?? v.provider],
      ['Voice', v.voice], ['Time it may spend per run', v.maxMinutes ? `${v.maxMinutes} min (the rest is spoken by the tablet)` : ''], ['How it sounds', v.style], ['Models', (v.models ?? []).join(', ')],
    ]));
    const b = info.backupText ?? {};
    setBody.push(fold('Backup program (if Claude can’t run)', table([['OpenRouter mode', b.mode], ['Preferred models', (b.preferred ?? []).join(', ')], ['Paid model', b.paidModel ?? 'none'], ['Max calls per run', b.maxCallsPerRun]])));
  }
  setBody.push(el('h3', '', 'Tablet rules it reads (Settings tab)'), table([
    ['Watching hours', r.hours.map((w) => `${w.days.length === 7 ? 'every day' : w.days.map((x) => DAYS[x] ?? x).join(' ')} ${w.from}–${w.to}`).join('; ')],
    ['Minutes per day', r.maxMinutesPerDay || 'no limit'], ['Videos on the home screen', r.queueSize], ['Must-watch order', ORDER[r.requiredFirst] ?? r.requiredFirst],
    ['Video length', `${r.minVideoMinutes || 0}–${r.maxVideoMinutes || '∞'} min`], ['Must watch before switching', `${r.minSecondsBeforeLeave} s`], ['Skipping inside a video', r.allowSkip ? 'allowed' : 'off'],
    ['Questions', r.quiz.enabled ? `on, ${r.quiz.maxAttempts} tries, then ${ON_FAIL[r.quiz.onFail] ?? r.quiz.onFail}` : 'off'],
    ['Talking friend', `${r.friend.name}: ${[r.friend.intro && 'hello before', r.friend.outro && 'what we learned after'].filter(Boolean).join(', ') || 'quiet'}${r.friend.recorded ? ', recorded voice' : ''}`],
    ['Hearing his answers', r.friend.listen], ['Other websites', r.blockSites ? 'blocked' : 'open'],
  ]));
  box('settings', 'Settings it uses', ...setBody);

  // 5. What it reads and writes, its toolkit, and every prompt in full.
  if (info) {
    const ul = (items) => { const u = el('ul'); u.append(...items.map((x) => el('li', '', x))); return u; };
    box('io', 'What it reads and writes', el('h3', '', 'Reads'), ul(info.reads ?? []), el('h3', '', 'Writes'), ul(info.writes ?? []),
      fold(`Its toolkit (${(info.commands ?? []).length} commands)`, table((info.commands ?? []).map((c) => [c.command, c.what]))));
    // Helpers before 0.12.25 published the rules and the steps as one text.
    const prompts = info.prompts?.length ? info.prompts : [{ file: 'agent/SYSTEM.md + agent/DAILY.md', title: 'The prompt', when: 'Read on every run.', text: info.prompt }];
    const one = (title, file, when, text) => fold(title, el('p', 'muted', `${file} · ${when}`), editable(text, file));
    box('prompts', 'All its prompts', el('p', 'muted', `As the helper used them${info.updatedAt ? ` (published ${new Date(info.updatedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})` : ''}. Tap one to read it.`),
      ...prompts.map((p) => one(p.title, p.file, p.when, p.text)),
      ...(info.skills ?? []).map((s) => one(`Skill: ${s.text.match(/^# (.+)/m)?.[1] ?? s.name}`, s.file ?? `.claude/skills/${s.name}/SKILL.md`, 'Loaded when the run reaches its step.', s.text.replace(/^# .+\n/, ''))),
      fold('Your changes', el('p', 'muted', `memory.json (promptNotes) · Added after the steps on every run. ${h.notes.length ? `${h.notes.length} now: see “Your changes to the prompt”.` : 'None yet.'}`)));
  }

  // The chips: one per box (a tap goes to it), and 🔳 One box as in Settings.
  const chips = el('div', 'chips noswipe pchips');
  const full = btn(promptFull ? '✕ All boxes' : '🔳 One box', () => { promptFull = !promptFull; holdPage(promptFull, true); draw(); if (!promptFull) boxes.find((b) => b.dataset.box === promptAt)?.scrollIntoView({ block: 'start' }); }, promptFull ? 'small slidebtn on' : 'small slidebtn');
  full.title = 'One box at a time, full screen: swipe up for the next box';
  const pager = el('div', 'pager');
  function draw(step = 0) {
    const ids = boxes.map((b) => b.dataset.box);
    if (!ids.includes(promptAt)) promptAt = ids[0];
    const at = ids.indexOf(promptAt);
    full.textContent = promptFull ? '✕ All boxes' : '🔳 One box';
    full.className = promptFull ? 'small slidebtn on' : 'small slidebtn';
    chips.replaceChildren(full, ...boxes.map((b) => btn(ABOUT[b.dataset.box].chip, () => {
      promptAt = b.dataset.box;
      if (promptFull) { scrollTo(0, 0); draw(); } else b.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, promptFull && b.dataset.box === promptAt ? 'small primary' : 'small')));
    // In 🔳 One box a swipe goes to the next box, not to the next tab (the tabs' swipe skips .noswipe).
    view.classList.toggle('noswipe', promptFull);
    holdPage(promptFull);
    for (const b of boxes) b.hidden = promptFull && b.dataset.box !== promptAt;
    pager.hidden = !promptFull;
    pager.replaceChildren(el('span', '', `${at + 1} of ${boxes.length} · ${boxes[at].querySelector('h2').textContent} · ${at < boxes.length - 1 ? 'swipe up for the next' : 'the last box: swipe down for the one before'}`));
    if (promptFull && step) slideIn(boxes[at], step);
    if (promptFull) checkPromptFull();
  }
  view.replaceChildren(chips, pager, ...boxes);
  promptDraw = (step) => { if (chips.isConnected) draw(step); };
  draw(promptStep);
  promptStep = 0;
}
// A swipe up (or ↓): the next box; down (or ↑): the one before (only in 🔳 One box).
upDown(view, { on: () => promptFull && route().tab === 'prompt' && !route().video, box: () => view.querySelector('.box.pbox:not([hidden])'), skip: '.chips', go: (step) => {
  const ids = [...view.querySelectorAll('.box.pbox')].map((b) => b.dataset.box);
  const i = ids.indexOf(promptAt) + step;
  if (i < 0 || i >= ids.length) return;
  promptAt = ids[i];
  scrollTo(0, 0);
  promptDraw?.(step);
} });
function checkPromptFull() {
  globalThis.KidTubeWatch?.check({ id: 'parent.prompt.oneBox', area: 'parent', expect: '🔳 One box on the Prompt tab shows one box on the whole screen, its chip marked, each box says where it comes from',
    code: ['apps/kidtube/parent/parent.js renderPrompt'] }, (t) => {
    if (route().tab !== 'prompt' || !promptFull) return t.skip('left the mode');
    const seen = [...view.querySelectorAll('.box.pbox')].filter((b) => !b.hidden);
    t.eq('boxes on the screen', 1, seen.length);
    t.eq('the box', promptAt, seen[0]?.dataset.box ?? null);
    t.eq('the marked chip', ABOUT[promptAt]?.chip, view.querySelector('.pchips .primary')?.textContent ?? null);
    t.ok('From, Used, Why', seen[0]?.querySelectorAll('.about dt').length === 3, seen[0]?.querySelectorAll('.about dt').length, '3 lines');
    t.eq('a swipe down is the box before, not a reload', 'none', getComputedStyle(document.documentElement).overscrollBehaviorY);
    t.eq('nothing on top (no apps header, notifications or tabs)', 'none', getComputedStyle(document.querySelector('body > header') ?? document.body).display);
  }, 1500);
}

// --- Context: the documents the helper plans from (kidtube-data context/*.md) ---------------------------
// The parent's note (2026-10-13): no "Your notes on this document" box (a chip still counts the notes waiting), and
// 🔳 Full screen as in Settings: the document fills the screen, a swipe up (or ↓) goes to the next document.
const CONTEXT = [['kid', 'About him'], ['strategy', 'Strategy'], ['math', 'Math'], ['letters', 'Letters'], ['world', 'World']];
let contextDoc = 'kid';
let contextFull = false;
async function renderContext() {
  const c = await ask({ type: 'contextData' });
  if (route().tab !== 'context') return;
  if (!c?.ok) { view.replaceChildren(el('p', 'err', 'Could not load the context documents.')); return; }
  const at = CONTEXT.findIndex(([id]) => id === contextDoc);
  const chips = el('div', 'chips noswipe');
  const full = btn(contextFull ? '✕ Exit full screen' : '🔳 Full screen', () => { contextFull = !contextFull; holdPage(contextFull, true); renderContext(); }, contextFull ? 'small slidebtn on' : 'small slidebtn');
  full.title = 'The document on the whole screen: swipe up for the next document';
  chips.append(full);
  for (const [id, name] of CONTEXT) {
    const n = c.notes.filter((x) => x.doc === id).length;
    chips.append(btn(n ? `${name} · ${n}` : name, () => { contextDoc = id; renderContext(); }, id === contextDoc ? 'small primary' : 'small'));
  }
  const doc = c.docs[contextDoc];
  const body = el('div', contextFull ? 'box doc full' : 'box doc');
  // A double tap on a paragraph edits it (the parent's note, 2026-10-13): the change goes as a note on this document.
  body.append(doc?.text ? editable(doc.text, `context/${contextDoc}.md`) : el('p', 'muted', 'Not written yet. It appears after the next sync, or the helper writes it on its next run.'));
  // In 🔳 Full screen a swipe goes to the next document, not to the next tab (the swipe below; the tabs' swipe skips .noswipe).
  view.classList.toggle('noswipe', contextFull);
  holdPage(contextFull);
  if (!contextFull) { view.replaceChildren(chips, body); return; }
  const pager = el('div', 'pager');
  pager.append(el('span', '', `${at + 1} of ${CONTEXT.length} · ${CONTEXT[at][1]} · ${at < CONTEXT.length - 1 ? 'swipe up for the next' : 'the last one: swipe down for the one before'}`));
  view.replaceChildren(chips, pager, body);
  if (contextStep) slideIn(body, contextStep);
  contextStep = 0;
  globalThis.KidTubeWatch?.check({ id: 'parent.context.full', area: 'parent', expect: '🔳 Full screen shows the chosen document on the whole screen, its chip marked',
    code: ['apps/kidtube/parent/parent.js renderContext'] }, (t) => {
    if (route().tab !== 'context' || !contextFull) return t.skip('left the mode');
    t.eq('documents on the screen', 1, view.querySelectorAll('.box.doc').length);
    t.eq('the marked chip', CONTEXT.find(([id]) => id === contextDoc)[1], view.querySelector('.chips .primary')?.textContent.replace(/ · \d+$/, '') ?? null);
    t.ok('fills the screen', view.querySelector('.box.doc')?.getBoundingClientRect().height >= innerHeight * 0.5, 'small', 'at least half the screen');
    t.eq('no notes box', 0, [...view.querySelectorAll('h2')].filter((h) => /Your notes/.test(h.textContent)).length);
    t.eq('no ‹ › buttons (a swipe up or down)', 0, view.querySelectorAll('.pager button').length);
    t.eq('a swipe down is the document before, not a reload', 'none', getComputedStyle(document.documentElement).overscrollBehaviorY);
    t.eq('nothing on top (no apps header, notifications or tabs)', 'none', getComputedStyle(document.querySelector('body > header') ?? document.body).display);
  }, 1500);
}
let contextStep = 0;
// A swipe up (or ↓): the next document; down (or ↑): the one before (only in 🔳 Full screen; the parent's note, 2026-10-13).
upDown(view, { on: () => contextFull && route().tab === 'context' && !route().video, box: () => view.querySelector('.box.doc'), skip: '.chips', go: (step) => {
  const i = CONTEXT.findIndex(([id]) => id === contextDoc) + step;
  if (i < 0 || i >= CONTEXT.length) return;
  contextDoc = CONTEXT[i][0];
  contextStep = step;
  scrollTo(0, 0);
  renderContext();
} });

// A double tap on a text of the Prompt or Context tab: the change goes as a note, like one from the 🎤 (kit.js startEdit).
editOnDoubleTap(view, (text) => (route().tab === 'context' ? ask({ type: 'contextNote', doc: contextDoc, text })
  : route().tab === 'prompt' ? ask({ type: 'promptNote', action: 'add', text }) : { ok: false }));

// --- Settings: its own view here (settings.js; no second PIN in parent mode) ---------------------

function renderSettings() {
  const box = el('div');
  view.replaceChildren(box);
  mountSettings(box);
}

// --- one video ---------------------------------------------------------------------------------------

let detailFor = null;
async function renderDetail(videoId) {
  detailFor = videoId;
  const d = await ask({ type: 'videoDetail', videoId });
  if (detailFor !== videoId) return;
  scrollTo(0, 0);
  if (!d?.ok) { view.replaceChildren(el('p', 'err', 'Could not load this video.')); return; }
  const back = btn('‹ Back', () => { location.hash = lastTab; }, 'back ghost');

  const hero = el('div', 'hero');
  const t = thumbOf(d, true);
  t.append(el('span', 'play', '▶'));
  t.title = 'Watch it yourself (doesn’t count for him)';
  t.addEventListener('click', () => ask({ type: 'watchHere', videoId }));
  const side = el('div');
  const whereText = { today: 'On today’s list', planned: 'Planned', watched: 'Watched', removed: 'Removed', other: '' }[d.where];
  side.append(el('h2', '', d.title), el('div', 'meta', [d.channelTitle, mins(d.durationSeconds), whereText].filter(Boolean).join(' · ')), chipsOf(d, d.where === 'watched' ? 'history' : d.where));
  const where = d.where === 'watched' ? 'history' : d.where;
  const again = async () => { await refresh(); };
  if (['today', 'planned', 'history'].includes(where)) side.append(actionsFor(d, where, { onDone: again }));
  const more = el('div', 'actions');
  if (d.where === 'removed') more.append(btn('Put back in the plan', async () => { if (await plan('restore', videoId)) { toast('Back in the plan.'); await again(); } }));
  more.append(btn('▶ Watch it yourself', () => ask({ type: 'watchHere', videoId }), 'primary'));
  side.append(more);
  hero.append(t, side);

  const sections = [];
  const section = (title, ...body) => { const b = el('div', 'box'); b.append(el('h3', '', title), ...body); sections.push(b); return b; };
  const list = (items) => { const u = el('ul'); u.append(...items.map((x) => el('li', '', x))); return u; };

  section('Why it’s on the list', el('p', '', d.why || 'No reason written.'));
  if (d.learned.length) section('Why he should watch it: what he learns', list(d.learned));
  section('Summary', el('p', '', d.summary || (d.hasWords ? 'No summary.' : 'The helper hasn’t written about this video yet.')),
    ...(d.madeFrom ? [el('p', 'muted', d.madeFrom === 'transcript' ? 'Written from the video’s transcript.' : 'Written from the title only (no transcript yet).')] : []));
  if (d.tooHard) section('⚠️ Maybe too hard', el('p', '', d.tooHard));
  const speakLine = (line, lang) => {
    const b = btn('🔊', async () => {
      // the helper's recording, or one made on this tablet (Groq, then Gemini): never the device's own voice
      const url = line.audioRef ? await recordedUrl(line.audioRef) : null;
      try { await say(url ? { ...line, audioUrl: url } : line, { lang: lang || d.friend.voice.lang }); }
      finally { if (url) URL.revokeObjectURL(url); }
    });
    b.title = `Hear ${d.friend.name}`;
    return b;
  };
  const talk = (line) => { const l = el('div', 'line'); l.append(el('p', '', line.text), speakLine(line)); return l; };
  section(`Intro: what ${d.friend.name} says before`, d.intro ? talk(d.intro) : el('p', 'muted', 'None yet: he hears a short hello.'));
  section(`Outro: what ${d.friend.name} says after`, d.outro ? talk(d.outro) : el('p', 'muted', 'None yet: he hears “well done”.'));
  sections.push(quizBox(d, speakLine));
  if (d.talkAbout.length) section('Things to talk about with him', list(d.talkAbout));
  if (d.history.length) {
    section('When he watched it', list(d.history.map((h) => `${new Date(h.at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}: ${mins(h.watchedSeconds) || 'under a minute'}${(h.quiz ?? []).length ? ` · questions ${h.quiz.map((q) => (q.result === 'passed' ? '✅' : q.result === 'failed' ? '❌' : '⏭️')).join('')}` : ''}`)));
  }
  if (d.helperNotes.length) section('Your earlier comments the helper has', list(d.helperNotes));

  view.replaceChildren(back, hero, ...sections);
}

// The questions, and a try of the quiz the way he gets it (without the friend's screen).
function quizBox(d, speakLine) {
  const box = el('div', 'box');
  box.append(el('h3', '', 'Questions'));
  if (!d.items.length) { box.append(el('p', 'muted', 'No questions for this video yet.')); return box; }
  const overview = el('div');
  for (const it of d.items) {
    const q = el('div', 'q');
    const l = el('div', 'line');
    l.append(el('p', 'prompt', it.prompt), speakLine({ text: it.prompt, audioRef: it.audioRef }, it.lang));
    const answer = it.answer.kind === 'choice' ? `Choices: ${it.answer.options.join(' · ')} — right: ${it.answer.correct}` : `Accepted answers: ${it.answer.accept.join(', ')}`;
    q.append(l, el('p', 'muted', `${it.type === 'voice' ? 'He says it' : it.type === 'choice' ? 'He taps it' : 'He types it'} · ${answer}`));
    overview.append(q);
  }
  const tryIt = btn('Try the quiz yourself', () => runQuiz(d, box, speakLine), 'primary');
  box.append(overview, tryIt);
  return box;
}

function runQuiz(d, box, speakLine) {
  let i = 0, right = 0;
  const stage = el('div');
  box.replaceChildren(el('h3', '', 'Try the quiz'), stage);
  const next = () => {
    if (i >= d.items.length) {
      stage.replaceChildren(el('p', 'result ok', `${right} of ${d.items.length} right.`), btn('Try again', () => { i = 0; right = 0; next(); }), btn('Show the questions', () => box.replaceWith(quizBox(d, speakLine))));
      return;
    }
    const it = d.items[i];
    const q = el('div', 'q');
    const l = el('div', 'line');
    l.append(el('p', 'prompt', `${i + 1}. ${it.prompt}`), speakLine({ text: it.prompt, audioRef: it.audioRef }, it.lang));
    const out = el('div', 'result');
    let tries = 0;
    const max = 3;
    const check = (given, spoken = false) => {
      tries++;
      if (isCorrect(it, given, { spoken })) { right++; out.className = 'result ok'; out.textContent = '✅ Right!'; done(); return; }
      out.className = 'result bad';
      out.textContent = tries >= max ? `❌ The answer is “${correctText(it)}”.` : `❌ Not quite${spoken ? ` (heard “${[].concat(given)[0] ?? ''}”)` : ''}. Try again (${max - tries} left).`;
      if (tries >= max) done();
    };
    const done = () => { for (const b of q.querySelectorAll('.answers button, .typed button, .typed input')) b.disabled = true; q.append(btn(i + 1 < d.items.length ? 'Next question' : 'See the score', () => { i++; next(); }, 'primary')); };
    q.append(l);
    if (it.answer.kind === 'choice') {
      const a = el('div', 'answers');
      for (const o of [...it.answer.options].sort(() => Math.random() - 0.5)) a.append(btn(o, () => check(o)));
      q.append(a);
    } else {
      const row = el('div', 'typed');
      const input = el('input');
      input.placeholder = it.type === 'voice' ? 'Type it, or 🎤 say it' : 'Type the answer';
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) check(input.value.trim()); });
      row.append(input, btn('Check', () => input.value.trim() && check(input.value.trim())));
      if (it.type === 'voice') {
        row.append(btn('🎤', async () => {
          out.className = 'result'; out.textContent = 'Listening…';
          const heard = await listen(it.lang);
          if (heard === null) { out.textContent = 'No speech recognition in this browser: type it.'; return; }
          if (!heard.length) { out.textContent = 'Didn’t hear anything. Try again.'; return; }
          check(heard, true);
        }));
      }
      q.append(row);
    }
    q.append(out);
    stage.replaceChildren(q);
  };
  next();
}

// Lists change when a sync brings a new plan, or another device changes it.
chrome.storage.onChanged.addListener((ch) => {
  if ((ch.data || ch.planLog || ch.account || ch.memory || ch.history) && !route().video && !document.activeElement?.matches('textarea, input')) refresh();
  if (ch.settings && route().tab !== 'settings') refresh();
  else if (ch.settings) ask({ type: 'parentData' }).then((r) => { if (r && !r.parentMode) refresh(); });
});
// --- notes for the AI: the 🎤 bottom right, the card on top. A note is about the screen it starts on. ----------
function noteTarget() {
  const r = route();
  if (r.video) return { videoId: r.video };
  if (r.tab === 'context') return { doc: contextDoc };
  if (r.tab === 'prompt') return { prompt: true };
  // Settings in 🔳 One box: the note is about the box on the screen when it starts.
  if (r.tab === 'settings' && settingsBox()) return { list: 'settings', section: settingsBox() };
  return { list: r.tab };   // today | planned | history | settings
}
notesDock({ card: $('notesCard'), fabHost: $('mic'), where: noteTarget,
  onSaved: () => { const t = route().tab; if (t === 'context') renderContext(); if (t === 'prompt') renderPrompt(); } });

window.kidtubeParentReady = true;   // boot.js: the script ran
refresh();
