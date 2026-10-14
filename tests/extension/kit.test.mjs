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
notesDock({ card, where: () => screen });
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

test('the notes card has no list: a saved note waits in 🔔, with the screen and the app data kept for its checkboxes', async () => {
  answers.runHelper = () => ({ ok: true });
  sent.length = 0;
  screen = { doc: 'math' };
  fab.click();   // records about the Math document
  await tick();
  rec.phrase('and adds small numbers');
  fab.click();
  await tick();
  const m = sent.find((x) => x.type === 'contextNote');
  assert.deepEqual([m.doc, m.text, m.offer, m.withApp], ['math', 'and adds small numbers', true, true], 'kept with the note, sent only when ticked');
  assert.ok(!sent.some((x) => x.type === 'heldNotes'), 'the card no longer lists the notes');
  assert.equal(card.hidden, true, 'saved: the card closes (the note is in the header’s 🔔 list)');
  for (const gone of ['Clear all', 'Apply notes', 'This screen', 'App data', 'Question']) assert.ok(!text(card).includes(gone), gone);
});

// The parent's note (2026-10-14): ✕ Cancel while a note records: nothing is saved or sent, the card closes.
test('✕ Cancel while it records: nothing is saved or sent, and the next note works as before', async () => {
  sent.length = 0;
  screen = { list: 'today' };
  fab.click();
  await tick();
  rec.phrase('do not keep this');
  const cancel = button(card, '✕ Cancel');
  assert.ok(cancel, 'Cancel next to Stop and Stop and send');
  assert.ok(button(card, '⏹ Stop') && button(card, '➤ Stop and send'));
  cancel.click();
  await tick();
  assert.equal(sent.filter((m) => ['wish', 'inbox'].includes(m.type)).length, 0, 'nothing saved, nothing sent');
  assert.equal(card.hidden, true, 'the card closes');
  assert.equal(fab.textContent, '🎤');
  fab.click();
  await tick();
  rec.phrase('keep this one');
  fab.click();
  await tick();
  assert.deepEqual(sent.filter((m) => m.type === 'wish').map((m) => m.text), ['keep this one'], 'the next note is saved');
});

test('a long press takes 3 seconds (the parent asked for 3 to 4)', async () => {
  const { PRESS_MS } = await import('../../extension/apps/kidtube/parent/kit.js');
  assert.equal(PRESS_MS, 3000);
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
      { id: 'instagram', label: 'Instagram', has: false, active: false, color: '#d62976', glyph: 'camera', who: null, site: 'Instagram', siteId: 'instagram' }],
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
  // The parent's note (2026-10-14): Instagram without a profile stays active; it opens Instagram to sign in, and
  // Instagram's page then asks to switch to the app (the offer).
  const igTile = find(appsRow(host), (n) => n.tagName === 'BUTTON' && text(n).includes('Instagram'));
  assert.ok(!igTile.className.includes('none'), 'Instagram without a profile: not dimmed');
  assert.ok(text(host.shadowRoot).includes('Instagram: tap it, sign in on Instagram, then switch to the app.'));
  sent.length = 0;
  igTile.click();
  await tick();
  assert.deepEqual(sent.filter((m) => m.type === 'plainSite').map((m) => [m.site, m.offer]), [['instagram', 'instagram']], 'Instagram itself, with the offer');
  assert.ok(!sent.some((m) => m.type === 'openApp'), 'not the app: it has no profile yet');
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
  let inbox = rowsOf('AI working');
  answers.header = () => ({ ok: true, open: true, mode: 'parent', running: 'kidtube', site: null, here: null, connected: null, github: { connected: true }, apps: [], inbox });
  answers.version = () => ({ ok: true, installed: '0.12.9', latest: '0.12.9', newer: false, kind: 'quetta' });
  local.inboxHidden = { 'problem:a': 'AI working|1' };   // swiped while the AI worked on it, try 1
  const titles = (h) => {
    const out = [];
    const walk = (n) => { if (n.className?.startsWith?.('nrow')) out.push(text(n.children[2]).split('Tapping')[0] || text(n.children[2])); (n.children ?? []).forEach(walk); };
    walk(h.shadowRoot);
    return out.map((t) => t.trim());
  };
  const h1 = new FakeEl('div');
  globalThis.KidTubeHeader.mount(h1, { dark: false });
  await tick(); await tick();
  // Every row ends with its version (the parent's note, 2026-10-14; no version of its own: this tablet's).
  assert.deepEqual(titles(h1), ['Your notes were sent v0.12.9'], 'the swiped row stays away');
  inbox = rowsOf('Done');   // the AI fixed it: a new status, so it shows again (and goes by itself after 3 minutes)
  const h2 = new FakeEl('div');
  globalThis.KidTubeHeader.mount(h2, { dark: false });
  await tick(); await tick();
  assert.equal(titles(h2).length, 2);
  delete local.inboxHidden; delete answers.header; delete answers.version;
});

test('the notifications: Hide on the right of the footer hides them, like the bell (the parent’s note, 2026-10-14)', async () => {
  const inbox = [{ id: 'problem:a', type: 'error', status: { text: 'AI did not reply', tone: 'bad' }, title: 'A problem', actions: [], count: 1, tries: 1 }];
  answers.header = () => ({ ok: true, open: true, mode: 'parent', running: 'kidtube', site: null, here: null, connected: null, github: { connected: true }, apps: [], inbox });
  answers.version = () => ({ ok: true, installed: '0.12.27', latest: '0.12.27', newer: false, kind: 'quetta' });
  delete local.headerUi;
  const h = new FakeEl('div');
  globalThis.KidTubeHeader.mount(h, { dark: false });
  await tick(); await tick();
  const foot = find(h.shadowRoot, (n) => n.className === 'nfoot');
  assert.ok(foot, 'the footer shows');
  const last = foot.children.at(-1);
  assert.equal(text(last).trim(), 'Hide', 'Hide is the footer’s last item: on the right');
  last.click();
  await tick();
  assert.ok(!find(h.shadowRoot, (n) => n.className === 'inbox'), 'the notifications are hidden');
  assert.deepEqual(local.headerUi, { inboxClosed: true }, 'remembered, like the bell');
  delete local.headerUi; delete answers.header; delete answers.version;
});

test('the notifications: rows swiped one after another all stay away (2026-10-13: the first came back when the second went)', async () => {
  const row = (id, title) => ({ id, type: 'error', status: { text: 'AI did not reply', tone: 'bad' }, title, actions: [], count: 1, tries: 1 });
  const inbox = [row('problem:a', 'First problem'), row('problem:b', 'Second problem'), row('problem:c', 'Third problem')];
  answers.header = () => ({ ok: true, open: true, mode: 'parent', running: 'kidtube', site: null, here: null, connected: null, github: { connected: true }, apps: [], inbox });
  answers.version = () => ({ ok: true, installed: '0.12.14', latest: '0.12.14', newer: false, kind: 'quetta' });
  delete local.inboxHidden;
  const h = new FakeEl('div');
  globalThis.KidTubeHeader.mount(h, { dark: false });
  await tick(); await tick();
  const rowEl = (title) => find(h.shadowRoot, (n) => n.className?.startsWith?.('nrow') && text(n).includes(title));
  const swipe = async (title) => {
    const r = rowEl(title);
    r.setPointerCapture = () => {};
    const ev = (x) => ({ clientX: x, clientY: 0, pointerId: 1, target: { closest: () => null } });
    r.dispatchEvent({ type: 'pointerdown', ...ev(0) });
    r.dispatchEvent({ type: 'pointermove', ...ev(200) });
    r.dispatchEvent({ type: 'pointerup', ...ev(200) });
    await new Promise((res) => setTimeout(res, 200));
    await tick();
  };
  await swipe('First problem');
  assert.ok(!rowEl('First problem'));
  await swipe('Second problem');
  assert.ok(!rowEl('Second problem'));
  assert.ok(!rowEl('First problem'), 'the first stays away');
  assert.ok(rowEl('Third problem'));
  assert.deepEqual(Object.keys(local.inboxHidden).sort(), ['problem:a', 'problem:b']);
  delete local.inboxHidden; delete answers.header; delete answers.version;
});

test('the notifications: a note’s checkboxes (This screen, App data, Question), Send all, and a sent note’s Details', async () => {
  const checks = (screen) => [{ key: 'screen', label: '📄 This screen', on: screen, can: true }, { key: 'app', label: '⚙️ App data', on: false, can: true },
    { key: 'ask', label: '❓ Question', on: false, can: true }];
  const send = [{ do: 'note.edit', label: 'Edit' }, { do: 'note.drop', label: 'Delete' }, { do: 'note.send', label: 'Send' }];
  let screenOn = false;
  answers.header = () => ({ ok: true, open: true, mode: 'parent', running: 'kidtube', site: null, here: null, connected: null, github: { connected: true }, apps: [], inbox: [
    { id: 'note:n1', note: 'n1', type: 'note', status: { text: 'Not sent', tone: 'wait' }, title: 'Bigger buttons', checks: checks(screenOn), actions: send },
    { id: 'note:n2', note: 'n2', type: 'note', status: { text: 'Not sent', tone: 'wait' }, title: 'More trains', checks: checks(false), actions: send },
    { id: 'question:n0', note: 'n0', type: 'note', done: true, status: { text: 'Done', tone: 'ok' }, title: 'Remove update box',
      details: [['What was done', 'Removed it in 0.12.14.']], actions: [{ do: 'question.dismiss', label: 'Got it' }] },
  ] });
  answers.version = () => ({ ok: true, installed: '0.12.14', latest: '0.12.14', newer: false, kind: 'quetta' });
  answers.inbox = (m) => { if (m.do === 'note.attach' && m.what === 'screen') screenOn = m.on; return { ok: true }; };
  const h = new FakeEl('div');
  globalThis.KidTubeHeader.mount(h, { dark: false });
  await tick(); await tick();
  const row = (title) => find(h.shadowRoot, (n) => n.className?.startsWith?.('nrow') && text(n).includes(title));
  const box = (r, label) => find(r, (n) => n.tagName === 'LABEL' && text(n).includes(label)).children[0];
  const tap = (r, label) => find(r, (n) => n.tagName === 'BUTTON' && text(n).trim().startsWith(label)).click();
  assert.equal(box(row('Bigger buttons'), 'This screen').checked, false);
  sent.length = 0;
  const cb = box(row('Bigger buttons'), 'This screen');
  cb.checked = true;
  cb.dispatchEvent({ type: 'change' });
  await tick(); await tick();
  assert.deepEqual(sent.find((m) => m.type === 'inbox'), { type: 'inbox', do: 'note.attach', id: 'n1', what: 'screen', on: true });
  assert.equal(box(row('Bigger buttons'), 'This screen').checked, true, 'drawn again as ticked');
  // Send all: two notes can go.
  tap(h.shadowRoot, 'Send all (2)');
  await tick(); await tick();
  assert.ok(sent.some((m) => m.type === 'inbox' && m.do === 'run'));
  // A sent note: a tap on its row opens its Details, with what the AI did about it; Back returns to the list.
  assert.ok(!text(row('Remove update box')).includes('Removed it in 0.12.14.'));
  row('Remove update box').dispatchEvent({ type: 'click', target: { closest: () => null } });
  await tick();
  const view = find(h.shadowRoot, (n) => n.className === 'dview');
  assert.ok(view && text(view).includes('Removed it in 0.12.14.'));
  assert.ok(!row('Bigger buttons'), 'the list is closed meanwhile');
  tap(view, '‹ Back');
  await tick();
  assert.ok(row('Bigger buttons'));
  delete answers.header; delete answers.version; delete answers.inbox;
});

// The parent's note (2026-10-14): in a notification's Details the ✕ did not close it (Got it, ✕, Delete left the old
// row on the screen; Edit showed nothing). Every row: its date and version, and a way to remove it; Edit's field fits its words.
test('the notifications: Details closes on ✕ and on Got it; every row has its date, version and Remove; Edit goes to its field', async () => {
  answers.header = () => ({ ok: true, open: true, mode: 'parent', running: 'kidtube', site: null, here: null, connected: null, github: { connected: true }, apps: [], inbox: [
    { id: 'note:n1', note: 'n1', type: 'note', status: { text: 'Not sent', tone: 'wait' }, title: 'Bigger buttons', at: '2026-10-14T07:31:48Z', version: '0.12.26',
      actions: [{ do: 'note.edit', label: 'Edit' }, { do: 'note.drop', label: 'Delete' }, { do: 'note.send', label: 'Send' }] },
    { id: 'question:n0', note: 'n0', type: 'note', done: true, status: { text: 'Done', tone: 'ok' }, title: 'Remove update box', at: '2026-10-14T07:00:00Z',
      details: [['What was done', 'Removed it.']], actions: [{ do: 'question.dismiss', label: 'Got it' }] },
    { id: 'run', type: 'data', status: { text: 'Sent', tone: 'wait' }, title: 'Your notes were sent', at: '2026-10-14T07:35:00Z', actions: [] },
  ] });
  answers.version = () => ({ ok: true, installed: '0.12.27', latest: '0.12.27', newer: false, kind: 'quetta' });
  answers.inbox = () => ({ ok: true });
  delete local.inboxHidden;
  const h = new FakeEl('div');
  globalThis.KidTubeHeader.mount(h, { dark: false });
  await tick(); await tick();
  const row = (title) => find(h.shadowRoot, (n) => n.className?.startsWith?.('nrow') && text(n).includes(title));
  const details = () => find(h.shadowRoot, (n) => n.className === 'dview');
  const tap = (r, label) => find(r, (n) => n.tagName === 'BUTTON' && text(n).trim().startsWith(label)).click();
  // Date and version on the row: its own, or this tablet's.
  assert.match(text(row('Bigger buttons')), /v0\.12\.26/);
  assert.match(text(row('Your notes were sent')), /v0\.12\.27/);
  // A row with no Delete or Got it of its own gets Remove.
  assert.ok(find(row('Your notes were sent'), (n) => n.tagName === 'BUTTON' && text(n).trim() === 'Remove'));
  assert.ok(!find(row('Bigger buttons'), (n) => n.tagName === 'BUTTON' && text(n).trim() === 'Remove'), 'a note has its own Delete');
  // Details: the When section, and ✕ closes it.
  row('Bigger buttons').dispatchEvent({ type: 'click', target: { closest: () => null } });
  await tick();
  assert.ok(details() && text(details()).includes('0.12.26'), 'Details says the version');
  tap(details(), '✕');
  await tick();
  assert.ok(!details(), '✕ closes the Details');
  // Got it in the Details: the Details closes (it stayed with the old row before).
  row('Remove update box').dispatchEvent({ type: 'click', target: { closest: () => null } });
  await tick();
  tap(details(), 'Got it');
  await tick(); await tick();
  assert.ok(!details(), 'Got it closes the Details');
  assert.ok(sent.some((m) => m.type === 'inbox' && m.do === 'question.dismiss'));
  // Edit in the Details: back to the list, with the row's field open.
  row('Bigger buttons').dispatchEvent({ type: 'click', target: { closest: () => null } });
  await tick();
  tap(details(), 'Edit');
  await tick();
  assert.ok(!details(), 'Edit closes the Details');
  assert.ok(find(h.shadowRoot, (n) => n.tagName === 'TEXTAREA'), 'the edit field is open');
  // Remove in the list: the row goes.
  tap(row('Your notes were sent'), 'Remove');
  await tick();
  assert.ok(!row('Your notes were sent'));
  delete local.inboxHidden; delete answers.header; delete answers.version; delete answers.inbox;
});

test('the Edit field is as tall as its words (no scroll inside it)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../extension/core/ui/header.js', import.meta.url), 'utf8');
  assert.match(src, /const fit = \(ta\) => \{ ta\.style\.height = 'auto'; ta\.style\.height = `\$\{ta\.scrollHeight \+ 2\}px`; \}/);
  assert.match(src, /\.msg textarea \{[^}]*resize: none; overflow: hidden/);
  assert.match(src, /fit\(box\); \}\);/, 'grows while typing');
  assert.match(src, /id: 'header\.editFits'/, 'its check in the app');
});

// The parent's wish (2026-10-13): “every notification should be clickable and goes to details … all agents runs should
// have also details step by step”. A row with a run report: For you, what it got, what changed, and every step.
test('the notifications: a row’s Details shows its sections and the AI run’s report, step by step', async () => {
  const report = { schemaVersion: 1, kind: 'notes', title: 'Run on your notes', ok: true, at: '2026-10-13T15:22:00Z', minutes: 8.4, turns: 43, costUsd: 1.18, model: 'claude-opus-5-5',
    forYou: [{ tone: 'do', text: 'New version 0.12.20: update the tablet.' }], input: [{ title: 'Slides up and down, not left and right', detail: 'Settings' }],
    said: 'One box goes up and down as in Reels.', released: '0.12.20', tests: { pass: 278, fail: 0 }, commits: [{ sha: 'fdd9a20', subject: 'One box: up and down' }],
    files: [{ path: 'extension/apps/kidtube/parent/settings.js', add: 12, del: 30 }],
    steps: [{ kind: 'say', what: 'The note asks for vertical swipes.' }, { kind: 'edit', what: 'Changed settings.js', detail: '- old\n+ new' }, { kind: 'test', what: 'Run the tests', out: '# pass 278', failed: false }] };
  answers.header = () => ({ ok: true, open: true, mode: 'parent', running: 'kidtube', site: null, here: null, connected: null, github: { connected: true }, apps: [], inbox: [
    { id: 'run', type: 'data', done: true, status: { text: 'Done', tone: 'ok' }, title: 'The AI run is done', actions: [],
      view: { sections: [{ title: 'This run', rows: [['State', 'done'], ['Ended', '2026-10-13T15:22:00Z', 'time']] }], report: { path: 'reports/notes-1.json', root: false } } },
  ] });
  answers.version = () => ({ ok: true, installed: '0.12.20', latest: '0.12.20', newer: false, kind: 'quetta' });
  answers.runReport = (m) => (m.path === 'reports/notes-1.json' && m.root === false ? { ok: true, report } : { ok: false, error: 'no' });
  const h = new FakeEl('div');
  globalThis.KidTubeHeader.mount(h, { dark: false });
  await tick(); await tick();
  const row = find(h.shadowRoot, (n) => n.className?.startsWith?.('nrow'));
  row.dispatchEvent({ type: 'click', target: { closest: () => null } });
  await tick(); await tick();
  const view = () => find(h.shadowRoot, (n) => n.className === 'dview');
  const all = text(view());
  for (const want of ['This run', 'For you', 'New version 0.12.20: update the tablet.', 'What it got', 'Slides up and down', 'What it said', 'One box goes up and down',
    '278 passed, 0 failed', 'fdd9a20 One box: up and down', 'extension/apps/kidtube/parent/settings.js', 'Step by step (3)', 'The note asks for vertical swipes.']) {
    assert.ok(all.includes(want), `${want} in the Details`);
  }
  assert.ok(!all.includes('+ new'), 'a step’s output is closed at first');
  const step = find(view(), (n) => n.tagName === 'LI' && text(n).includes('Changed settings.js'));
  step.dispatchEvent({ type: 'click', target: { closest: () => null } });
  await tick();
  assert.ok(text(view()).includes('+ new'), 'a tap on a step opens its output');
  delete answers.header; delete answers.version; delete answers.runReport;
});

// The parent's note (2026-10-13): Settings' 🔳 One box (and Context's 🔳 Full screen) go up and down as in Reels, no ‹ ›.
test('up and down through boxes: a swipe up or ↓ is the next box; a swipe only from the end of a long box', async () => {
  const { swipeStep, keyStep } = await import('../../extension/apps/kidtube/parent/kit.js');
  const ends = { top: true, bottom: true };
  assert.equal(swipeStep(ends, 0, -120), 1, 'swipe up: the next box');
  assert.equal(swipeStep(ends, 10, 120), -1, 'swipe down: the box before');
  assert.equal(swipeStep(ends, -120, 0), 0, 'left: nothing');
  assert.equal(swipeStep(ends, 120, 10), 0, 'right: nothing');
  assert.equal(swipeStep(ends, 0, -40), 0, 'too short');
  assert.equal(swipeStep({ top: true, bottom: false }, 0, -120), 0, 'a long box scrolls to its end first');
  assert.equal(swipeStep({ top: false, bottom: true }, 0, 120), 0, 'and back to its top');
  // Then (the parent's note, 2026-10-13): easier to swipe, and a scroll never changes the box.
  assert.equal(swipeStep(ends, 0, -50), 1, 'a short swipe is enough');
  assert.equal(swipeStep(ends, 45, -60), 1, 'a swipe not quite straight still counts');
  assert.equal(swipeStep(ends, 0, -200, true), 0, 'the page (or a field) scrolled: a scroll, not a swipe');
  assert.equal(swipeStep(ends, 0, 200, true), 0, 'also up');
  const key = (k, extra = {}) => ({ key: k, target: { closest: () => null }, ...extra });
  assert.equal(keyStep(key('ArrowDown')), 1);
  assert.equal(keyStep(key('PageDown')), 1);
  assert.equal(keyStep(key('ArrowUp')), -1);
  assert.equal(keyStep(key('ArrowLeft')), 0, 'no left / right');
  assert.equal(keyStep(key('ArrowDown', { ctrlKey: true })), 0);
  assert.equal(keyStep(key('ArrowDown', { target: { closest: () => ({}) } })), 0, 'not in a field');
});

// The parent's notes (2026-10-13): in 🔳 One box / Full screen a swipe down at the top reloaded the page (the browser's
// pull-to-refresh), so the box before never came. html.updown stops it; the mode's button also asks for full screen.
test('holdPage: no pull-to-refresh in the mode, full screen on a tap, both back when the mode ends', async () => {
  const { holdPage } = await import('../../extension/apps/kidtube/parent/kit.js');
  const asked = [];
  const html = new FakeEl('html');
  html.requestFullscreen = (o) => { asked.push(['on', o]); document.fullscreenElement = html; return Promise.resolve(); };
  document.documentElement = html;
  document.fullscreenElement = null;
  document.exitFullscreen = () => { asked.push(['off']); document.fullscreenElement = null; return Promise.resolve(); };
  holdPage(true);
  assert.ok(html.classList.contains('updown'), 'pull-to-refresh off');
  assert.equal(asked.length, 0, 'full screen only from a tap');
  holdPage(true, true);
  assert.deepEqual(asked, [['on', { navigationUI: 'hide' }]]);
  holdPage(false);
  assert.ok(!html.classList.contains('updown'), 'out of the mode a swipe down reloads again');
  assert.deepEqual(asked.at(-1), ['off']);
  html.requestFullscreen = () => Promise.reject(new Error('refused'));
  holdPage(true, true);
  assert.ok(html.classList.contains('updown'), 'a refused full screen keeps the mode');
  delete document.documentElement; delete document.fullscreenElement; delete document.exitFullscreen;
});

// The parent's note (2026-10-14): one Full size switch for every tab (kit.js isFull, setFull).
test('Full size is one setting for every tab, kept on this tablet', async () => {
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
  const seen = [];
  const add = globalThis.addEventListener, disp = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (e) => { seen.push(e.type); return true; };
  const html = new FakeEl('html');
  document.documentElement = html;
  document.fullscreenElement = null;
  try {
    const { isFull, setFull } = await import('../../extension/apps/kidtube/parent/kit.js');
    assert.equal(isFull(), false);
    setFull(true);
    assert.equal(isFull(), true);
    assert.equal(store.kidtubeFullSize, '1');
    assert.deepEqual(seen, ['kidtube-fullsize'], 'every view hears it');
    assert.ok(html.classList.contains('updown'), 'no pull-to-refresh, no apps header');
    setFull(false);
    assert.equal(isFull(), false);
  } finally { delete document.documentElement; delete document.fullscreenElement; delete globalThis.localStorage; globalThis.dispatchEvent = disp; globalThis.addEventListener = add; }
});

// The parent's note (2026-10-13): a double tap on a paragraph of the Prompt or Context tab makes it editable; Save sends
// the old words, the new ones and the file as a note for the AI (the texts live in GitHub).
test('a double tap on a text: a note with the file, the old words and the new; one tap or another text does nothing', async () => {
  const { editNote, editOnDoubleTap } = await import('../../extension/apps/kidtube/parent/kit.js');
  assert.equal(editNote('agent/DAILY.md', 'Pick 5 videos.', 'Pick 6 videos.'), 'Edit in agent/DAILY.md: replace “Pick 5 videos.” with “Pick 6 videos.”.');
  assert.equal(editNote('context/kid.md', 'He is 4.', ''), 'Edit in context/kid.md: delete “He is 4.”.');
  const long = editNote('agent/SYSTEM.md', 'a'.repeat(5000), 'b'.repeat(5000));
  assert.ok(long.length <= 2000, `under the notes' limit (${long.length})`);
  assert.ok(long.includes('…'), 'a long text is shortened, and says so');
  // two taps on the same paragraph open it; taps on two paragraphs, or one slow pair, don't
  const root = new FakeEl('div');
  const doc = { dataset: { source: 'context/kid.md' } };
  const para = (name) => ({ name, closest: (sel) => (sel === '[data-source]' ? doc : /editform/.test(sel) ? null : undefined) });
  const a = para('a'), b = para('b');
  const opened = [];
  // startEdit needs a real page: count the paragraphs it is asked to open (classList.contains is its first look)
  for (const p of [a, b]) p.classList = { contains: (c) => { if (c === 'editing') opened.push(p.name); return true; } };
  editOnDoubleTap(root, async () => ({ ok: true }));
  const tap = (n, t) => root.dispatchEvent({ type: 'click', target: { closest: (sel) => (sel.includes('li') ? n : null) }, timeStamp: t });
  tap(a, 0); tap(b, 100); tap(a, 2000); tap(a, 3000);
  assert.deepEqual(opened, [], 'another paragraph, or too slow');
  tap(b, 4000); tap(b, 4300);
  assert.deepEqual(opened, ['b']);
  // not a text of a prompt or document (no [data-source]): nothing
  const free = { closest: (sel) => (sel === '[data-source]' ? null : undefined), classList: { contains: () => { opened.push('free'); return true; } } };
  tap(free, 5000); tap(free, 5100);
  assert.deepEqual(opened, ['b']);
});

// A long press on any part of a parent screen: a note about that part (the parent's note, 2026-10-14).
// A tiny tree: the Settings tab's box “Status” with a button “Remove”, and a field.
function node(tag, { cls = '', id = '', text = '', kids = [], data = {} } = {}) {
  const n = { tagName: tag, className: cls, id, textContent: text, innerText: text, dataset: data, children: kids, parentElement: null,
    getAttribute: () => null, getBoundingClientRect: () => ({ left: 10, top: 20, width: 80, height: 30 }) };
  for (const k of kids) k.parentElement = n;
  const is = (m, sel) => sel.split(',').map((x) => x.trim()).some((x) => x === m.tagName.toLowerCase() || (x.startsWith('.') && m.className.split(' ').includes(x.slice(1)))
    || (x.startsWith('#') && m.id === x.slice(1)) || (x.startsWith('input:') && m.tagName === 'INPUT'));
  n.closest = (sel) => { for (let m = n; m; m = m.parentElement) if (is(m, sel)) return m; return null; };
  n.querySelector = (sel) => (sel.includes('h2') ? kids.find((k) => k.tagName === 'H2') ?? null : sel === '.title' ? kids.find((k) => k.className === 'title') ?? null : null);
  return n;
}
const removeBtn = node('BUTTON', { cls: 'small', text: 'Remove' });
const field = node('INPUT', { text: '' });
const statusBox = node('DIV', { cls: 'box', id: 'status', kids: [node('H2', { text: 'Status' }), removeBtn, field] });
node('DIV', { id: 'view', kids: [statusBox] });

test('a long press: the part pressed in plain words (tab › box › part), a selector, its words and its place', async () => {
  const { describeElement, elementText } = await import('../../extension/apps/kidtube/parent/kit.js');
  const d = describeElement(removeBtn);
  assert.equal(d.path, 'box “Status” › button “Remove”');
  assert.equal(d.label, 'button “Remove”');
  assert.equal(d.selector, 'div#view > div#status.box > button.small');
  assert.equal(d.place, '10,20 80×30 px');
  assert.match(elementText(d), /^Path: box “Status” › button “Remove”\nSelector: .*\nWords: Remove\nPlace: /);
});

test('a long press: the ring fills while the finger stays; a full press picks the part, an early lift or a move does nothing; fields are left alone', async (t) => {
  const { pressToNote } = await import('../../extension/apps/kidtube/parent/kit.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => {};
  const page = new FakeEl('document');
  const picked = [];
  let free = true;
  pressToNote(page, { can: () => free, pick: (n) => picked.push(n), ms: 800 });
  const ev = (type, target, x = 50, y = 50) => {
    const e = { type, target, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
    page.dispatchEvent(e);
    return e;
  };
  try {
    ev('pointerdown', removeBtn); t.mock.timers.tick(799);
    assert.equal(picked.length, 0, 'not yet');
    t.mock.timers.tick(1);
    assert.deepEqual(picked, [removeBtn], 'held still: the button is picked');
    assert.equal(ev('click', removeBtn).prevented, true, 'the press’s own tap does not press the button');
    ev('pointerup', removeBtn);
    ev('pointerdown', removeBtn); t.mock.timers.tick(400); ev('pointerup', removeBtn); t.mock.timers.tick(1000);
    ev('pointerdown', removeBtn); t.mock.timers.tick(400); ev('pointermove', removeBtn, 50, 90); t.mock.timers.tick(1000);
    assert.equal(picked.length, 1, 'lifted early or moved (a scroll): nothing');
    ev('pointerdown', field); t.mock.timers.tick(1000);
    assert.equal(picked.length, 1, 'a field: its own long press (select text)');
    free = false;
    ev('pointerdown', statusBox); t.mock.timers.tick(1000);
    assert.equal(picked.length, 1, 'while a note records: nothing');
    free = true;
    ev('pointerdown', statusBox.children[0]); t.mock.timers.tick(1000);
    assert.equal(picked[1].tagName, 'H2', 'the nearest part with a name of its own');
  } finally { t.mock.timers.reset(); delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; }
});

// header.loads|quetta (2026-10-14, 0.12.34): the tablet installed an update while the parent page opened; the
// background restarted and closed the header's "header" message after 3 s (lastError, no answer). The header stayed
// empty and the check said "no answer in 15 s". Now the header asks the new worker once more, and the check sees that.
test('the apps header: an answer lost to a restarting background is asked again, and the check sees the second one', async () => {
  const results = [];
  const watch = globalThis.KidTubeWatch;
  globalThis.KidTubeWatch = { watchTaps() {}, noAnswer() {}, shadow() {},
    check: async (def, testFn) => { const t = { mismatch: [], skipped: null, ok(what, c, actual) { if (!c) this.mismatch.push({ what, actual }); return !!c; }, skip(w) { this.skipped = w; } };
      await testFn(t); results.push({ id: def.id, mismatch: t.mismatch, skipped: t.skipped }); } };
  const send = chrome.runtime.sendMessage;
  let headers = 0;
  chrome.runtime.sendMessage = (msg, cb) => {
    if (msg.type !== 'header') return send(msg, cb);
    if (++headers === 1) {   // the old worker goes away: the port closes, Chrome sets lastError for the callback
      chrome.runtime.lastError = { message: 'The message port closed before a response was received.' };
      cb(undefined);
      chrome.runtime.lastError = null;
      return;
    }
    cb({ ok: true, open: true, mode: 'parent', running: 'kidtube', site: null, here: null, connected: { app: 'kidtube', label: 'KidTube', who: 'parent@example.com', site: 'YouTube' }, github: { connected: true }, apps: [] });
  };
  const host = new FakeEl('div');
  globalThis.KidTubeHeader.mount(host, { dark: false });
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(headers, 2, 'asked again after the restart');
  assert.ok(text(host.shadowRoot).includes('parent@example.com'), 'the header shows');
  assert.deepEqual(results.filter((r) => r.id === 'header.loads').map((r) => r.mismatch), [[]], 'header.loads passes');

  // The page cut off from KidTube (an update replaced it: sendMessage throws): nothing to ask, the check skips.
  results.length = 0;
  chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated.'); };
  globalThis.KidTubeHeader.mount(new FakeEl('div'), { dark: false });
  await tick();
  assert.deepEqual(results.filter((r) => r.id === 'header.loads').map((r) => [r.mismatch.length, !!r.skipped]), [[0, true]], 'skipped, not failed');
  chrome.runtime.sendMessage = send;
  globalThis.KidTubeWatch = watch;
});
