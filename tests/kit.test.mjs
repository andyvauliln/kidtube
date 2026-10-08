// The parent's note dictation (parent/kit.js) and the apps header's drop-downs (ui/header.js), on a tiny fake page.
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
globalThis.chrome = {
  runtime: { sendMessage: (msg, cb) => { sent.push(msg); cb({ ok: true }); }, lastError: null },
  storage: { local: { get: async () => ({}) }, onChanged: { addListener() {}, removeListener() {} } },
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
const micOf = (box) => find(box, (n) => n.className === 'small mic');
const { noteBox } = await import('../extension/parent/kit.js');

test('a dictated note with pauses stays one note until ⏹', async () => {
  const box = noteBox({ list: 'today' }, [], 'Note');
  const mic = micOf(box);
  mic.click();
  await tick();
  assert.equal(mic.textContent, '⏹');
  rec.phrase('when they switch the account');
  rec.phrase('the menu goes under the tabs');
  await tick();
  assert.equal(rec.starts, 3, 'started again after each pause');
  assert.equal(sent.filter((m) => m.type === 'wish').length, 0, 'nothing saved while still recording');
  mic.click();
  await tick();
  const wishes = sent.filter((m) => m.type === 'wish');
  assert.equal(wishes.length, 1);
  assert.equal(wishes[0].text, 'when they switch the account the menu goes under the tabs');
  assert.equal(mic.textContent, '🎤');
});

test('a recognition error ends the recording and keeps what was heard', async () => {
  sent.length = 0;
  const box = noteBox({ list: 'today' }, [], 'Note');
  const mic = micOf(box);
  mic.click();
  await tick();
  rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'more animals' }], { isFinal: true })] });
  rec.onerror({ error: 'network' });
  rec.onend();
  await tick();
  assert.equal(rec.starts, 1);
  assert.deepEqual(sent.filter((m) => m.type === 'wish').map((m) => m.text), ['more animals']);
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
