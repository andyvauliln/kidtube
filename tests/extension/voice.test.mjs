// Listening: the recording goes to the free Gemini models first, then the paid OpenRouter ones.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let store, calls, answer;
globalThis.chrome = { storage: { local: {
  get: async (keys) => Object.fromEntries([keys].flat().filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
  set: async (o) => { Object.assign(store, structuredClone(o)); },
} } };
// answer(route, body) → { status, text, headers, delay } ; delay: 'hang' never answers (until aborted).
globalThis.fetch = async (url, init) => {
  const body = init.body instanceof FormData ? Object.fromEntries(init.body) : JSON.parse(init.body);
  const route = url.includes('api.groq.com') ? `groq:${body.model}` : url.includes('generativelanguage') ? `gemini:${decodeURIComponent(url.match(/models\/([^:]+):/)[1])}` : `openrouter:${body.model}`;
  const call = { route, body, headers: init.headers, aborted: false };
  calls.push(call);
  const a = answer(route, body) ?? { status: 500 };
  await new Promise((resolve, reject) => {
    const fail = () => { call.aborted = true; reject(new DOMException('aborted', 'AbortError')); };
    if (init.signal?.aborted) return fail();
    init.signal?.addEventListener('abort', fail);
    if (a.delay !== 'hang') setTimeout(resolve, a.delay ?? 0);
  });
  if (a.status !== 200) return new Response('{}', { status: a.status, headers: a.headers ?? {} });
  const json = route.startsWith('groq') ? { text: a.text } : route.includes('transcribe') ? { candidates: [{ content: { parts: [{ audioTranscription: { text: a.text } }] } }] }
    : route.startsWith('gemini') ? { candidates: [{ content: { parts: [{ text: a.text }] } }] } : { choices: [{ message: { content: a.text } }] };
  return new Response(JSON.stringify(json), { status: 200 });
};
const { transcribeAnswer, listenRoutes, FREE_LISTEN_MODELS, PAID_LISTEN_MODELS, NOTE_LISTEN_MODELS, GROQ_LISTEN_MODELS } = await import('../../extension/apps/kidtube/lib/voice.js');

const audio = new Uint8Array(44 + 32000);   // one second of 16 kHz WAV
const keys = { gemini: 'AIza-test', openrouter: 'sk-or-test' };
const [FREE1, FREE2] = FREE_LISTEN_MODELS.map((m) => `gemini:${m}`);
const [PAID1, PAID2] = PAID_LISTEN_MODELS.map((m) => `openrouter:${m}`);
const fast = { staggerMs: 40 };
beforeEach(() => { store = {}; calls = []; answer = () => ({ status: 200, text: 'eighteen' }); });

test('the first free Gemini model answers; nothing paid is called', async () => {
  let used;
  assert.deepEqual(await transcribeAnswer(audio, { keys, onUsed: (u) => { used = u; } }), ['eighteen']);
  assert.deepEqual(calls.map((c) => c.route), [FREE1]);
  assert.equal(calls[0].headers['x-goog-api-key'], 'AIza-test');
  assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(used.free, true);
});

test('the prompt asks for his words only; the quiz question is never in it', async () => {
  await transcribeAnswer(audio, { keys, lang: 'ru-RU', question: 'What is 2 + 2?' });
  const text = JSON.stringify(calls[0].body);
  assert.match(text, /Never answer/);
  assert.match(text, /ru-RU/);
  assert.doesNotMatch(text, /2 \+ 2/);
});

test('a rate limit moves on to the next free model at once, and that model rests', async () => {
  answer = (route) => (route === FREE1 ? { status: 429, headers: { 'retry-after': '90' } } : { status: 200, text: '20' });
  assert.deepEqual(await transcribeAnswer(audio, { keys }), ['20']);
  assert.deepEqual(calls.map((c) => c.route), [FREE1, FREE2]);
  await new Promise((r) => setTimeout(r, 10));
  const until = store.listenCooldown[FREE1];
  assert.ok(until > Date.now() + 80000 && until < Date.now() + 100000);
  calls = [];
  await transcribeAnswer(audio, { keys });                 // the next answer skips the resting model
  assert.deepEqual(calls.map((c) => c.route), [FREE2]);
});

test('a model that hangs: the next one starts after the stagger, wins, and the slow one is stopped and rests', async () => {
  answer = (route) => (route === FREE1 ? { delay: 'hang' } : { status: 200, text: 'seven' });
  const t = Date.now();
  assert.deepEqual(await transcribeAnswer(audio, { keys, ...fast }), ['seven']);
  assert.ok(Date.now() - t < 1000);
  assert.deepEqual(calls.map((c) => c.route), [FREE1, FREE2]);
  assert.equal(calls[0].aborted, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(store.listenCooldown[FREE1] > Date.now());
});

test('a slow first model that still answers first wins; the later one is stopped without resting', async () => {
  answer = (route) => (route === FREE1 ? { status: 200, text: 'one', delay: 200 } : { status: 200, text: 'two', delay: 600 });
  assert.deepEqual(await transcribeAnswer(audio, { keys, ...fast }), ['one']);
  assert.equal(calls[1].aborted, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(store.listenCooldown?.[FREE2], undefined);
});

test('when every free model fails, the paid OpenRouter ones answer, in order', async () => {
  let used;
  answer = (route) => (route.startsWith('gemini') ? { status: 429 } : route === PAID1 ? { status: 502 } : { status: 200, text: 'cat' });
  assert.deepEqual(await transcribeAnswer(audio, { keys, onUsed: (u) => { used = u; } }), ['cat']);
  assert.deepEqual(calls.map((c) => c.route), [FREE1, FREE2, PAID1, PAID2]);
  assert.equal(used.model, PAID_LISTEN_MODELS[1]);
  assert.equal(used.free, false);
  assert.equal(calls.at(-1).headers.Authorization, 'Bearer sk-or-test');
  assert.equal(calls.at(-1).body.messages[0].role, 'system');
});

test('"(none)" means nothing was said; "I can’t hear the audio" asks the next model', async () => {
  answer = () => ({ status: 200, text: '(none)' });
  assert.deepEqual(await transcribeAnswer(audio, { keys }), []);
  calls = [];
  answer = (route) => (route === FREE1 ? { status: 200, text: 'I’m sorry, but I can’t hear the audio. Could you provide more details?' } : { status: 200, text: 'blue' });
  assert.deepEqual(await transcribeAnswer(audio, { keys }), ['blue']);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(store.listenCooldown?.[FREE1], undefined);   // a refusal is not a reason to rest
});

test('a model that refuses "minimal" thinking is asked again without it', async () => {
  answer = (route, body) => (body.generationConfig?.thinkingConfig ? { status: 400 } : { status: 200, text: 'dog' });
  assert.deepEqual(await transcribeAnswer(audio, { keys: { gemini: 'k' }, freeModels: ['gemini-3.8-flash'] }), ['dog']);
  assert.equal(calls.length, 2);
});

test('when all are resting they are still tried rather than giving up', async () => {
  store.listenCooldown = Object.fromEntries(listenRoutes({ keys }).map((r) => [`${r.via}:${r.model}`, Date.now() + 60000]));
  assert.deepEqual(await transcribeAnswer(audio, { keys }), ['eighteen']);
});

test('only the routes with a key; the keys come from this tablet’s storage', async () => {
  assert.deepEqual(listenRoutes({ keys: { openrouter: 'x' } }).map((r) => r.via), PAID_LISTEN_MODELS.map(() => 'openrouter'));
  assert.equal(await transcribeAnswer(audio, { keys: {} }), null);            // no key: the device listens
  store = { geminiKey: 'AIza-stored' };
  assert.deepEqual(await transcribeAnswer(audio), ['eighteen']);
  assert.equal(calls[0].headers['x-goog-api-key'], 'AIza-stored');
});

test('silence is [] without a call; everything failing is null (the device listens)', async () => {
  assert.deepEqual(await transcribeAnswer(new Uint8Array(0), { keys }), []);
  assert.equal(calls.length, 0);
  answer = () => ({ status: 503 });
  assert.equal(await transcribeAnswer(audio, { keys, ...fast }), null);
  assert.equal(calls.length, 4);
});

test('notes: gemini-3.5-transcribe first, with only the audio; its words come as audioTranscription', async () => {
  answer = () => ({ status: 200, text: 'Добавь видео про dinosaurs.' });
  let used;
  assert.deepEqual(await transcribeAnswer(audio, { keys, freeModels: NOTE_LISTEN_MODELS, maxTokens: 6000, onUsed: (u) => { used = u; } }), ['Добавь видео про dinosaurs.']);
  assert.equal(used.model, 'gemini-3.5-transcribe');
  assert.equal(calls[0].route, 'gemini:gemini-3.5-transcribe');
  assert.equal(calls[0].body.system_instruction, undefined);                 // the model refuses one
  assert.deepEqual(calls[0].body.contents[0].parts.map((p) => Object.keys(p)), [['inline_data']]);
});

test('notes: transcribe over its limit (3 a minute) → the next free model, and it rests', async () => {
  answer = (route) => (route.includes('transcribe') ? { status: 429, headers: { 'retry-after': '40' } } : { status: 200, text: 'a note' });
  assert.deepEqual(await transcribeAnswer(audio, { keys, freeModels: NOTE_LISTEN_MODELS }), ['a note']);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(store.listenCooldown['gemini:gemini-3.5-transcribe'] > Date.now() + 30000);
  assert.ok(!FREE_LISTEN_MODELS.includes('gemini-3.5-transcribe'));          // the quiz answers don't use it
});

test('onFail says why each model failed', async () => {
  answer = (route) => (route === FREE1 ? { status: 429 } : route === FREE2 ? { status: 503 } : { status: 401 });
  const why = [];
  assert.equal(await transcribeAnswer(audio, { keys, ...fast, onFail: (r, w) => why.push(`${r.model}:${w}`) }), null);
  assert.deepEqual(why.sort(), [...FREE_LISTEN_MODELS.map((m, i) => `${m}:${[429, 503][i]}`), ...PAID_LISTEN_MODELS.map((m) => `${m}:401`)].sort());
});

test('Groq’s Whisper goes first: the WAV as a file, no language set (a note may mix two)', async () => {
  answer = () => ({ status: 200, text: ' Добавь видео про dinosaurs. ' });
  let used;
  assert.deepEqual(await transcribeAnswer(audio, { keys: { ...keys, groq: 'gsk_test' }, onUsed: (u) => { used = u; } }), ['Добавь видео про dinosaurs.']);
  assert.equal(used.model, GROQ_LISTEN_MODELS[0]);
  assert.equal(calls[0].route, `groq:${GROQ_LISTEN_MODELS[0]}`);
  assert.equal(calls[0].headers.Authorization, 'Bearer gsk_test');
  assert.ok(calls[0].body.file instanceof Blob);
  assert.equal(calls[0].body.language, undefined);
  assert.deepEqual(listenRoutes({ keys: { ...keys, groq: 'g' } }).map((r) => r.via), ['groq', 'groq', 'gemini', 'gemini', 'openrouter', 'openrouter']);
});

test('Whisper’s silence (“.”, “Thank you.”, “Продолжение следует…”) is nothing heard; a note saying “can’t hear” is kept', async () => {
  for (const said of [' .', 'Thank you.', 'Продолжение следует...']) {
    answer = () => ({ status: 200, text: said });
    assert.deepEqual(await transcribeAnswer(audio, { keys: { groq: 'g' } }), [], said);
  }
  answer = () => ({ status: 200, text: 'He can’t hear the video, make it louder.' });
  assert.deepEqual(await transcribeAnswer(audio, { keys: { groq: 'g' } }), ['He can’t hear the video, make it louder.']);
});

test('the limits are per Groq model: one over its limit → the other Groq model, then Gemini', async () => {
  answer = (route) => (route === `groq:${GROQ_LISTEN_MODELS[0]}` ? { status: 429, headers: { 'retry-after': '30' } } : { status: 200, text: 'more numbers' });
  let used;
  assert.deepEqual(await transcribeAnswer(audio, { keys: { ...keys, groq: 'g' }, onUsed: (u) => { used = u; } }), ['more numbers']);
  assert.equal(used.model, GROQ_LISTEN_MODELS[1]);
});
