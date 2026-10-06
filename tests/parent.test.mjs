// Parent mode, the parent's plan changes, and per-account data, against the real service worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeChrome } from './fake-chrome.mjs';
import { applyPlan, pendingPlan, applyPlanEvent } from '../extension/lib/plan.js';
import { accountFromSwitcher, accountKey } from '../extension/lib/account.js';

const fake = installFakeChrome();
await import('../extension/sw.js');

const starter = JSON.parse(readFileSync('extension/default-queue.json', 'utf8'));
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
const PAGE = { url: 'ext://parent/parent.html', tab: { id: 8, url: 'ext://parent/parent.html' } };
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
  assert.ok(fake.store.settings.parentUntil > Date.now());
  assert.equal(await navigate('https://m.youtube.com/'), 'ext://parent/parent.html');
  assert.equal(await navigate('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://m.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal((await send({ type: 'tick', videoId: 'dQw4w9WgXcQ', seconds: 10 })).action, 'none');
  assert.equal(fake.store.today?.playedSeconds ?? 0, 0);
  const st = await send({ type: 'state' });
  assert.equal(st.parentMode, true);
  assert.equal(st.parent, true);
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

test('each YouTube account has its own data; the PIN stays the same', async () => {
  fake.store.settings = { ...fake.store.settings, pinHash: 'H', pinSalt: 'S', repo: 'me/data', token: 't1' };
  await send({ type: 'account', loggedIn: true, datasyncId: 'AAA||', switcher: '' });          // first account: keeps what is here
  assert.equal(fake.store.account.key, 'yt:AAA');
  const switcher = `)]}'\n${JSON.stringify({ header: { email: { simpleText: 'other@example.com' } }, items: [{ accountItem: { accountName: { simpleText: 'Other' }, isSelected: true } }] })}`;
  const r = await send({ type: 'account', loggedIn: true, datasyncId: 'BBB||', switcher });
  assert.equal(r.switched, true);
  assert.equal(fake.store.account.key, 'other@example.com');
  assert.equal(fake.store.settings.token, undefined);              // fresh settings
  assert.equal(fake.store.settings.pinHash, 'H');                  // same PIN
  assert.equal(fake.store.planLog, undefined);
  assert.equal(fake.store['acct:yt:AAA'].settings.token, 't1');
  await send({ type: 'account', loggedIn: false });                // signed out: nothing changes
  assert.equal(fake.store.account.key, 'other@example.com');
  await send({ type: 'account', loggedIn: true, datasyncId: 'AAA||', switcher: '' });          // back again
  assert.equal(fake.store.settings.token, 't1');
  assert.ok(fake.store.planLog.events.length > 0);
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
