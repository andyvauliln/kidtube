// The checks inside KidTube (core/checks/): the start checks, the checks after each message, the page results,
// and the reports they make — with what was expected, what was seen, the situation and the steps, and no secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeChrome } from '../helpers/fake-chrome.mjs';
import { Expect, redact, shapeOf, safeUrl, clip } from '../../extension/core/checks/kit.js';

const fake = installFakeChrome();
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
fake.runtime.getManifest = () => manifest;   // start.files compares the file with what the browser loaded
await import('../../extension/core/background/main.js');

const TOKEN = 'github_pat_11AAAAAAA0secretsecretsecret';
const PIN_HASH = 'pinhash-very-secret-value';
const EMAIL = 'kid@example.com';
fake.store.account = { key: EMAIL, email: EMAIL, app: 'kidtube', folder: 'kid' };
fake.store.accounts = { [EMAIL]: { email: EMAIL, app: 'kidtube', folder: 'kid' } };
fake.store.settings = { token: TOKEN, repo: 'me/kidtube-data', pinHash: PIN_HASH, pinSalt: 'salt', mode: 'parent' };
fake.store.ytAccount = { email: EMAIL, loggedIn: true, at: Date.now() };

const YT = { id: 7, url: 'https://m.youtube.com/' };
const PAGE = { url: 'ext://apps/kidtube/parent/parent.html', tab: { id: 8, url: 'ext://apps/kidtube/parent/parent.html' } };
const send = (msg, sender = { tab: YT }) => new Promise((resolve) => fake.listeners.message[0](msg, sender, resolve));
const fromPage = (msg) => send(msg, PAGE);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const view = () => fromPage({ type: 'checks' });
const report = async (id) => (await view()).reports.find((r) => r.check === id);
const result = async (id) => (await view()).results.find((r) => r.id === id);
const switcher = (email) => `)]}'\n${JSON.stringify({ header: { email: { simpleText: email } }, items: [{ accountItem: { isSelected: true, accountName: { simpleText: 'Kid' } } }] })}`;

test('kit: an Expect lists each mismatch with what was expected and what was seen', () => {
  const t = new Expect();
  t.eq('settings.mode', 'kid', 'parent').ok('a list', Array.isArray(null), null, 'a list');
  t.has('answer.url', '');
  assert.equal(t.passed, false);
  assert.deepEqual(t.mismatch.map((m) => m.what), ['settings.mode', 'a list', 'answer.url']);
  assert.deepEqual(t.mismatch[0], { what: 'settings.mode', expected: 'kid', actual: 'parent' });
  assert.equal(new Expect().eq('x', 1, 1).passed, true);
  assert.match(String(clip('x'.repeat(1000))), /… \(1000 chars\)$/);
});

test('kit: redact hides tokens, keys, the PIN, names and texts; shapeOf keeps only the structure', () => {
  const r = redact({ settings: { token: TOKEN, pinHash: PIN_HASH, pinSalt: 's', repo: 'me/data', geminiKey: 'AIzaSyAAAAAAAAAAA' },
    file: { switcher: 'x' }, note: { text: 'private words', email: EMAIL }, error: `GitHub said no to ${TOKEN}`, mode: 'kid' });
  const s = JSON.stringify(r);
  for (const secret of [TOKEN, PIN_HASH, 'AIzaSyAAAAAAAAAAA', 'private words', EMAIL]) assert.ok(!s.includes(secret), secret);
  assert.equal(r.settings.repo, 'me/data');
  assert.equal(r.mode, 'kid');
  assert.match(r.error, /github_pat_•••/);
  assert.deepEqual(shapeOf({ a: [{ b: 'x', c: 1 }], d: null }), { a: [{ b: 'string', c: 'number' }, '×1'], d: 'null' });
  assert.equal(safeUrl('https://m.youtube.com/watch?v=abcdefghijk&t=10&list=x'), 'https://m.youtube.com/watch?v=abcdefghijk');
});

test('the start checks run and say what they found; one that fails says what it expected', async () => {
  fake.alarms.set.poll = { name: 'poll', periodInMinutes: 15 };
  await fromPage({ type: 'setMode', mode: 'parent' });   // applies the blocking rule (start() does it in the browser)
  const r = await fromPage({ type: 'runChecks' });
  assert.equal(r.ok, true);
  const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
  for (const id of ['start.storage', 'start.files', 'start.alarm', 'start.rules', 'start.profile', 'kidtube.files', 'kidtube.lists']) assert.equal(by[id]?.status, 'pass', `${id}: ${by[id]?.saw}`);
  assert.equal(by['start.kept'].status, 'skip');   // not an update
  // The fake web has no release file: a failure with the address and the status, and a report.
  assert.equal(by['start.latest'].status, 'fail');
  assert.match(by['start.latest'].saw, /status of https:\/\/andyvauliln\.github\.io\/kidtube\/latest\.json: expected 200, saw 404/);
  const rep = await report('start.latest');
  assert.equal(rep.kind, 'start');
  assert.deepEqual(rep.code, ['core/background/updates.js latestRelease', 'core/background/constants.js LATEST_URL']);
  assert.equal(rep.context.app.version, manifest.version);
  assert.equal(rep.context.profile.folder, 'kid');
  assert.equal(rep.context.profile.github.connected, true);
  assert.equal(r.start.fail >= 1, true);
});

test('an update that lost the token is a failure of start.kept', async () => {
  const keep = fake.store.settings;
  fake.store.settings = { ...keep, token: '' };
  await fromPage({ type: 'runChecks' });   // remembers what is set now (no token)…
  fake.store.settings = keep;
  await fromPage({ type: 'runChecks' });   // …so the next run has the token in "previous"
  const { runStartChecks } = await import('../../extension/core/checks/runner.js');
  fake.store.settings = { ...keep, token: '' };
  const r = await runStartChecks('update');
  fake.store.settings = keep;
  const kept = r.results.find((x) => x.id === 'start.kept');
  assert.equal(kept.status, 'fail');
  assert.match(kept.saw, /GitHub token: expected still saved, saw missing/);
});

test('a message that does what it should passes its check; the steps record it', async () => {
  assert.equal((await fromPage({ type: 'setMode', mode: 'kid' })).ok, true);
  await wait(50);
  const r = await result('action.setMode');
  assert.equal(r.status, 'pass');
  await fromPage({ type: 'setMode', mode: 'parent' });
});

test('the account switch bug: another account on YouTube must stop the app — a report shows the mismatch, the situation and the steps', async () => {
  fake.store.shell = { on: false, locked: false };
  // Break it on purpose: the stop of the app (shell) never reaches the storage.
  const set = fake.storage.local.set;
  fake.storage.local.set = async (obj) => { const { shell, ...rest } = obj; return set(rest); };
  try {
    await fromPage({ type: 'setMode', mode: 'parent' });
    await send({ type: 'account', loggedIn: true, datasyncId: 'X||', switcher: switcher('other@example.com') });
    await wait(50);
  } finally { fake.storage.local.set = set; }
  const rep = await report('action.account');
  assert.ok(rep, 'a report');
  assert.deepEqual(rep.mismatch.find((m) => m.what.startsWith('shell.on')), { what: 'shell.on (the app stopped)', expected: true, actual: false });
  assert.equal(rep.context.profile.mode, 'parent');
  assert.equal(rep.context.profile.running, true);
  assert.equal(rep.context.page.url, 'https://m.youtube.com/');
  assert.ok(rep.steps.some((s) => s.type === 'setMode'), 'the steps before it');
  assert.ok(rep.code.includes('core/background/profiles.js youtubeAccount'));
  // Nothing personal or secret in it.
  const s = JSON.stringify(rep);
  for (const secret of [TOKEN, PIN_HASH, 'other@example.com', EMAIL]) assert.ok(!s.includes(secret), secret);
  // The same again: one report, counted.
  fake.storage.local.set = async (obj) => { const { shell, ...rest } = obj; return set(rest); };
  try { await send({ type: 'account', loggedIn: true, datasyncId: 'X||', switcher: switcher('other@example.com') }); await wait(50); }
  finally { fake.storage.local.set = set; }
  assert.equal((await report('action.account')).count, 2);
  fake.store.shell = { on: false, locked: false };
  fake.store.ytAccount = { email: EMAIL, loggedIn: true, at: Date.now() };
});

test('YouTube’s switcher without an email is an outside change: a warning first, a failure the second time a minute later', async () => {
  const realNow = Date.now;
  try {
    await send({ type: 'account', loggedIn: true, datasyncId: 'X||', switcher: `)]}'\n${JSON.stringify({ newLayout: { accounts: [{ id: 1 }] } })}` });
    await wait(50);
    assert.equal((await result('yt.switcher')).status, 'warn');
    Date.now = () => realNow() + 61000;
    await send({ type: 'account', loggedIn: true, datasyncId: 'X||', switcher: `)]}'\n${JSON.stringify({ newLayout: { accounts: [{ id: 1 }] } })}` });
    await wait(50);
  } finally { Date.now = realNow; }
  const rep = await report('yt.switcher');
  assert.equal(rep.kind, 'probe');
  assert.deepEqual(rep.evidence.shape, { newLayout: { accounts: [{ id: 'number' }, '×1'] } });   // the new structure, nobody's data
  fake.store.shell = { on: false, locked: false };
});

test('a handler that throws is reported with its stack; the page still gets its error', async () => {
  const update = fake.tabs.update;
  fake.tabs.update = async () => { throw new Error('No tab with id: 8'); };
  try {
    const r = await fromPage({ type: 'kidHome' });
    assert.match(String(r.error), /No tab with id/);
    await wait(50);
  } finally { fake.tabs.update = update; }
  const rep = await report('rule.handlerError.kidHome');
  assert.match(rep.saw, /threw: No tab with id: 8/);
  assert.match(rep.evidence.stack, /Error: No tab with id/);
  await fromPage({ type: 'setMode', mode: 'parent' });
});

test('a check that waits for the tab: Kid sends the tab to his list', async () => {
  const r = await fromPage({ type: 'kidHome' });
  assert.equal(r.ok, true);
  await wait(4300);   // the check looks at the tab 4 s later
  assert.equal((await result('action.kidHome')).status, 'pass');
  await fromPage({ type: 'setMode', mode: 'parent' });
});

test('a page’s own result: a failure with the page’s steps; a pass; nonsense refused', async () => {
  const fail = await fromPage({ type: 'checkResult', steps: [{ at: new Date().toISOString(), kind: 'tap', label: 'Load from GitHub', where: 'parent.html' }],
    result: { id: 'rule.deadButton.Load-from-GitHub', kind: 'rule', area: 'header', status: 'fail', expect: '“Load from GitHub” does something',
      mismatch: [{ what: 'the tap on “Load from GitHub”', expected: 'something changes within 5 s', actual: 'nothing changed' }], page: { path: '/apps/kidtube/parent/parent.html', tab: 'settings' } } });
  assert.deepEqual(fail, { ok: true, status: 'fail' });
  const rep = await report('rule.deadButton.Load-from-GitHub');
  assert.equal(rep.context.page.tab, 'settings');
  assert.ok(rep.steps.some((s) => s.page && s.label === 'Load from GitHub'));
  assert.equal((await fromPage({ type: 'checkResult', result: { id: 'parent.loads', status: 'pass', expect: 'x' } })).status, 'pass');
  assert.equal((await fromPage({ type: 'checkResult', result: { id: '<script>', status: 'fail' } })).ok, false);
  assert.equal((await send({ type: 'checks' })).ok, false, 'the results only for KidTube’s pages');
});

test('parent mode sees which reports are new; Clear empties them', async () => {
  await fromPage({ type: 'clearChecks' });
  await fromPage({ type: 'checkResult', result: { id: 'parent.loads', status: 'fail', expect: 'x', mismatch: [{ what: 'answer to "parentData"', expected: 'the lists', actual: 'no answer in 8 s' }] } });
  assert.equal((await view()).unseen, 1);
  await fromPage({ type: 'checks', seen: true });
  assert.equal((await view()).unseen, 0);
  await fromPage({ type: 'clearChecks' });
  assert.equal((await view()).reports.length, 0);
});
