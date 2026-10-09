// Parent mode, the parent's plan changes, and per-account data, against the real service worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeChrome } from '../helpers/fake-chrome.mjs';
import { applyPlan, pendingPlan, applyPlanEvent } from '../../extension/apps/kidtube/lib/plan.js';
import { accountFromSwitcher, accountKey, profileFolder, chooserUrl } from '../../extension/core/lib/account.js';

const fake = installFakeChrome();
await import('../../extension/core/background/main.js');

const starter = JSON.parse(readFileSync('extension/apps/kidtube/data/default-queue.json', 'utf8'));
const ids = starter.videos.map((v) => v.videoId);
const queue = { ...starter, updatedAt: '2026-10-05T03:40:00Z', videos: starter.videos.slice(0, 3), upcoming: [{ videoId: ids[3], title: 'Planned 1' }, { videoId: ids[4], title: 'Planned 2' }] };
const rec = (v, status, extra = {}) => ({ title: v.title, channelId: v.channelId, channelTitle: v.channelTitle, durationSeconds: v.durationSeconds, lang: 'en', why: 'because', status, approved: status !== 'idea', required: null, addedAt: '2026-10-02T00:00:00Z', ...extra });
const memory = {
  schemaVersion: 1, updatedAt: '2026-10-05T03:40:00Z', processedThrough: '2026-10-04T18:00:00Z',
  helper: { processedThrough: '2026-10-04T18:00:00Z', videos: {
    ...Object.fromEntries(starter.videos.slice(0, 3).map((v) => [v.videoId, rec(v, 'today')])),
    [ids[3]]: rec(starter.videos[3], 'planned', { content: { summary: 'S', learned: ['L'], intro: 'Hello', outro: 'Bye', talkAbout: ['T'], quizIds: ['p-1'],
      items: { 'p-1': { type: 'voice', prompt: 'How many?', answer: { kind: 'text', accept: ['five', '5'] } } } } }),
    [ids[4]]: rec(starter.videos[4], 'idea'),
    [ids[5]]: rec(starter.videos[5], 'watched', { watchedAt: '2026-10-03T16:00:00Z' }),
  } },
};
fake.store.data = { queue, memoryMeta: { processedThrough: '2026-10-04T18:00:00Z' },
  config: { schemaVersion: 1, time: { allowed: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '00:00', to: '23:59' }], maxMinutesPerDay: 0 } } };
fake.store.memory = memory;

const YT = { id: 7, url: 'https://m.youtube.com/' };
const PAGE = { url: 'ext://apps/kidtube/parent/parent.html', tab: { id: 8, url: 'ext://apps/kidtube/parent/parent.html' } };
const send = (msg, sender = { tab: YT }) => new Promise((resolve) => fake.listeners.message[0](msg, sender, resolve));
const fromPage = (msg) => send(msg, PAGE);
async function navigate(url) {
  fake.nav.updates.length = 0;
  fake.listeners.tabUpdated[0](YT.id, { url });
  await new Promise((r) => setTimeout(r, 20));
  return fake.nav.updates.at(-1) ?? url;
}

test('plan changes from a YouTube page are refused', async () => {
  const refused = await send({ type: 'setMode', mode: 'parent' });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /did not come from a KidTube page/);
  assert.equal((await send({ type: 'plan', action: 'drop', videoId: ids[0] })).ok, false);
});

test('plan changes need parent mode', async () => {
  assert.equal((await fromPage({ type: 'plan', action: 'drop', videoId: ids[0] })).ok, false);
});

test('parent mode: YouTube home opens the parent screens, any video plays, nothing is counted', async () => {
  assert.equal((await fromPage({ type: 'setMode', mode: 'parent' })).ok, true);
  assert.equal(fake.store.settings.parentUntil, 0);   // stays on until the parent leaves (no timer since 0.8.9)
  assert.equal(await navigate('https://m.youtube.com/'), 'ext://apps/kidtube/parent/parent.html');
  assert.equal(await navigate('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://m.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal((await send({ type: 'tick', videoId: 'dQw4w9WgXcQ', seconds: 10 })).action, 'none');
  assert.equal(fake.store.today?.playedSeconds ?? 0, 0);
  const st = await send({ type: 'state' });
  assert.equal(st.parentMode, true);
});

test('parent data: today, planned (helper order) and history by day', async () => {
  const d = await fromPage({ type: 'parentData' });
  assert.deepEqual(d.today.map((v) => v.videoId), ids.slice(0, 3));
  assert.deepEqual(d.planned.map((v) => v.videoId), [ids[3], ids[4]]);
  assert.equal(d.planned[0].approved, true);
  assert.equal(d.planned[1].status, 'idea');
  assert.equal(d.history[0].date, '2026-10-03');
  assert.equal(d.history[0].items[0].videoId, ids[5]);
});

test('removing an unwatched video from today brings the next planned one, and the helper gets both', async () => {
  const r = await fromPage({ type: 'plan', action: 'notToday', videoId: ids[1] });
  assert.equal(r.ok, true);
  assert.equal(r.added, ids[3]);
  const st = await send({ type: 'state' });
  assert.ok(!st.videos.some((v) => v.videoId === ids[1]));
  const added = st.videos.find((v) => v.videoId === ids[3]);
  assert.equal(added.intro.text, 'Hello');                       // full entry from memory.json
  const plans = fake.store.outbox.filter((e) => e.type === 'plan');
  assert.deepEqual(plans.map((e) => [e.action, e.videoId]), [['notToday', ids[1]], ['today', ids[3]]]);
  const d = await fromPage({ type: 'parentData' });
  assert.ok(d.planned.some((v) => v.videoId === ids[1]));          // back to planned
  // its questions come along for the talking friend
  const rules = await send({ type: 'getRules' });
  assert.equal(rules.config.quiz.items['p-1'].prompt, 'How many?');
});

test('must-watch on a today video shows the star to him at once', async () => {
  await fromPage({ type: 'plan', action: 'required', videoId: ids[0], value: true });
  const st = await send({ type: 'state' });
  assert.equal(st.videos.find((v) => v.videoId === ids[0]).required, true);
  await fromPage({ type: 'plan', action: 'required', videoId: ids[0], value: false });
  assert.ok(!(await send({ type: 'state' })).videos.find((v) => v.videoId === ids[0]).required);
});

test('approve, drop and restore a planned video', async () => {
  await fromPage({ type: 'plan', action: 'approve', videoId: ids[4], value: true });
  let d = await fromPage({ type: 'parentData' });
  assert.equal(d.planned.find((v) => v.videoId === ids[4]).approved, true);
  await fromPage({ type: 'plan', action: 'drop', videoId: ids[4] });
  d = await fromPage({ type: 'parentData' });
  assert.ok(!d.planned.some((v) => v.videoId === ids[4]));
  assert.equal((await fromPage({ type: 'videoDetail', videoId: ids[4] })).where, 'removed');
  await fromPage({ type: 'plan', action: 'restore', videoId: ids[4] });
  d = await fromPage({ type: 'parentData' });
  assert.ok(d.planned.some((v) => v.videoId === ids[4]));
});

test('video details: summary, why, intro/outro and the questions', async () => {
  const d = await fromPage({ type: 'videoDetail', videoId: ids[3] });
  assert.equal(d.where, 'today');
  assert.equal(d.summary, 'S');
  assert.equal(d.why, 'because');
  assert.deepEqual(d.learned, ['L']);
  assert.equal(d.outro.text, 'Bye');
  assert.equal(d.items[0].prompt, 'How many?');
});

test('notes for the AI: one video (parentNote) and a whole list (wish with list)', async () => {
  assert.equal((await fromPage({ type: 'note', videoId: ids[0], comment: 'Too fast for him' })).ok, true);
  assert.equal((await fromPage({ type: 'wish', list: 'planned', text: 'More numbers please' })).ok, true);
  assert.equal(fake.store.outbox.at(-1).list, 'planned');
  const d = await fromPage({ type: 'parentData' });
  assert.equal(d.lists.planned[0].text, 'More numbers please');
  assert.equal((await fromPage({ type: 'videoDetail', videoId: ids[0] })).notes[0].text, 'Too fast for him');
});

test('prompt changes: added, shown as waiting, removed; the helper gets prompt events', async () => {
  fake.store.memory.helper.promptNotes = [{ id: 'note-0001-aaaa', at: '2026-10-04T10:00:00Z', text: 'Animals every day' }];
  const added = await fromPage({ type: 'promptNote', action: 'add', text: 'Questions only in English' });
  assert.equal(added.ok, true);
  let h = await fromPage({ type: 'helperData' });
  assert.deepEqual(h.notes.map((n) => [n.text, n.pending]), [['Animals every day', false], ['Questions only in English', true]]);
  await fromPage({ type: 'promptNote', action: 'remove', noteId: 'note-0001-aaaa' });
  h = await fromPage({ type: 'helperData' });
  assert.deepEqual(h.notes.map((n) => n.text), ['Questions only in English']);
  const evs = fake.store.outbox.filter((e) => e.type === 'prompt');
  assert.deepEqual(evs.map((e) => e.action), ['add', 'remove']);
  assert.equal(evs[0].noteId, evs[0].eventId);
  assert.equal(h.rules.queueSize, 10);
  assert.equal((await fromPage({ type: 'promptNote', action: 'add', text: '  ' })).ok, false);
});

test('prompt changes also come from the settings page with parent mode off, never from YouTube', async () => {
  const before = fake.store.settings;
  fake.store.settings = { ...before, mode: 'kid', parentUntil: 0 };
  const opts = { url: 'ext://core/pages/options.html', tab: { id: 9, url: 'ext://core/pages/options.html' } };
  assert.equal((await send({ type: 'promptNote', action: 'add', text: 'More animals' }, opts)).ok, true);
  assert.equal((await send({ type: 'promptNote', action: 'add', text: 'From the page' })).ok, false);
  assert.ok((await send({ type: 'helperData' }, opts)).notes.some((n) => n.text === 'More animals'));
  fake.store.settings = before;
});

test('kid mode: home is his list again', async () => {
  await fromPage({ type: 'kidHome' });
  assert.equal(fake.store.settings.mode, 'kid');
  assert.equal(await navigate('https://m.youtube.com/'), 'https://m.youtube.com/');
  assert.equal(await navigate('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://m.youtube.com/');
});

test('parent mode times out', async () => {
  fake.store.settings = { ...fake.store.settings, mode: 'parent', parentUntil: Date.now() - 1000 };
  assert.equal((await send({ type: 'state' })).parentMode, false);
});

// YouTube's page names its account (core/content/shell.js sends the account switcher's answer).
const switcherFor = (email) => `)]}'\n${JSON.stringify({ header: { email: { simpleText: email } }, items: [{ accountItem: { isSelected: true } }] })}`;
const youtubeHas = (email, datasyncId = 'X||') => send(email ? { type: 'account', loggedIn: true, datasyncId, switcher: switcherFor(email) } : { type: 'account', loggedIn: false, datasyncId: '' });
// A data repo with these profiles (<app>/<folder>/profile.json); every other GitHub call is a 404.
async function withRepo(profiles, fn) {
  const realFetch = globalThis.fetch;
  delete fake.store.repoProfiles;
  globalThis.fetch = async (url, init = {}) => {
    const m = String(url).match(/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (!String(url).includes('api.github.com')) return realFetch(url, init);
    const no = { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } };
    if (!m || init.method === 'PUT') return init.method === 'PUT' ? { ok: true, status: 200, json: async () => ({}) } : no;
    const path = decodeURIComponent(m[1]);
    const dirs = profiles.filter((p) => p.app === path);
    if (dirs.length) return { ok: true, status: 200, json: async () => dirs.map((p) => ({ type: 'dir', name: p.folder })) };
    const p = profiles.find((x) => path === `${x.app}/${x.folder}/profile.json`);
    if (p) return { ok: true, status: 200, json: async () => ({ sha: 's', content: Buffer.from(JSON.stringify({ schemaVersion: 1, email: p.email })).toString('base64') }) };
    return no;
  };
  try { return await fn(); } finally { globalThis.fetch = realFetch; delete fake.store.repoProfiles; }
}

test('the apps header: sign in, connect GitHub, open or create this account’s apps; each has its own data; the PIN and GitHub stay', async () => {
  fake.store.settings = { ...fake.store.settings, pinHash: 'H', pinSalt: 'S', repo: 'me/data', token: '' };
  await fromPage({ type: 'leaveApp' });
  assert.equal(await navigate('https://m.youtube.com/results?search_query=x'), 'https://m.youtube.com/results?search_query=x', 'plain YouTube');
  assert.deepEqual((await send({ type: 'state' })).shell, { on: true, locked: false });
  assert.ok((fake.rules[0]?.condition.excludedRequestDomains ?? ['google.com']).includes('google.com'), 'Google’s sign-in is open');

  await youtubeHas(null);
  let h = await send({ type: 'header' });
  assert.equal(h.signedIn, false);
  assert.equal(h.apps.length, 0, 'not signed in: no apps');
  assert.equal((await send({ type: 'openApp', app: 'kidtube', create: true })).ok, false);
  assert.match(h.switchAccount, /^https:\/\/accounts\.google\.com\/AccountChooser\?service=youtube&continue=/);

  await youtubeHas('first@example.com', 'AAA||');
  h = await send({ type: 'header' });
  assert.equal(h.email, 'first@example.com');
  assert.equal(h.github.connected, false, 'no GitHub yet: the header asks for it');
  assert.equal(h.apps.length, 0);

  fake.store.settings.token = 't1';
  await withRepo([{ app: 'kidtube', folder: 'first', email: 'first@example.com' }, { app: 'kidtube', folder: 'zed', email: 'zed@example.com' }], async () => {
    h = await send({ type: 'header' });
    assert.deepEqual(h.apps.map((a) => [a.id, a.has, a.folder]), [['kidtube', true, 'first'], ['blank', false, null]], 'the repo knows its KidTube');
    assert.equal((await send({ type: 'openApp', app: 'blank' })).ok, false, 'not there yet: Create, not Open');
    const r = await send({ type: 'openApp', app: 'kidtube', mode: 'kid' });
    assert.equal(r.ok, true);
    assert.equal(r.url, 'https://m.youtube.com/', 'kid mode: his list on YouTube');
  });
  assert.equal(fake.store.account.key, 'first@example.com');
  assert.equal(fake.store.account.folder, 'first', 'the folder the repo already has');
  assert.equal(fake.store.settings.mode, 'kid');
  assert.deepEqual(fake.store.shell, { on: false, locked: false });
  assert.equal((await send({ type: 'state' })).shell.on, false);
  fake.store.settings.queueSize = 3;                               // a setting of this profile only
  fake.store.planLog = { events: [{ at: '2026-10-05T10:00:00Z', action: 'drop', videoId: 'x' }] };

  // Another account on YouTube while KidTube runs in kid mode: it stops, and YouTube is locked for the PIN.
  await youtubeHas('other@example.com', 'BBB||');
  assert.equal(fake.store.shell.on, true);
  assert.equal(fake.store.shell.locked, true);
  assert.match(fake.store.shell.why, /other@example\.com, not first@example\.com/);
  assert.equal(fake.store.account.key, 'first@example.com', 'nothing switches by itself');
  assert.equal((await send({ type: 'openApp', app: 'kidtube', mode: 'kid' })).ok, false, 'locked: no apps without the PIN');
  assert.equal((await send({ type: 'leaveApp' })).ok, false, 'only from the apps page');
  assert.equal((await fromPage({ type: 'leaveApp' })).ok, true, 'the apps page, after the PIN');
  assert.equal(fake.store.shell.locked, false);

  await withRepo([], async () => {
    h = await send({ type: 'header' });
    assert.deepEqual(h.apps.map((a) => a.has), [false, false], 'nothing for this account yet');
    assert.equal((await send({ type: 'openApp', app: 'kidtube', mode: 'kid' })).ok, false);
    const r = await send({ type: 'openApp', app: 'kidtube', create: true });
    assert.equal(r.url, 'ext://apps/kidtube/parent/parent.html', 'a new KidTube starts in parent mode');
  });
  assert.equal(fake.store.account.key, 'other@example.com');
  assert.equal(fake.store.account.folder, 'other');
  assert.equal(fake.store.settings.mode, 'parent');
  assert.equal(fake.store.settings.token, 't1', 'the GitHub connection belongs to the tablet');
  assert.equal(fake.store.settings.pinHash, 'H', 'same PIN');
  assert.equal(fake.store.settings.queueSize, undefined);
  assert.equal(fake.store.planLog, undefined, 'a new profile starts empty');
  assert.equal(fake.store['acct:first@example.com'].settings.queueSize, 3);

  // In parent mode a change of account opens the header at once (the tablet is open anyway).
  await youtubeHas('first@example.com', 'AAA||');
  assert.deepEqual([fake.store.shell.on, fake.store.shell.locked], [true, false]);
  await withRepo([], async () => assert.equal((await send({ type: 'openApp', app: 'kidtube', mode: 'kid' })).ok, true, 'known on this tablet'));
  assert.equal(fake.store.account.key, 'first@example.com');
  assert.equal(fake.store.settings.queueSize, 3, 'its own settings are back');
  assert.equal(fake.store.planLog.events.length, 1);
  assert.equal(fake.store.settings.mode, 'kid');

  // The same account again (or one YouTube can't name, with the same id): it keeps running.
  await youtubeHas('first@example.com', 'AAA||');
  await send({ type: 'account', loggedIn: true, datasyncId: 'AAA||', switcher: '' });
  assert.equal(fake.store.shell.on, false);
  // Signed out: it stops too.
  await youtubeHas(null);
  assert.deepEqual([fake.store.shell.on, fake.store.shell.locked], [true, true]);
  await fromPage({ type: 'leaveApp' });
  await youtubeHas('first@example.com', 'AAA||');
  await withRepo([], () => send({ type: 'openApp', app: 'kidtube', mode: 'kid' }));
  assert.equal(fake.store.shell.on, false);
});

test('applyPlan: notToday, today, drop, required', () => {
  const plan = { events: [
    { at: '2026-10-05T10:00:00Z', action: 'notToday', videoId: 'a' },
    { at: '2026-10-05T10:00:01Z', action: 'today', videoId: 'c' },
    { at: '2026-10-05T10:00:02Z', action: 'required', videoId: 'b', value: true },
    { at: '2026-10-05T10:00:03Z', action: 'drop', videoId: 'd' },
  ], entries: { c: { videoId: 'c', title: 'C', durationSeconds: 100 } } };
  const q = applyPlan({ videos: [{ videoId: 'a' }, { videoId: 'b' }], upcoming: [{ videoId: 'c' }, { videoId: 'd' }] }, plan);
  assert.deepEqual(q.videos.map((v) => v.videoId), ['b', 'c']);
  assert.equal(q.videos[0].required, true);
  assert.deepEqual(q.upcoming.map((u) => u.videoId), ['a']);
});

test('pendingPlan drops what the helper has read', () => {
  const p = pendingPlan({ events: [{ at: '2026-10-04T10:00:00Z', videoId: 'a' }, { at: '2026-10-05T10:00:00Z', videoId: 'b' }], entries: { a: {}, b: { quizIds: ['q'] } }, items: { q: {}, z: {} } }, '2026-10-04T12:00:00Z');
  assert.deepEqual(p.events.map((e) => e.videoId), ['b']);
  assert.deepEqual(Object.keys(p.entries), ['b']);
  assert.deepEqual(Object.keys(p.items), ['q']);
});

test('applyPlanEvent mirrors the helper statuses', () => {
  assert.equal(applyPlanEvent({ status: 'idea', approved: false }, { action: 'approve', value: true }).status, 'planned');
  assert.equal(applyPlanEvent({ status: 'today', approved: false }, { action: 'notToday' }).status, 'idea');
  assert.equal(applyPlanEvent({ required: 'today' }, { action: 'required', value: true }).required, 'today');
});

test('account email from YouTube’s account switcher: the one next to the selected account', () => {
  const json = { sections: [
    { header: { googleAccountHeaderRenderer: { email: { simpleText: 'Parent@Example.com' } } }, contents: [{ accountItem: { accountName: { simpleText: 'Dad' }, isSelected: false } }] },
    { header: { googleAccountHeaderRenderer: { email: { simpleText: 'kid@example.com' } } }, contents: [{ accountItem: { accountName: { runs: [{ text: 'Kid' }] }, isSelected: true } }] },
  ] };
  assert.deepEqual(accountFromSwitcher(`)]}'\n${JSON.stringify(json)}`), { email: 'kid@example.com', name: 'Kid' });
  assert.equal(accountFromSwitcher('not json'), null);
  assert.equal(accountKey({ email: 'A@B.com' }), 'a@b.com');
  assert.equal(accountKey({ datasyncId: 'xyz||' }), 'yt:xyz');
  assert.equal(accountKey({}), null);
});

test('parent mode has no timer: still on hours later, until the parent switches to kid mode', async () => {
  const realNow = Date.now;
  try {
    assert.equal((await fromPage({ type: 'setMode', mode: 'parent' })).ok, true);
    Date.now = () => realNow() + 5 * 3600 * 1000;
    assert.equal((await fromPage({ type: 'parentData' })).parentMode, true);
  } finally { Date.now = realNow; }
  assert.equal((await fromPage({ type: 'setMode', mode: 'kid' })).ok, true);
  assert.equal((await fromPage({ type: 'parentData' })).parentMode, false);
  await fromPage({ type: 'setMode', mode: 'parent' });
});

test('notes wait on the tablet until ↻ Update; then they all go to GitHub, and the run request after them', async () => {
  // A small fake of GitHub's contents API: what the tablet writes.
  const files = {}, puts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const m = String(url).match(/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (!m) return realFetch(url, init);
    const base = `${fake.store.account.app}/${fake.store.account.folder}/`;
    assert.ok(decodeURIComponent(m[1]).startsWith(base), m[1]);   // only inside the profile's folder
    const path = decodeURIComponent(m[1]).slice(base.length);
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body);
      files[path] = { json: JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')), sha: `sha-${puts.length}` };
      puts.push(path);
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (!files[path]) return { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } };
    if (path === 'run-status.json') return { ok: true, status: 200, json: async () => files[path].json, headers: { get: () => null } };   // read raw
    return { ok: true, status: 200, json: async () => ({ sha: files[path].sha, content: Buffer.from(JSON.stringify(files[path].json)).toString('base64') }) };
  };
  try {
    fake.store.settings = { ...fake.store.settings, token: 'ghp_test', repo: 'me/kidtube-data' };
    fake.store.outbox = [];
    assert.equal((await fromPage({ type: 'wish', list: 'settings', text: 'Open parent mode on the Planned tab' })).ok, true);
    assert.equal((await fromPage({ type: 'note', videoId: ids[0], comment: 'Too fast' })).ok, true);
    assert.equal((await fromPage({ type: 'note', videoId: ids[1], liked: true })).ok, true);   // a 👍 is not a note: it goes at once
    assert.equal((await fromPage({ type: 'parentData' })).lists.settings.at(-1).text, 'Open parent mode on the Planned tab');
    assert.equal((await fromPage({ type: 'runStatus' })).held, 2);
    // The notes card lists them with where they were made; ✕ deletes one, Clear all the rest.
    const extra = await fromPage({ type: 'wish', list: 'today', text: 'scrap this' });
    assert.equal(extra.ok, true);
    let held = (await fromPage({ type: 'heldNotes' })).notes;
    assert.deepEqual(held.map((n) => [n.type, n.list ?? n.videoId, n.text]),
      [['wish', 'settings', 'Open parent mode on the Planned tab'], ['parentNote', ids[0], 'Too fast'], ['wish', 'today', 'scrap this']]);
    assert.equal(typeof held[1].title, 'string');
    assert.equal((await fromPage({ type: 'dropNote', id: held[2].id })).ok, true);
    assert.ok(!(await fromPage({ type: 'parentData' })).lists.today?.some((n) => n.text === 'scrap this'), 'gone from the tab’s list too');
    assert.equal((await send({ type: 'heldNotes' }, { tab: { id: 7, url: 'https://m.youtube.com/' } })).ok, false, 'only KidTube’s pages');
    held = (await fromPage({ type: 'heldNotes' })).notes;
    assert.equal(held.length, 2);
    const keep = structuredClone(fake.store.outbox);
    assert.equal((await fromPage({ type: 'dropNote', all: true })).removed, 2);
    assert.equal(fake.store.outbox.filter((e) => e.held).length, 0);
    assert.ok(fake.store.outbox.some((e) => e.liked === true), 'a 👍 waiting to upload is not a note: it stays');
    fake.store.outbox = keep;   // back, for the rest of this test
    await fromPage({ type: 'sync' });   // an ordinary sync (after a video, on open) leaves the notes
    const sent = () => Object.entries(files).filter(([p]) => p.startsWith('activity/')).flatMap(([, f]) => f.json.events);
    assert.deepEqual(sent().map((e) => e.type), ['parentNote']);
    assert.equal(sent()[0].liked, true);
    assert.equal(fake.store.outbox.length, 2);

    const r = await fromPage({ type: 'runHelper' });   // ↻ Update
    assert.equal(r.ok, true);
    assert.equal(fake.store.outbox.length, 0);
    const notes = sent().filter((e) => e.type === 'wish' || e.comment);
    assert.deepEqual(notes.map((e) => e.text ?? e.comment).sort(), ['Open parent mode on the Planned tab', 'Too fast']);
    assert.ok(notes.every((e) => !('held' in e)));     // the tablet's own flag never reaches GitHub
    assert.equal(notes.find((e) => e.type === 'wish').list, 'settings');
    assert.equal(puts.at(-1), 'requests/run.json');    // the request goes after the notes
    assert.equal((await fromPage({ type: 'runStatus' })).held, 0);
    assert.equal((await fromPage({ type: 'runStatus' })).state, 'queued');
    // The server worked on notes under its own id after the request: the tablet stops waiting.
    files['run-status.json'] = { json: { schemaVersion: 1, requestId: 'notes-x', state: 'done', message: 'ok', startedAt: new Date(Date.now() + 1000).toISOString(), finishedAt: new Date(Date.now() + 2000).toISOString() } };
    await fromPage({ type: 'sync' });
    assert.equal((await fromPage({ type: 'runStatus' })).state, 'done');

    // Settings → Update now (sync with notes: true) also sends them.
    await fromPage({ type: 'wish', text: 'More Russian' });
    await fromPage({ type: 'sync', notes: true });
    assert.ok(sent().some((e) => e.text === 'More Russian'));
  } finally {
    globalThis.fetch = realFetch;
    fake.store.settings = { ...fake.store.settings, token: '' };
  }
});

test('profile folders: the email’s name part, given once; a clash adds the domain', () => {
  assert.equal(profileFolder({ email: 'JohnnyPitt.Ind@gmail.com' }), 'johnnypitt.ind');
  assert.equal(profileFolder({ email: 'kid@school.org' }, ['kid']), 'kid-school');
  assert.equal(profileFolder({ email: 'kid@school.org' }, ['kid', 'kid-school']), 'kid-school-2');
  assert.equal(profileFolder({ datasyncId: 'AbC||' }), 'yt-abc');
  assert.equal(profileFolder({}), null);
  // Back through YouTube's own sign-in handler, so YouTube takes the account Google signed in.
  const u = new URL(chooserUrl('a+b@x.com'));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/AccountChooser');
  assert.equal(u.searchParams.get('Email'), 'a+b@x.com');
  assert.equal(u.searchParams.get('service'), 'youtube');
  const back = new URL(u.searchParams.get('continue'));
  assert.equal(back.origin + back.pathname, 'https://m.youtube.com/signin');
  assert.equal(back.searchParams.get('action_handle_signin'), 'true');
  assert.equal(back.searchParams.get('noapp'), '1', 'Android must not open the YouTube app');
  assert.equal(back.searchParams.get('next'), 'https://m.youtube.com/');
  assert.equal(new URL(new URL(chooserUrl('a@x.com', 'www.youtube.com')).searchParams.get('continue')).searchParams.get('app'), 'desktop');
});

test('the header’s pages: parent mode opens the parent screens of the account’s KidTube; Switch account and Sign out', async () => {
  const first = fake.store.account.key;
  await fromPage({ type: 'leaveApp' });
  await youtubeHas(first, 'AAA||');
  const h = await send({ type: 'header' });
  assert.match(h.signOut, /^https:\/\/m\.youtube\.com\/logout$/);
  assert.ok(new URL(new URL(h.switchAccount).searchParams.get('continue')).searchParams.get('noapp'), 'Android must not open the YouTube app');
  assert.equal(await navigate('https://m.youtube.com/'), 'https://m.youtube.com/', 'the header, not the parent page');
  await withRepo([], async () => assert.equal((await send({ type: 'openApp', app: 'kidtube', mode: 'parent' })).url, 'ext://apps/kidtube/parent/parent.html'));
  assert.equal(fake.store.settings.mode, 'parent');
  assert.equal(await navigate('https://m.youtube.com/'), 'ext://apps/kidtube/parent/parent.html');
  const a = await fromPage({ type: 'apps' });
  assert.equal(a.parentMode, true, 'the apps page opens without the PIN');
  assert.equal(a.running.email, first);
  assert.equal((await fromPage({ type: 'leaveApp' })).open, 'https://m.youtube.com/');
  assert.equal(await navigate('https://m.youtube.com/'), 'https://m.youtube.com/');
  await withRepo([], () => send({ type: 'openApp', app: 'kidtube', mode: 'kid' }));
  await fromPage({ type: 'setMode', mode: 'parent' });
});

test('the tablet keeps no history: notes the AI worked on (notes-done.json) and old ones without an id are deleted', async () => {
  fake.store.notes = { ...(fake.store.notes ?? {}), lists: { today: [{ at: '2026-10-01T10:00:00Z', text: 'Old, before ids' }] }, videos: {} };
  await fromPage({ type: 'wish', list: 'settings', text: 'Bigger buttons' });
  await fromPage({ type: 'wish', list: 'settings', text: 'Darker colors' });
  await fromPage({ type: 'note', videoId: ids[0], comment: 'Too fast' });
  const [bigger, darker] = fake.store.outbox.filter((e) => e.list === 'settings').slice(-2);
  const video = fake.store.outbox.filter((e) => e.comment === 'Too fast').at(-1);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/contents/') && u.includes('notes-done.json') && !init.method) {
      return { ok: true, status: 200, headers: { get: () => 'etag-1' }, json: async () => ({ schemaVersion: 1, ids: [bigger.eventId, video.eventId] }) };
    }
    if (u.includes('api.github.com')) return { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } };
    return realFetch(url, init);
  };
  try {
    fake.store.settings = { ...fake.store.settings, token: 'ghp_test', repo: 'me/kidtube-data' };
    await fromPage({ type: 'sync' });
  } finally {
    globalThis.fetch = realFetch;
    fake.store.settings = { ...fake.store.settings, token: '' };
  }
  const d = await fromPage({ type: 'parentData' });
  assert.deepEqual(d.lists.settings.map((n) => n.text), ['Darker colors']);
  assert.equal(d.lists.settings[0].id, darker.eventId);
  assert.equal(d.lists.today, undefined);                              // the old note without an id is gone
  assert.equal(fake.store.notes.videos?.[ids[0]], undefined);
  assert.ok(fake.store.outbox.some((e) => e.eventId === darker.eventId)); // not sent yet: still waits for ↻ Update
});

test('a profile with the blank test app: created from the header, a white page in kid and parent mode, nothing syncs but profile.json', async () => {
  const first = fake.store.account.key;
  fake.store.settings = { ...fake.store.settings, token: 't1' };
  await fromPage({ type: 'leaveApp' });
  await youtubeHas(first, 'AAA||');
  const puts = [];
  await withRepo([], async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => { if (init.method === 'PUT') puts.push(String(url)); return real(url, init); };
    const r = await send({ type: 'openApp', app: 'blank', create: true });
    assert.equal(r.url, 'ext://apps/blank/blank.html');
    await new Promise((ok) => setTimeout(ok, 50));   // the sync Create started
    globalThis.fetch = real;
  });
  assert.equal(fake.store.account.key, `blank:${first}`, 'another app’s profile: "<app>:<email>"');
  assert.equal(fake.store.account.app, 'blank');
  assert.equal(fake.store.account.folder, first.split('@')[0], 'folders are unique within an app: kidtube/x and blank/x');
  assert.deepEqual(puts.map((u) => decodeURIComponent(u.split('/contents/')[1])), [`blank/${first.split('@')[0]}/profile.json`], 'only profile.json, once, so the header finds it');
  await fromPage({ type: 'setMode', mode: 'kid' });
  assert.equal(await navigate('https://m.youtube.com/'), 'ext://apps/blank/blank.html');
  assert.equal(await navigate(`https://m.youtube.com/watch?v=${ids[0]}`), 'ext://apps/blank/blank.html');
  // Google's sign-in steps on YouTube's hosts go through, even in kid mode on a Blank profile.
  assert.equal(await navigate('https://accounts.youtube.com/accounts/SetSID?ssdc=1&sidt=x'), 'https://accounts.youtube.com/accounts/SetSID?ssdc=1&sidt=x');
  await fromPage({ type: 'setMode', mode: 'parent' });
  assert.equal(await navigate('https://m.youtube.com/'), 'ext://apps/blank/blank.html', 'KidTube’s parent screens are not this app’s screens');
  assert.equal((await fromPage({ type: 'parentData' })).app, 'blank', 'the parent page sends it to the apps page');

  // Its account on YouTube changes: Blank stops too.
  await youtubeHas('someone@example.com', 'ZZZ||');
  assert.equal(fake.store.shell.on, true);
  await youtubeHas(first, 'AAA||');
  await withRepo([{ app: 'blank', folder: first.split('@')[0], email: first }], async () => {
    const h = await send({ type: 'header' });
    assert.deepEqual(h.apps.map((a) => [a.id, a.has]), [['kidtube', true], ['blank', true]]);
    assert.equal((await send({ type: 'openApp', app: 'kidtube', mode: 'kid' })).ok, true);
  });
  assert.equal(fake.store.account.key, first);
  assert.equal(fake.store.account.app, 'kidtube');
  await fromPage({ type: 'setMode', mode: 'parent' });
});

test('a Blank profile from 0.9.2–0.9.5 (keyed by its email alone) gets its "blank:" key, so the email can be in KidTube too', async () => {
  const first = fake.store.account.key;
  fake.store.accounts = { ...fake.store.accounts, 'old@example.com': { email: 'old@example.com', app: 'blank', folder: 'old', datasyncId: null, name: null, lastSeen: '2026-10-07T00:00:00Z' } };
  fake.store['acct:old@example.com'] = { settings: { queueSize: 7 } };
  await fromPage({ type: 'leaveApp' });
  await youtubeHas('old@example.com', 'OLD||');
  await withRepo([], () => send({ type: 'openApp', app: 'kidtube', create: true }));
  assert.equal(fake.store.account.key, 'old@example.com', 'a new KidTube profile, not the old Blank one');
  assert.equal(fake.store.account.app, 'kidtube');
  assert.ok(fake.store.accounts['blank:old@example.com']);
  assert.deepEqual(fake.store['acct:blank:old@example.com'], { settings: { queueSize: 7 } }, 'its saved data moves with it');
  await fromPage({ type: 'leaveApp' });
  await youtubeHas(first, 'AAA||');
  await withRepo([], () => send({ type: 'openApp', app: 'kidtube', mode: 'kid' }));
  assert.equal(fake.store.account.key, first);
  await fromPage({ type: 'setMode', mode: 'parent' });
});

test('the header in parent mode: tiles open apps, Add app starts with no list; GitHub and the settings file only where the header shows', async () => {
  const first = fake.store.account.key;   // KidTube runs in parent mode (the test before)
  await youtubeHas(first, 'AAA||');
  const before = { ...fake.store.settings };
  fake.store.settings = { ...fake.store.settings, token: 't1', repo: 'me/data' };
  await withRepo([], async () => {
    const h = await send({ type: 'header' });
    assert.deepEqual([h.open, h.mode, h.running], [true, 'parent', 'kidtube'], 'parent mode: the header shows and can act');
    assert.deepEqual(h.apps.filter((a) => a.active).map((a) => a.id), ['kidtube'], 'the running app is marked');
    assert.ok(h.apps.every((a) => a.color && a.glyph), 'each tile has its look');
    const r = await send({ type: 'openApp', app: 'kidtube' });
    assert.deepEqual([r.ok, r.url, r.navigated], [true, 'ext://apps/kidtube/parent/parent.html', true], 'a tile opens its app in parent mode');
  });
  assert.equal(fake.store.shell.on, false);

  // Google stays open where the header shows (its Switch), even with other sites blocked.
  fake.store.localConfig = { blockOutboundLinks: true, allowedSiteDomains: ['wikipedia.org'] };
  await fromPage({ type: 'setMode', mode: 'parent' });
  assert.ok(fake.rules[0].condition.excludedRequestDomains.includes('google.com'), 'parent mode: Google’s sign-in is open');

  // Kid mode: no header, so nothing of it works.
  await fromPage({ type: 'setMode', mode: 'kid' });
  assert.ok(!fake.rules[0].condition.excludedRequestDomains.includes('google.com'), 'kid mode: Google is blocked again');
  delete fake.store.localConfig;
  assert.equal((await send({ type: 'header' })).open, false);
  await withRepo([], async () => assert.equal((await send({ type: 'openApp', app: 'kidtube' })).ok, false));
  assert.equal((await send({ type: 'connectGitHub', repo: 'me/other', token: 'x' })).ok, false);
  assert.equal((await send({ type: 'exportSettings' })).ok, false);
  assert.equal((await send({ type: 'importSettings', file: { kidtubeSettings: 1, token: 'evil' } })).ok, false);
  assert.equal(fake.store.settings.token, 't1');
  await fromPage({ type: 'setMode', mode: 'parent' });

  // The GitHub connection: checked before it is kept; a refused token keeps the old one.
  assert.match((await send({ type: 'connectGitHub', repo: 'not a repo', token: 'x' })).error, /owner\/name/);
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).includes('api.github.com') ? { ok: false, status: 401, json: async () => ({}), headers: { get: () => null } } : real(url));
  try {
    assert.match((await send({ type: 'connectGitHub', repo: 'me/other', token: 'bad' })).error, /token is wrong/);
  } finally { globalThis.fetch = real; }
  assert.deepEqual([fake.store.settings.repo, fake.store.settings.token], ['me/data', 't1'], 'the old connection stays');
  await withRepo([{ app: 'kidtube', folder: 'zed', email: 'zed@example.com' }], async () => {
    const r = await send({ type: 'connectGitHub', repo: 'https://github.com/me/new.git', token: ' t2 ' });
    assert.deepEqual([r.ok, r.repo, r.profiles], [true, 'me/new', 1]);
  });
  assert.deepEqual([fake.store.settings.repo, fake.store.settings.token], ['me/new', 't2']);

  // The settings file: the connection, the PIN and the listening keys, and back.
  fake.store.geminiKey = 'AIza-1';
  const file = (await send({ type: 'exportSettings' })).file;
  assert.deepEqual([file.kidtubeSettings, file.repo, file.token, file.pinHash, file.geminiKey], [1, 'me/new', 't2', fake.store.settings.pinHash, 'AIza-1']);
  fake.store.settings = { ...fake.store.settings, token: '', repo: '' };
  assert.equal((await send({ type: 'importSettings', file: { hello: 1 } })).ok, false);
  assert.equal((await send({ type: 'importSettings', file })).ok, true);
  assert.deepEqual([fake.store.settings.repo, fake.store.settings.token], ['me/new', 't2']);

  // Add app for a new account: no starter list; the helper fills it.
  await youtubeHas('fresh@example.com', 'FRESH||');
  assert.deepEqual([fake.store.shell.on, fake.store.shell.locked], [true, false], 'parent mode: the header stays open');
  await withRepo([], async () => {
    const h = await send({ type: 'header' });
    assert.deepEqual([h.running, h.apps.filter((a) => a.has).length], [null, 0]);
    assert.equal((await send({ type: 'openApp', app: 'kidtube' })).ok, false, 'not there yet: Add app');
    assert.equal((await send({ type: 'openApp', app: 'kidtube', create: true })).url, 'ext://apps/kidtube/parent/parent.html');
  });
  assert.equal(fake.store.account.key, 'fresh@example.com');
  assert.deepEqual(fake.store.data.queue.videos, [], 'a new app has no list, not the built-in starter list');
  assert.equal((await send({ type: 'state' })).videos.length, 0);

  await fromPage({ type: 'leaveApp' });
  await youtubeHas(first, 'AAA||');
  await withRepo([], () => send({ type: 'openApp', app: 'kidtube' }));
  assert.equal(fake.store.account.key, first);
  assert.ok(fake.store.data.queue.videos.length > 0, 'the old account keeps its list');
  fake.store.settings = { ...fake.store.settings, token: before.token ?? '', repo: before.repo ?? '' };
  delete fake.store.geminiKey;
});

test('a note carries what the parent attached: the screen (cut to the schema sizes) and the app state; the activity schema accepts it', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { validateFile } = await import('../../tools/validate.mjs');
  assert.equal((await fromPage({ type: 'wish', list: 'today', text: 'This button is too small',
    screen: { where: 'the Today tab', path: 'parent/parent.html#today', text: 'x'.repeat(9000), viewport: '1024×768', userAgent: 'test', other: 'dropped' },
    withApp: true })).ok, true);
  const ev = fake.store.outbox.at(-1);
  assert.equal(ev.context.screen.text.length, 8000);
  assert.equal(ev.context.screen.other, undefined, 'only the schema’s fields');
  assert.equal(ev.context.app.version, '0.1.0');
  assert.equal(typeof ev.context.app.rules.quiz.items, 'number', 'quiz items only counted');
  assert.ok(ev.context.app.list.length > 0 && ev.context.app.list.every((v) => v.videoId && v.title));
  assert.deepEqual((await fromPage({ type: 'heldNotes' })).notes.find((n) => n.id === ev.eventId).attached, ['screen', 'app']);
  assert.equal((await fromPage({ type: 'note', videoId: ids[0], comment: 'Plain note' })).ok, true);
  assert.equal(fake.store.outbox.at(-1).context, undefined, 'nothing attached: no context');
  // The file the tablet writes passes the data repo's checks.
  const dir = mkdtempSync(join(tmpdir(), 'kt-ctx-'));
  mkdirSync(join(dir, 'activity'));
  const date = ev.at.slice(0, 10);
  const { held, ...sent } = ev;
  const file = join(dir, 'activity', `${date}.json`);
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, date, device: { deviceId: 'tab-test', extensionVersion: '0.1.0', quizTypes: ['text'], lastSyncAt: ev.at }, events: [sent] }));
  assert.deepEqual(validateFile(file).errors, []);
});
