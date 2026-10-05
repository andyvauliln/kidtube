// Parent mode: today's list, the planned videos and what he watched, each video's details and its quiz.
// Changes go to the background (sw.js → planChange), which applies them on this tablet at once and logs them for the helper.
import { ask } from '../lib/ask.js';
import { checkPin } from '../lib/pin.js';
import { say, listen, recordedUrl } from '../ui/voice.js';
import { isCorrect, correctText } from '../lib/mark.js';
import { renderMarkdown, promptSteps } from './markdown.js';

const $ = (id) => document.getElementById(id);
const view = $('view');
let data = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(text, onClick, cls = '') {
  const b = el('button', cls, text);
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    b.disabled = true;
    try { await onClick(b); } finally { b.disabled = false; }
  });
  return b;
}
const mins = (s) => (s ? `${Math.max(1, Math.round(s / 60))} min` : '');
const when = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayLabel = (date) => {
  const d = new Date(`${date}T12:00:00`);
  const diff = Math.round((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
};

// --- toast with undo ----------------------------------------------------------------------------
let toastTimer = null, undoFn = null;
function toast(text, undo) {
  $('toastText').textContent = text;
  $('toastUndo').hidden = !undo;
  undoFn = undo;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, undo ? 8000 : 3000);
}
$('toastUndo').addEventListener('click', async () => {
  $('toast').hidden = true;
  if (undoFn) { await undoFn(); undoFn = null; await refresh(); }
});

// --- loading and the PIN ---------------------------------------------------------------------------
async function refresh() {
  const r = await ask({ type: 'parentData' });
  if (!r || r.ok === false) { view.replaceChildren(el('p', 'err', 'KidTube’s background did not answer. Close this page and open it again.')); return; }
  data = r;
  $('who').textContent = r.account?.email || r.account?.name || 'YouTube account not seen yet';
  $('who').title = 'Lists, history and settings belong to this YouTube account';
  if (!r.parentMode) return showGate();
  $('gate').hidden = true;
  $('tabs').hidden = false;
  $('nToday').textContent = r.today.filter((v) => !v.watchedAt).length;
  $('nPlanned').textContent = r.planned.length;
  render();
}

async function showGate() {
  $('tabs').hidden = true;
  view.replaceChildren();
  $('gate').hidden = false;
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (!settings.pinHash) {
    $('gateText').textContent = 'Set a parent PIN in the settings (⚙️) first.';
    $('pin').hidden = $('pinGo').hidden = true;
  }
  $('pin').focus();
}
$('pinGo').addEventListener('click', async () => {
  const r = await checkPin($('pin').value.trim());
  $('pin').value = '';
  if (!r.ok) { $('pinErr').textContent = r.error; return; }
  $('pinErr').textContent = '';
  await ask({ type: 'setMode', mode: 'parent' });
  refresh();
});
$('pin').addEventListener('keydown', (e) => e.key === 'Enter' && $('pinGo').click());
$('kid').addEventListener('click', () => ask({ type: 'kidHome' }));

// --- routing: #today, #planned, #history, #prompt, #settings, #v=<videoId> ---------------------------
const TABS = ['today', 'planned', 'history', 'prompt', 'settings'];
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
  if (r.video) { shownTab = null; return renderDetail(r.video); }
  // The settings page keeps its own state: redrawn only when you come to the tab.
  if (r.tab === 'settings' && shownTab === 'settings') return;
  if (shownTab !== r.tab) scrollTo(0, 0);
  lastTab = shownTab = r.tab;
  if (r.tab === 'planned') return renderPlanned();
  if (r.tab === 'history') return renderHistory();
  if (r.tab === 'prompt') return renderPrompt();
  if (r.tab === 'settings') return renderSettings();
  return renderToday();
}
addEventListener('hashchange', render);

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

// A note for the AI: about one video, or about a whole list.
function noteBox(target, past = [], label = 'Note for the AI', buttonInto = null) {
  const wrap = el('div', 'notebox');
  const list = el('ul', 'notes');
  const show = (items) => list.replaceChildren(...items.map((n) => {
    const li = el('li');
    if (n.at) li.append(el('time', '', new Date(n.at).toLocaleDateString())); li.append(document.createTextNode(n.text));
    return li;
  }));
  show(past);
  const box = el('div');
  box.hidden = true;
  const ta = el('textarea');
  ta.maxLength = 2000;
  ta.placeholder = target.list ? `For example: “${target.list === 'history' ? 'He loved the animal videos, more like these' : 'Too many videos about space, more numbers please'}”` : 'For example: “Good one, more like this” or “Too fast for him”';
  const send = btn('Send to the helper', async () => {
    const text = ta.value.trim();
    if (!text) return;
    const r = target.list ? await ask({ type: 'wish', list: target.list, text }) : await ask({ type: 'note', videoId: target.videoId, comment: text });
    if (!r?.ok) return toast('Could not save the note.');
    past = [...past, { at: new Date().toISOString(), text }];
    show(past);
    ta.value = '';
    box.hidden = true;
    toast('Saved. The helper reads it on its next run.');
  }, 'primary');
  box.append(ta, send);
  const open = btn(`📝 ${label}`, () => { box.hidden = !box.hidden; if (!box.hidden) ta.focus(); });
  if (buttonInto) buttonInto.append(open); else wrap.append(open);
  wrap.append(box, list);
  return wrap;
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
  const acts = actionsFor(v, where);
  info.append(acts, noteBox({ videoId: v.videoId }, [], 'Note for the AI', acts));
  r.append(t, info);
  return r;
}

function syncLine() {
  const bits = [];
  if (!data.hasToken) bits.push('No GitHub token for this account yet: changes stay on this tablet (Settings → Connection).');
  else if (data.waiting) bits.push(`${data.waiting} change${data.waiting > 1 ? 's' : ''} waiting to upload.`);
  if (data.sync?.errors?.length) bits.push(`Sync problem: ${data.sync.errors[0]}`);
  if (data.parentUntil) bits.push(`Parent mode until ${when(new Date(data.parentUntil).toISOString())}.`);
  return el('p', 'muted', bits.join(' '));
}

// --- the three lists -------------------------------------------------------------------------------

function renderToday() {
  const vs = data.today;
  const left = vs.filter((v) => !v.watchedAt).length;
  const head = el('div', 'box');
  head.append(el('h2', '', 'What he sees today'),
    el('p', 'muted', `${vs.length} video${vs.length === 1 ? '' : 's'} · ${vs.length - left} watched · ${vs.filter((v) => v.required).length} must-watch. Removing a video brings the next planned one in.`),
    syncLine(), noteBox({ list: 'today' }, data.lists.today ?? [], 'Note for the AI about today’s list'));
  view.replaceChildren(head, ...(vs.length ? vs.map((v) => row(v, 'today')) : [el('p', 'muted', 'Nothing on today’s list.')]));
}

function renderPlanned() {
  const head = el('div', 'box');
  head.append(el('h2', '', 'Planned and ideas'),
    el('p', 'muted', data.hasMemory ? 'The helper’s next picks, in its order. Approve, make a must-watch, move to today or remove. The helper reads your changes on its next run.'
      : 'Planned videos show here once the tablet has the helper’s notes (memory.json; needs the GitHub token).'),
    syncLine(), noteBox({ list: 'planned' }, data.lists.planned ?? [], 'Note for the AI about the plan'));
  view.replaceChildren(head, ...(data.planned.length ? data.planned.map((v) => row(v, 'planned')) : [el('p', 'muted', 'Nothing planned yet.')]));
}

function renderHistory() {
  const head = el('div', 'box');
  head.append(el('h2', '', 'What he watched'), el('p', 'muted', 'By day. Tap a video to see its questions and how he answered.'),
    noteBox({ list: 'history' }, data.lists.history ?? [], 'Note for the AI about his history'));
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

let promptDraft = '';
async function renderPrompt() {
  const h = await ask({ type: 'helperData' });
  if (route().tab !== 'prompt') return;
  if (!h?.ok) { view.replaceChildren(el('p', 'err', 'Could not load the helper’s description.')); return; }
  const info = h.info;
  const parts = [];
  const box = (title, ...body) => { const b = el('div', 'box'); b.append(el('h2', '', title), ...body); parts.push(b); return b; };

  // 1. When and how it runs.
  const run = info?.run;
  const howBody = [];
  if (run) {
    howBody.push(el('p', '', `Runs ${scheduleText(run.schedule, run.timezone)}. ${run.runner === 'claude'
      ? `Claude Code (${run.model}) reads the prompt below and does the work with its toolkit${run.maxTurns ? `, in up to ${run.maxTurns} steps` : ''}.`
      : 'The fixed program (agent/run.mjs) does the work with OpenRouter text models.'}${run.fallbackToNode ? ' If Claude can’t run and nothing was saved that day, the backup program does the same steps with OpenRouter models.' : ''}`));
  } else {
    howBody.push(el('p', 'muted', h.hasToken ? 'The helper hasn’t published its description yet. It does on its next run.' : 'Needs the GitHub token for this account (Settings → Connection).'));
  }
  howBody.push(el('p', 'muted', h.lastRunAt ? `Last run: ${new Date(h.lastRunAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. It had read the tablets up to ${h.processedThrough ? new Date(h.processedThrough).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}.` : 'No run seen yet.'));
  if (h.journal[0]) {
    howBody.push(el('h3', '', 'Its latest diary'), el('p', '', h.journal[0].summary));
    if (h.journal.length > 1) howBody.push(fold('Earlier days', ...h.journal.slice(1).map((j) => el('p', '', `${new Date(j.at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}: ${j.summary}`))));
  }
  box('How the helper works', ...howBody);

  // What it learned about him, its study plan, and the messages it has from you (all in memory.json).
  if (h.noticed) box('What it noticed', renderMarkdown(h.noticed));
  if (h.studyPlan) box('Study plan', ...(h.studyPlanAt ? [el('p', 'muted', `Written ${new Date(h.studyPlanAt).toLocaleDateString()}. Send a message to change it.`)] : []), renderMarkdown(h.studyPlan));
  if (h.messages?.length) {
    const ul = el('ul', 'notes');
    ul.append(...h.messages.map((m) => el('li', '', `${m.at.slice(0, 10)}: ${m.aboutList ? `(${m.aboutList}) ` : ''}${m.text}`)));
    box('Your messages it keeps in mind', ul);
  }

  // 2. Your changes to the prompt.
  const list = el('ul', 'notes');
  for (const n of h.notes) {
    const li = el('li', 'pnote');
    const text = el('span', '', n.text);
    const meta = el('time', '', `${new Date(n.at).toLocaleDateString()}${n.pending ? ' · waiting for the next run' : ''}`);
    li.append(meta, text, btn('Remove', async () => {
      const r = await ask({ type: 'promptNote', action: 'remove', noteId: n.id });
      if (!r?.ok) return toast('Could not remove it. Is parent mode still on?');
      toast('Removed. The helper stops following it from its next run.');
      renderPrompt();
    }, 'small'));
    list.append(li);
  }
  const ta = el('textarea');
  ta.maxLength = 2000;
  ta.value = promptDraft;
  ta.placeholder = 'For example: “Every day one video about animals” · “Questions only in English” · “No videos longer than 8 minutes on school days”';
  ta.addEventListener('input', () => { promptDraft = ta.value; });
  const send = btn('Add to the prompt', async () => {
    const text = ta.value.trim();
    if (!text) return;
    const r = await ask({ type: 'promptNote', action: 'add', text });
    if (!r?.ok) return toast('Could not save it. Is parent mode still on?');
    promptDraft = '';
    toast('Added. The helper follows it from its next run, every run.');
    renderPrompt();
  }, 'primary');
  box('Your changes to the prompt',
    el('p', 'muted', 'Standing instructions the helper follows on every run, as part of its prompt. They win over its steps, but not over its safety rules. For one-off wishes use the notes on the other tabs.'),
    h.notes.length ? list : el('p', 'muted', 'None yet.'), ta, send);

  // 3. The run, step by step (straight from the prompt).
  if (info?.prompt) {
    const { steps, after } = promptSteps(info.prompt);
    const ol = el('div', 'steps');
    for (const st of steps) {
      const d = el('details', 'step');
      const sum = el('summary');
      sum.append(el('span', 'n', String(st.n)), el('span', '', st.title));
      d.append(sum, renderMarkdown(st.body));
      ol.append(d);
    }
    box('What it does, step by step', el('p', 'muted', 'Tap a step to see exactly what the prompt tells it.'), ol, ...(after ? [renderMarkdown(after)] : []));
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
    ['Hearing his answers', r.friend.listen === 'openrouter' ? 'OpenRouter audio model' : 'the tablet’s speech recognition'], ['Other websites', r.blockSites ? 'blocked' : 'open'],
  ]));
  box('Settings it uses', ...setBody);

  // 5. What it reads and writes, its toolkit, the full prompt.
  if (info) {
    const ul = (items) => { const u = el('ul'); u.append(...items.map((x) => el('li', '', x))); return u; };
    box('What it reads and writes', el('h3', '', 'Reads'), ul(info.reads ?? []), el('h3', '', 'Writes'), ul(info.writes ?? []),
      fold(`Its toolkit (${(info.commands ?? []).length} commands)`, table((info.commands ?? []).map((c) => [c.command, c.what]))));
    box('The full prompt', el('p', 'muted', `agent/DAILY.md, as the helper uses it${info.updatedAt ? ` (published ${new Date(info.updatedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})` : ''}. Your changes above are added to it.`),
      fold('Read the whole prompt', renderMarkdown(info.prompt)));
  }
  view.replaceChildren(...parts);
}

// --- Settings: the same settings page, inside this tab (no second PIN in parent mode) --------------------

function renderSettings() {
  const frame = el('iframe', 'settings');
  frame.src = '../options/options.html?embedded=1';
  frame.title = 'Settings';
  const fallback = el('p', 'muted');
  fallback.hidden = true;
  const a = el('a', '', 'Open the settings page');
  a.href = '../options/options.html';
  fallback.append('The settings didn’t show here. ', a);
  const timer = setTimeout(() => { fallback.hidden = false; }, 4000);
  addEventListener('message', function sized(e) {
    if (e.source !== frame.contentWindow || e.data?.kidtube !== 'options-size') return;
    clearTimeout(timer);
    frame.style.height = `${Math.max(400, e.data.height + 20)}px`;
    if (!frame.isConnected) removeEventListener('message', sized);
  });
  view.replaceChildren(fallback, frame);
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
  if (d.where === 'removed') side.append(el('div', 'actions'), btn('Put back in the plan', async () => { if (await plan('restore', videoId)) { toast('Back in the plan.'); await again(); } }));
  side.append(btn('▶ Watch it yourself', () => ask({ type: 'watchHere', videoId }), 'primary'));
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
      const url = d.friend.recorded && line.audioRef ? await recordedUrl(line.audioRef) : null;
      try { await say(url ? { ...line, audioUrl: url } : line, { ...d.friend.voice, lang: lang || d.friend.voice.lang }); }
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
  const notes = section('Notes for the AI');
  if (d.helperNotes.length) notes.append(el('p', 'muted', 'Earlier comments the helper has:'), list(d.helperNotes));
  notes.append(noteBox({ videoId }, d.notes, 'Add a note for the AI'));

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
setInterval(() => { if (data?.parentMode && data.parentUntil && data.parentUntil < Date.now()) refresh(); }, 30000);
refresh();
