// Pieces shared by the parent screens and the settings view: elements, buttons, the toast,
// and the notes for the AI (one 🎤 button and one notes card).
import { ask } from '../lib/ask.js';
import { recordAnswer, transcribeAnswer, listenKeys, NOTE_LISTEN_MODELS } from '../ui/voice.js';

// Set by the page: what to redraw after an undo, and after asking for a run (the header's run status).
export const hooks = { afterUndo: async () => {}, afterRun: () => {} };

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
export function btn(text, onClick, cls = '') {
  const b = el('button', cls, text);
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    b.disabled = true;
    try { await onClick(b); } finally { b.disabled = false; }
  });
  return b;
}

// --- toast with undo (made on first use, so any page can show it) --------------------------------------
let toastBox = null, toastText = null, toastUndo = null, toastTimer = null, undoFn = null;
export function toast(text, undo) {
  if (!toastBox) {
    toastBox = el('div', 'toast');
    toastText = el('span');
    toastUndo = el('button', '', 'Undo');
    toastUndo.addEventListener('click', async () => {
      toastBox.hidden = true;
      if (undoFn) { const fn = undoFn; undoFn = null; await fn(); await hooks.afterUndo(); }
    });
    toastBox.append(toastText, toastUndo);
    document.body.append(toastBox);
  }
  toastText.textContent = text;
  toastUndo.hidden = !undo;
  undoFn = undo;
  toastBox.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastBox.hidden = true; }, undo ? 8000 : 3000);
}

// --- Update: run the helper now ---------------------------------------------------------------------
// Your notes go to GitHub first; the server starts the helper within a minute or two (agent/poll.sh).
// Sends every note waiting on any tab, then runs the helper. Returns false when it could not ask.
export async function runNow() {
  toast('Sending your notes and asking the helper to run…');
  const res = await ask({ type: 'runHelper' });
  if (!res?.ok) { toast(res?.error ?? 'Could not ask for a run.'); return false; }
  toast('Asked. The helper starts within a minute or two, reads all your notes and takes about 10–30 minutes.');
  hooks.afterRun();
  return true;
}

// --- notes for the AI: one 🎤 button (bottom right) and one notes card (top of the page) ---------------
// The 🎤 records a note about what is on the screen (where()): a tab, a video, a context document or the prompt.
// Pauses don't end it: it records until ⏹. Then the words join the card, which lists every note still on this
// tablet, from every tab, with ✕ and Clear all. Apply notes sends them all to the AI (the same as ↻ Update data).
// The words are written down by Gemini (free key: gemini-3.5-transcribe first) or OpenRouter (Settings → keys). Only without either key
// the browser's own speech recognition writes them, and the card says so.
const LONG_NOTE_MINUTES = 15;   // the browser's recognition
const CLOUD_NOTE_MINUTES = 5;   // Gemini / OpenRouter: 5 min of 16 kHz WAV is ~13 MB sent, under Gemini's 20 MB
const TYPE_LABEL = { today: 'Today', planned: 'Planned', history: 'History', settings: 'Settings' };

// where(): { list } | { videoId } | { doc, docName } | { prompt: true } — what the screen shows now.
// docNames: context document id → its name, for the card.
export function notesDock({ card, where, docNames = {}, onSaved = () => {} }) {
  const fab = el('button', 'notefab', '🎤');
  fab.title = 'Record a note for the AI about this screen';
  fab.setAttribute('aria-label', fab.title);
  document.body.append(fab);
  let rec = null;            // the recording in progress: { stop }
  let writing = false;       // the recording is being written down
  let started = 0, clock = null, notice = '', cloud = false;
  let notes = [];

  const label = (n) => n.videoId ? `Video · ${n.title || n.videoId}` : n.doc ? `Context · ${docNames[n.doc] ?? n.doc}`
    : n.type === 'prompt' ? 'Prompt' : TYPE_LABEL[n.list] ?? 'Message';
  const save = async (text, at = where()) => {
    const r = at.videoId ? await ask({ type: 'note', videoId: at.videoId, comment: text })
      : at.doc ? await ask({ type: 'contextNote', doc: at.doc, text })
      : at.prompt ? await ask({ type: 'promptNote', action: 'add', text })
      : await ask({ type: 'wish', list: at.list ?? 'settings', text });
    if (!r?.ok) { toast('Could not save the note. Is parent mode still on?'); return false; }
    notice = '';
    card.classList.remove('open');   // the card stays while notes wait
    await draw();
    onSaved();
    hooks.afterRun();
    return true;
  };

  const typed = el('textarea');
  typed.maxLength = 2000;
  typed.rows = 1;
  typed.placeholder = 'Or type a note…';
  const addTyped = btn('Add', async () => { const t = typed.value.trim(); if (t && (await save(t))) typed.value = ''; }, 'small');

  async function draw() {
    const r = await ask({ type: 'heldNotes' });
    notes = r?.ok ? r.notes ?? [] : notes;
    const busy = rec || writing;
    card.hidden = !busy && !notes.length && !card.classList.contains('open');
    fab.textContent = rec ? '⏹' : writing ? '…' : '🎤';
    fab.classList.toggle('on', !!rec);
    if (card.hidden) return;
    const head = el('div', 'nchead');
    head.append(el('h2', '', notes.length ? `Notes for the AI · ${notes.length}` : 'Notes for the AI'));
    const close = el('button', 'ghost small nclose', '✕');
    close.title = 'Hide (the notes stay)';
    close.addEventListener('click', () => { card.classList.remove('open'); if (!notes.length && !busy) card.hidden = true; else draw(); });
    if (!notes.length && !busy) head.append(close);
    const parts = [head];
    if (rec) {
      const s = Math.round((Date.now() - started) / 1000);
      parts.push(el('p', 'recline', `● Recording ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · pauses are fine · tap ⏹ to stop${cloud ? ` (it stops by itself at ${CLOUD_NOTE_MINUTES}:00)` : ''}`));
    } else if (writing) parts.push(el('p', 'recline', 'Writing it down…'));
    if (notice) parts.push(el('p', 'muted', notice));
    if (retry && !busy) {
      const again = el('div', 'ncacts');
      again.append(
        btn('Delete recording', async () => { retry = null; notice = ''; await draw(); }, 'small'),
        btn('Try again', () => writeDown(retry.audio, retry.at), 'small primary'));
      parts.push(again);
    }
    if (notes.length) {
      const ul = el('ul', 'notes nlist');
      for (const n of notes) {
        const li = el('li');
        const body = el('div');
        body.append(el('span', 'nwhere', label(n)), el('span', '', n.text));
        const x = btn('✕', async () => {
          if ((await ask({ type: 'dropNote', id: n.id }))?.ok) { await draw(); hooks.afterRun(); } else toast('Already sent: it can’t be removed now.');
        }, 'ghost small');
        x.title = 'Remove this note';
        li.append(body, x);
        ul.append(li);
      }
      parts.push(ul);
    }
    const row = el('div', 'noterow');
    row.append(typed, addTyped);
    parts.push(row);
    if (notes.length) {
      const acts = el('div', 'ncacts');
      acts.append(
        btn('Clear all', async () => {
          if (!confirm(`Delete all ${notes.length} notes? They were not sent.`)) return;
          await ask({ type: 'dropNote', all: true });
          card.classList.remove('open');
          await draw();
          hooks.afterRun();
        }, 'small'),
        btn(`Apply notes (${notes.length})`, async () => { if (rec) rec.stop(); if (await runNow()) await draw(); }, 'small primary'));
      parts.push(acts);
    }
    card.replaceChildren(...parts);
  }

  // Why a model could not write a recording down, in the card.
  const WHY = { 400: 'refused the request', 401: 'refused the key', 403: 'refused the key', 404: 'model not found', 429: 'limit reached',
    500: 'error', 503: 'busy', refused: 'did not hear it', timeout: 'too slow', network: 'no connection' };
  let retry = null;          // a recording that could not be written down: { audio, at }, kept for Try again

  async function writeDown(audio, at) {
    const keys = await listenKeys();
    retry = null;
    notice = '';
    writing = true;
    await draw();
    const fails = [];
    const heard = await transcribeAnswer(audio, { keys, lang: navigator.language || 'en-US', maxTokens: 6000, freeModels: NOTE_LISTEN_MODELS,
      instruction: 'A parent dictates a note about their child\'s videos and learning, or about the app. Use punctuation.',
      onFail: (r, why) => fails.push(`${r.model}: ${WHY[why] ?? why}`) });
    writing = false;
    if (heard?.length) { await save(heard[0], at); return; }
    if (heard) notice = 'Heard nothing. Try again closer to the tablet.';
    else {
      retry = { audio, at };
      notice = `The recording could not be written down (${fails.join('; ') || 'no key'}). It is kept: tap Try again in a minute.`;
    }
    await draw();
  }

  async function record() {
    const lang = navigator.language || 'en-US';
    const at = where();      // the screen where the note started, even if you move on while it records
    const keys = await listenKeys();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    notice = '';
    retry = null;
    if (!keys.gemini && !keys.openrouter && !SR) {
      card.classList.add('open');
      notice = 'Dictation isn’t available here: type the note, or use the 🎤 on the keyboard.';
      await draw();
      typed.focus();
      return;
    }
    card.classList.add('open');
    started = Date.now();
    clock = setInterval(draw, 1000);
    const stopClock = () => { clearInterval(clock); clock = null; };
    cloud = !!(keys.gemini || keys.openrouter);
    if (cloud) {
      const ctl = new AbortController();
      rec = { stop: () => ctl.abort() };
      await draw();
      const audio = await recordAnswer({ seconds: CLOUD_NOTE_MINUTES * 60, stopSignal: ctl.signal, silenceStop: false });
      rec = null;
      if (audio) { stopClock(); await writeDown(audio, at); return; }
      // null: the browser didn't let KidTube record. Its own recognition may still work.
      cloud = false;
      if (!SR) { stopClock(); notice = 'The browser doesn’t let KidTube use the microphone. Allow it (Android Settings → Apps → the browser → Permissions → Microphone), or type the note.'; await draw(); return; }
      started = Date.now();
      notice = 'The browser doesn’t let KidTube record the microphone, so its own speech recognition writes this note (less accurate). To fix it, allow the microphone for the browser (Android Settings → Apps → the browser → Permissions).';
    } else {
      notice = 'The browser’s speech recognition writes this note. For much better text, add a free Gemini key: Settings → Talking friend → Gemini API key.';
    }
    // The browser's own recognition. Android ends it after a pause, so it starts again and the words join the same note.
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = false;
    let said = '', stopped = false, failed = false;
    const until = Date.now() + LONG_NOTE_MINUTES * 60000;
    rec = { stop: () => { stopped = true; try { r.stop(); } catch {} } };
    r.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) said = `${said} ${e.results[i][0].transcript}`.trim(); };
    r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') { failed = true; notice = `Dictation stopped (${e.error}). Type the note, or use the 🎤 on the keyboard.`; } };
    r.onend = async () => {
      if (!stopped && !failed && Date.now() < until) { try { r.start(); return; } catch {} }
      rec = null;
      stopClock();
      if (said) await save(said, at); else await draw();
    };
    try { r.start(); await draw(); } catch { rec = null; stopClock(); notice = 'Dictation isn’t available here: type the note.'; await draw(); }
  }

  fab.addEventListener('click', () => {
    if (rec) return rec.stop();
    if (writing) return;
    record();
  });
  draw();
  return { refresh: draw };
}

// The standing instructions for the helper (the Prompt tab): the list with Remove (added with the 🎤).
// onChange() redraws the page after one is added or removed.
export function promptNotesBox(notes, onChange) {
  const list = el('ul', 'notes');
  for (const n of notes) {
    const li = el('li', 'pnote');
    const text = el('span', '', n.text);
    const meta = el('time', '', `${new Date(n.at).toLocaleDateString()}${n.pending ? ' · waiting for the next run' : ''}`);
    li.append(meta, text, btn('Remove', async () => {
      const r = await ask({ type: 'promptNote', action: 'remove', noteId: n.id });
      if (!r?.ok) return toast('Could not remove it. Try again.');
      toast('Removed. The helper stops following it from its next run.');
      onChange();
    }, 'small'));
    list.append(li);
  }
  return [
    el('p', 'muted', 'Standing instructions the helper follows on every run, as part of its prompt. They win over its steps, but not over its safety rules. To add one, tap 🎤 (bottom right) on this tab. A note on another tab is a one-off wish.'),
    notes.length ? list : el('p', 'muted', 'None yet.'),
  ];
}
