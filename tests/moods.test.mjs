// The friend's moods: [mood] tags written by the helper → { at, mood } in queue.json → the avatar's face.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseMoods, moodLine, MOODS } from '../agent/lib/moods.mjs';
import { contentPrompt } from '../agent/lib/prompts.mjs';
import { validateFile } from '../tools/validate.mjs';
import { MOODS as AVATAR_MOODS } from '../extension/ui/mesh.js';

test('tags come out of the text; each mood keeps where its sentence starts', () => {
  const r = parseMoods('[surprised] Wow, a spider! [curious]  How many legs?');
  assert.equal(r.text, 'Wow, a spider! How many legs?');
  assert.deepEqual(r.moods, [{ at: 0, mood: 'surprised' }, { at: 15, mood: 'curious' }]);
  assert.equal(r.text.slice(r.moods[1].at), 'How many legs?');
  assert.deepEqual(parseMoods('[Happy] Hi [sad]').moods, [{ at: 0, mood: 'happy' }, { at: 2, mood: 'sad' }], 'any case; one at the end');
  assert.deepEqual(parseMoods('[excited][happy] Go').moods, [{ at: 0, mood: 'happy' }], 'two in a row: the last one');
  assert.deepEqual(parseMoods('Hi [angry] there').unknown, ['angry']);
  assert.equal(parseMoods('Hi [angry] there').text, 'Hi there');
  assert.deepEqual(parseMoods('Привет! [curious] Смотри!'), { text: 'Привет! Смотри!', moods: [{ at: 8, mood: 'curious' }], unknown: [] });
  assert.deepEqual(parseMoods('no tags'), { text: 'no tags', moods: [], unknown: [] });
  assert.deepEqual(moodLine('x', []), { text: 'x' });
});

test('every mood the helper may write moves the avatar', () => {
  assert.deepEqual(Object.keys(AVATAR_MOODS).sort(), [...MOODS].sort());
  const schema = JSON.parse(readFileSync('schemas/queue.schema.json', 'utf8'));
  assert.ok(JSON.stringify(schema).includes(JSON.stringify(MOODS)), 'the queue schema allows the same moods');
});

test('the model is asked for tags, and they do not count toward the length', () => {
  const p = contentPrompt({ video: { title: 't', channelTitle: 'c', durationSeconds: 60 }, transcript: null, friend: { name: 'Zippy' }, about: '', want: {}, templates: [], quizOn: false, maxQuestions: 2 });
  assert.match(p.user, /\[surprised\]/);
  const long = `[happy] ${'a'.repeat(440)}`;
  assert.equal(p.check({ intro: long, outro: '[calm] Bye.', summary: 's', quiz: [] }), null);
});

test('kt.mjs words: tags become introMoods/outroMoods; an unknown tag is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-moods-'));
  cpSync('fixtures/good/data', join(dir, 'data/kidtube/x'), { recursive: true });
  const v = JSON.parse(readFileSync('fixtures/good/data/queue.json', 'utf8')).videos[0];
  mkdirSync(join(dir, 'state/kidtube/x'), { recursive: true });
  const session = join(dir, 'state/kidtube/x/session.json');
  writeFileSync(session, JSON.stringify({ videos: { [v.videoId]: { title: v.title, lang: 'en', channelId: v.channelId, durationSeconds: 300 } }, quizTypes: ['voice', 'choice'], rewritten: [], touched: [] }));
  const env = { ...process.env, KIDTUBE_DATA_DIR: join(dir, 'data'), KIDTUBE_STATE_DIR: join(dir, 'state'), KIDTUBE_PROFILE: 'kidtube/x' };
  const words = (intro, outro) => {
    try { return JSON.parse(execFileSync(process.execPath, ['agent/kt.mjs', 'words', v.videoId, JSON.stringify({ summary: 's', learned: ['a'], intro, outro, talkAbout: [], quiz: [] })], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
    catch (e) { return JSON.parse(e.stdout); }
  };
  const bad = words('[surprised] Wow!', '[grumpy] Bye.');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /unknown mood tags \[grumpy\]/);
  assert.equal(words('[surprised] Wow, a spider! [curious] How many legs?', '[happy] Great job.').ok, true);
  const c = JSON.parse(readFileSync(session, 'utf8')).videos[v.videoId].content;
  assert.equal(c.intro, 'Wow, a spider! How many legs?');
  assert.deepEqual(c.introMoods, [{ at: 0, mood: 'surprised' }, { at: 15, mood: 'curious' }]);
  assert.deepEqual(c.outroMoods, [{ at: 0, mood: 'happy' }]);
});

test('queue.json with moods is valid; an unknown mood is not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-moods-q-'));
  const q = JSON.parse(readFileSync('fixtures/good/data/queue.json', 'utf8'));
  q.videos[0].intro = moodLine('Wow! Look.', [{ at: 0, mood: 'surprised' }, { at: 5, mood: 'curious' }]);
  writeFileSync(join(dir, 'queue.json'), JSON.stringify(q));
  assert.deepEqual(validateFile(join(dir, 'queue.json')).errors, []);
  q.videos[0].intro.moods[0].mood = 'grumpy';
  writeFileSync(join(dir, 'queue.json'), JSON.stringify(q));
  assert.ok(validateFile(join(dir, 'queue.json')).errors.length);
});
