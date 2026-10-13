// The parent's notes for the AI (parent/kit.js: the 🎤 button and the notes card) and the apps header's drop-downs (ui/header.js), on a tiny fake page.
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.listeners = {}; this.style = {}; this.dataset = {};
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
const changed = [];   // chrome.storage.onChanged listeners
globalThis.chrome = {
  runtime: { sendMessage: (msg, cb) => { sent.push(msg); cb(answers[msg.type]?.(msg) ?? { ok: true }); }, lastError: null },
  storage: { local: { get: async (keys) => Object.fromEntries([keys].flat().filter((k) => k in local).map((k) => [k, local[k]])), set: async (o) => { Object.assign(local, o); } }, onChanged: { addListener(fn) { changed.push(fn); }, removeListener() {} } },
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
const { notesDock } = await import('../../extension/apps/kidtube/parent/kit.js');
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

  answers.runHelper = () => ({ ok: false, error: 'offline' });   // not sent: the card stays, with its notes
  button(card, 'Apply notes (2)').click();
  await tick();
  assert.ok(sent.some((m) => m.type === 'runHelper'), 'Apply notes sends them and runs the AI');
  assert.equal(card.hidden, false);

  button(card, 'Clear all').click();
  await tick();
  assert.ok(sent.some((m) => m.type === 'dropNote' && m.all));
  assert.equal(card.hidden, true, 'no notes and not recording: the card hides');
});

test('the notes card follows the 🔔 list: a note deleted there goes from the card too; ✕ on one already gone says so', async () => {
  let held = [{ id: 'v1', type: 'wish', list: 'today', text: '🎤 A recorded note: the server writes it down…' }, { id: 'n5', type: 'wish', list: 'today', text: 'keep me' }];
  answers.heldNotes = () => ({ ok: true, notes: held });
  answers.dropNote = (m) => { const had = held.some((n) => n.id === m.id); held = held.filter((n) => n.id !== m.id); return { ok: had }; };
  screen = { list: 'today' };
  fab.click(); await tick(); rec.phrase('one more'); fab.click(); await tick();   // the card is open
  assert.ok(text(card).includes('server writes it down'));
  held = held.filter((n) => n.id !== 'v1');   // deleted in the header's list (Delete, or a swipe)
  for (const fn of changed) fn({ outbox: { newValue: [] } });
  await tick();
  assert.ok(!text(card).includes('server writes it down'), 'gone from the card at once');
  const stale = held[0];
  held = [];   // sent meanwhile
  button(find(card, (n) => n.tagName === 'LI' && text(n).includes(stale.text)), '✕').click();
  await tick();
  assert.ok(!text(card).includes('keep me'), 'the card shows what is there now');
  assert.match(text(document.body), /not here any more: it was sent, or deleted in the 🔔 list/);
});

test('the apps header sits above the page’s sticky toolbar, so its menus show; YouTube’s fixed one is left alone', async () => {
  await import('../../extension/core/ui/header.js');
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

test('the apps header: Custom Apps, Connect on a site’s page, App | site switch, no Switch, Sign in or Add app; the apps row (only the apps) starts closed on every page and reload', async () => {
  let reads = 0;
  globalThis.KidTubeAccount = { read: async () => { reads++; } };   // the site's page reads its account again first
  answers.header = () => ({
    ok: true, open: true, mode: 'parent', running: 'kidtube', site: 'youtube',
    here: { site: 'youtube', label: 'YouTube', seen: true, signedIn: true, name: 'parent@example.com', checkedAt: Date.now() },
    connected: { app: 'kidtube', label: 'KidTube', who: 'parent@example.com', site: 'YouTube' },
    github: { connected: true, repo: 'me/data' },
    switch: { app: 'kidtube', label: 'KidTube', site: 'youtube', siteLabel: 'YouTube', on: 'app' },
    apps: [{ id: 'kidtube', label: 'KidTube', has: true, active: true, color: '#c00', glyph: 'play', who: 'parent@example.com', site: 'YouTube' },
      { id: 'instagram', label: 'Instagram', has: false, active: false, color: '#d62976', glyph: 'camera', who: null, site: 'Instagram' }],
  });
  answers.connect = () => ({ ok: true, same: true, app: 'kidtube', who: 'parent@example.com', message: 'Already connected: parent@example.com (KidTube). Nothing changed.' });
  const appsRow = (host) => find(host.shadowRoot, (n) => n.className === 'apps');
  const all = (n, pred, out = []) => { if (typeof n !== 'object') return out; if (pred(n)) out.push(n); for (const c of n.children ?? []) all(c, pred, out); return out; };
  const labels = (host) => all(host.shadowRoot, (n) => n.tagName === 'BUTTON').map((b) => text(b).trim());
  const host = new FakeEl('div');
  globalThis.KidTubeHeader.mount(host, { dark: false });
  await tick();
  assert.equal(appsRow(host), undefined, 'closed when the page opens');
  const shown = labels(host);
  assert.ok(shown.some((l) => l.includes('Connect')), 'Connect on YouTube’s page');
  for (const gone of ['Switch', 'Sign in', 'Add app']) assert.ok(!shown.some((l) => l.includes(gone)), `no ${gone}`);
  assert.ok(text(host.shadowRoot).includes('parent@example.com'), 'the connected profile');
  assert.ok(text(host.shadowRoot).includes('Custom Apps'), 'the name of the extension, not of one app');
  const seg = find(host.shadowRoot, (n) => n.className === 'seg');
  assert.deepEqual((seg?.children ?? []).map((b) => [text(b).trim(), b.className]), [['App', 'on'], ['YouTube', '']], 'App | YouTube, the app on');
  sent.length = 0;
  seg.children[1].click();
  await tick();
  assert.deepEqual(sent.filter((m) => m.type === 'plainSite').map((m) => m.site), ['youtube'], 'YouTube: the plain site');
  seg.children[0].click();
  await tick();
  assert.ok(!sent.some((m) => m.type === 'openApp'), 'App is on already: nothing');

  sent.length = 0;
  all(host.shadowRoot, (n) => n.tagName === 'BUTTON' && text(n).includes('Connect'))[0].click();
  await tick(); await tick();
  assert.equal(reads, 1, 'YouTube’s account is read again before Connect');
  assert.ok(sent.some((m) => m.type === 'connect'));
  assert.ok(text(host.shadowRoot).includes('Already connected: parent@example.com'), 'the same account: it says so');

  const grid = find(host.shadowRoot, (n) => n.tagName === 'BUTTON' && n.className === 'round');
  assert.equal(grid.title, 'Show the apps');
  grid.click();
  assert.ok(appsRow(host), 'the apps button opens it');
  assert.deepEqual(all(appsRow(host), (n) => n.className === 'name').map((n) => n.textContent), ['KidTube', 'Instagram'], 'only the apps (no site tiles), with a profile or not');
  assert.ok(find(appsRow(host), (n) => n.tagName === 'BUTTON' && n.className.includes('none') && text(n).includes('Instagram')), 'Instagram without a profile: dimmed');
  assert.ok(text(host.shadowRoot).includes('Instagram: sign in on Instagram, then press Connect there.'));
  const again = new FakeEl('div');   // a reload: a new header
  globalThis.KidTubeHeader.mount(again, { dark: false });
  await tick();
  assert.equal(appsRow(again), undefined, 'closed again after a reload');

  answers.header = () => ({ ok: true, open: true, mode: 'parent', running: 'kidtube', site: null, here: null,
    connected: { app: 'kidtube', label: 'KidTube', who: 'parent@example.com', site: 'YouTube' }, github: { connected: true }, apps: [] });
  const page = new FakeEl('div');   // an extension page (the parent screens): no site, so no Connect
  globalThis.KidTubeHeader.mount(page, { dark: false });
  await tick();
  assert.ok(!labels(page).some((l) => l.includes('Connect')));
  delete answers.header; delete answers.connect; delete globalThis.KidTubeAccount;
});

test('the apps header: a newer version above the version, in blue, gets it; the site side of the switch can be the page’s own view', async () => {
  answers.header = () => ({ ok: true, open: true, mode: 'parent', running: 'instagram', site: 'instagram', here: { site: 'instagram', label: 'Instagram', seen: true, signedIn: true, name: '@me' },
    connected: { app: 'instagram', label: 'Instagram', who: '@me', site: 'Instagram' }, github: { connected: true }, apps: [],
    switch: { app: 'instagram', label: 'Instagram', site: 'instagram', siteLabel: 'Instagram', on: 'app' } });
  answers.version = () => ({ ok: true, installed: '0.11.4', latest: '0.12.0', newer: true, kind: 'dev' });
  answers.openUpdate = () => ({ ok: true, kind: 'dev', url: 'chrome://extensions/?id=x' });
  let views = 0;
  const host = new FakeEl('div');
  globalThis.KidTubeHeader.mount(host, { dark: false, siteView: () => { views++; } });
  await tick(); await tick();
  const vers = find(host.shadowRoot, (n) => n.className === 'vers');
  assert.deepEqual((vers?.children ?? []).map((n) => [n.className, text(n).trim()]), [['newver', '↑ 0.12.0'], ['ver', '0.11.4']], 'the new one on top of the current one');
  sent.length = 0;
  vers.children[0].click();
  await tick(); await tick();
  assert.ok(sent.some((m) => m.type === 'openUpdate'));
  assert.ok(text(host.shadowRoot).includes('git pull'), 'a copy from git: what to do in the page that opened');
  const seg = find(host.shadowRoot, (n) => n.className === 'seg');
  seg.children[1].click();
  await tick();
  assert.equal(views, 1, 'Instagram: the same page’s own view, not a new page');
  assert.ok(!sent.some((m) => m.type === 'plainSite'));

  // Quetta: the label says where the new version is; not installed in time: by hand, the install page.
  answers.version = () => ({ ok: true, installed: '0.12.2', latest: '0.12.8', newer: true, kind: 'quetta', phase: 'installing', status: 'update_available', askedAt: Date.now() });
  const q = new FakeEl('div');
  globalThis.KidTubeHeader.mount(q, { dark: false });
  await tick(); await tick();
  assert.equal(text(find(q.shadowRoot, (n) => n.className === 'newver')).trim(), '↓ 0.12.8 installing…');
  answers.version = () => ({ ok: true, installed: '0.12.2', latest: '0.12.8', newer: true, kind: 'quetta', phase: 'manual', why: 'throttled', status: 'throttled', askedAt: Date.now() });
  answers.openUpdate = (m) => ({ ok: true, kind: 'quetta', manual: !!m.manual || true, url: 'https://x/', latest: '0.12.8' });
  const q2 = new FakeEl('div');
  globalThis.KidTubeHeader.mount(q2, { dark: false });
  await tick(); await tick();
  const nv = find(q2.shadowRoot, (n) => n.className === 'newver');
  assert.equal(text(nv).trim(), '↑ 0.12.8 · by hand');
  sent.length = 0;
  nv.click();
  await tick(); await tick();
  assert.ok(text(q2.shadowRoot).includes('Download .crx'), 'what to do on the install page');

  answers.version = () => ({ ok: true, installed: '0.12.0', latest: '0.12.0', newer: false, kind: 'quetta' });
  const now = new FakeEl('div');   // after the update: only the current version
  globalThis.KidTubeHeader.mount(now, { dark: false });
  await tick(); await tick();
  assert.deepEqual((find(now.shadowRoot, (n) => n.className === 'vers')?.children ?? []).map((n) => n.className), ['ver']);
  delete answers.header; delete answers.version; delete answers.openUpdate;
});

test('↻ Update waits for the run to be sent: 9 s on a slow tablet is an answer, not “the extension did not answer” (rule.noAnswer.runHelper, 0.12.2)', async (t) => {
  const { runNow } = await import('../../extension/apps/kidtube/parent/kit.js');
  const send = chrome.runtime.sendMessage;
  const missed = [];
  globalThis.KidTubeWatch = { noAnswer: (msg, ms) => missed.push([msg.type, ms]) };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  chrome.runtime.sendMessage = (msg, cb) => { sent.push(msg); setTimeout(() => cb({ ok: true }), 9000); };   // the whole sync, then requests/run.json
  try {
    const run = runNow();
    t.mock.timers.tick(9000);
    assert.equal(await run, true, 'the answer came: the run was asked for');
    assert.deepEqual(missed, []);
    chrome.runtime.sendMessage = (msg) => { sent.push(msg); };   // a background that never answers is still noticed
    const lost = runNow();
    t.mock.timers.tick(60000);
    assert.equal(await lost, false);
    assert.deepEqual(missed, [['runHelper', 60000]]);
  } finally { chrome.runtime.sendMessage = send; delete globalThis.KidTubeWatch; t.mock.timers.reset(); }
});

test('the parent page waits for a whole sync: 10.5 s on a slow tablet is an answer, not “the extension did not answer” (rule.noAnswer.sync, 0.12.2)', async (t) => {
  const { ask } = await import('../../extension/core/lib/ask.js');
  const send = chrome.runtime.sendMessage;
  const missed = [];
  globalThis.KidTubeWatch = { noAnswer: (msg, ms) => missed.push([msg.type, ms]) };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  chrome.runtime.sendMessage = (msg, cb) => { sent.push(msg); setTimeout(() => cb({ ok: true }), 10460); };   // GitHub and back several times
  try {
    const synced = ask({ type: 'sync' });
    t.mock.timers.tick(10460);
    assert.deepEqual(await synced, { ok: true }, 'the answer came');
    assert.deepEqual(missed, []);
    chrome.runtime.sendMessage = (msg) => { sent.push(msg); };   // a background that never answers is still noticed
    const lost = ask({ type: 'sync' });
    t.mock.timers.tick(60000);
    assert.equal(await lost, undefined);
    assert.deepEqual(missed, [['sync', 60000]]);
  } finally { chrome.runtime.sendMessage = send; delete globalThis.KidTubeWatch; t.mock.timers.reset(); }
});

test('the notifications: a row swiped away stays away until its status changes; done rows and messages need no swipe', async () => {
  const rowsOf = (status) => [
    { id: 'problem:a', type: 'error', status: { text: status, tone: 'wait' }, title: 'Tapping “X” did nothing', actions: [], count: 2, tries: 1 },
    { id: 'run', type: 'data', status: { text: 'Sent', tone: 'wait' }, title: 'Your notes were sent', actions: [] },
  ];
  let inbox = rowsOf('Handling');
  answers.header = () => ({ ok: true, open: true, mode: 'parent', running: 'kidtube', site: null, here: null, connected: null, github: { connected: true }, apps: [], inbox });
  answers.version = () => ({ ok: true, installed: '0.12.9', latest: '0.12.9', newer: false, kind: 'quetta' });
  local.inboxHidden = { 'problem:a': 'Handling|1' };   // swiped while it was Handling, try 1
  const titles = (h) => {
    const out = [];
    const walk = (n) => { if (n.className?.startsWith?.('nrow')) out.push(text(n.children[2]).split('Tapping')[0] || text(n.children[2])); (n.children ?? []).forEach(walk); };
    walk(h.shadowRoot);
    return out.map((t) => t.trim());
  };
  const h1 = new FakeEl('div');
  globalThis.KidTubeHeader.mount(h1, { dark: false });
  await tick(); await tick();
  assert.deepEqual(titles(h1), ['Your notes were sent'], 'the swiped row stays away');
  inbox = rowsOf('Done');   // the AI fixed it: a new status, so it shows again (and goes by itself after 3 minutes)
  const h2 = new FakeEl('div');
  globalThis.KidTubeHeader.mount(h2, { dark: false });
  await tick(); await tick();
  assert.equal(titles(h2).length, 2);
  delete local.inboxHidden; delete answers.header; delete answers.version;
});
