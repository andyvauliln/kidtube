import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyActivity, applyPromptNotes, composeToday, markToday, upcoming, freshCandidates } from '../agent/lib/plan.mjs';
import { buildQuiz, TEMPLATES } from '../agent/lib/quiz.mjs';
import { parseJson } from '../agent/lib/llm.mjs';
import { isCorrect } from '../extension/lib/mark.js';
import { waitingIds } from '../extension/lib/queue.js';

const vid = (n) => `video${String(n).padStart(6, '0')}`; // 11 chars
const V = (over) => ({ title: 't', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', durationSeconds: 300, lang: 'en', status: 'planned', approved: false, required: null, day: null, addedAt: '2026-10-01T00:00:00Z', ...over });

test('watch events mark videos watched; short peeks do not', () => {
  const videos = { [vid(1)]: V(), [vid(2)]: V() };
  const news = applyActivity(videos, [
    { type: 'watch', at: '2026-10-02T10:00:00Z', videoId: vid(1), watchedSeconds: 30, endReason: 'ended' },
    { type: 'watch', at: '2026-10-02T10:05:00Z', videoId: vid(2), watchedSeconds: 20, endReason: 'leftAfterLock' },
    { type: 'wish', at: '2026-10-02T11:00:00Z', text: 'friendship today' },
  ]);
  assert.equal(videos[vid(1)].status, 'watched');
  assert.equal(videos[vid(2)].status, 'planned');
  assert.deepEqual(news.wishes.map((w) => w.text), ['friendship today']);
});

test('plan changes from the tablet apply', () => {
  const videos = { [vid(1)]: V({ status: 'today', approved: true }), [vid(2)]: V({ status: 'idea' }), [vid(3)]: V() };
  const news = applyActivity(videos, [
    { type: 'plan', at: '2026-10-02T10:00:00Z', videoId: vid(1), action: 'drop' },
    { type: 'plan', at: '2026-10-02T10:00:01Z', videoId: vid(2), action: 'today' },
    { type: 'plan', at: '2026-10-02T10:00:02Z', videoId: vid(3), action: 'required', value: true },
    { type: 'wish', at: '2026-10-02T10:01:00Z', text: 'more numbers', list: 'planned' },
  ]);
  assert.equal(videos[vid(1)].status, 'no');
  assert.equal(videos[vid(2)].approved, true);
  assert.equal(videos[vid(3)].required, 'yes');
  assert.equal(news.plan.length, 3);
  assert.equal(news.wishes[0].aboutList, 'planned');
});

test('prompt notes from the tablet: added and removed, kept across runs', () => {
  const news = applyActivity({}, [
    { type: 'prompt', at: '2026-10-02T10:00:00Z', action: 'add', noteId: 'n-aaaaaaaa1', text: 'Animals every day' },
    { type: 'prompt', at: '2026-10-02T10:01:00Z', action: 'add', noteId: 'n-aaaaaaaa2', text: 'English questions' },
    { type: 'prompt', at: '2026-10-02T10:02:00Z', action: 'remove', noteId: 'n-aaaaaaaa0' },
  ]);
  const notes = applyPromptNotes([{ id: 'n-aaaaaaaa0', at: '2026-10-01T00:00:00Z', text: 'old' }], news.prompt);
  assert.deepEqual(notes.map((n) => n.text), ['Animals every day', 'English questions']);
});

test('helper.json describes the real prompt, toolkit and config', async () => {
  const { helperInfo } = await import('../agent/lib/info.mjs');
  const info = helperInfo('.', JSON.parse(readFileSync('agent/config.json', 'utf8')));
  assert.ok(info.prompt.includes('## Steps'));
  assert.ok(info.commands.some((c) => c.command === 'start'));
  assert.equal(info.run.schedule, '30 3 * * *');
  assert.ok(!JSON.stringify(info).match(/sk-or-|AIza|ntn_|secret_/));   // no keys
  const { promptSteps } = await import('../extension/parent/markdown.js');
  const { steps, after } = promptSteps(info.prompt);
  assert.equal(steps[0].title, 'Start');
  assert.ok(steps.length >= 9);
  assert.ok(steps.find((x) => x.title === 'Save').body.includes('kt.mjs save'));
  assert.ok(after.startsWith('If a step fails'));
});

test('today: must-watch-today first, approved before the helper’s own picks', () => {
  const videos = {
    [vid(1)]: V({ approved: false, status: 'idea' }),
    [vid(2)]: V({ approved: true }),
    [vid(3)]: V({ required: 'today', day: '2026-10-02', status: 'idea' }),
    [vid(4)]: V({ approved: true, day: '2026-10-05' }),     // later day: not today
    [vid(5)]: V({ status: 'watched', approved: true }),
    [vid(6)]: V({ status: 'no', approved: true }),
  };
  assert.deepEqual(composeToday(videos, { today: '2026-10-02', count: 3 }), [vid(3), vid(2), vid(1)]);
  assert.deepEqual(composeToday(videos, { today: '2026-10-02', count: 1 }), [vid(3)]);
});

test('today: at least N videos in a language when there are some', () => {
  const videos = {
    [vid(1)]: V({ approved: true }), [vid(2)]: V({ approved: true }), [vid(3)]: V({ approved: true }),
    [vid(4)]: V({ lang: 'ru', status: 'idea' }), [vid(5)]: V({ lang: 'ru', status: 'idea' }),
  };
  const ids = composeToday(videos, { today: '2026-10-02', count: 3, languageMins: { ru: 2 } });
  assert.equal(ids.length, 3);
  assert.equal(ids.filter((id) => videos[id].lang === 'ru').length, 2);
});

test('yesterday’s unwatched list goes back to planned; upcoming skips today', () => {
  const videos = { [vid(1)]: V({ status: 'today', approved: true }), [vid(2)]: V({ status: 'today' }), [vid(3)]: V() };
  markToday(videos, [vid(3)]);
  assert.deepEqual([videos[vid(1)].status, videos[vid(2)].status, videos[vid(3)].status], ['planned', 'idea', 'today']);
  assert.deepEqual(upcoming(videos, [vid(3)], { today: '2026-10-02' }).map((u) => u.videoId).sort(), [vid(1), vid(2)]);
});

test('search results: only unknown videos of the right length', () => {
  const known = { [vid(1)]: V() };
  const r = (n, s, extra) => ({ videoId: vid(n), channelId: 'UCbbbbbbbbbbbbbbbbbbbbbb', durationSeconds: s, ...extra });
  const out = freshCandidates([r(1, 300), r(2, 300), r(2, 300), r(3, 30), r(4, 5000), r(5, 300, { isLive: true })], known, { maxSeconds: 1200 });
  assert.deepEqual(out.map((x) => x.videoId), [vid(2)]);
});

test('math templates always have the right answer, in Russian too', () => {
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 200; i++) {
    const { item } = TEMPLATES.add.make({ max: 10 }, 'ru', rng);
    const [, a, b] = item.prompt.match(/(\d+) плюс (\d+)/).map(Number);
    assert.ok(a + b <= 10);
    assert.ok(isCorrect(item, [`это ${a + b}`], { spoken: true }));
    const sub = TEMPLATES.subtract.make({ max: 10 }, null, rng).item;
    const [, x, y] = sub.prompt.match(/(\d+) minus (\d+)/).map(Number);
    assert.ok(x - y >= 1 && isCorrect(sub, String(x - y)));
  }
});

test('quiz from the model: bad items are dropped, ids are valid quiz ids', () => {
  const { items, ids } = buildQuiz('Ab_cD-12345', [
    { template: 'video-voice', prompt: 'How many legs does a spider have?', accept: ['eight'] },
    { template: 'video-choice', prompt: 'Bees make?', options: ['honey', 'milk'], correct: 'bread' },
    { template: 'nope' },
    { template: 'add', params: { max: 5 }, count: 5 },
  ], null, { max: 3 });
  assert.equal(ids.length, 3);
  for (const id of ids) assert.match(id, /^[a-z0-9][a-z0-9-]{0,63}$/);
  assert.ok(items[ids[0]].answer.accept.includes('8'));
});

test('JSON from chatty models', () => {
  assert.deepEqual(parseJson('<think>hmm {no}</think>Sure!\n```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('Here: {"b": [1, 2]} hope it helps'), { b: [1, 2] });
  assert.equal(parseJson('no json here'), null);
});

test('tablet: must-watch first / mix / off', () => {
  const list = [{ videoId: 'a', required: true }, { videoId: 'b' }, { videoId: 'c' }];
  assert.deepEqual([...waitingIds(list, { requiredFirst: 'first' })], ['b', 'c']);
  assert.deepEqual([...waitingIds(list, { requiredFirst: 'off' })], []);
  assert.deepEqual([...waitingIds(list, { requiredFirst: 'mix' }, { required: 0, free: 0 })], ['b', 'c']);
  assert.deepEqual([...waitingIds(list, { requiredFirst: 'mix' }, { required: 1, free: 0 })], []);
  assert.deepEqual([...waitingIds(list, { requiredFirst: 'mix' }, { required: 1, free: 1 })], ['b', 'c']);
  assert.deepEqual([...waitingIds([{ videoId: 'b' }], { requiredFirst: 'first' })], []);
});

test('questions too hard for a 4-year-old are sent back', async () => {
  const { tooHard } = await import('../agent/lib/prompts.mjs');
  assert.equal(tooHard([{ accept: ['sugar'] }, { accept: ['one', '1'] }]), null);
  assert.equal(tooHard([{ accept: ['2.4 million'] }]), '2.4 million');
  assert.equal(tooHard([{ accept: ['hemoglobin in the blood'] }]), 'hemoglobin in the blood');
  assert.equal(tooHard([{ options: ['5', '50'] }]), '50');
});

test('a recording’s file name changes with the text and the voice settings', async () => {
  const { audioPath } = await import('../agent/lib/voices.mjs');
  const cfg = { provider: 'gemini', voice: 'Puck', pitch: 1.15 };
  assert.match(audioPath('Hi!', 'en', cfg), /^audio\/[0-9a-f]{16}\.mp3$/);
  assert.equal(audioPath('Hi!', 'en', cfg), audioPath('Hi!', 'en', { ...cfg }));
  assert.notEqual(audioPath('Hi!', 'en', cfg), audioPath('Hi!', 'en', { ...cfg, pitch: 1.3 }));
});
