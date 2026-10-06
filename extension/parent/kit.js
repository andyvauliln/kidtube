// Pieces shared by the parent screens and the settings view: elements, buttons, the toast,
// and the note-for-the-AI control (type or dictate, then add it, or add it and run the helper now).
import { ask } from '../lib/ask.js';
import { recordAnswer, transcribeAnswer, listenKeys } from '../ui/voice.js';

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

// --- writing a note for the helper ------------------------------------------------------------------
let dictating = null;   // the one recording in progress: { stop }
// After ⏹ the words go to addNote(text) at once: the note joins the list (and waits for ↻ Update).
function micButton(ta, addNote) {
  const lang = navigator.language || 'en-US';
  // Not btn(): that one stays disabled until its work ends, and here the work is the recording, so ⏹ couldn't be tapped.
  const b = el('button', 'small mic', '🎤');
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (dictating) return dictating.stop();
    if (b.textContent === '…') return;   // still writing the last one down
    let said = '';
    const add = (text) => { text = text.trim(); if (text) said = said ? `${said} ${text}` : text; };
    const finish = async () => {
      if (!said) return;
      const text = said;
      said = '';
      if (!(await addNote(text))) { ta.value = (ta.value.trim() ? ta.value.trim() + ' ' : '') + text; ta.dispatchEvent(new Event('input')); }
    };
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const keys = await listenKeys();
    b.classList.add('on');
    b.textContent = '⏹';
    const done = () => { dictating = null; b.classList.remove('on'); b.textContent = '🎤'; };
    if (keys.gemini || keys.openrouter) {
      // Cloud: records until you tap ⏹ (at most 2 minutes), then writes it down (free Gemini first, then OpenRouter).
      const ctl = new AbortController();
      dictating = { stop: () => ctl.abort() };
      toast('Speak your note, then tap ⏹.');
      const audio = await recordAnswer({ seconds: 120, stopSignal: ctl.signal, silenceStop: false });
      b.textContent = '…';
      const heard = audio ? await transcribeAnswer(audio, { keys, lang, maxTokens: 800,
        instruction: 'A parent dictates a note about their child\'s videos and learning. Use punctuation.' }) : null;
      done();
      if (heard?.length) { add(heard[0]); return finish(); }
      if (heard === null && !SR) return toast('Could not write it down. Use the 🎤 on the iPad keyboard instead.');
      if (heard) return toast('Heard nothing.');
    }
    if (!SR) { done(); return toast('Dictation isn’t available here. Use the 🎤 on the iPad keyboard instead.'); }
    // The device's own speech recognition: keeps listening until you tap ⏹.
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = false;
    dictating = { stop: () => { try { r.stop(); } catch {} } };
    r.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) add(e.results[i][0].transcript); };
    r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Dictation stopped. You can use the 🎤 on the iPad keyboard instead.'); };
    r.onend = () => { done(); finish(); };
    try { r.start(); } catch { done(); toast('Dictation isn’t available here. Use the 🎤 on the iPad keyboard instead.'); }
  });
  b.title = 'Dictate the note';
  return b;
}

// textarea + 🎤 + "Add note" + "Add & ↻ Update". save(text) → true when saved.
// Notes stay on this tablet until ↻ Update sends them all; the AI on the server then reads them within a minute.
export function noteInput({ placeholder, value = '', onInput, save, saveLabel = 'Add note', failText = 'Could not save it. Is parent mode still on?' }) {
  const ta = el('textarea');
  ta.maxLength = 2000;
  ta.placeholder = placeholder;
  ta.value = value;
  if (onInput) ta.addEventListener('input', () => onInput(ta.value));
  const added = () => { toast('Added. Tap ↻ Update to send your notes.'); hooks.afterRun(); };
  const go = async (andRun) => {
    if (dictating) dictating.stop();
    const text = ta.value.trim();
    if (!text) return andRun ? runNow() : undefined;
    if (!(await save(text))) return toast(failText);
    ta.value = '';
    onInput?.('');
    if (andRun) await runNow(); else added();
  };
  const dictated = async (text) => { if (!(await save(text))) { toast(failText); return false; } added(); return true; };
  const row = el('div', 'noterow');
  const update = btn('Add & ↻ Update', () => go(true));
  update.title = 'Add this note, then send all your notes to the AI now';
  row.append(micButton(ta, dictated), btn(saveLabel, () => go(false), 'primary'), update);
  return { ta, row, nodes: [ta, row] };
}

// "📝 Note for the AI" at the top of a tab: a button that opens the note control, and the notes so far.
// target: { list } (a whole tab) or { videoId }. buttonInto: put the button there instead (a video's actions).
export function noteBox(target, past = [], label = 'Note for the AI', buttonInto = null) {
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
  const examples = { history: 'He loved the animal videos, more like these', settings: 'Parent mode should open with the Planned tab', today: 'Too many videos about space, more numbers please', planned: 'Too many videos about space, more numbers please' };
  const input = noteInput({
    placeholder: target.list ? `For example: “${examples[target.list] ?? examples.today}”` : 'For example: “Good one, more like this” or “Too fast for him”',
    save: async (text) => {
      const r = target.list ? await ask({ type: 'wish', list: target.list, text }) : await ask({ type: 'note', videoId: target.videoId, comment: text });
      if (!r?.ok) return false;
      past = [...past, { at: new Date().toISOString(), text }];
      show(past);
      return true;
    },
  });
  const ta = input.ta;
  box.append(...input.nodes);
  const open = btn(`📝 ${label}`, () => { box.hidden = !box.hidden; if (!box.hidden) ta.focus(); });
  if (buttonInto) buttonInto.append(open); else wrap.append(open);
  wrap.append(box, list);
  return wrap;
}

// The standing instructions for the helper (Prompt tab and Settings): the list with Remove, and the input.
// onChange() redraws the page after one is added or removed.
let promptDraft = '';
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
  const input = noteInput({
    placeholder: 'For example: “Every day one video about animals” · “Questions only in English” · “No videos longer than 8 minutes on school days”',
    value: promptDraft, onInput: (v) => { promptDraft = v; }, saveLabel: 'Add to the prompt', failText: 'Could not save it. Try again.',
    save: async (text) => { const r = await ask({ type: 'promptNote', action: 'add', text }); if (r?.ok) setTimeout(onChange, 300); return r?.ok; },
  });
  return [
    el('p', 'muted', 'Standing instructions the helper follows on every run, as part of its prompt. They win over its steps, but not over its safety rules. For one-off wishes send a message to the helper (Settings) or add a note to a video or a list.'),
    notes.length ? list : el('p', 'muted', 'None yet.'), ...input.nodes,
  ];
}

// --- Profiles: every email has its own lists, settings, notes and helper; each profile has one app ------
// Shown in parent mode (Profiles tab) and in Settings. onStay: after a switch that needs no Google sign-in.
export async function profilesPanel(box, { onStay = () => location.reload() } = {}) {
  const p = await ask({ type: 'profiles' });
  if (!p?.ok) { box.replaceChildren(el('p', 'err', 'KidTube’s background did not answer. Close this page and open it again.')); return; }
  const appLabel = (id) => p.apps.find((a) => a.id === id)?.label ?? id;
  const go = async (msg) => {
    const r = await ask(msg);
    if (!r?.ok) { toast(r?.error ?? 'That didn’t work. Try again.'); return; }
    // YouTube signs in the same Google account, then comes back with the new profile.
    if (r.switched && r.chooser) { location.href = r.chooser; return; }
    toast('Switched.');
    onStay();
  };
  const rows = p.profiles.map((pr) => {
    const row = el('div', 'box profile');
    const me = pr.key === p.current;
    row.append(el('h3', '', `${me ? '✓ ' : ''}${pr.email || pr.name || pr.key}`),
      el('p', 'muted', `App: ${appLabel(pr.app)} · data folder ${pr.app}/${pr.folder ?? '(given on the first sync)'}${pr.lastSeen ? ` · last used ${new Date(pr.lastSeen).toLocaleDateString()}` : ''}`));
    if (me) row.append(el('p', 'muted', p.waitingFor === pr.key ? 'Current profile. Waiting for YouTube to sign in to this account (pick it when Google asks).' : 'Current profile.'));
    else {
      const actions = el('div', 'actions');
      actions.append(btn('Switch to this profile', () => go({ type: 'switchProfile', key: pr.key }), 'primary'), btn('Remove from this tablet', async () => {
        if (!confirm(`Remove ${pr.email || pr.key} from this tablet? Its lists and settings here are deleted. Its folder in the data repo stays.`)) return;
        const r = await ask({ type: 'removeProfile', key: pr.key });
        if (!r?.ok) toast(r?.error ?? 'Could not remove it.');
        profilesPanel(box, { onStay });
      }, 'ghost'));
      row.append(actions);
    }
    return row;
  });
  const add = el('div', 'box');
  const email = el('input');
  Object.assign(email, { type: 'email', id: 'newEmail', placeholder: 'child@gmail.com', autocomplete: 'off', autocapitalize: 'off' });
  const app = el('select');
  app.id = 'newApp';
  for (const a of p.apps) { const o = el('option', '', a.label); o.value = a.id; app.append(o); }
  const label = (text, forId) => { const l = el('label', '', text); l.htmlFor = forId; return l; };
  const actions = el('div', 'actions');
  actions.append(btn('Add and switch', () => go({ type: 'addProfile', email: email.value, app: app.value }), 'primary'));
  add.append(el('h3', '', 'Add a profile'),
    el('p', 'muted', 'For another child or another YouTube account. A new email starts empty: its own lists, history, settings, notes and helper. The PIN and the GitHub connection stay the same.'),
    label('Email of the YouTube (Google) account', 'newEmail'), email, label('App', 'newApp'), app, actions);
  box.replaceChildren(...(rows.length ? rows : [el('p', 'muted', 'No YouTube account seen yet: open YouTube once, or add one below.')]), add,
    el('p', 'muted', 'After a switch, Google asks which account YouTube should use: pick the same email. If it doesn’t ask, tap your picture in YouTube → Switch account.'));
}
