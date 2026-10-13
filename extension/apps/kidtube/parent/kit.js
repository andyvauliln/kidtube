// Pieces shared by the parent screens and the settings view: elements, buttons, the toast,
// and the notes for the AI (one 🎤 button and one notes card).
import { ask } from '../../../core/lib/ask.js';
import { recordAnswer, transcribeAnswer, listenKeys, NOTE_LISTEN_MODELS, VOICE_TEXT } from '../lib/voice.js';
import { bytesToBase64 } from '../../../core/lib/github.js';

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
// Where the run is (sent, working, done) shows in the header's notifications, not in a toast at the bottom.
export async function runNow() {
  const res = await ask({ type: 'runHelper' });
  if (!res?.ok) { toast(res?.error ?? 'Could not send your notes: the extension did not answer. Try again.'); return false; }
  hooks.afterRun();
  return true;
}

// --- notes for the AI: one 🎤 button (in the bottom bar, right) and one notes card (top of the page) ---------
// The 🎤 records a note about what is on the screen (where()): a tab, a video, a context document or the prompt.
// Pauses don't end it: it records until ⏹. Then the words join the card, which lists every note still on this
// tablet, from every tab, with ✕ and Clear all. Apply notes sends them all to the AI (the same as ↻ Update).
// The header's notifications list the same notes with Edit, Delete and Send (core/background/inbox.js).
// The words are written down by Groq's Whisper, Gemini (gemini-3.5-transcribe first) or OpenRouter (Settings → keys). Only without either key
// the browser's own speech recognition writes them, and the card says so.
// Two switches in the card attach context to the next notes, so the AI on the server sees what the parent means:
// This screen (the page's visible text, its tab, the screen size and browser) and App data (the background adds the
// version, the rules, today's list and the sync status). They stay as set on this tablet.
const LONG_NOTE_MINUTES = 15;   // the browser's recognition
const CLOUD_NOTE_MINUTES = 5;   // Gemini / OpenRouter: 5 min of 16 kHz WAV is ~13 MB sent, under Gemini's 20 MB
const TYPE_LABEL = { today: 'Today', planned: 'Planned', history: 'History', settings: 'Settings' };
const ATTACH_KEY = 'kidtube.noteAttach';
const loadAttach = () => { try { return { screen: false, app: false, ...JSON.parse(localStorage.getItem(ATTACH_KEY) ?? '{}') }; } catch { return { screen: false, app: false }; } };

// The screen as the parent sees it now, for a note's This screen. at: where() when the note started.
function snapshot(at) {
  const view = document.getElementById('view') ?? document.querySelector('main') ?? document.body;
  const where = at.videoId ? `video ${at.videoId}` : at.doc ? `context document ${at.doc}` : at.prompt ? 'the Prompt tab' : `the ${TYPE_LABEL[at.list] ?? 'Settings'} tab`;
  return {
    where, title: document.title, path: `${location.pathname.replace(/^\/+/, '')}${location.hash}`,
    text: (view.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000),
    viewport: `${innerWidth}×${innerHeight}`, userAgent: navigator.userAgent,
  };
}

// where(): { list } | { videoId } | { doc, docName } | { prompt: true } — what the screen shows now.
// docNames: context document id → its name, for the card.
// fabHost: where the 🎤 goes (the parent page's bottom bar); without one it floats bottom right.
export function notesDock({ card, where, docNames = {}, onSaved = () => {}, fabHost = null }) {
  const fab = el('button', `notefab${fabHost ? ' docked' : ''}`, '🎤');
  fab.title = 'Record a note for the AI about this screen';
  fab.setAttribute('aria-label', fab.title);
  (fabHost ?? document.body).append(fab);
  let rec = null;            // the recording in progress: { stop }
  let writing = false;       // the recording is being written down
  let started = 0, clock = null, notice = '', cloud = false;
  let notes = [];
  // On a fresh page the card is closed (the waiting notes are in the header's 🔔 list); a recording opens it.
  let expanded = false;
  const attach = loadAttach();   // { screen, app }: what goes with the next notes

  const label = (n) => n.videoId ? `Video · ${n.title || n.videoId}` : n.doc ? `Context · ${docNames[n.doc] ?? n.doc}`
    : n.type === 'prompt' ? 'Prompt' : TYPE_LABEL[n.list] ?? 'Message';
  // more: what else goes with the note (voice: a recording for the server to write down).
  const save = async (text, at = where(), more = {}) => {
    // The screen where the note started (a recording took it then), and the app's state now.
    const extra = { ...(attach.screen ? { screen: at.shot ?? snapshot(at) } : {}), ...(attach.app ? { withApp: true } : {}), ...(asking ? { ask: true } : {}), ...more };
    const r = at.videoId ? await ask({ type: 'note', videoId: at.videoId, comment: text, ...extra })
      : at.doc ? await ask({ type: 'contextNote', doc: at.doc, text, ...extra })
      : at.prompt ? await ask({ type: 'promptNote', action: 'add', text, ...extra })
      : await ask({ type: 'wish', list: at.list ?? 'settings', text, ...extra });
    if (!r?.ok) { toast('Could not save the note. Is parent mode still on?'); return false; }
    if (asking) { asking = false; showAsk(); }   // the ❓ switch is for one note
    notice = '';
    expanded = true;
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

  // The two switches: pressed = attached to the next notes.
  function attachSwitch(key, text, title) {
    const b = el('button', 'small attach', text);
    b.type = 'button';
    b.title = title;
    const show = () => { b.setAttribute('aria-pressed', String(attach[key])); b.classList.toggle('on', attach[key]); };
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      attach[key] = !attach[key];
      try { localStorage.setItem(ATTACH_KEY, JSON.stringify(attach)); } catch {}
      show();
    });
    show();
    return b;
  }
  // ❓ Question: the AI answers this note in the header's list (a "?" in the words does the same). For one note.
  let asking = false;
  const askBtn = el('button', 'small attach', '❓ Question');
  askBtn.type = 'button';
  askBtn.title = 'The AI answers this note: the answer shows in the header’s 🔔 list';
  const showAsk = () => { askBtn.setAttribute('aria-pressed', String(asking)); askBtn.classList.toggle('on', asking); };
  askBtn.addEventListener('click', (e) => { e.stopPropagation(); asking = !asking; showAsk(); });
  showAsk();
  const attachRow = el('div', 'attachrow');
  attachRow.append(el('span', 'muted', 'Send with the note:'),
    attachSwitch('screen', '📄 This screen', 'Attach what this screen shows (its text, the tab, the screen size), so the AI sees what you mean'),
    attachSwitch('app', '⚙️ App data', 'Attach the app’s state: version, rules, today’s list, sync status'), askBtn);

  async function draw() {
    const r = await ask({ type: 'heldNotes' });
    notes = r?.ok ? r.notes ?? [] : notes;
    const busy = rec || writing;
    // The waiting notes are in the header's notifications (Edit, Delete, Send): the card opens only to add one.
    card.hidden = !busy && !retry && !notice && !expanded && !card.classList.contains('open');
    fab.textContent = rec ? '⏹' : writing ? '…' : '🎤';
    fab.classList.toggle('on', !!rec);
    if (card.hidden) return;
    const head = el('div', 'nchead');
    head.append(el('h2', '', notes.length ? `Notes for the AI · ${notes.length}` : 'Notes for the AI'));
    const close = el('button', 'ghost small nclose', '✕');
    close.title = 'Close (the notes stay: they are in the header’s 🔔 list)';
    close.addEventListener('click', () => { expanded = false; notice = ''; card.classList.remove('open'); if (!busy) card.hidden = true; else draw(); });
    if (!busy) head.append(close);
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
        body.append(el('span', 'nwhere', `${n.ask ? '❓ ' : ''}${label(n)}`), el('span', '', n.text));
        if (n.attached?.length) body.append(el('span', 'nattached', ['screen', 'app'].filter((a) => n.attached.includes(a)).map((a) => (a === 'screen' ? '📄 screen' : '⚙️ app data')).join(' · ')));
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
    parts.push(row, attachRow);
    if (notes.length) {
      const acts = el('div', 'ncacts');
      acts.append(
        btn('Clear all', async () => {
          if (!confirm(`Delete all ${notes.length} notes? They were not sent.`)) return;
          await ask({ type: 'dropNote', all: true });
          expanded = false;
          card.classList.remove('open');
          await draw();
          hooks.afterRun();
        }, 'small'),
        btn(`Apply notes (${notes.length})`, async () => { if (rec) rec.stop(); if (await runNow()) { expanded = false; card.classList.remove('open'); await draw(); } }, 'small primary'));
      parts.push(acts);
    }
    card.replaceChildren(...parts);
  }

  // Why a model could not write a recording down, in the card.
  const WHY = { 400: 'refused the request', 401: 'refused the key', 403: 'refused the key', 404: 'model not found', 429: 'limit reached',
    500: 'error', 503: 'busy', refused: 'did not hear it', timeout: 'too slow', network: 'no connection' };
  let retry = null;          // a recording that could not be written down: { audio, at }, kept for Try again

  // The self-check of dictation (an outside service: a probe): every model failed and the recording could not go to
  // the server either → a report with each one's reason, the recording's size and where each key comes from (typed
  // here or from the data repo; never the key itself). toServer: the server writes it down (background/voice.js).
  async function voiceCheck(heard, fails, audio, toServer) {
    const { geminiKey = '', voiceKey = '', groqKey = '', repoKeys = {} } = await chrome.storage.local.get(['geminiKey', 'voiceKey', 'groqKey', 'repoKeys']).catch(() => ({}));
    const from = (typed, repo) => (typed.trim() ? 'typed in Settings' : repo ? 'data repo' : 'none');
    globalThis.KidTubeWatch?.check({ id: 'voice.writeDown', kind: 'probe', area: 'notes',
      expect: 'A dictated note is written down by one of the speech models (Groq Whisper, then Gemini, then OpenRouter), or by the server when none answers on the tablet',
      code: ['apps/kidtube/lib/voice.js transcribeAnswer', 'apps/kidtube/parent/kit.js writeDown'] }, (t) => {
      t.note('fails', fails).note('audio', { bytes: audio?.length ?? 0, ...(audio?.info ?? {}) }).note('online', navigator.onLine)
        .note('server', toServer).note('keys', { groq: from(groqKey, repoKeys.groq), gemini: from(geminiKey, repoKeys.gemini), openrouter: from(voiceKey, repoKeys.openrouter) });
      t.ok('a model wrote the recording down, or it went to the server', heard != null || toServer, fails.join('; ') || 'no model to ask', 'one model answered, or the server has it');
    });
  }

  async function writeDown(audio, at) {
    const keys = await listenKeys();
    retry = null;
    notice = '';
    writing = true;
    await draw();
    const fails = [], details = [];
    const heard = await transcribeAnswer(audio, { keys, lang: navigator.language || 'en-US', maxTokens: 6000, freeModels: NOTE_LISTEN_MODELS,
      instruction: 'A parent dictates a note about their child\'s videos and learning, or about the app. Use punctuation.',
      onFail: (r, why, detail) => { fails.push(`${r.model}: ${WHY[why] ?? why}`); details.push(`${r.via}:${r.model}: ${why} ${detail ?? ''}`.trim()); } });
    writing = false;
    if (heard) voiceCheck(heard, details, audio, false);
    if (heard?.length) { await save(heard[0], at); return; }
    if (heard) {
      const i = audio.info;
      notice = `Heard nothing${i ? ` (${i.seconds} s recorded, loudest ${Math.round(i.peak * 100)}%${i.state !== 'running' && i.state !== 'closed' ? `, sound ${i.state}` : ''})` : ''}. Try again closer to the tablet.`;
    }
    else {
      // No speech service answered here (Google and Groq refuse some countries): the server writes it down
      // (background/voice.js). Only if that can't be saved, the recording stays here for Try again.
      const seconds = Math.round(audio.info?.seconds ?? Math.max(0, (audio.length - 44) / 32000));
      const toServer = await save(VOICE_TEXT, at, { voice: { id: crypto.randomUUID(), audio: bytesToBase64(audio), seconds } });
      voiceCheck(heard, details, audio, toServer);
      if (toServer) {
        notice = '';
        toast('No speech service answered on this tablet: the server writes the recording down. It shows in 🔔 within a few minutes.');
        return;
      }
      retry = { audio, at };
      notice = `The recording could not be written down (${fails.join('; ') || 'no key'}). It is kept: tap Try again in a minute.`;
    }
    await draw();
  }

  async function record() {
    const lang = navigator.language || 'en-US';
    const at = where();      // the screen where the note started, even if you move on while it records
    if (attach.screen) at.shot = snapshot(at);
    const keys = await listenKeys();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    notice = '';
    retry = null;
    expanded = true;
    if (!keys.groq && !keys.gemini && !keys.openrouter && !SR) {
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
    cloud = !!(keys.groq || keys.gemini || keys.openrouter);
    if (cloud) {
      const ctl = new AbortController();
      rec = { stop: () => ctl.abort() };
      await draw();
      const audio = await recordAnswer({ seconds: CLOUD_NOTE_MINUTES * 60, stopSignal: ctl.signal, silenceStop: false });
      rec = null;
      if (audio?.length) { stopClock(); await writeDown(audio, at); return; }
      if (audio) {   // no sound reached KidTube at all
        stopClock();
        const i = audio.info ?? {};
        notice = `The microphone gave KidTube no sound (${i.seconds ?? 0} s, sound ${i.state ?? '?'}). Close other apps that use the microphone, then try again.`;
        await draw();
        return;
      }
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
