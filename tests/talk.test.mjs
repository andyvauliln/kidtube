// The talking friend before and after a video, the questions, and the parent's own viewing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeChrome } from './fake-chrome.mjs';

const fake = installFakeChrome();
await import('../extension/sw.js');

const queue = JSON.parse(readFileSync('extension/default-queue.json', 'utf8'));
const [A, B, C] = queue.videos.map((v) => v.videoId);
const TAB = 7;
const send = (msg, url = 'https://m.youtube.com/') => new Promise((resolve) => fake.listeners.message[0](msg, { tab: { id: TAB, url } }, resolve));
const sendFrom = (tabId, msg) => new Promise((resolve) => fake.listeners.message[0](msg, { tab: { id: tabId, url: 'https://m.youtube.com/' } }, resolve));
async function navigate(url, tabId = TAB) {
  fake.nav.updates.length = 0;
  fake.listeners.tabUpdated[0](tabId, { url });
  await new Promise((r) => setTimeout(r, 20));
  return fake.nav.updates.at(-1) ?? url;
}
const allDay = { allowed: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '00:00', to: '23:59' }], maxMinutesPerDay: 0 };
const item = { type: 'voice', prompt: 'How many legs does a spider have?', answer: { kind: 'text', accept: ['eight'] } };
function setConfig(extra) {
  fake.store.data = { config: { schemaVersion: 1, updatedAt: '2026-10-01T00:00:00Z', time: allDay, minSecondsBeforeLeave: 0, ...extra } };
}

test('intro on: tapping a video opens the talking friend first, then the video', async () => {
  setConfig({ presenter: { intro: true } });
  await send({ type: 'open', videoId: A });
  assert.equal(fake.nav.updates.at(-1), `ext://ui/talk.html?mode=intro&v=${A}`);
  const t = await send({ type: 'talk', videoId: A, mode: 'intro' });
  assert.match(t.lines[0].text, /going to watch/);
  assert.equal(t.voice.pitch, 1.9);
  await send({ type: 'talkDone', videoId: A });
  assert.equal(fake.nav.updates.at(-1), `https://m.youtube.com/watch?v=${A}`);
  assert.equal(await navigate(`https://m.youtube.com/watch?v=${A}`), `https://m.youtube.com/watch?v=${A}`);
});

test('the agent’s own intro and outro words are used', async () => {
  const q = structuredClone(queue);
  q.videos[1].intro = { text: 'Spiders are amazing!' };
  q.videos[1].outro = { text: 'Today we learned spiders have eight legs.' };
  setConfig({ presenter: { intro: true, outro: true } });
  fake.store.data.queue = q;
  assert.equal((await send({ type: 'talk', videoId: B, mode: 'intro' })).lines[0].text, 'Spiders are amazing!');
  assert.equal((await send({ type: 'talk', videoId: B, mode: 'outro' })).lines[0].text, 'Today we learned spiders have eight legs.');
});

test('outro and questions after the video; a wrong answer with onFail=continue goes home', async () => {
  setConfig({ presenter: { outro: true }, quiz: { enabled: true, defaultIds: ['legs'], items: { legs: item }, onFail: 'continue' } });
  await navigate(`https://m.youtube.com/watch?v=${B}`);
  await send({ type: 'ended', videoId: B });
  assert.equal(fake.nav.updates.at(-1), `ext://ui/talk.html?mode=outro&v=${B}`);
  const t = await send({ type: 'talk', videoId: B, mode: 'outro' });
  assert.equal(t.items.length, 1);
  assert.equal(t.items[0].supported, true, 'voice questions are in this build');
  const r = await send({ type: 'quizResults', videoId: B, results: [{ quizId: 'legs', result: 'failed', attempts: 3, answers: ['six', 'ten', 'two'], answeredBy: 'spoken' }] });
  assert.equal(r.next, 'home');
  await send({ type: 'talkDone', videoId: B });
  assert.equal(fake.nav.updates.at(-1), 'https://m.youtube.com/');
  const ev = fake.store.outbox.filter((e) => e.type === 'quiz').at(-1);
  assert.deepEqual([ev.quizId, ev.result, ev.attempts, ev.answeredBy], ['legs', 'failed', 3, 'spoken']);
});

test('onFail=rewatch: he watches the same video once more, only once a day', async () => {
  setConfig({ quiz: { enabled: true, defaultIds: ['legs'], items: { legs: item }, onFail: 'rewatch' } });
  for (const expected of [`https://m.youtube.com/watch?v=${C}`, 'https://m.youtube.com/']) {
    await navigate(`https://m.youtube.com/watch?v=${C}`);
    await send({ type: 'ended', videoId: C });
    await send({ type: 'quizResults', videoId: C, results: [{ quizId: 'legs', result: 'failed', attempts: 3 }] });
    await send({ type: 'talkDone', videoId: C });
    assert.equal(fake.nav.updates.at(-1), expected);
  }
});

test('onFail=stopForToday locks until a parent resets today', async () => {
  setConfig({ quiz: { enabled: true, defaultIds: ['legs'], items: { legs: item }, onFail: 'stopForToday' } });
  const D = (await send({ type: 'state' })).videos[0].videoId;
  await navigate(`https://m.youtube.com/watch?v=${D}`);
  await send({ type: 'ended', videoId: D });
  assert.equal((await send({ type: 'quizResults', videoId: D, results: [{ quizId: 'legs', result: 'failed', attempts: 3 }] })).next, 'stopForToday');
  await send({ type: 'talkDone', videoId: D });
  assert.equal((await send({ type: 'state' })).lock.reason, 'stopped');
  assert.equal((await send({ type: 'open', videoId: (await send({ type: 'state' })).videos[0]?.videoId })).ok, false);
  await send({ type: 'resetToday' });
  assert.equal((await send({ type: 'state' })).lock, null);
});

test('a passed quiz never triggers onFail', async () => {
  setConfig({ quiz: { enabled: true, defaultIds: ['legs'], items: { legs: item }, onFail: 'stopForToday' } });
  const E = (await send({ type: 'state' })).videos[0].videoId;
  await navigate(`https://m.youtube.com/watch?v=${E}`);
  await send({ type: 'ended', videoId: E });
  assert.equal((await send({ type: 'quizResults', videoId: E, results: [{ quizId: 'legs', result: 'passed', attempts: 1 }] })).next, 'home');
});

test('with intro, outro and quiz off, the video end goes straight home', async () => {
  setConfig({});
  const F = (await send({ type: 'state' })).videos[0].videoId;
  await navigate(`https://m.youtube.com/watch?v=${F}`);
  await send({ type: 'ended', videoId: F });
  assert.equal(fake.nav.updates.at(-1), 'https://m.youtube.com/');
});

test('the parent list shows picture, title and channel of watched videos', async () => {
  const st = await send({ type: 'status' });
  const b = st.recent.find((r) => r.videoId === B);
  assert.ok(b.title.length > 3 && b.channelTitle && b.thumbnailUrl.startsWith('https://i.ytimg.com/'));
});

test('parent watch: any video in its own tab, skipping allowed, no counting, ends when the tab leaves it', async () => {
  setConfig({ time: { ...allDay, maxMinutesPerDay: 30 } });
  fake.store.today = null;
  assert.equal((await send({ type: 'parentWatch', videoId: 'dQw4w9WgXcQ' })).ok, true);
  assert.equal(fake.nav.created.at(-1), 'https://m.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(await navigate('https://m.youtube.com/watch?v=dQw4w9WgXcQ', 99), 'https://m.youtube.com/watch?v=dQw4w9WgXcQ');
  const st = await sendFrom(99, { type: 'state' });
  assert.equal(st.parent, true);
  assert.equal(st.rules.allowSkip, true);
  assert.equal((await send({ type: 'state' })).parent, false, 'other tabs keep the kid rules');
  await sendFrom(99, { type: 'tick', videoId: 'dQw4w9WgXcQ', seconds: 15 });
  assert.equal(fake.store.today.playedSeconds, 0, "the parent's watching doesn't count");
  assert.equal(await navigate('https://m.youtube.com/watch?v=aaaaaaaaaaa', 99), 'https://m.youtube.com/', 'leaving the video ends the pass');
  assert.equal(fake.store.parentPass, null);
});

test('the gear opens the parent settings page', async () => {
  await send({ type: 'openSettings' });
  assert.equal(fake.nav.created.at(-1), 'ext://options/options.html');
});
