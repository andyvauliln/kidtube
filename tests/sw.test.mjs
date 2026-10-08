// Plays the kid's scenarios against the real service worker with a fake chrome API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeChrome } from './fake-chrome.mjs';

const fake = installFakeChrome();
await import('../extension/sw.js');

const queue = JSON.parse(readFileSync('extension/default-queue.json', 'utf8'));
const [A, B] = queue.videos.map((v) => v.videoId);
const TAB = 7, TAB_URL = 'https://m.youtube.com/';

const send = (msg) => new Promise((resolve) => fake.listeners.message[0](msg, { tab: { id: TAB, url: TAB_URL } }, resolve));
// Simulates the tab moving to a URL; returns where the guard sent it (or the URL itself if allowed).
async function navigate(url) {
  fake.nav.updates.length = 0;
  fake.listeners.tabUpdated[0](TAB, { url });
  await new Promise((r) => setTimeout(r, 20));
  return fake.nav.updates.at(-1) ?? url;
}
async function play(seconds) {
  let r;
  for (let left = seconds; left > 0; left -= 15) r = await send({ type: 'tick', videoId: fake.store.session?.videoId, seconds: Math.min(15, left) });
  return r;
}
// One profile (a YouTube account): its files are under kidtube/kid/ in the data repo.
fake.store.account = { key: 'kid@example.com', email: 'kid@example.com', app: 'kidtube', folder: 'kid' };
// Keep the tests inside the allowed hours whatever time it is now.
fake.store.data = { config: { schemaVersion: 1, updatedAt: '2026-10-01T00:00:00Z', time: { allowed: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '00:00', to: '23:59' }], maxMinutesPerDay: 20 } } };

test('home screen lists the starter videos', async () => {
  const st = await send({ type: 'state' });
  assert.equal(st.lock, null);
  assert.equal(st.videos.length, 10);
});

test('a random video is sent home and logged', async () => {
  assert.equal(await navigate('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://m.youtube.com/');
  assert.equal(fake.store.outbox.at(-1).type, 'blocked');
});

test('channel, shorts and search pages are sent home', async () => {
  for (const u of ['https://m.youtube.com/@x', 'https://m.youtube.com/shorts/abc', 'https://m.youtube.com/results?search_query=x']) {
    assert.equal(await navigate(u), 'https://m.youtube.com/');
  }
});

test('a listed video plays; leaving before the lock returns to it', async () => {
  assert.equal(await navigate(`https://m.youtube.com/watch?v=${A}`), `https://m.youtube.com/watch?v=${A}`);
  assert.equal(fake.store.session.videoId, A);
  assert.equal(await navigate('https://m.youtube.com/'), `https://m.youtube.com/watch?v=${A}`);
  assert.equal(await navigate(`https://m.youtube.com/watch?v=${B}`), `https://m.youtube.com/watch?v=${A}`);
  assert.equal((await send({ type: 'goHome' })).ok, false);
  assert.ok((await send({ type: 'state' })).session.secondsUntilUnlock > 0);
});

test('after 2 minutes he can leave; the video counts as watched and leaves the list', async () => {
  await play(120);
  assert.equal((await send({ type: 'state' })).session.secondsUntilUnlock, 0);
  assert.equal(await navigate(`https://m.youtube.com/watch?v=${B}`), `https://m.youtube.com/watch?v=${B}`);
  const watch = fake.store.outbox.filter((e) => e.type === 'watch').at(-1);
  assert.equal(watch.videoId, A);
  assert.equal(watch.endReason, 'leftAfterLock');
  assert.ok(watch.watchedSeconds >= 120);
  assert.ok(!(await send({ type: 'state' })).videos.some((v) => v.videoId === A));
  assert.equal(await navigate(`https://m.youtube.com/watch?v=${A}`), `https://m.youtube.com/watch?v=${B}`); // watched + B still locked
});

test('video end sends him home and logs ended', async () => {
  await send({ type: 'ended', videoId: B });
  assert.equal(fake.nav.updates.at(-1), 'https://m.youtube.com/');
  assert.equal(fake.store.outbox.filter((e) => e.type === 'watch').at(-1).endReason, 'ended');
  assert.equal(fake.store.session, null);
});

test('a blocked channel found in player data is closed', async () => {
  const C = (await send({ type: 'state' })).videos[0].videoId;
  await navigate(`https://m.youtube.com/watch?v=${C}`);
  fake.store.data.config.blockedChannelIds = ['UCzzzzzzzzzzzzzzzzzzzzzz'];
  await send({ type: 'details', videoId: C, channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz', lengthSeconds: 300, isLive: false });
  assert.equal(fake.nav.updates.at(-1), 'https://m.youtube.com/');
  assert.equal(fake.store.outbox.filter((e) => e.type === 'watch').at(-1).endReason, 'blockedOnLoad');
  delete fake.store.data.config.blockedChannelIds;
});

test('the daily cap locks the screen and logs timeUp', async () => {
  const C = (await send({ type: 'state' })).videos[0].videoId;
  await navigate(`https://m.youtube.com/watch?v=${C}`);
  const r = await play(20 * 60);
  assert.equal(r.action, 'lock');
  assert.equal(fake.store.outbox.at(-1).type, 'timeUp');
  assert.equal((await send({ type: 'state' })).lock.reason, 'dailyCap');
  assert.equal(await navigate(`https://m.youtube.com/watch?v=${C}`), 'https://m.youtube.com/');
  assert.equal((await send({ type: 'open', videoId: C })).ok, false);
});

test('site allowlist rule blocks everything outside the allowed domains', async () => {
  await send({ type: 'sync' });
  const rule = fake.rules[0];
  assert.deepEqual(rule.condition.resourceTypes, ['main_frame']);
  assert.ok(rule.condition.excludedRequestDomains.includes('youtube.com'));
});

test('a token that cannot see the repo gets a plain explanation, once', async () => {
  await chrome.storage.local.set({ settings: { ...fake.store.settings, token: 'github_pat_x' } });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url) === 'https://api.github.com/user') return { ok: true, status: 200, json: async () => ({ login: 'andyvauliln' }) };
    return realFetch(url, opts);
  };
  const r = await send({ type: 'sync' });
  globalThis.fetch = realFetch;
  assert.equal(r.errors.filter((e) => e.includes("can't see andyvauliln/kidtube-data")).length, 1);
  assert.ok(r.errors[0].includes('(andyvauliln)'));
});

test('rules saved without GitHub work on the tablet at once', async () => {
  await chrome.storage.local.set({ settings: { ...fake.store.settings, token: '' } });
  const r = await send({ type: 'saveRules', patch: { allowSkip: true, allowedSiteDomains: ['wikipedia.org'] } });
  assert.equal(r.saved, 'tablet');
  assert.equal((await send({ type: 'state' })).rules.allowSkip, true);
  const domains = fake.rules[0].condition.excludedRequestDomains;
  assert.ok(domains.includes('wikipedia.org') && domains.includes('youtube.com'), 'youtube.com always stays open');
});

test('rules are merged into parent-config.json on GitHub, then the local copy is cleared', async () => {
  await chrome.storage.local.set({ settings: { ...fake.store.settings, token: 'github_pat_ok' } });
  const remote = { schemaVersion: 1, updatedAt: '2026-10-01T00:00:00Z', queueSize: 7, time: { maxMinutesPerDay: 30 } };
  let written = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('/contents/parent-config.json')) throw new Error('outside the profile folder');
    if (String(url).endsWith('/contents/kidtube/kid/parent-config.json') && opts.method === 'PUT') {
      written = JSON.parse(Buffer.from(JSON.parse(opts.body).content, 'base64').toString('utf8'));
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (String(url).endsWith('/contents/kidtube/kid/parent-config.json')) {
      return { ok: true, status: 200, json: async () => ({ sha: 'abc', content: Buffer.from(JSON.stringify(remote)).toString('base64') }) };
    }
    return realFetch(url, opts);
  };
  const r = await send({ type: 'saveRules', patch: { time: { maxMinutesPerDay: 45 } } });
  globalThis.fetch = realFetch;
  assert.equal(r.saved, 'github');
  assert.equal(written.queueSize, 7, 'keeps what the agent wrote');
  assert.equal(written.time.maxMinutesPerDay, 45);
  assert.equal(written.allowSkip, true, 'earlier tablet-only rules go up too');
  assert.equal(fake.store.localConfig, null);
});

test('a new profile without its files yet: a note, not a problem', async () => {
  await chrome.storage.local.set({ settings: { ...fake.store.settings, token: 'github_pat_ok' }, data: { ...fake.store.data, config: undefined, queue: undefined } });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u === 'https://api.github.com/user') return { ok: true, status: 200, json: async () => ({ login: 'me' }) };
    if (u === 'https://api.github.com/repos/andyvauliln/kidtube-data') return { ok: true, status: 200, json: async () => ({}) };
    return realFetch(url, opts);
  };
  const r = await send({ type: 'sync' });
  globalThis.fetch = realFetch;
  assert.ok(!r.errors.some((e) => e.includes('parent-config.json') || e.includes('queue.json')), r.errors.join(' | '));
  assert.match(r.notes[0], /^New profile: kidtube\/kid\/ has no parent-config\.json or queue\.json yet/);
});

test('listening keys from the data repo: kidtube/keys.json, beside the profile folders; gone when the file is gone', async () => {
  await chrome.storage.local.set({ settings: { ...fake.store.settings, token: 'github_pat_ok' } });
  const realFetch = globalThis.fetch;
  let file = { schemaVersion: 1, geminiKey: ' AIza-from-repo ' };
  globalThis.fetch = async (url, opts) => {
    if (String(url).endsWith('/contents/kidtube/kid/keys.json')) throw new Error('inside the profile folder');
    if (String(url).endsWith('/contents/kidtube/keys.json')) return file ? { ok: true, status: 200, json: async () => file, headers: { get: () => '"e1"' } } : { ok: false, status: 404, headers: { get: () => null } };
    return realFetch(url, opts);
  };
  await send({ type: 'sync' });
  assert.deepEqual(fake.store.repoKeys, { gemini: 'AIza-from-repo', openrouter: '' });
  const { listenKeys } = await import('../extension/ui/voice.js');
  assert.equal((await listenKeys()).gemini, 'AIza-from-repo');
  await chrome.storage.local.set({ geminiKey: 'AIza-typed' });
  assert.equal((await listenKeys()).gemini, 'AIza-typed', 'a key typed in Settings wins');
  await chrome.storage.local.remove('geminiKey');
  file = null;
  await send({ type: 'sync' });
  globalThis.fetch = realFetch;
  assert.equal(fake.store.repoKeys, undefined);
});

test('Quetta asks for a newer release itself, and reloads YouTube after the update', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).endsWith('/latest.json')
    ? { ok: true, status: 200, json: async () => ({ version: '9.9.9', zipUrl: 'https://x.test/k.zip' }) }
    : realFetch(url));
  let asked = 0;
  fake.runtime.requestUpdateCheck = (cb) => { asked++; cb({ status: 'update_available', version: '9.9.9' }); };
  const v = await send({ type: 'version' });
  assert.equal(v.newer, true);
  assert.equal(v.updating, 'update_available');
  await send({ type: 'version' });
  assert.equal(asked, 1, 'at most one ask every 5 minutes');
  assert.deepEqual(await send({ type: 'updateApp' }), { ok: true, status: 'update_available' });
  assert.equal(asked, 2, 'the toolbar button asks at once');

  const reloaded = [];
  fake.tabs.query = async () => [{ id: 3 }, { id: 4 }];
  fake.tabs.reload = async (id) => { reloaded.push(id); };
  await fake.listeners.installed[0]({ reason: 'update' });
  globalThis.fetch = realFetch;
  assert.deepEqual(reloaded, [3, 4]);
});
