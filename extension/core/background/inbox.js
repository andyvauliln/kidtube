// The header's notifications (core/ui/header.js), only where the parent is: one list, one row per thing, each row
// [type] [status] message [actions] [count]. Types:
//   error       the code broke (a script error, a dead button, no answer)     validation  a self-check failed
//   data        the server's AI run on the notes, posts in an app's list        note        a note not sent yet
//   question    a note that asks something: not sent yet (like a note), waiting for the AI, then its answer
//   (a note sent is followed too: waiting, then Done with what the AI did about it in its Details)
//   (a recorded note the server still writes down is a note row too: Uploading, Writing down, Failed)
//   (the header adds its own: update, a newer version; system, what its last action said)
// The same problem again is not a new row: its count goes up (core/checks/runner.js counts it and does not send it
// again). A new version that still has it sends it once more: its try goes up (one try per version).
// Every row has a view: its Details (the header opens it on a tap), only what the parent needs to understand it and to
// check it again: sections of { title, text } | { title, rows: [[label, value, 'time'?]] } | { title, steps: [..] }
// (what to do, in order) | { title, list: [..] }, and report: { path, root } when an AI run did something about it
// (agent/report.mjs: every step of the run; readReport below fetches it).
import { withState, headerOpen, dataLocation } from './store.js';
import { sync } from './sync.js';
import { partOf } from './apps.js';
import { checksView, sendReports } from '../checks/runner.js';
import { getRepoFile } from '../lib/github.js';
import { DEFAULT_REPO } from './constants.js';

// Done, nothing to do (a fixed problem, a finished run): shown 3 minutes so the parent sees it change, then gone.
const RECENT = 3 * 60000;
const recent = (at, now = Date.now()) => !!at && now - Date.parse(at) < RECENT;

// A problem's state (runner.js stateOf) as the row's status: its short words and its tone (bad, wait, ok).
const PROBLEM_STATUS = {
  unsent: ['Not sent', 'bad'], waiting: ['Sent to the AI', 'wait'], late: ['AI did not reply', 'bad'], working: ['AI working', 'wait'],
  reload: ['Fixed: update', 'wait'], fixed: ['Fixed', 'ok'], checked: ['Closed', 'ok'], 'needs-you': ['Needs you', 'bad'],
  retry: ['AI retrying', 'wait'], 'gave-up': ['AI stopped', 'bad'], old: ['Not seen since', 'ok'],
};
// Where a problem came from and where it is fixed, in one line: "Came from 0.12.2 · Fixed in 0.12.6 · This tablet: 0.12.14".
function versionsOf(p, installed) {
  const fixed = p.fix?.version && ['fixed', 'not-a-bug'].includes(p.fix.state) ? ` · ${p.fix.state === 'fixed' ? 'Fixed' : 'Check corrected'} in ${p.fix.version}` : '';
  return `Came from ${p.versions.join(', ') || '?'}${fixed}${installed ? ` · This tablet: ${installed}` : ''}`;
}
const status = ([text, tone]) => ({ text, tone });

// How to check a problem again, by where it is now.
const WHERE_WORDS = { header: 'the header', parent: 'the parent screens', youtube: 'YouTube', page: 'the extension page', background: 'the app',
  notes: 'the notes', rules: 'the rules', instagram: 'the Instagram app', kid: 'his screen' };
function recheckOf(p) {
  const again = `Do again what you did when it happened, on ${WHERE_WORDS[p.area] ?? 'the same screen'}. The check runs again by itself.`;
  const after = 'If it still happens, this row comes back: its count goes up, and a new version sends it to the AI once more.';
  switch (p.state) {
    case 'unsent': return ['Tap Send now: the AI gets the report.', 'Wait for “AI working”, then for its answer in this row.'];
    case 'waiting': case 'working': case 'retry': return ['Nothing to do now: the AI works on it. This row changes by itself.', 'When it says Fixed, check it as below.'];
    case 'late': return ['The server did not answer in 30 minutes. Wait, or tell the AI in a note.'];
    case 'reload': return [`Update to ${p.fix?.version ?? 'the new version'}: tap Update (or the new version next to the logo).`, again, after];
    case 'needs-you': return ['Read what the AI says below: it needs something from you.', 'Do it, then do again what you did when it happened.', after];
    case 'gave-up': return ['The AI stopped 3 times before it answered (a usage limit or a crash). Open its run below to see why.', 'It tries again when a new version reports it.'];
    default: return [again, after];
  }
}
const val = (v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 600);

function problemRow(p, installed) {
  const actions = [];
  if (p.state === 'unsent') actions.unshift({ do: 'problems.send', label: 'Send now' });
  if (p.state === 'reload') actions.unshift({ do: 'update', label: 'Update' });
  actions.push({ do: 'open', page: 'checks', label: 'All checks' });
  const ai = p.fix?.message ? ` The AI says: ${p.fix.message}` : '';
  const view = { sections: [
    { title: 'What happened', text: [p.title, p.detail].filter(Boolean).join('\n') },
    { title: 'The check', rows: [['Should be', val(p.expect)], ['Was', val(p.saw)], ['Where', WHERE_WORDS[p.area] ?? p.area ?? ''], ['Check', p.check]] },
    { title: 'When', rows: [['First seen', p.firstAt, 'time'], ['Last seen', p.lastAt, 'time'], ['Times', String(p.count)],
      ['Sent to the AI', p.sentAt ?? (p.state === 'unsent' ? 'not yet' : ''), p.sentAt ? 'time' : ''], ['Versions', versionsOf(p, installed)]] },
    { title: 'The AI', rows: [['State', p.label], ['It says', p.fix?.message ?? ''], ['Fixed in', p.fix?.version ?? ''], ['Answered', p.fix?.at ?? '', 'time']] },
    { title: 'Check it again', steps: recheckOf(p) },
  ], report: p.fix?.report ? { path: p.fix.report, root: true } : null };
  return { id: `problem:${p.key}`, type: p.kind, status: status(PROBLEM_STATUS[p.state] ?? ['Open', 'bad']), title: p.title,
    detail: p.detail, state: `${p.label}.${ai}`, versions: versionsOf(p, installed), count: p.count, tries: p.tries, at: p.lastAt, done: !!p.done, actions,
    more: `${p.check} · ${p.versions.join(', ')}`, view };
}

// The app's run on the notes (KidTube's aiView): sent, working, late, done in the last 3 minutes, failed in the last day
// (it needs the parent: Ask again, or swipe it away).
function runRow(a) {
  const view = { sections: [
    { title: 'This run', rows: [['State', { queued: 'sent, waiting for the server', running: 'the AI works', late: 'not started in 10 minutes', done: 'done', failed: 'failed' }[a.run] ?? a.run],
      [['queued', 'late'].includes(a.run) ? 'Asked' : ['done', 'failed'].includes(a.run) ? 'Ended' : 'Started', a.at, 'time'], ['The server says', a.message || '']] },
    ...(['queued', 'running'].includes(a.run) ? [{ title: 'What happens', steps: ['The server looks every minute and starts the AI.', 'The AI reads your notes, changes the app or the lists, and releases a new version when the app changes.',
      'This row then says Done, and its report tells every step.'] }] : []),
    ...(a.run === 'failed' ? [{ title: 'What to do', steps: ['Open the run’s report below: “For you” says why it stopped.', 'Tap Ask again when the reason is gone (for example after a usage limit resets).'] }] : []),
  ], report: a.report ? { path: a.report, root: false } : null };
  const base = { id: 'run', type: 'data', at: a.at, count: null, view };
  const open = { do: 'open', page: a.page, label: 'Open' };
  const again = { do: 'run', label: 'Ask again' };
  switch (a.run) {
    case 'queued': return { ...base, status: status(['Sent', 'wait']), title: 'Your notes were sent: the AI run starts in 1–2 minutes',
      detail: 'The server checks every minute. The run takes about 10–30 minutes.', actions: [] };
    case 'running': return { ...base, status: status(['Handling', 'wait']), title: 'The AI is working on your notes',
      detail: 'It updates the lists when it is done (about 10–30 minutes).', actions: [] };
    case 'late': return { ...base, status: status(['Not started', 'bad']), title: 'The server did not start the AI run in 10 minutes',
      detail: 'The server may be off or busy. Ask again, or wait.', actions: [again] };
    case 'done': return recent(a.at) ? { ...base, status: status(['Done', 'ok']), title: 'The AI run is done: the lists are updated',
      detail: a.message || '', done: true, actions: a.page ? [open] : [] } : null;
    case 'failed': return a.at && Date.now() - Date.parse(a.at) < 24 * 3600000 ? { ...base, status: status(['Failed', 'bad']), title: 'The AI run failed',
      detail: a.message || 'The server did not say why.', actions: [again] } : null;
    default: return null;
  }
}

// n.about: what the note is about, in the app's words (KidTube: a video, a list, a context document, the prompt).
// A recorded note the tablet could not write down (the speech services refuse this country): the server writes it
// down (apps/kidtube/background/voice.js); only Delete until it has words, then it is a note like any other.
const VOICE = {
  upload: [['Uploading', 'wait'], 'No speech service answered on this tablet, so the recording goes to the server. It uploads now.'],
  server: [['Writing down', 'wait'], 'The server writes the recording down (usually within 2 minutes). This row changes by itself; then you can edit and send it.'],
  failed: [['Failed', 'bad'], 'The server could not write it down either'],
};
// The checkboxes of a note not sent yet: what goes with it (kept with the note since it was made; ticked: sent too).
function checksOf(n) {
  const has = (k) => (n.attached ?? []).includes(k) || (n.offered ?? []).includes(k);
  return [
    { key: 'screen', label: '📄 This screen', on: (n.attached ?? []).includes('screen'), can: has('screen'),
      title: 'Send what the screen showed when you made the note (its text, the tab, the screen size), so the AI sees what you mean' },
    { key: 'app', label: '⚙️ App data', on: (n.attached ?? []).includes('app'), can: true, title: 'Send the app’s state: version, rules, today’s list, sync status' },
    { key: 'ask', label: '❓ Question', on: !!n.ask, can: true, title: 'The AI answers it here instead of changing something' },
  ];
}

// A note not sent yet: all of it, what goes with it, and what happens when it is sent.
function noteView(n, about, extra = []) {
  const goes = checksOf(n).filter((c) => c.on).map((c) => c.label.replace(/^\S+ /, ''));
  return { sections: [
    { title: n.ask ? 'Your question' : 'Your note', text: n.text || '(no words yet)' },
    { title: 'About', rows: [['About', about], ['Made', n.at, 'time'], ['Sent with it', goes.join(', ') || 'only the words'], ...extra] },
    { title: 'What happens', steps: [n.ask ? 'Tap Send: the AI answers here, under the question.' : 'Tap Send (or ↻ Update): the AI works on it in its next run.',
      'The row then says Waiting, and Done or Answered when the AI is ready. Tap it again to read what the AI did.'] },
  ] };
}

function voiceRow(n, about) {
  const [st, words] = VOICE[n.voice.state] ?? VOICE.server;
  const failed = n.voice.state === 'failed';
  return { id: `note:${n.id}`, note: n.id, type: n.ask ? 'question' : 'note', status: status(st), at: n.at, count: null,
    view: noteView(n, about, [['Recording', `${n.voice.seconds ?? '?'} s, ${st[0].toLowerCase()}${failed ? `: ${n.voice.error ?? 'no reason given'}` : ''}`]]),
    editText: '', title: `🎤 A recorded ${n.ask ? 'question' : 'note'}${n.voice.seconds ? ` (${n.voice.seconds} s)` : ''} about ${about}`,
    detail: failed ? `${words}: ${n.voice.error ?? 'no reason given'}. Type the note with Edit, or delete it.` : words,
    checks: checksOf(n), actions: failed ? [{ do: 'note.edit', label: 'Edit' }, { do: 'note.drop', label: 'Delete' }] : [{ do: 'note.drop', label: 'Delete' }] };
}

function noteRow(n) {
  const about = n.about ?? 'the app';
  if (n.voice) return voiceRow(n, about);
  return { id: `note:${n.id}`, note: n.id, type: n.ask ? 'question' : 'note', status: status(['Not sent', 'wait']), title: n.text, view: noteView(n, about),
    detail: `Your ${n.ask ? 'question' : 'note'} about ${about}. It waits on this tablet until you send it.${n.ask ? ' The AI answers it here.' : ''}`,
    at: n.at, count: null, checks: checksOf(n), actions: [{ do: 'note.edit', label: 'Edit' }, { do: 'note.drop', label: 'Delete' }, { do: 'note.send', label: 'Send' }] };
}

// A note or question already sent: waiting for the AI, then its answer (a question) or what was done about it (a
// note), or worked on with no answer. The row changes by itself: the tablet looks for answers.json every minute while
// one waits (core/background/sync.js, the app's waiting()). Details opens what the AI wrote.
function questionRow(q, run) {
  const ask = q.ask !== false;
  const gotIt = { do: 'question.dismiss', label: 'Got it' };
  const said = q.result ?? run?.message ?? '';
  const view = { sections: [
    { title: ask ? 'Your question' : 'Your note', text: q.text },
    ...(q.answer ? [{ title: ask ? 'The answer' : 'What was done', text: q.answer }] : []),
    ...(said && q.state !== 'waiting' ? [{ title: 'What the AI said about its run', text: said }] : []),
    { title: 'About', rows: [['About', q.about ?? ''], ['Sent', q.at, 'time'], ['Answered', q.answeredAt ?? '', 'time'],
      ['State', { answered: ask ? 'answered' : 'done', none: ask ? 'worked on, no answer' : 'worked on', waiting: 'waiting for the AI' }[q.state] ?? q.state]] },
    ...(q.state === 'waiting' ? [] : [{ title: 'Check it', steps: ask ? ['Read the answer. If it is not what you asked, make a new note that says what is missing.']
      : ['Open the run’s report below: “What it said” and “What changed” show what it did about this note.', 'Check it on the screen it is about. If it is not right, make a new note on that screen.'] }]),
  ], report: q.report ? { path: q.report, root: false } : run?.report && q.state !== 'waiting' ? { path: run.report, root: false } : null };
  const base = { id: `question:${q.id}`, note: q.id, type: ask ? 'question' : 'note', title: q.text, at: q.answeredAt ?? q.at, count: null, view };
  if (q.state === 'answered') {
    return ask ? { ...base, fresh: true, status: status(['Answered', 'ok']), answer: q.answer, state: `Your question about ${q.about}.`, actions: [gotIt] }
      : { ...base, done: true, status: status(['Done', 'ok']), state: `Your note about ${q.about}.`, details: [['What was done', q.answer]], actions: [gotIt] };
  }
  if (q.state === 'none') {
    return ask ? { ...base, status: status(['No answer', 'bad']), actions: [gotIt],
      detail: `The AI worked on your notes but wrote no answer to this question.${said ? ` What it said: ${said}` : ''} Ask it again in a new note.` }
      : { ...base, done: true, status: status(['Done', 'ok']), state: `Your note about ${q.about}.`,
        details: [['What the AI said about this run', said || 'Nothing: it gave no summary.']], actions: [gotIt] };
  }
  return { ...base, status: status(['Waiting', 'wait']), actions: [],
    detail: ask ? 'Sent. The AI answers when the server picks it up (usually within 2–10 minutes). This row changes by itself.'
      : 'Sent. The AI works on it when the server picks it up (about 10–30 minutes); then Details says what it did.' };
}

// cur: the running profile's account (null: no app runs, only the checks' problems).
export async function inboxOf(cur) {
  const part = cur ? partOf(cur) : null;
  const mine = part ? await withState(async (s) => ({
    ai: part.aiView?.(s) ?? null,
    notes: (await part.notes?.list?.(s)) ?? [],
    questions: part.questions?.list?.(s) ?? [],
    sync: s.syncStatus ?? null,
  })) : { ai: null, notes: [], questions: [], sync: null };
  const rows = [];
  const a = mine.ai ?? {};
  for (const q of mine.questions) rows.push(questionRow(q, a));
  for (const n of mine.notes) rows.push(noteRow(n));
  const run = a.run ? runRow(a) : null;
  if (run) rows.push(run);
  if (a.queued) {
    rows.push({ id: 'queued', type: 'data', status: status(['Waiting', 'wait']), count: null, actions: [],
      title: `${a.queued} post${a.queued === 1 ? '' : 's'} in your list ${a.queued === 1 ? 'waits' : 'wait'} for the server’s AI`,
      detail: 'The server writes down what each video says. It looks for new ones every minute.',
      view: { sections: [{ title: 'What happens', steps: ['The server looks for new posts in your list every minute.', 'It writes down what each video and each recorded note says (Whisper, no Claude).',
        'The post then shows its words in the app’s list. This row goes when none waits.'] }] } });
  }
  // The last sync's errors: one row (its self-check gh.sync, reported too, is the same thing: not a second row).
  const { problems, version } = await checksView();
  const errs = mine.sync?.errors ?? [];
  if (errs.length) {
    rows.push({ id: 'sync', type: 'error', status: status(['Failed', 'bad']), title: 'The last sync with GitHub had a problem: some changes may stay on this tablet',
      detail: String(errs[0]).slice(0, 300), at: mine.sync.at ?? null,
      view: { sections: [{ title: 'What went wrong', list: errs.map((e) => String(e).slice(0, 400)) }, { title: 'When', rows: [['Last sync', mine.sync.at ?? '', 'time']] },
        { title: 'What to do', steps: ['Tap Try again.', 'Still failing: open the account menu → GitHub and check that the token is saved and can write to the data repo.',
          'What waits is kept on this tablet and goes up with the next good sync.'] }] },
      count: problems.find((p) => p.check === 'gh.sync')?.count ?? null, actions: [{ do: 'sync', label: 'Try again' }] });
  }
  // Each problem that waits for something, and the ones fixed or checked in the last 3 minutes.
  for (const p of problems) {
    if (errs.length && p.check === 'gh.sync') continue;
    if (!p.done || recent(p.fix?.at)) rows.push(problemRow(p, version));
  }
  // What waits for the parent first, what is done last.
  const rank = (r) => (r.done ? 2 : r.status.tone === 'bad' || r.fresh ? 0 : 1);   // an answer is what the parent waits for
  return rows.sort((x, y) => rank(x) - rank(y));
}

// An AI run's report (agent/report.mjs) for a row's Details: in the profile's folder (notes and helper runs) or at the
// root of the data repo (fix runs). A report never changes, so the ones read stay here while the background lives.
const REPORTS = new Map();
export async function readReport(msg) {
  if (!(await headerOpen())) return { ok: false, error: 'Unlock with the PIN first.' };
  const path = String(msg.path ?? '');
  if (!/^reports\/[\w.-]+\.json$/.test(path)) return { ok: false, error: 'This is not a run report.' };
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (!settings.token) return { ok: false, error: 'Connect GitHub first: the report is in the data repo.' };
  const loc = msg.root ? { repo: settings.repo || DEFAULT_REPO, base: '' } : await dataLocation(settings);
  const key = `${loc.repo}/${loc.base}${path}`;
  if (REPORTS.has(key)) return { ok: true, report: REPORTS.get(key) };
  try {
    const f = await getRepoFile(loc, settings.token, path);
    if (!f?.json) return { ok: false, error: 'The report is not in the data repo any more (the server keeps the last 60).' };
    REPORTS.set(key, f.json);
    if (REPORTS.size > 12) REPORTS.delete(REPORTS.keys().next().value);
    return { ok: true, report: f.json };
  } catch (e) {
    return { ok: false, error: `The report could not be read: ${String(e.message ?? e).slice(0, 200)}` };
  }
}

// The rows' buttons. msg: { do, id, text } (id: the note's id). The header checks headerOpen before.
export async function inboxAct(msg) {
  const { account } = await chrome.storage.local.get('account');
  const notes = account?.key ? partOf(account).notes : null;
  const id = typeof msg.id === 'string' ? msg.id : null;
  switch (msg.do) {
    case 'note.edit':
      if (!notes || !id) return { ok: false, error: 'This note is not here any more.' };
      return withState((s) => notes.edit(s, id, msg.text));
    case 'note.drop': {
      if (!notes || !id) return { ok: false, error: 'This note is not here any more.' };
      const r = await withState((s) => notes.drop(s, id));
      return r.ok ? r : { ok: false, error: 'This note is not here any more: it was sent or deleted already.' };
    }
    case 'note.attach':
      if (!notes?.attach || !id) return { ok: false, error: 'This note is not here any more.' };
      return withState((s) => notes.attach(s, id, String(msg.what ?? ''), !!msg.on));
    case 'note.send':
    case 'run':
      if (!notes?.send) return { ok: false, error: 'This app has no AI run to ask for.' };
      // The run's own row says where it is now: no second message.
      return notes.send(msg.do === 'note.send' && id ? [id] : null).then((r) => (r?.ok ? { ok: true } : r));
    case 'question.dismiss': {
      const qs = account?.key ? partOf(account).questions : null;
      if (!qs || !id) return { ok: false, error: 'This question is not here any more.' };
      return withState((s) => qs.dismiss(s, id));
    }
    case 'problems.send': {
      const r = await sendReports();
      return r.ok ? { ...r, message: r.sent ? `Sent ${r.sent} report${r.sent === 1 ? '' : 's'} to the server.` : 'Nothing was waiting to be sent.' } : r;
    }
    case 'sync': {
      const r = await sync();
      const e = r?.errors?.[0] ?? r?.error;
      return e ? { ok: false, error: `Saving to GitHub failed again: ${e}` } : { ok: true, message: 'Saved to GitHub.' };
    }
    default: return { ok: false, error: `Unknown action “${String(msg.do).slice(0, 40)}”.` };
  }
}
