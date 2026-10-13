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

// The report start.kept|quetta from 0.11.0 → 0.11.1: the running profile was an Instagram profile of 0.11.0, named by
// the YouTube email. 0.11.1 drops those on purpose (profiles.js unkept); the check must know that drop, and still
// fail when a profile that could stay is gone.
test('an update that drops a profile that cannot stay is no failure of start.kept; a lost profile still is', async () => {
  const keep = { account: fake.store.account, accounts: fake.store.accounts, settings: fake.store.settings, shell: fake.store.shell };
  const { runStartChecks } = await import('../../extension/core/checks/runner.js');
  const { migrateProfileKeys } = await import('../../extension/core/background/profiles.js');
  const { serial } = await import('../../extension/core/background/store.js');
  const old = { email: EMAIL, app: 'instagram', folder: 'kid' };
  fake.store.account = { key: `instagram:${EMAIL}`, ...old };
  fake.store.accounts = { ...keep.accounts, [`instagram:${EMAIL}`]: old };
  await runStartChecks('startup');                 // what 0.11.0 had: a profile
  await serial(migrateProfileKeys);                // the update's start() drops it
  assert.equal(fake.store.account, undefined);
  let r = await runStartChecks('update');
  let kept = r.results.find((x) => x.id === 'start.kept');
  assert.equal(kept.status, 'pass', kept.saw);
  assert.equal(fake.store.settings.token, keep.settings.token);
  // A KidTube profile lost by an update is still a failure.
  Object.assign(fake.store, keep);
  await runStartChecks('startup');
  delete fake.store.account;
  r = await runStartChecks('update');
  kept = r.results.find((x) => x.id === 'start.kept');
  assert.equal(kept.status, 'fail');
  assert.match(kept.saw, /profile: expected still there/);
  Object.assign(fake.store, keep);
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

// The report action.plainSite|quetta (0.12.2): the worker had just started, so it sent the tab to m.youtube.com; the
// tablet's YouTube is the desktop one and YouTube moved the tab on to www.youtube.com/?app=desktop by itself.
// Plain YouTube is on the tab all the same: the YouTube tile passes on any YouTube host, Instagram's on its address.
test('the YouTube tile passes when YouTube moves the tab to its other host (m. → www.)', async () => {
  const update = fake.tabs.update;
  fake.tabs.update = async (id, { url }) => { await update(id, { url }); fake.nav.at[id] = url.replace('//m.youtube.com/', '//www.youtube.com/?app=desktop'); };
  try {
    const r = await fromPage({ type: 'plainSite', site: 'youtube' });
    assert.deepEqual([r.ok, r.url, r.navigated], [true, 'https://m.youtube.com/', true]);
    await wait(4300);   // the check looks at the tab 4 s later
  } finally { fake.tabs.update = update; }
  const yt = await result('action.plainSite');
  assert.equal(yt.status, 'pass', yt.saw);
  // Instagram's tile still needs Instagram on the tab.
  fake.tabs.update = async (id, { url }) => { await update(id, { url }); fake.nav.at[id] = 'https://m.youtube.com/'; };
  try {
    await fromPage({ type: 'plainSite', site: 'instagram' });
    await wait(4300);
  } finally { fake.tabs.update = update; }
  const ig = await result('action.plainSite');
  assert.equal(ig.status, 'fail');
  assert.match(ig.saw, /expected https:\/\/www\.instagram\.com\//);
  fake.store.shell = { on: false, locked: false };
  await fromPage({ type: 'setMode', mode: 'parent' });
});

test('a page’s own result: a failure with the page’s steps; a pass; nonsense refused', async () => {
  const fail = await fromPage({ type: 'checkResult', steps: [{ at: new Date().toISOString(), kind: 'tap', label: 'Load from GitHub', where: 'parent.html' }],
    result: { id: 'rule.deadButton.Load-from-GitHub', kind: 'rule', area: 'header', status: 'fail', expect: '“Load from GitHub” does something',
      mismatch: [{ what: 'the tap on “Load from GitHub”', expected: 'something changes within 5 s', actual: 'nothing changed' }], page: { path: '/apps/kidtube/parent/parent.html', tab: 'settings' } } });
  assert.deepEqual(fail, { ok: true, status: 'fail', again: false });
  const rep = await report('rule.deadButton.Load-from-GitHub');
  assert.equal(rep.context.page.tab, 'settings');
  assert.ok(rep.steps.some((s) => s.page && s.label === 'Load from GitHub'));
  assert.equal((await fromPage({ type: 'checkResult', result: { id: 'parent.loads', status: 'pass', expect: 'x' } })).status, 'pass');
  assert.equal((await fromPage({ type: 'checkResult', result: { id: '<script>', status: 'fail' } })).ok, false);
  assert.equal((await send({ type: 'checks' })).ok, false, 'the results only for KidTube’s pages');
});

test('the reports go to GitHub: problems/<day>.json at the top of the data repo, one entry per report, no secrets', async () => {
  const files = {}, puts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const m = String(url).match(/api\.github\.com\/repos\/me\/kidtube-data\/contents\/(.+)$/);
    if (!m) return realFetch(url, init);
    const path = decodeURIComponent(m[1]);
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body);
      files[path] = { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: `sha-${puts.length}` };
      puts.push({ path, message: body.message, sha: body.sha ?? null });
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (!files[path]) return { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } };
    return { ok: true, status: 200, json: async () => ({ sha: files[path].sha, content: Buffer.from(files[path].text).toString('base64') }) };
  };
  try {
    const before = (await view()).reports.length;
    assert.ok(before > 0);
    const r = await fromPage({ type: 'sendChecks' });
    assert.equal(r.ok, true);
    assert.equal(r.sent, before);
    const day = new Date().toISOString().slice(0, 10);
    const path = Object.keys(files).find((p) => p.startsWith('problems/'));
    assert.ok(path?.startsWith('problems/') && path.endsWith('.json'), path);
    const file = JSON.parse(files[path].text);
    assert.equal(file.schemaVersion, 1);
    assert.ok(file.reports.every((x) => x.type === 'problem' && x.reportId && x.deviceId?.startsWith('tab-') && x.fingerprint && !('sent' in x)));
    for (const secret of [TOKEN, PIN_HASH, EMAIL]) assert.ok(!files[path].text.includes(secret), secret);
    assert.ok((await view()).reports.every((x) => x.sentAt));
    assert.equal((await fromPage({ type: 'sendChecks' })).sent, 0, 'nothing new: nothing sent');
    // A new problem: sent once.
    const fail = { type: 'checkResult', result: { id: 'parent.loads', status: 'fail', expect: 'x', mismatch: [{ what: 'answer to "parentData"', expected: 'the lists', actual: 'no answer in 8 s' }] } };
    await fromPage(fail);
    assert.equal((await fromPage({ type: 'sendChecks' })).sent, 1);
    assert.ok(puts.at(-1).sha, 'the second write updates the file (its sha)');
    // The same problem again on this version: counted on the tablet, not sent again (the server may be fixing it).
    const writes = puts.length;
    assert.equal((await fromPage(fail)).again, true, 'the page learns it was reported before (Send to AI says so)');
    await fromPage(fail);
    assert.equal((await fromPage({ type: 'sendChecks' })).sent, 0, 'a repeat is not sent');
    assert.equal(puts.length, writes);
    assert.equal((await view()).reports.filter((x) => x.check === 'parent.loads').map((x) => x.count).join(), '3', 'one report, counted');
    const there = JSON.parse(files[`problems/${day}.json`].text).reports.filter((x) => x.check === 'parent.loads');
    assert.deepEqual(there.map((x) => x.count), [1]);
  } finally { globalThis.fetch = realFetch; }
});

test('the problems: one per check with its counter, and where each is from the server’s fixes.json', async () => {
  const { problemsOf } = await import('../../extension/core/checks/runner.js');
  const at = (min) => new Date(Date.parse('2026-10-12T12:00:00Z') + min * 60000).toISOString();
  const rep = (check, v, n, sent = at(1)) => ({ reportId: `${check}-${v}`, check, fingerprint: `${check}|${v}|quetta`, expect: `${check} works`, saw: 'no', count: n,
    firstAt: at(0), lastAt: at(0), sentAt: sent });
  const now = Date.parse(at(10));
  const ps = problemsOf([rep('a', '0.10.4', 2), rep('a', '0.11.1', 1), rep('b', '0.10.4', 1), rep('c', '0.11.1', 1), rep('d', '0.11.3', 1, null),
    rep('e', '0.11.3', 1), rep('f', '0.11.3', 1), rep('g', '0.11.3', 1), rep('h', '0.11.3', 1), rep('i', '0.11.1', 4)], [
    { key: 'a|quetta', state: 'fixed', version: '0.11.2', message: 'Fixed it.', at: at(5) },
    { key: 'b|quetta', state: 'fixed', version: '0.11.4', message: 'Fixed it.', at: at(5) },
    { key: 'c|quetta', state: 'working', at: at(5) },
    { key: 'f|quetta', state: 'needs-you', message: 'Sign in again.', at: at(5) },
    { key: 'g|quetta', state: 'fixed', version: '0.11.3', at: at(5) },
    { key: 'h|quetta', state: 'no-answer', at: at(5) },
  ], '0.11.3', now);
  const st = Object.fromEntries(ps.map((p) => [p.check, p.state]));
  assert.deepEqual(st, { a: 'fixed', b: 'reload', c: 'working', d: 'unsent', e: 'waiting', f: 'needs-you', g: 'waiting', h: 'retry', i: 'old' });
  // Seen only on an older version and not since (2026-10-13: 0.10.5 and 0.12.2 problems said "No answer" for days): done.
  const old = ps.find((p) => p.check === 'i');
  assert.deepEqual([old.done, old.label], [true, 'Seen on 0.11.1 only, not since this tablet has 0.11.3. If it comes back, it is sent again']);
  const a = ps.find((p) => p.check === 'a');
  assert.deepEqual([a.count, a.versions, a.done, a.label, a.fix.message], [3, ['0.10.4', '0.11.1'], true, 'Fixed in 0.11.2', 'Fixed it.'], 'two versions, one problem, counted');
  assert.match(ps.find((p) => p.check === 'b').label, /Fixed in 0\.11\.4: update Custom Apps/);
  assert.match(ps.find((p) => p.check === 'g').label, /back after the fix in 0\.11\.3/, 'it failed again on the fixed version');
  assert.deepEqual(ps.slice(0, 3).map((p) => p.state), ['working', 'needs-you', 'reload'], 'what needs a look first');
  assert.equal(problemsOf([rep('e', '0.11.3', 1)], [], '0.11.3', Date.parse(at(40)))[0].state, 'late', 'no answer in 30 minutes');
  // One try per version: the same problem on a new version was sent again (try 2); on the same version only counted.
  assert.deepEqual([a.tries, ps.find((p) => p.check === 'b').tries], [2, 1]);

  // The tablet reads fixes.json (only when a report was sent), and the header shows each problem once.
  const realFetch = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).endsWith('/contents/fixes.json')) return realFetch(url, init);
    reads++;
    const v = (await view()).reports.find((r) => r.check === 'parent.loads');
    const json = { schemaVersion: 1, fixes: [{ key: 'parent.loads|quetta', state: 'working', message: '', at: new Date().toISOString() }] };
    assert.ok(v?.sentAt);
    return { ok: true, status: 200, json: async () => ({ sha: 'x', content: Buffer.from(JSON.stringify(json)).toString('base64') }) };
  };
  try {
    assert.deepEqual(await fromPage({ type: 'readFixes' }), { ok: true, error: null });
    const p = (await view()).problems.find((x) => x.check === 'parent.loads');
    assert.deepEqual([p.state, p.count], ['working', 3]);
    // The header's notifications: one row, [type] [status] the message [Details] [×count].
    const row = (await fromPage({ type: 'header' })).inbox.find((x) => x.id === 'problem:parent.loads|quetta');
    assert.deepEqual([row.type, row.status.text, row.count, row.tries], ['validation', 'AI working', 3, 1]);
    assert.match(row.versions, /^Came from [0-9.]+ · This tablet: [0-9.]+$/, 'where it came from, in words');
    assert.match(row.title, /^A self-check failed .*: /);
    assert.match(row.state, /^The AI is working on it now\./);
    assert.deepEqual(row.actions.map((a) => a.label), ['Details']);
    const n = reads;
    await view();
    await wait(20);
    assert.equal(reads, n, 'not again within 2 minutes');
    assert.match((await fromPage({ type: 'openAiPage', page: 'checks' })).url, /check\.html#problems$/);
  } finally { globalThis.fetch = realFetch; }
});

test('the banner: a new report is shown once where the parent is, never in kid mode', async () => {
  await fromPage({ type: 'setMode', mode: 'kid' });
  await fromPage({ type: 'checkResult', result: { id: 'kid.list', status: 'fail', expect: 'His list comes from the background', mismatch: [{ what: 'answer to "state"', expected: 'his list', actual: 'no answer in 8 s' }] } });
  assert.equal((await send({ type: 'checkAlert' })).alert, null, 'kid mode: no banner for him');
  await fromPage({ type: 'setMode', mode: 'parent' });
  const a = (await fromPage({ type: 'checkAlert' })).alert;
  assert.equal(a.check, 'kid.list');
  assert.equal(a.expect, 'His list comes from the background');
  assert.match(a.saw, /answer to "state": expected his list, saw no answer in 8 s/);
  assert.equal(a.willSend, true);
  assert.equal((await fromPage({ type: 'checkAlert' })).alert, null, 'once');
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

test('a problem in plain words: what went wrong, where, and what was expected', async () => {
  const { wordsOf } = await import('../../extension/core/checks/runner.js');
  const dead = wordsOf({ check: 'rule.deadButton.Instagram', area: 'header', expect: '“Instagram” does something',
    first: { what: 'the tap on “Instagram”', expected: 'something on the screen changes within 5 s', actual: 'nothing changed' } });
  assert.deepEqual([dead.kind, dead.title], ['error', 'Tapping “Instagram” in the header did nothing']);
  const err = wordsOf({ check: 'rule.pageError.render-js_172', area: 'page', expect: 'no uncaught error', first: { what: 'an uncaught error', expected: 'none', actual: 'x is undefined' } });
  assert.deepEqual([err.kind, err.title, err.detail], ['error', 'A script error on an extension page (render-js:172)', 'The error: x is undefined']);
  const slow = wordsOf({ check: 'rule.slowAnswer.connect', area: 'header', first: { what: 'time', expected: 'under 15000 ms', actual: '21000 ms' } });
  assert.deepEqual([slow.title, slow.detail], ['Connect was too slow in the header', 'It took 21 s, but the screen waits only 15 s, so it said “no answer” too early.']);
  assert.equal(wordsOf({ check: 'rule.slowAnswer.runHelper', area: 'background' }).title, '↻ Update (send the notes, ask for an AI run) was too slow');
  const v = wordsOf({ check: 'parent.dock', area: 'parent', expect: 'The bottom bar has ↻ Update', first: { what: '↻ Update', expected: 'the Update button', actual: '' } });
  assert.deepEqual([v.kind, v.title, v.detail], ['validation', 'A self-check failed on the parent screens: The bottom bar has ↻ Update', '↻ Update: expected the Update button, but it was nothing.']);
});

test('↻ Update (runHelper) may take as long as its page waits (60 s): 9 s is not slow, more than 60 s still is (0.12.2)', async () => {
  const realNow = Date.now, realFetch = globalThis.fetch;
  let late = 0;
  globalThis.fetch = (...a) => { const shift = late; Date.now = () => realNow() + shift; return realFetch(...a); };   // GitHub answers slowly
  try {
    await fromPage({ type: 'clearChecks' });
    late = 9000;
    await fromPage({ type: 'runHelper' });
    await wait(50);
    assert.equal(await result('rule.slowAnswer.runHelper'), undefined, '8463 ms in the report: the page still waits');
    Date.now = realNow; late = 61000;
    await fromPage({ type: 'runHelper' });
    await wait(50);
    const r = await result('rule.slowAnswer.runHelper');
    assert.ok(r, 'longer than the page waits: still a slow answer');
    assert.match(r.saw, /expected under 60000 ms/);
  } finally { Date.now = realNow; globalThis.fetch = realFetch; await fromPage({ type: 'clearChecks' }); }
});

test('a sync may take as long as its page waits (60 s): 10.5 s is not slow, more than 60 s still is (0.12.2)', async () => {
  const realNow = Date.now, realFetch = globalThis.fetch;
  let late = 0;
  globalThis.fetch = (...a) => { const shift = late; Date.now = () => realNow() + shift; return realFetch(...a); };   // GitHub answers slowly
  try {
    await fromPage({ type: 'clearChecks' });
    late = 10460;
    await fromPage({ type: 'sync' });
    await wait(50);
    assert.equal(await result('rule.slowAnswer.sync'), undefined, '10460 ms in the report: the page still waits');
    Date.now = realNow; late = 61000;
    await fromPage({ type: 'sync' });
    await wait(50);
    const r = await result('rule.slowAnswer.sync');
    assert.ok(r, 'longer than the page waits: still a slow answer');
    assert.match(r.saw, /expected under 60000 ms/);
  } finally { Date.now = realNow; globalThis.fetch = realFetch; await fromPage({ type: 'clearChecks' }); }
});

test('a new version on Quetta: the browser is asked once, then at most every 30 min; the header sees where it is', async () => {
  const { autoUpdate, phaseOf } = await import('../../extension/core/background/updates.js');
  const realCheck = fake.runtime.requestUpdateCheck;
  let asks = 0;
  fake.runtime.requestUpdateCheck = (cb) => { asks++; cb({ status: 'throttled' }); };
  try {
    delete fake.store.updateState;
    const latest = { version: '9.9.9' };
    assert.equal((await autoUpdate(latest)).status, 'throttled');
    await autoUpdate(latest);
    await autoUpdate(latest);
    assert.equal(asks, 1, 'asking often makes the browser refuse (2026-10-13: the tablet stayed on 0.12.2): once, then wait');
    assert.equal(fake.store.updateState.version, '9.9.9');
    fake.store.updateState.askedAt -= 31 * 60000;
    await autoUpdate(latest);
    assert.equal(asks, 2, 'again after 30 minutes');
    assert.equal(await autoUpdate({ version: '0.0.1' }), null, 'not newer: nothing to ask');
    // The tap on the new version asks at once, whatever the gap.
    fake.store.updateState.askedAt = Date.now();
    await fromPage({ type: 'openUpdate' });
    assert.equal(asks, 3);
  } finally { fake.runtime.requestUpdateCheck = realCheck; delete fake.store.updateState; }
  // The phase next to the logo and in the App update row.
  const now = Date.parse('2026-10-13T10:00:00Z');
  const st = (status, askedMin, sinceMin) => ({ status, askedAt: now - askedMin * 60000, since: now - sinceMin * 60000 });
  assert.deepEqual(phaseOf(st('update_available', 1, 1), 'normal', now), { phase: 'installing' });
  assert.deepEqual(phaseOf(st('throttled', 1, 2), 'normal', now), { phase: 'waiting', why: 'throttled' });
  assert.deepEqual(phaseOf(st('throttled', 1, 11), 'normal', now), { phase: 'manual', why: 'throttled' }, 'not installed in 10 min: by hand');
  assert.deepEqual(phaseOf(st('update_available', 8, 11), 'normal', now), { phase: 'manual', why: 'update_available' }, 'said it downloads, but nothing came');
  assert.deepEqual(phaseOf(null, 'development', now), { phase: 'manual', why: 'zip' }, 'a .zip install: the browser never updates it');
});
