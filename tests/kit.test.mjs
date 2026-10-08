// The parent's notes for the AI (parent/kit.js: the 🎤 button and the notes card) and the apps header's drop-downs (ui/header.js), on a tiny fake page.
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.listeners = {}; this.style = {};
    this.className = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this.value = ''; this.attrs = {};
    const cls = new Set();
    this.classList = { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => (on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c) };
  }
  append(...n) { this.children.push(...n); }
  replaceChildren(...n) { this.children = n; }
  remove() {}
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  dispatchEvent(e) { for (const fn of this.listeners[e.type] ?? []) fn(e); }
  focus() {}
  click() { for (const fn of this.listeners.click ?? []) fn({ stopPropagation() {} }); }
  attachShadow() { this.shadowRoot = new FakeEl('#shadow'); return this.shadowRoot; }
}
globalThis.document = { createElement: (t) => new FakeEl(t), createElementNS: (_, t) => new FakeEl(t), createTextNode: (t) => t, body: new FakeEl('body') };
const sent = [];
const local = {};   // chrome.storage.local
const answers = {};   // type → (msg) => the background's answer
globalThis.chrome = {
  runtime: { sendMessage: (msg, cb) => { sent.push(msg); cb(answers[msg.type]?.(msg) ?? { ok: true }); }, lastError: null },
  storage: { local: { get: async (keys) => Object.fromEntries([keys].flat().filter((k) => k in local).map((k) => [k, local[k]])) }, onChanged: { addListener() {}, removeListener() {} } },
};

// The device's speech recognition the Android way: each phrase ends it, and the page has to start it again.
let rec = null;
class FakeRecognition {
  constructor() { rec = this; this.starts = 0; }
  start() { this.starts++; }
  stop() { setTimeout(() => this.onend(), 0); }
  phrase(text) {
    this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
    this.onend();
  }
}
globalThis.window = { SpeechRecognition: FakeRecognition };
const tick = () => new Promise((r) => setTimeout(r, 5));

const find = (n, pred) => pred(n) ? n : (n.children ?? []).map((c) => typeof c === 'object' && find(c, pred)).find(Boolean);
const text = (n) => typeof n === 'string' ? n : [n.textContent, ...(n.children ?? []).map(text)].join(' ');
const button = (root, label) => find(root, (n) => n.tagName === 'BUTTON' && n.textContent.startsWith(label));
const { notesDock } = await import('../extension/parent/kit.js');
let screen = { list: 'today' };
const card = new FakeEl('div');
notesDock({ card, where: () => screen, docNames: { math: 'Math' } });
const fab = document.body.children.find((n) => n.className === 'notefab');

test('one 🎤 for every note: pauses keep it one note until ⏹, about the screen it started on', async () => {
  fab.click();
  await tick();
  assert.equal(fab.textContent, '⏹');
  assert.equal(card.hidden, false, 'the card shows while it records');
  assert.match(text(card), /browser’s speech recognition/, 'says which recognition writes it (no Gemini key)');
  screen = { list: 'planned' };   // moving on while it records doesn't change what the note is about
  rec.phrase('when they switch the account');
  rec.phrase('the menu goes under the tabs');
  await tick();
  assert.equal(rec.starts, 3, 'started again after each pause');
  assert.equal(sent.filter((m) => m.type === 'wish').length, 0, 'nothing saved while still recording');
  fab.click();
  await tick();
  const wishes = sent.filter((m) => m.type === 'wish');
  assert.deepEqual(wishes.map((m) => [m.list, m.text]), [['today', 'when they switch the account the menu goes under the tabs']]);
  assert.equal(fab.textContent, '🎤');
});

test('a recognition error ends the recording and keeps what was heard', async () => {
  sent.length = 0;
  screen = { videoId: 'abcdefghijk' };
  fab.click();
  await tick();
  rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'more animals' }], { isFinal: true })] });
  rec.onerror({ error: 'network' });
  rec.onend();
  await tick();
  assert.equal(rec.starts, 1);
  assert.deepEqual(sent.filter((m) => m.type === 'note').map((m) => [m.videoId, m.comment]), [['abcdefghijk', 'more animals']]);
});

test('the notes card: every waiting note with where it was made, ✕, Clear all and Apply notes', async () => {
  let held = [
    { id: 'n1', type: 'wish', list: 'today', text: 'more numbers' },
    { id: 'n2', type: 'parentNote', videoId: 'abcdefghijk', title: 'Counting song', text: 'too fast' },
    { id: 'n3', type: 'context', doc: 'math', text: 'counts to 20' },
  ];
  answers.heldNotes = () => ({ ok: true, notes: held });
  answers.dropNote = (m) => { held = m.all ? [] : held.filter((n) => n.id !== m.id); return { ok: true }; };
  answers.runHelper = () => ({ ok: true });
  globalThis.confirm = () => true;
  sent.length = 0;
  screen = { doc: 'math' };
  fab.click();   // records about the Math document
  await tick();
  rec.phrase('and adds small numbers');
  fab.click();
  await tick();
  assert.deepEqual(sent.find((m) => m.type === 'contextNote'), { type: 'contextNote', doc: 'math', text: 'and adds small numbers' });
  const shown = text(card);
  for (const s of ['Notes for the AI · 3', 'Today', 'Video · Counting song', 'Context · Math', 'too fast']) assert.ok(shown.includes(s), s);

  const li = find(card, (n) => n.tagName === 'LI' && text(n).includes('too fast'));
  button(li, '✕').click();
  await tick();
  assert.deepEqual(sent.at(-2), { type: 'dropNote', id: 'n2' });
  assert.ok(!text(card).includes('too fast'));

  button(card, 'Apply notes (2)').click();
  await tick();
  assert.ok(sent.some((m) => m.type === 'runHelper'), 'Apply notes sends them and runs the AI');

  button(card, 'Clear all').click();
  await tick();
  assert.ok(sent.some((m) => m.type === 'dropNote' && m.all));
  assert.equal(card.hidden, true, 'no notes and not recording: the card hides');
});

test('the apps header sits above the page’s sticky toolbar, so its menus show; YouTube’s fixed one is left alone', async () => {
  await import('../extension/ui/header.js');
  const page = new FakeEl('div');
  globalThis.KidTubeHeader.mount(page, { dark: false });
  assert.equal(page.style.position, 'relative');
  assert.ok(Number(page.style.zIndex) > 5, 'above parent.css’s sticky header (z-index 5)');
  const yt = new FakeEl('div');
  yt.style.position = 'fixed'; yt.style.zIndex = '2147483646';
  globalThis.KidTubeHeader.mount(yt, { dark: false });
  assert.equal(yt.style.position, 'fixed');
  assert.equal(yt.style.zIndex, '2147483646');
});

test('a key, but the browser won’t let KidTube record: its own recognition writes the note, and the card says why', async () => {
  answers.heldNotes = () => ({ ok: true, notes: [] });
  local.repoKeys = { gemini: 'AQ.test' };   // node has no microphone: recordAnswer gives null
  sent.length = 0;
  screen = { list: 'history' };
  fab.click();
  await tick();
  assert.equal(fab.textContent, '⏹');
  assert.match(text(card), /doesn’t let KidTube record the microphone/);
  rec.phrase('fewer cartoons');
  fab.click();
  await tick();
  assert.deepEqual(sent.filter((m) => m.type === 'wish').map((m) => [m.list, m.text]), [['history', 'fewer cartoons']]);
  delete local.repoKeys;
});
