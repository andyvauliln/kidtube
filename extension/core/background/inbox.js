// The header's notifications (core/ui/header.js), only where the parent is: one list, one row per thing, each row
// [type] [status] message [actions] [count]. Types:
//   error       the code broke (a script error, a dead button, no answer)     validation  a self-check failed
//   data        the server's AI run on the notes, posts in an app's list        note        a note not sent yet
//   question    a note that asks something: not sent yet (like a note), waiting for the AI, then its answer
//   (the header adds its own: update, a newer version; system, what its last action said)
// The same problem again is not a new row: its count goes up (core/checks/runner.js counts it and does not send it
// again). A new version that still has it sends it once more: its try goes up (one try per version).
import { withState } from './store.js';
import { sync } from './sync.js';
import { partOf } from './apps.js';
import { checksView, sendReports } from '../checks/runner.js';

const RECENT = 30 * 60000;
const recent = (at, now = Date.now()) => !!at && now - Date.parse(at) < RECENT;

// A problem's state (runner.js stateOf) as the row's status: its short words and its tone (bad, wait, ok).
const PROBLEM_STATUS = {
  unsent: ['Not sent', 'bad'], waiting: ['Sent', 'wait'], late: ['No answer', 'bad'], working: ['Handling', 'wait'],
  reload: ['Fixed: update', 'wait'], fixed: ['Done', 'ok'], checked: ['Done', 'ok'], 'needs-you': ['Needs you', 'bad'],
  retry: ['Retrying', 'wait'], 'gave-up': ['Stopped', 'bad'],
};
const status = ([text, tone]) => ({ text, tone });

function problemRow(p) {
  const actions = [{ do: 'open', page: 'checks', label: 'Details' }];
  if (p.state === 'unsent') actions.unshift({ do: 'problems.send', label: 'Send now' });
  if (p.state === 'reload') actions.unshift({ do: 'update', label: 'Update' });
  const ai = p.fix?.message ? ` The AI says: ${p.fix.message}` : '';
  return { id: `problem:${p.key}`, type: p.kind, status: status(PROBLEM_STATUS[p.state] ?? ['Open', 'bad']), title: p.title,
    detail: p.detail, state: `${p.label}.${ai}`, count: p.count, tries: p.tries, at: p.lastAt, done: !!p.done, actions,
    more: `${p.check} · ${p.versions.join(', ')}` };
}

// The app's run on the notes (KidTube's aiView): sent, working, late, done or failed in the last 30 minutes.
function runRow(a) {
  const base = { id: 'run', type: 'data', at: a.at, count: null };
  const open = { do: 'open', page: a.page, label: 'Open' };
  const again = { do: 'run', label: 'Ask again' };
  switch (a.run) {
    case 'queued': return { ...base, status: status(['Sent', 'wait']), title: 'Your notes were sent: the AI run starts in 1–2 minutes',
      detail: 'The server checks every minute. The run takes about 10–30 minutes.', actions: [] };
    case 'running': return { ...base, status: status(['Handling', 'wait']), title: 'The AI is working on your notes',
      detail: 'It updates the lists when it is done (about 10–30 minutes).', actions: [] };
    case 'late': return { ...base, status: status(['No answer', 'bad']), title: 'The server did not start the AI run in 10 minutes',
      detail: 'The server may be off or busy. Ask again, or wait.', actions: [again] };
    case 'done': return recent(a.at) ? { ...base, status: status(['Done', 'ok']), title: 'The AI run is done: the lists are updated',
      detail: a.message || '', done: true, actions: a.page ? [open] : [] } : null;
    case 'failed': return recent(a.at) ? { ...base, status: status(['Failed', 'bad']), title: 'The AI run failed',
      detail: a.message || 'The server did not say why.', actions: [again] } : null;
    default: return null;
  }
}

// n.about: what the note is about, in the app's words (KidTube: a video, a list, a context document, the prompt).
function noteRow(n) {
  const about = n.about ?? 'the app';
  const attached = (n.attached ?? []).map((a) => (a === 'screen' ? 'the screen' : a === 'app' ? 'the app data' : a));
  return { id: `note:${n.id}`, note: n.id, type: n.ask ? 'question' : 'note', status: status(['Not sent', 'wait']), title: n.text,
    detail: `Your ${n.ask ? 'question' : 'note'} about ${about}${attached.length ? `, with ${attached.join(' and ')}` : ''}. It waits on this tablet until you send it.${n.ask ? ' The AI answers it here.' : ''}`,
    at: n.at, count: null, actions: [{ do: 'note.edit', label: 'Edit' }, { do: 'note.drop', label: 'Delete' }, { do: 'note.send', label: 'Send' }] };
}

// A question already sent: waiting for the AI, answered, or worked on with no answer. The row changes by itself:
// the tablet looks for answers.json every minute while one waits (core/background/sync.js, the app's waiting()).
function questionRow(q, run) {
  const base = { id: `question:${q.id}`, note: q.id, type: 'question', title: q.text, at: q.answeredAt ?? q.at, count: null };
  const gotIt = { do: 'question.dismiss', label: 'Got it' };
  if (q.state === 'answered') return { ...base, fresh: true, status: status(['Answered', 'ok']), answer: q.answer, state: `Your question about ${q.about}.`, actions: [gotIt] };
  if (q.state === 'none') {
    return { ...base, status: status(['No answer', 'bad']), actions: [gotIt],
      detail: `The AI worked on your notes but wrote no answer to this question.${run?.message ? ` What it said: ${run.message}` : ''} Ask it again in a new note.` };
  }
  return { ...base, status: status(['Waiting', 'wait']), actions: [],
    detail: `Sent. The AI answers when the server picks it up (usually within 2–10 minutes). This row changes by itself.` };
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
      detail: 'The server writes down what each video says. It looks for new ones every minute.' });
  }
  // The last sync's errors: one row (its self-check gh.sync, reported too, is the same thing: not a second row).
  const { problems } = await checksView();
  const errs = mine.sync?.errors ?? [];
  if (errs.length) {
    rows.push({ id: 'sync', type: 'error', status: status(['Failed', 'bad']), title: 'The last sync with GitHub had a problem: some changes may stay on this tablet',
      detail: String(errs[0]).slice(0, 300), at: mine.sync.at ?? null,
      count: problems.find((p) => p.check === 'gh.sync')?.count ?? null, actions: [{ do: 'sync', label: 'Try again' }] });
  }
  // Each problem that waits for something, and the ones fixed or checked in the last 30 minutes.
  for (const p of problems) {
    if (errs.length && p.check === 'gh.sync') continue;
    if (!p.done || recent(p.fix?.at)) rows.push(problemRow(p));
  }
  // What waits for the parent first, what is done last.
  const rank = (r) => (r.done ? 2 : r.status.tone === 'bad' || r.fresh ? 0 : 1);   // an answer is what the parent waits for
  return rows.sort((x, y) => rank(x) - rank(y));
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
      return r.ok ? r : { ok: false, error: 'This note was sent already: it can’t be deleted now.' };
    }
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
