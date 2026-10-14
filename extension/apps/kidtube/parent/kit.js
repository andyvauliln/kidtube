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

// --- up and down through boxes, as in Reels (the parent's note, 2026-10-13) -------------------------------
// Settings' 🔳 One box and Context's 🔳 Full screen: a swipe up goes to the next box, a swipe down to the one before,
// ↓ ↑ (and Page Down / Page Up) on a keyboard always. A box longer than the screen scrolls first: only from its end does
// the next swipe go on. A swipe left or right does nothing there.
// Then (the parent's note, 2026-10-13: "very hard to swipe", "I cannot scroll"): a finger that scrolled the page (or a
// field) never changes the box, and a shorter, less straight swipe is enough, also on a field (most of Hearing is fields).
// The step for a swipe of dx, dy from a start that was (or not) at the box's top and its end, and that scrolled
// something (moved) or not: 1, -1 or 0.
export function swipeStep(start, dx, dy, moved = false) {
  if (moved || Math.abs(dy) < 45 || Math.abs(dx) > Math.abs(dy)) return 0;
  if (dy < 0) return start.bottom ? 1 : 0;
  return start.top ? -1 : 0;
}
// The step for a key: 1, -1 or 0 (not in a field, and not with Ctrl, Alt or ⌘).
export function keyStep(e) {
  if (e.ctrlKey || e.altKey || e.metaKey || e.target?.closest?.('textarea, input, select, [contenteditable]')) return 0;
  if (e.key === 'ArrowDown' || e.key === 'PageDown') return 1;
  if (e.key === 'ArrowUp' || e.key === 'PageUp') return -1;
  return 0;
}
// on(): the mode is on here; box(): the box on the screen; go(step): show the next (1) or the one before (-1).
// The keys stop with the host's page. Not from the field being typed in (its keyboard is open) or from skip.
export function upDown(host, { on, box, go, skip = '' }) {
  let start = null;
  const scrolled = () => { if (start) start.moved = true; };
  host.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    const r = box()?.getBoundingClientRect();
    const typing = e.target === document.activeElement && e.target.closest?.('textarea, input');
    start = on() && r && e.touches.length === 1 && !typing && !(skip && e.target.closest?.(skip))
      ? { x: t.clientX, y: t.clientY, sy: scrollY, moved: false, top: scrollY <= 2 || r.top >= -24, bottom: r.bottom <= innerHeight + 24 } : null;
  }, { passive: true });
  // Any scroll while the finger is down (the page, a long field, a wide table): it was a scroll, not a swipe.
  document.addEventListener('scroll', scrolled, { passive: true, capture: true });
  host.addEventListener('touchend', (e) => {
    if (!start) return;
    const t = e.changedTouches[0];
    const step = swipeStep(start, t.clientX - start.x, t.clientY - start.y, start.moved || Math.abs(scrollY - start.sy) > 2);
    start = null;
    if (step) go(step);
  }, { passive: true });
  host.addEventListener('touchcancel', () => { start = null; }, { passive: true });
  const key = (e) => {
    if (!host.isConnected) return removeEventListener('keydown', key);
    const step = on() ? keyStep(e) : 0;
    if (!step) return;
    e.preventDefault();
    go(step);
  };
  addEventListener('keydown', key);
}
// While the mode is on (the parent's notes, 2026-10-13): a swipe down at the top goes to the box before, it does not
// reload the page (html.updown stops the browser's pull-to-refresh; parent.css). Out of the mode it reloads as before.
// tapped: the mode's button was just tapped, so the browser may also go full screen (no status bar or notifications
// on top); leaving the mode leaves full screen. html.updown also hides the apps header with its notifications
// (the parent's note, 2026-10-13; parent.css); the tabs stay, with the Full size switch to leave it (2026-10-14). A browser that refuses full screen keeps the mode as it was.
export function holdPage(on, tapped = false) {
  document.documentElement.classList.toggle('updown', on);
  if (on && tapped && !document.fullscreenElement) document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => {});
  if (!on && document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {});
}
// --- Full size: one switch for every tab (the parent's note, 2026-10-14) ----------------------------------------
// It replaced each tab's own 🔳 One box / Full screen button: the switch at the right end of the tabs turns it on or off
// on every tab at once, and it stays as it was left (this tablet, localStorage). On: one box (a video, a document, a
// Settings or Prompt box) on the screen, a swipe up for the next. The tabs stay on top (the switch is there).
const FULL_KEY = 'kidtubeFullSize';
export function isFull() {
  try { return globalThis.localStorage?.getItem(FULL_KEY) === '1'; } catch { return false; }
}
// tapped: the switch was just tapped (the browser may go full screen). Tells every view: 'kidtube-fullsize'.
export function setFull(on, tapped = false) {
  try { globalThis.localStorage?.setItem(FULL_KEY, on ? '1' : '0'); } catch {}
  holdPage(on, tapped);
  globalThis.dispatchEvent?.(new Event('kidtube-fullsize'));
}

// The box comes in from below (step 1) or from above (-1).
export function slideIn(node, step) {
  node.classList.remove('from-below', 'from-above');
  void node.offsetWidth;
  node.classList.add(step > 0 ? 'from-below' : 'from-above');
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
// Pauses don't end it: it records until ⏹. The card shows the recording and has a box to type a note instead.
// While it records (the parent's note, 2026-10-14): ⏹ Stop keeps the note in 🔔 as before; ➤ Stop and send sends it to
// the AI as soon as it is written down (sendAfter).
// The notes themselves are only in the header's notifications (🔔): Edit, Delete, Send, Send all, and the checkboxes
// of what goes with each one (core/background/inbox.js): 📄 This screen and ⚙️ App data, kept with every note when it
// is made (the background's madeWith) and only sent when ticked, and ❓ Question.
// The words are written down by Groq's Whisper, Gemini (gemini-3.5-transcribe first) or OpenRouter (Settings → keys). Only without either key
// the browser's own speech recognition writes them, and the card says so.
const LONG_NOTE_MINUTES = 15;   // the browser's recognition
const CLOUD_NOTE_MINUTES = 5;   // Gemini / OpenRouter: 5 min of 16 kHz WAV is ~13 MB sent, under Gemini's 20 MB
const TYPE_LABEL = { today: 'Today', planned: 'Planned', history: 'History', settings: 'Settings' };

// The screen as the parent sees it now, for a note's This screen. at: where() when the note started.
function snapshot(at) {
  const view = document.getElementById('view') ?? document.querySelector('main') ?? document.body;
  const where = at.videoId ? `video ${at.videoId}` : at.doc ? `context document ${at.doc}` : at.prompt ? 'the Prompt tab'
    : `the ${TYPE_LABEL[at.list] ?? 'Settings'} tab${at.section ? `, box “${at.section}”` : ''}`;
  return {
    where, title: document.title, path: `${location.pathname.replace(/^\/+/, '')}${location.hash}`,
    text: (view.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000),
    viewport: `${innerWidth}×${innerHeight}`, userAgent: navigator.userAgent,
  };
}

// A page that can't be read (no view) sends the note without its screen.
const shot = (at) => { try { return snapshot(at); } catch { return null; } };

// where(): { list, section? } | { videoId } | { doc, docName } | { prompt: true } — what the screen shows now.
// fabHost: where the 🎤 goes (the parent page's bottom bar); without one it floats bottom right.
export function notesDock({ card, where, onSaved = () => {}, fabHost = null }) {
  const fab = el('button', `notefab${fabHost ? ' docked' : ''}`, '🎤');
  fab.title = 'Record a note for the AI about this screen';
  fab.setAttribute('aria-label', fab.title);
  (fabHost ?? document.body).append(fab);
  let rec = null;            // the recording in progress: { stop }
  let writing = false;       // the recording is being written down
  let started = 0, clock = null, notice = '', cloud = false;
  // On a fresh page the card is closed (the notes are in the header's 🔔 list); a recording opens it.
  let expanded = false;
  let sendAfter = false;     // ➤ Stop and send was tapped: the note goes to the AI once saved

  // more: what else goes with the note (voice: a recording for the server to write down).
  const save = async (text, at = where(), more = {}) => {
    // The screen where the note started (a recording took it then) and the app's state now: kept with the note,
    // sent only when its row in 🔔 ticks them (offer).
    const extra = { screen: at.shot ?? shot(at), withApp: true, offer: true, ...more };
    const r = at.videoId ? await ask({ type: 'note', videoId: at.videoId, comment: text, ...extra })
      : at.doc ? await ask({ type: 'contextNote', doc: at.doc, text, ...extra })
      : at.prompt ? await ask({ type: 'promptNote', action: 'add', text, ...extra })
      : await ask({ type: 'wish', list: at.list ?? 'settings', ...(at.section ? { section: at.section } : {}), text, ...extra });
    if (!r?.ok) { toast('Could not save the note. Is parent mode still on?'); return false; }
    notice = '';
    expanded = false;
    card.classList.remove('open');
    await draw();
    // ➤ Stop and send: this note goes now (a recording the server still writes down waits: it has no words yet).
    const go = sendAfter && r.eventId && !more.voice;
    sendAfter = false;
    const sent = go ? await ask({ type: 'inbox', do: 'note.send', id: r.eventId }) : null;
    if (go) checkSent(r.eventId, sent);
    if (sent?.ok) toast('Sent to the AI. The 🔔 list shows when it answers.');
    else if (go) toast(`Saved, but not sent: ${sent?.error ?? 'no answer'}. Send it from the 🔔 list.`);
    else toast('Saved. It waits in the 🔔 list: send it there, or tick what goes with it.');
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
    const busy = rec || writing;
    card.hidden = !busy && !retry && !notice && !expanded && !card.classList.contains('open');
    fab.textContent = rec ? '⏹' : writing ? '…' : '🎤';
    fab.classList.toggle('on', !!rec);
    if (card.hidden) return;
    const head = el('div', 'nchead');
    head.append(el('h2', '', 'Note for the AI'));
    const close = el('button', 'ghost small nclose', '✕');
    close.title = 'Close (your notes are in the header’s 🔔 list)';
    close.addEventListener('click', () => { expanded = false; notice = ''; card.classList.remove('open'); if (!busy) card.hidden = true; else draw(); });
    if (!busy) head.append(close);
    const parts = [head];
    if (rec) {
      const s = Math.round((Date.now() - started) / 1000);
      parts.push(el('p', 'recline', `● Recording ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · pauses are fine · tap ⏹ to stop${cloud ? ` (it stops by itself at ${CLOUD_NOTE_MINUTES}:00)` : ''}`));
      const stop = el('div', 'ncacts recacts');
      const keep = el('button', 'small', '⏹ Stop');
      keep.title = 'Stop: the note waits in the 🔔 list';
      keep.addEventListener('click', () => { sendAfter = false; rec?.stop(); });
      const go = el('button', 'small primary', '➤ Stop and send');
      go.title = 'Stop, and send the note to the AI as soon as it is written down';
      go.addEventListener('click', () => { sendAfter = true; rec?.stop(); });
      stop.append(keep, go);
      parts.push(stop);
    } else if (writing) parts.push(el('p', 'recline', 'Writing it down…'));
    if (notice) parts.push(el('p', 'muted', notice));
    if (retry && !busy) {
      const again = el('div', 'ncacts');
      again.append(
        btn('Delete recording', async () => { retry = null; notice = ''; await draw(); }, 'small'),
        btn('Try again', () => writeDown(retry.audio, retry.at), 'small primary'));
      parts.push(again);
    }
    const row = el('div', 'noterow');
    row.append(typed, addTyped);
    parts.push(row, el('p', 'hint', 'Saved notes wait in the 🔔 list above: Send, Send all, Edit, Delete, and what goes with each one.'));
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
    at.shot = shot(at);
    const keys = await listenKeys();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    notice = '';
    retry = null;
    expanded = true;
    sendAfter = false;
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

  // ➤ Stop and send: the note left the 🔔 list's "Not sent" (sent, or the run asked for).
  function checkSent(id, res) {
    globalThis.KidTubeWatch?.check({ id: 'notes.stopAndSend', area: 'notes', expect: '➤ Stop and send sends the recorded note to the AI at once',
      code: ['apps/kidtube/parent/kit.js notesDock save', 'core/background/inbox.js inboxAct note.send'] }, async (t) => {
      t.ok('the send was accepted', !!res?.ok, res?.error ?? 'no answer', 'ok');
      const left = await ask({ type: 'heldNotes' });
      t.ok('it is not waiting on the tablet', !(left?.notes ?? []).some((n) => n.id === id), 'still held', 'sent');
    }, 3000);
  }

  fab.addEventListener('click', () => {
    if (rec) return rec.stop();
    if (writing) return;
    record();
  });
  draw();
  return { refresh: draw };
}

// --- a double tap on a text makes it editable (the parent's note, 2026-10-13) ----------------------------------
// The Prompt and Context tabs: a double tap (or double click) on a paragraph, a list item or a heading of a text
// (inside [data-source]: the file it comes from) opens a field with its words. Save sends the change as a note for
// the AI, with the old words and the new, and the file: the texts live in GitHub, so the AI on the server makes the
// change (the prompt files in the code, the documents in the data repo). The tablet marks the paragraph meanwhile.
export const EDITABLE = 'p, li, h3, h4, h5, h6, pre';
// The note for one change: under 2000 characters (the notes' limit); a long old text is shortened to its start.
export function editNote(source, before, after) {
  const cut = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);
  const now = after ? `replace “${cut(before, 1900 - Math.min(after.length, 1400) - source.length - 40)}” with “${cut(after, 1400)}”`
    : `delete “${cut(before, 1800)}”`;
  return `Edit in ${source}: ${now}.`;
}
// The words of a paragraph or list item without its sub-list.
export function ownText(node) {
  const c = node.cloneNode(true);
  for (const sub of c.querySelectorAll?.('ul, ol, .editform, .edited') ?? []) sub.remove();
  return c.textContent.replace(/\s+/g, ' ').trim();
}
// root: the page part to watch; send(text, source): saves the note, returns { ok }. Two taps on the same text within
// 450 ms open it (a tablet's double tap sends no dblclick when it zooms; a mouse sends both, and both open it once).
export function editOnDoubleTap(root, send, ms = 450) {
  let last = null;
  const target = (e) => {
    const n = e.target?.closest?.(EDITABLE);
    return n && n.closest('[data-source]') && !n.closest('.editform, .edited, .old, summary, button, .about') ? n : null;
  };
  root.addEventListener('click', (e) => {
    const n = target(e);
    if (n && last?.n === n && e.timeStamp - last.t < ms) { last = null; startEdit(n, send); return; }
    last = n ? { n, t: e.timeStamp } : null;
  });
  root.addEventListener('dblclick', (e) => { const n = target(e); if (n) { getSelection?.()?.removeAllRanges?.(); startEdit(n, send); } });
}
export function startEdit(node, send) {
  if (node.classList.contains('editing')) return;
  const source = node.closest('[data-source]').dataset.source;
  const before = ownText(node);
  const form = el('div', 'editform');
  const area = el('textarea');
  area.value = before;
  area.rows = 3;
  // As tall as its words, also while typing: no scroll inside it (the parent's note, 2026-10-14).
  const fit = () => { area.style.height = 'auto'; area.style.height = `${area.scrollHeight + 2}px`; };
  area.addEventListener('input', fit);
  const close = (...put) => { node.classList.remove('editing'); form.replaceWith(...put); };
  const save = btn('Save', async () => {
    const after = area.value.replace(/\s+/g, ' ').trim();
    if (after === before) return close();
    const r = await send(editNote(source, before, after), source);
    if (!r?.ok) return toast('Could not save the change. Is parent mode still on?');
    node.classList.add('old');
    close(el('div', 'edited', after ? `✎ Your new words: ${after}` : '✎ You deleted this'));
    toast('Saved. It waits in the 🔔 list: send it there, and the AI changes the text.');
    hooks.afterRun();
  }, 'small primary');
  const actions = el('div', 'actions');
  actions.append(save, btn('Cancel', () => close(), 'small'));
  form.append(el('div', 'muted', `Change the words, then Save. The AI changes ${source} with them.`), area, actions);
  node.classList.add('editing');
  if (node.tagName === 'LI') node.append(form); else node.after(form);
  fit();
  area.focus();
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
