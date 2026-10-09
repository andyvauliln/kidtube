// Mouth shapes for recordings (lib/lips.js, agent/lib/lips.mjs) and the friend's voice chain on the tablet:
// the helper's recording, else one made here (Groq's Orpheus, then Gemini), never the device's own voice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vowelsOf, lipTrack, shapeAt } from '../extension/lib/lips.js';
import { makeLips } from '../agent/lib/lips.mjs';
import { validateDataDir } from '../tools/validate.mjs';

const shapes = (w) => vowelsOf(w).map((x) => (x.close ? '^' : '') + x.v).join('');

test('words become vowels: English spelling, Russian letters, lips that close first', () => {
  assert.equal(shapes('spider'), '^ie');
  assert.equal(shapes('make'), '^a', 'silent e');
  assert.equal(shapes('beautiful'), '^iia');
  assert.equal(shapes('happy'), 'a^i');
  assert.equal(shapes('you'), 'u');
  assert.equal(shapes('молодец'), '^ooe');
  assert.equal(shapes('10'), 'ee');
  assert.equal(shapes('—'), '');
});

test('a track shares each word’s time among its vowels and closes the mouth in pauses', () => {
  const t = lipTrack([{ word: 'Hi', start: 0.4, end: 0.6 }, { word: 'spider', start: 0.6, end: 1.0 }, { word: 'yes', start: 1.5, end: 1.7 }]);
  assert.deepEqual(t, [[0.4, 'i'], [0.6, 'n'], [0.66, 'i'], [0.8, 'e'], [1, 'n'], [1.5, 'e'], [1.7, 'n']]);
  assert.equal(shapeAt(t, 0.1).shape, 'n', 'before the first word');
  assert.equal(shapeAt(t, 0.85).shape, 'e');
  const { index } = shapeAt(t, 0.7);
  assert.equal(shapeAt(t, 1.6, index).shape, 'e', 'from the last place');
  assert.equal(shapeAt(t, 0.45, 5).shape, 'i', 'back to the start after a seek');
});

// Groq's Whisper on the server: words with times for each recording.
function whisper(calls, { status = 200 } = {}) {
  return async (url, init) => {
    calls.push({ url, model: init.body.get('model'), lang: init.body.get('language') });
    if (status !== 200) return new Response('limit', { status });
    return new Response(JSON.stringify({ words: [{ word: 'Hi', start: 0.1, end: 0.3 }, { word: 'there', start: 0.3, end: 0.6 }] }), { status: 200 });
  };
}

test('audio/lips.json: a track for each new recording, kept ones stay, gone ones are dropped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-lips-'));
  mkdirSync(join(dir, 'audio'));
  for (const n of ['a', 'b']) writeFileSync(join(dir, `audio/${n}.mp3`), 'mp3');
  writeFileSync(join(dir, 'audio/lips.json'), JSON.stringify({ lines: { 'a.mp3': [[0, 'a']], 'old.mp3': [[0, 'o']] } }));
  const calls = [];
  const r = await makeLips({ dataDir: dir, want: new Set(['audio/a.mp3', 'audio/b.mp3']), langs: new Map([['audio/b.mp3', 'ru']]), key: 'k', fetchImpl: whisper(calls) });
  assert.deepEqual({ made: r.made, kept: r.kept }, { made: 1, kept: 1 });
  assert.deepEqual(calls.map((c) => [c.model, c.lang]), [['whisper-large-v3-turbo', 'ru']]);
  const file = JSON.parse(readFileSync(join(dir, 'audio/lips.json'), 'utf8'));
  assert.deepEqual(Object.keys(file.lines), ['a.mp3', 'b.mp3']);
  assert.deepEqual(file.lines['b.mp3'], [[0.1, 'i'], [0.3, 'e'], [0.6, 'n']]);
  // A data dir with lips.json is still valid.
  cpSync('fixtures/good/data', join(dir, 'p'), { recursive: true });
  cpSync(join(dir, 'audio'), join(dir, 'p/audio'), { recursive: true });
  for (const res of validateDataDir(join(dir, 'p'))) assert.deepEqual(res.errors.filter((m) => !m.startsWith('warning:')), [], res.path);
});

test('Whisper’s limit stops new tracks for this run; no key makes none; no recordings removes the file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-lips-'));
  mkdirSync(join(dir, 'audio'));
  for (const n of ['a', 'b', 'c']) writeFileSync(join(dir, `audio/${n}.mp3`), 'mp3');
  const want = new Set(['audio/a.mp3', 'audio/b.mp3', 'audio/c.mp3']);
  const calls = [];
  const r = await makeLips({ dataDir: dir, want, key: 'k', fetchImpl: whisper(calls, { status: 429 }) });
  assert.equal(calls.length, 1);
  assert.deepEqual({ made: r.made, skipped: r.skipped, errors: r.errors.length }, { made: 0, skipped: 2, errors: 1 });
  assert.equal(existsSync(join(dir, 'audio/lips.json')), false);
  assert.equal((await makeLips({ dataDir: dir, want, key: '', fetchImpl: whisper(calls) })).skipped, 3);
  writeFileSync(join(dir, 'audio/lips.json'), '{"lines":{"a.mp3":[[0,"a"]]}}');
  await makeLips({ dataDir: dir, want: new Set(), key: 'k' });
  assert.equal(existsSync(join(dir, 'audio/lips.json')), false);
});

// --- the tablet's voice chain ---------------------------------------------------------------------
globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
const { makeLine, say, pcmToWav } = await import('../extension/ui/voice.js');

function services(answer) {
  const calls = [];
  const f = async (url, init) => {
    const via = url.includes('audio/speech') ? 'groq' : url.includes('transcriptions') ? 'whisper' : url.includes('generativelanguage') ? `gemini:${url.match(/models\/([^:]+)/)[1]}` : url;
    calls.push(via);
    const a = answer(via) ?? 200;
    if (a !== 200) return new Response('no', { status: a });
    if (via === 'groq') return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    if (via === 'whisper') return new Response(JSON.stringify({ words: [{ word: 'Wow', start: 0, end: 0.4 }] }), { status: 200 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: btoa('\0\0\0\0') } }] } }] }), { status: 200 });
  };
  return { calls, fetchImpl: f };
}

test('a line the helper did not record: Groq first, with its mouth shapes', async () => {
  const s = services(() => 200);
  const m = await makeLine('Wow, a spider!', 'en-US', { groq: 'g', gemini: 'k' }, s);
  assert.deepEqual(s.calls, ['groq', 'whisper']);
  assert.equal(m.blob.type, 'audio/wav');
  assert.deepEqual(m.lips, [[0, 'o'], [0.4, 'n']]);
  assert.equal(await makeLine('Wow, a spider!', 'en-US', { groq: 'g' }, s), m, 'asked for once');
  assert.equal(s.calls.length, 2);
});

test('Groq out of its limit, or a Russian line: the Gemini models in order', async () => {
  const s = services((via) => (via === 'groq' ? 429 : via === 'gemini:gemini-3.8-flash-tts' ? 500 : 200));
  const m = await makeLine('Hello there one', 'en-US', { groq: 'g', gemini: 'k' }, s);
  assert.deepEqual(s.calls, ['groq', 'gemini:gemini-3.8-flash-tts', 'gemini:gemini-3.8-flash-lite-tts', 'whisper']);
  assert.equal(m.blob.size, 44 + 4, 'Gemini’s PCM in a WAV');
  const ru = services(() => 200);
  await makeLine('Привет!', 'ru-RU', { groq: 'g', gemini: 'k' }, ru);
  assert.deepEqual(ru.calls, ['gemini:gemini-3.8-flash-tts', 'whisper'], 'Orpheus speaks English only');
});

test('no key, or every service failing: no recording, and the words show for their reading time', async () => {
  assert.equal(await makeLine('Nobody', 'en-US', {}, services(() => 200)), null);
  assert.equal(await makeLine('Broken', 'en-US', { groq: 'g', gemini: 'k' }, services(() => 500)), null);
  const seen = [];
  const t = Date.now();
  await say({ text: 'Hi' }, { lang: 'en-US' }, { keys: {}, onProgress: (f) => seen.push(f), onAudio: () => assert.fail('no sound') });
  assert.ok(Date.now() - t >= 1500 && seen[0] === 0 && seen.at(-1) < 1);
  assert.equal(pcmToWav(new Uint8Array(10)).size, 54);
});
