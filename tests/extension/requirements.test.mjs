// What the parent asked for, as it stands now: one test per current requirement that had no test (or only a part),
// against the real service worker with the fake browser. Each test names the requirement and quotes the parent.
// Requests that a later one replaced (the parent-mode timer, the list of recent videos in Settings, notes kept after
// the AI used them, …) are left out on purpose: they are not how KidTube must work now.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { installFakeChrome } from '../helpers/fake-chrome.mjs';

const fake = installFakeChrome();
await import('../../extension/core/background/main.js');

const starter = JSON.parse(readFileSync('extension/apps/kidtube/data/default-queue.json', 'utf8'));
const [A, B, C, D] = starter.videos.map((v) => v.videoId);
const TAB = 7, YT = 'https://m.youtube.com/';
const PAGE = { url: 'ext://apps/kidtube/parent/parent.html', tab: { id: 8, url: 'ext://apps/kidtube/parent/parent.html' } };
const send = (msg, sender = { tab: { id: TAB, url: YT } }) => new Promise((resolve) => fake.listeners.message[0](msg, sender, resolve));
const fromPage = (msg) => send(msg, PAGE);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function navigate(url) {
  fake.nav.updates.length = 0;
  fake.listeners.tabUpdated[0](TAB, { url });
  await wait(20);
  return fake.nav.updates.at(-1) ?? url;
}
async function play(seconds) {
  let r;
  for (let left = seconds; left > 0; left -= 15) r = await send({ type: 'tick', videoId: fake.store.session?.videoId, seconds: Math.min(15, left) });
  return r;
}
const allDay = [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '00:00', to: '23:59' }];
// A fresh kid day with these rules (on top of the built-in ones).
function kidDay(rules = {}, extra = {}) {
  Object.assign(fake.store, { session: null, today: null, watched: {}, outbox: [], pendingTalk: null, localConfig: null, planLog: null,
    shell: { on: false, locked: false }, settings: { ...fake.store.settings, mode: 'kid' } }, extra);
  fake.store.data = { ...(extra.data ?? {}), config: { schemaVersion: 1, updatedAt: '2026-10-01T00:00:00Z', time: { allowed: allDay, maxMinutesPerDay: 0 }, ...rules } };
}

// The data repo on "GitHub": path → JSON or text, inside the profile's folder kidtube/kid/. down: the network fails.
const repo = {};
let down = false;
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.github.com/')) return realFetch(url, init);
  calls.push(`${init.method ?? 'GET'} ${u.replace('https://api.github.com/repos/me/data/contents/', '')}`);
  if (down) throw new TypeError('Failed to fetch');
  const m = u.match(/\/repos\/me\/data\/contents\/(.*)$/);
  const no = { ok: false, status: 404, json: async () => ({}), text: async () => '', headers: { get: () => null } };
  if (!m) return u.endsWith('/repos/me/data') ? { ok: true, status: 200, json: async () => ({ full_name: 'me/data' }) } : no;
  const path = decodeURIComponent(m[1]);
  if (init.method === 'PUT') {
    const body = JSON.parse(init.body);
    repo[path] = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
    return { ok: true, status: 200, json: async () => ({}) };
  }
  if (!(path in repo)) {
    const kids = Object.keys(repo).filter((p) => p.startsWith(`${path}/`)).map((p) => p.slice(path.length + 1).split('/')[0]);
    if (!kids.length) return no;
    const size = (p) => (typeof repo[p] === 'string' ? repo[p] : JSON.stringify(repo[p] ?? '')).length;
    return { ok: true, status: 200, json: async () => [...new Set(kids)].map((name) => ({ name, type: Object.keys(repo).some((p) => p.startsWith(`${path}/${name}/`)) ? 'dir' : 'file',
      sha: `sha-${size(`${path}/${name}`)}`, size: size(`${path}/${name}`) })) };
  }
  const v = repo[path];
  const text = typeof v === 'string' ? v : JSON.stringify(v);
  const raw = /raw/.test(init.headers?.Accept ?? '');
  return { ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === 'etag' ? `"${text.length}"` : null) },
    text: async () => text, blob: async () => new Blob([text]),
    json: async () => (raw ? JSON.parse(text) : { sha: `sha-${text.length}`, content: Buffer.from(text).toString('base64') }) };
};

const EMAIL = 'kid@example.com';
fake.store.account = { key: EMAIL, email: EMAIL, app: 'kidtube', folder: 'kid' };
fake.store.accounts = { [EMAIL]: { email: EMAIL, app: 'kidtube', folder: 'kid' } };
fake.store.ytAccount = { email: EMAIL, loggedIn: true, at: Date.now() };
fake.store.settings = { repo: 'me/data', token: 'github_pat_11ABCDEFGHIJKLMNOP_secretWXYZ', mode: 'kid', pinHash: 'H', pinSalt: 'S' };

test('R008 “closeAfterSeconds … A positive number returns him to the list”', async () => {
  kidDay({ closeAfterSeconds: 60, minSecondsBeforeLeave: 0 });
  assert.equal(await navigate(`${YT}watch?v=${A}`), `${YT}watch?v=${A}`);
  const r = await play(60);
  assert.equal(r.action, 'home');
  assert.equal(fake.nav.updates.at(-1), YT);
  const w = fake.store.outbox.filter((e) => e.type === 'watch').at(-1);
  assert.deepEqual([w.videoId, w.endReason], [A, 'closeAfter']);
  assert.ok(fake.store.watched[A], 'counted as watched');
  // 0: the video stays up until it ends.
  kidDay({ closeAfterSeconds: 0, minSecondsBeforeLeave: 0 });
  await navigate(`${YT}watch?v=${B}`);
  assert.equal((await play(600)).action, 'none');
});

test('R010 “The leave lock does not extend the day past the cap.”', async () => {
  kidDay({ time: { allowed: allDay, maxMinutesPerDay: 20 }, minSecondsBeforeLeave: 120 }, { });
  fake.store.today = { date: new Date().toISOString().slice(0, 10), playedSeconds: 19.5 * 60 };
  await send({ type: 'state' });   // the day in the config's time zone
  fake.store.today.playedSeconds = 19.5 * 60;
  assert.equal(await navigate(`${YT}watch?v=${A}`), `${YT}watch?v=${A}`);
  const r = await play(45);
  assert.equal(r.action, 'lock', 'the cap wins over the 2 minutes he must watch');
  assert.equal((await send({ type: 'state' })).lock.reason, 'dailyCap');
  assert.equal(await navigate(`${YT}watch?v=${A}`), YT, 'not held on the video: his lock screen');
  assert.equal(await navigate(YT), YT);
});

test('R005 the player data closes a live video and one shorter than minVideoDurationSeconds', async () => {
  for (const [details, target] of [[{ isLive: true, lengthSeconds: 0 }, 'video'], [{ isLive: false, lengthSeconds: 20 }, 'shorts']]) {
    kidDay({ blockLive: true, minVideoDurationSeconds: 60, minSecondsBeforeLeave: 0 });
    await navigate(`${YT}watch?v=${C}`);
    await send({ type: 'details', videoId: C, channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', ...details });
    assert.equal(fake.nav.updates.at(-1), YT, target);
    assert.equal(fake.store.outbox.find((e) => e.type === 'blocked').target, target);
    assert.equal(fake.store.outbox.find((e) => e.type === 'watch').endReason, 'blockedOnLoad');
  }
});

test('R013 “If GitHub is unreachable, the same record stays on the device and is sent on the next Update or poll.”', async () => {
  kidDay({ minSecondsBeforeLeave: 0 });
  for (const k of Object.keys(repo)) delete repo[k];
  await navigate(`${YT}watch?v=${A}`);
  await send({ type: 'ended', videoId: A });
  const waiting = fake.store.outbox.map((e) => e.eventId);
  assert.ok(waiting.length >= 1);
  down = true;
  try { await fromPage({ type: 'sync' }); } finally { down = false; }
  assert.deepEqual(fake.store.outbox.map((e) => e.eventId), waiting, 'kept on the tablet');
  await fromPage({ type: 'sync' });
  assert.equal(fake.store.outbox.length, 0);
  const day = Object.keys(repo).find((p) => p.startsWith('kidtube/kid/activity/'));
  assert.deepEqual(repo[day].events.map((e) => e.eventId).filter((id) => waiting.includes(id)).sort(), [...waiting].sort());
  await fromPage({ type: 'sync' });
  assert.equal(repo[day].events.filter((e) => waiting.includes(e.eventId)).length, waiting.length, 'sent once (de-duplicated by eventId)');
});

test('R014 “The extension fetches it on open … and immediately when Update is pressed”, and soon after a video', async () => {
  kidDay();
  fake.store.syncStatus = { at: new Date(Date.now() - 5 * 60000).toISOString(), errors: [] };
  calls.length = 0;
  const realNow = Date.now;
  Date.now = () => realNow() + 31000;   // the check runs at most twice a minute: the last one is half a minute ago
  try { await send({ type: 'state' }); } finally { Date.now = realNow; }   // a screen opens, the last sync is 5 minutes old
  await wait(100);
  assert.ok(calls.some((c) => c.includes('kidtube/kid/queue.json')), 'a sync started for the screen');
  calls.length = 0;
  await send({ type: 'state' });
  await wait(100);
  assert.equal(calls.length, 0, 'not again while fresh');
  await fromPage({ type: 'sync' });
  assert.ok(calls.some((c) => c.includes('queue.json')), 'Update: at once');
  // After a video: about 20 s later.
  await navigate(`${YT}watch?v=${B}`);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await send({ type: 'ended', videoId: B });
    calls.length = 0;
    mock.timers.tick(19000);
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 0);
    mock.timers.tick(1500);
  } finally { mock.timers.reset(); }
  await wait(100);
  assert.ok(calls.some((c) => c.includes('activity/')), 'what he did goes up about 20 s after the video');
});

test('R015 a broken list or rules file from GitHub keeps the last good copy and says why', async () => {
  kidDay();
  repo['kidtube/kid/queue.json'] = { schemaVersion: 1, updatedAt: '2026-10-09T00:00:00Z', videos: starter.videos.slice(0, 3) };
  await fromPage({ type: 'sync' });
  assert.equal(fake.store.data.queue.videos.length, 3);
  repo['kidtube/kid/queue.json'] = { schemaVersion: 1, videos: [{ videoId: 'not-an-id', durationSeconds: 'x' }] };
  const r = await fromPage({ type: 'sync' });
  assert.equal(fake.store.data.queue.videos.length, 3, 'the last good copy');
  assert.ok(r.errors.some((e) => /queue\.json: not a valid schemaVersion 1 file, keeping the last good copy/.test(e)), r.errors.join(' | '));
  delete repo['kidtube/kid/queue.json'];
});

test('R020 “an unknown type stays on screen as “this tablet needs an update” and does not count as a pass”', async () => {
  kidDay({ quiz: { enabled: true, items: { p1: { type: 'puzzle', prompt: 'Put it together' } } }, presenter: { outro: true } });
  fake.store.pendingTalk = { mode: 'outro', videoId: A, host: 'm.youtube.com', quizIds: ['p1'] };
  const t = await send({ type: 'talk', videoId: A, mode: 'outro' });
  assert.equal(t.items[0].supported, false);
  await send({ type: 'quizResults', videoId: A, results: [{ quizId: 'p1', result: 'unsupported', attempts: 0 }] });
  const q = fake.store.outbox.filter((e) => e.type === 'quiz').at(-1);
  assert.equal(q.result, 'unsupported');
  assert.notEqual(q.result, 'passed');
});

test('R047 a video from the parent screens plays only in parent mode', async () => {
  kidDay();
  assert.equal((await fromPage({ type: 'watchHere', videoId: D })).ok, false, 'kid mode: refused');
  fake.store.settings.mode = 'parent';
  assert.equal((await fromPage({ type: 'watchHere', videoId: D })).ok, true);
  assert.equal(fake.nav.updates.at(-1), `https://m.youtube.com/watch?v=${D}`);
  assert.equal((await fromPage({ type: 'watchHere', videoId: 'bad' })).ok, false);
});

test('R049 “context i also want to see on a tabs in a parent mode”: the documents come from GitHub with the notes not read yet', async () => {
  kidDay({}, { settings: { ...fake.store.settings, mode: 'parent' } });
  delete fake.store.contextDocs;
  repo['kidtube/kid/context/math.md'] = '# Math\nCounting to 20 first.';
  await fromPage({ type: 'sync' });
  assert.equal((await fromPage({ type: 'contextNote', doc: 'math', text: 'Add shapes' })).ok, true);
  assert.equal((await fromPage({ type: 'contextNote', doc: 'cooking', text: 'x' })).ok, false, 'only the app’s documents');
  const c = await fromPage({ type: 'contextData' });
  assert.match(c.docs.math.text, /Counting to 20 first/);
  assert.deepEqual(c.notes.map((n) => [n.doc, n.text]), [['math', 'Add shapes']]);
  delete repo['kidtube/kid/context/math.md'];
});

test('R048 the Prompt tab names how his answers are heard in the words of Settings (cloud is the default)', async () => {
  const { listenLabel } = await import('../../extension/apps/kidtube/background/parent.js');
  kidDay({}, { settings: { ...fake.store.settings, mode: 'parent' } });
  const h = await fromPage({ type: 'helperData' });
  assert.equal(h.rules.friend.listen, 'recorded and sent: free Groq and Gemini first, then paid OpenRouter');
  assert.equal(listenLabel('device'), 'the tablet’s own speech recognition');
  assert.equal(listenLabel('openrouter'), listenLabel('cloud'));
});

test('R059 “can we store it in a browser storages?”: the install page keeps a copy of the connection and gives it back', async () => {
  const INSTALL = { url: 'https://andyvauliln.github.io/kidtube/', tab: { id: 3, url: 'https://andyvauliln.github.io/kidtube/' } };
  const keep = fake.store.settings;
  const r = await send({ type: 'settingsBackup' }, INSTALL);
  assert.equal(r.backup.token, keep.token);
  assert.equal(r.backup.repo, 'me/data');
  assert.equal((await send({ type: 'settingsBackup' })).ok, false, 'only the install page may ask');
  fake.store.settings = { mode: 'kid' };   // a new install: nothing set
  const back = await send({ type: 'settingsBackup', saved: r.backup }, INSTALL);
  assert.equal(back.restored, true);
  assert.equal(fake.store.settings.token, keep.token);
  assert.equal(fake.store.settings.pinHash, keep.pinHash);
  fake.store.settings = keep;
});

test('R060 “I didn’t see token was in a input”: the GitHub card shows which token is saved, never the token', async () => {
  fake.store.settings.mode = 'parent';
  const h = await send({ type: 'header' });
  assert.equal(h.github.connected, true);
  assert.equal(h.github.tokenHint, 'github_pat_…WXYZ');
  assert.ok(!JSON.stringify(h).includes('secretWXYZ'));
});

test('R062 “automaticly upload settings from github after we connected github or switch profile”: an app opened from the header loads at once', async () => {
  for (const k of Object.keys(repo)) delete repo[k];
  repo['kidtube/kid/profile.json'] = { schemaVersion: 1, email: EMAIL };
  repo['kidtube/kid/queue.json'] = { schemaVersion: 1, updatedAt: '2026-10-09T00:00:00Z', videos: starter.videos.slice(2, 5) };
  repo['kidtube/kid/parent-config.json'] = { schemaVersion: 1, updatedAt: '2026-10-09T00:00:00Z', queueSize: 4 };
  Object.assign(fake.store, { shell: { on: true, locked: false }, data: {}, settings: { ...fake.store.settings, mode: 'parent' } });
  delete fake.store.repoProfiles;
  const r = await send({ type: 'openApp', app: 'kidtube', mode: 'kid' });
  assert.equal(r.ok, true);
  for (let i = 0; i < 50 && !fake.store.data?.queue; i++) await wait(20);
  assert.deepEqual(fake.store.data.queue.videos.map((v) => v.videoId), starter.videos.slice(2, 5).map((v) => v.videoId), 'his list from GitHub, before any 15-minute sync');
  assert.equal(fake.store.data.config.queueSize, 4);
  // Connect / Load from GitHub with the saved token: everything again, at once.
  repo['kidtube/kid/queue.json'] = { schemaVersion: 1, updatedAt: '2026-10-09T01:00:00Z', videos: starter.videos.slice(5, 7) };
  fake.store.settings.mode = 'parent';
  const c = await send({ type: 'connectGitHub', repo: 'me/data', token: '' });
  assert.equal(c.ok, true);
  assert.equal(c.synced, true);
  assert.deepEqual(fake.store.data.queue.videos.map((v) => v.videoId), starter.videos.slice(5, 7).map((v) => v.videoId));
});

test('R070 “button in apps youtube it ll switch to orinal youtube without any applications”', async () => {
  fake.store.settings.mode = 'parent';
  fake.store.shell = { on: false, locked: false };
  const r = await fromPage({ type: 'plainYouTube' });
  assert.equal(r.ok, true);
  assert.deepEqual(fake.store.shell, { on: true, locked: false });
  assert.equal(fake.nav.updates.at(-1), 'https://m.youtube.com/');
  assert.equal((await send({ type: 'header' })).running, null, 'no app runs: the YouTube tile is the ringed one');
  // Kid mode: the header is not his, so the tile does nothing.
  fake.store.shell = { on: false, locked: false };
  fake.store.settings.mode = 'kid';
  assert.equal((await send({ type: 'plainYouTube' })).ok, false);
  assert.deepEqual(fake.store.shell, { on: false, locked: false });
});

test('R074 “it could be another application for youtube”: one message type belongs to one app only', async () => {
  const { registerApps } = await import('../../extension/core/background/apps.js');
  assert.throws(() => registerApps([{ id: 'other', handlers: { tick: () => ({}) } }]), /other and kidtube both handle the message "tick"/);
  const core = readFileSync('extension/core/background/messages.js', 'utf8') + readFileSync('extension/core/background/store.js', 'utf8');
  assert.doesNotMatch(core, /from '\.\.\/\.\.\/apps\/kidtube\//, 'the core never imports an app');
});

test('R076 the PIN is kept only as a salted hash; wrong tries make the parent wait', async () => {
  const { hashPin, checkPin } = await import('../../extension/core/lib/pin.js');
  const salt = Buffer.from('saltsaltsaltsalt').toString('base64');
  fake.store.settings = { ...fake.store.settings, pinSalt: salt, pinHash: await hashPin('2580', salt), pinFails: 0, pinLockedUntil: 0 };
  assert.ok(!JSON.stringify(fake.store.settings).includes('2580'), 'no plain PIN stored');
  assert.equal((await checkPin('2580')).ok, true);
  for (let i = 0; i < 4; i++) assert.equal((await checkPin('0000')).error, 'Wrong PIN.');
  assert.equal((await checkPin('0000')).error, 'Too many tries. Wait 1 minute.');
  assert.match((await checkPin('2580')).error, /^Too many tries\. Wait \d+ s\.$/, 'even the right PIN waits');
  fake.store.settings.pinLockedUntil = Date.now() - 1;
  assert.equal((await checkPin('2580')).ok, true);
  fake.store.settings = { ...fake.store.settings, pinHash: 'H', pinSalt: 'S' };
});

test('R104 “folder should have some docs with readme explanation”: every code folder has a README, or a README above names it', () => {
  const missing = [];
  const walk = (dir) => {
    const names = readdirSync(dir);
    const code = names.some((n) => /\.(m?js|sh|html)$/.test(n));
    if (code && !existsSync(join(dir, 'README.md'))) {
      const name = dir.split('/').pop();
      const named = [join(dir, '..', 'README.md'), join(dir, '..', '..', 'README.md')].some((p) => existsSync(p) && readFileSync(p, 'utf8').includes(`${name}/`));
      if (!named) missing.push(dir);
    }
    for (const n of names) if (!['node_modules', '.git'].includes(n) && statSync(join(dir, n)).isDirectory()) walk(join(dir, n));
  };
  for (const top of ['extension', 'agent', 'build', 'tests']) walk(top);
  assert.deepEqual(missing, []);
  assert.equal(existsSync('spike'), false);
});

test('R003 “Banner and overlay ads are removed, Skip is pressed when it appears”: on by default, the ad servers blocked on Quetta', async () => {
  const { applySiteRules, AD_DOMAINS } = await import('../../extension/core/background/sites.js');
  const { AD_RULE_ID } = await import('../../extension/core/background/constants.js');
  kidDay();
  assert.equal((await send({ type: 'state' })).rules.blockAds, true, 'the page hides and skips ads (apps/kidtube/content/youtube.js)');
  await applySiteRules();
  const ad = fake.rules.find((r) => r.id === AD_RULE_ID);
  assert.deepEqual(ad?.condition.requestDomains, AD_DOMAINS);
  assert.equal(ad.condition.resourceTypes, undefined, 'everything a page loads, not the page itself');
  assert.ok(!AD_DOMAINS.some((d) => /youtube/.test(d)), 'YouTube’s own requests stay open: blocking them makes YouTube warn about ad blockers');
  // The parent turns it off in Settings: no ad rule, nothing skipped.
  kidDay({ blockAds: false });
  await applySiteRules();
  assert.equal(fake.rules.some((r) => r.id === AD_RULE_ID), false);
  assert.equal((await send({ type: 'state' })).rules.blockAds, false);
  kidDay();
  await applySiteRules();
});

test('R027 “ok add pikachu now”, then “Should Settings offer Pikachu?” “ok do it”: an avatar from the data repo is offered, downloaded and shown', async () => {
  // Cache Storage, in memory (the browser keeps the chosen avatar there).
  const mem = new Map();
  const box = (n) => { if (!mem.has(n)) mem.set(n, new Map()); return mem.get(n); };
  globalThis.caches = { open: async (n) => ({
    match: async (k) => box(n).get(String(k?.url ?? k))?.clone(),
    put: async (k, r) => { box(n).set(String(k?.url ?? k), r); },
    delete: async (k) => box(n).delete(String(k?.url ?? k)),
    keys: async () => [...box(n).keys()].map((url) => ({ url })),
  }) };
  const K = 'https://kidtube.invalid/avatars/pikachu/';
  const kept = () => [...box('kidtube-avatar').keys()].map((u) => u.replace(K, '')).sort();
  const { KIDTUBE_CHECKS } = await import('../../extension/apps/kidtube/background/checks.js');
  const { Expect } = await import('../../extension/core/checks/kit.js');
  const avatarCheck = async () => { const t = new Expect(); await KIDTUBE_CHECKS.start.find((c) => c.id === 'kidtube.avatar').run(t); return t; };
  try {
    for (const k of Object.keys(repo)) delete repo[k];
    repo['kidtube/kid/profile.json'] = { schemaVersion: 1, email: EMAIL };
    repo['kidtube/kid/avatars/pikachu/rig.json'] = { view: { padTop: 0 } };
    repo['kidtube/kid/avatars/pikachu/built/layers.json'] = { build: 1, layers: {} };
    repo['kidtube/kid/avatars/pikachu/built/base.png'] = 'PNG';
    repo['kidtube/kid/avatars/pikachu/built/sprites/sprites.json'] = { layers: {} };
    repo['kidtube/kid/avatars/pikachu/notes.txt'] = 'not part of the avatar';
    kidDay();
    Object.assign(fake.store, { data: {}, settings: { ...fake.store.settings, mode: 'parent' } });
    await fromPage({ type: 'sync' });
    assert.deepEqual((await fromPage({ type: 'getRules' })).repoAvatars, ['pikachu'], 'Settings offers it');
    assert.deepEqual(kept(), [], 'not chosen: nothing downloaded');
    assert.equal((await avatarCheck()).skipped, 'no avatar from the data repo chosen');

    // The parent picks it in Settings and saves: on GitHub, and downloaded at once.
    await fromPage({ type: 'saveRules', patch: { presenter: { avatar: 'repo:pikachu' } } });
    for (let i = 0; i < 50 && !kept().includes('rig.json'); i++) await wait(20);
    assert.deepEqual(kept(), ['.files', 'built/base.png', 'built/layers.json', 'built/sprites/sprites.json', 'rig.json']);
    assert.equal(repo['kidtube/kid/parent-config.json'].presenter.avatar, 'repo:pikachu');
    const t = await avatarCheck();
    assert.equal(t.passed && !t.skipped, true, JSON.stringify(t.mismatch));
    // The talk screen gets "repo:pikachu": kid/mesh.js cachedAvatar reads it from the cache.
    assert.equal((await send({ type: 'talk', videoId: A, mode: 'intro' })).avatar, 'repo:pikachu');

    // The next sync downloads only what changed.
    calls.length = 0;
    await fromPage({ type: 'sync' });
    assert.deepEqual(calls.filter((c) => /^GET kidtube\/kid\/avatars\/pikachu\/.*\.(png|json)$/.test(c)), []);
    assert.ok(!(fake.store.syncStatus?.errors ?? []).some((e) => e.startsWith('Moving avatar')), fake.store.syncStatus?.errors?.join(' | '));
    repo['kidtube/kid/avatars/pikachu/built/base.png'] = 'PNG, drawn again';
    await fromPage({ type: 'sync' });
    assert.equal(await (await box('kidtube-avatar').get(`${K}built/base.png`).clone().blob()).text(), 'PNG, drawn again');

    // Gone from the data repo: the sync says why, and the copy here stays (as the last good list does).
    for (const k of Object.keys(repo)) if (k.includes('/avatars/')) delete repo[k];
    await fromPage({ type: 'sync' });
    assert.ok(fake.store.syncStatus.errors.some((e) => /Moving avatar: avatars\/pikachu\/ is not in the data repo/.test(e)), fake.store.syncStatus.errors.join(' | '));
    assert.ok(kept().includes('rig.json'));
    // Never downloaded and not there: the check reports it, with the sync's words.
    box('kidtube-avatar').clear();
    const missing = await avatarCheck();
    assert.equal(missing.passed, false);
    assert.match(JSON.stringify(missing.mismatch), /is not in the data repo/);

    // Back to Miko (bundled in the extension): the Pikachu files leave the tablet at the next sync.
    repo['kidtube/kid/avatars/pikachu/rig.json'] = { view: { padTop: 0 } };
    await fromPage({ type: 'saveRules', patch: { presenter: { avatar: 'repo:pikachu' } } });
    for (let i = 0; i < 50 && !kept().includes('rig.json'); i++) await wait(20);
    await fromPage({ type: 'saveRules', patch: { presenter: { avatar: 'miko-qipao' } } });
    await fromPage({ type: 'sync' });
    assert.deepEqual(kept(), []);
    assert.equal((await send({ type: 'talk', videoId: A, mode: 'intro' })).avatar, '../avatars/miko-qipao');
  } finally {
    delete globalThis.caches;
  }
});

test('R105 “can i see this configuration in a settings”, then “show and change”: the server’s AI runs a day in Settings', async () => {
  for (const k of Object.keys(repo)) delete repo[k];
  repo['kidtube/kid/profile.json'] = { schemaVersion: 1, email: EMAIL };
  const server = { schemaVersion: 1, day: '2026-10-13', account: 'parent@example.com', updatedAt: '2026-10-13T16:00:00Z',
    runs: { notes: { used: 4, perDay: 10, default: 10, max: 30 }, helper: { used: 1, perDay: 6, default: 6, max: 12 }, fix: { used: 0, perDay: 6, default: 6, max: 20 } } };
  repo['kidtube/kid/server.json'] = server;
  kidDay();
  Object.assign(fake.store, { settings: { ...fake.store.settings, mode: 'parent' } });
  await fromPage({ type: 'sync' });
  assert.deepEqual((await fromPage({ type: 'getRules' })).server, server, 'Settings gets the server’s numbers');
  await fromPage({ type: 'saveRules', patch: { agents: { notesPerDay: 15, helperPerDay: 2, fixPerDay: 4 } } });
  assert.deepEqual(repo['kidtube/kid/parent-config.json'].agents, { notesPerDay: 15, helperPerDay: 2, fixPerDay: 4 }, 'saved where the server reads it (agent/limits.mjs)');
  assert.deepEqual((await fromPage({ type: 'getRules' })).config.agents, { notesPerDay: 15, helperPerDay: 2, fixPerDay: 4 });
  // The card is out of the bridge's reach (dev mode), as the other rules.
  assert.match(readFileSync('extension/apps/kidtube/parent/settings.js', 'utf8'), /<section id="sec-server" class="rules" data-bridge="no">/);
});
