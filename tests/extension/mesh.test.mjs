// The mesh avatar friend (ui/mesh.js): the bundled avatar is complete, and the friend's calls reach the engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const AVATAR = 'extension/apps/kidtube/avatars/miko-qipao';

test('the bundled avatar has every file the engine loads', () => {
  const rig = JSON.parse(readFileSync(`${AVATAR}/rig.json`, 'utf8'));
  const meta = JSON.parse(readFileSync(`${AVATAR}/built/layers.json`, 'utf8'));
  const names = ['base', 'hairmask', ...Object.keys(meta.layers)];
  if (rig.hand) assert.ok(names.includes('hand'));
  for (const n of names) assert.ok(existsSync(`${AVATAR}/built/${n}.png`), `${n}.png`);
  const sheet = JSON.parse(readFileSync(`${AVATAR}/built/sprites/sprites.json`, 'utf8'));
  for (const n of Object.keys(sheet.layers)) assert.ok(existsSync(`${AVATAR}/built/sprites/${n}.png`), `sprites/${n}.png`);
});

test('the engine bundle is one module with no eval (the extension CSP forbids it)', () => {
  const js = readFileSync('extension/apps/kidtube/vendor/mesh-avatar/mesh-avatar.js', 'utf8');
  assert.match(js, /export \{[^}]*createMeshAvatar/);
  assert.doesNotMatch(js, /\beval\(|new Function\(/);
  assert.ok(existsSync('extension/apps/kidtube/vendor/mesh-avatar/LICENSE'));
});

// --- a page with just enough DOM for mesh.js -----------------------------------------------------
let frames = [];
const appended = [];
globalThis.document = { createElement: () => ({ getContext: (k) => (k === 'webgl2' ? {} : null) }) };
globalThis.location = { href: 'chrome-extension://abc/ui/talk.html', origin: 'chrome-extension://abc' };
globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
globalThis.cancelAnimationFrame = () => { frames = []; };
globalThis.fetch = async (url) => new Response(JSON.stringify({ url }), { status: url.includes('missing') ? 404 : 200 });
let analysed = 0;
globalThis.AudioContext = class {
  state = 'running';
  createAnalyser() { return { fftSize: 0, connect() {}, getFloatTimeDomainData(a) { a.fill(0.3); analysed++; } }; }
  createMediaElementSource() { return { connect() {} }; }
  get destination() { return {}; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
};
const { createMeshFriend, fakeVoice, rmsLevel } = await import('../../extension/apps/kidtube/kid/mesh.js');

function fakeEngine() {
  const calls = [];
  // (no 'then': an awaited proxy would look like a promise)
  const avatar = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined : (...args) => calls.push([name, ...args])) });
  return { calls, load: async () => ({ createMeshAvatar: async (canvas, opts) => { calls.push(['create', opts.rig.url, opts.assetsBase]); return avatar; } }) };
}
const box = { append: (el) => appended.push(el) };
const runFrames = (n, t0 = 0) => { for (let i = 0; i < n; i++) { const f = frames; frames = []; f.forEach((fn) => fn(t0 + i * 16)); } };

test('the friend loads rig.json and built/ from the avatar folder', async () => {
  const e = fakeEngine();
  await createMeshFriend(box, { base: '../avatars/miko-qipao', load: e.load });
  assert.deepEqual(e.calls[0], ['create', '../avatars/miko-qipao/rig.json', '../avatars/miko-qipao/built/']);
  assert.equal(appended.at(-1).className, 'mesh');
});

test('a missing avatar fails, so the talk page shows the drawing instead', async () => {
  await assert.rejects(createMeshFriend(box, { base: '../avatars/missing', load: fakeEngine().load }), /avatar not found/);
});

test('talking moves the mouth by loudness and stops it at the end of the line', async () => {
  const e = fakeEngine();
  const f = await createMeshFriend(box, { base: 'a', load: e.load });
  f.talking(true);
  runFrames(20);
  const levels = e.calls.filter((c) => c[0] === 'setVoiceLevel').map((c) => c[1]);
  assert.ok(levels.length >= 19 && levels.some((l) => l > 0.3), 'the made-up rhythm opens the mouth');
  f.talking(false);
  assert.deepEqual(e.calls.filter((c) => c[0] === 'setSpeaking').map((c) => c[1]), [true, false]);
  assert.deepEqual(e.calls.at(-1), ['setVoiceLevel', 0]);
});

test('a recording of ours is measured; one from another site is not routed through the analyser', async () => {
  const e = fakeEngine();
  const f = await createMeshFriend(box, { base: 'a', load: e.load });
  f.talking(true);
  f.audio({ src: 'https://example.com/x.mp3' });
  runFrames(3);
  assert.equal(analysed, 0);
  f.audio({ src: 'blob:chrome-extension://abc/123' });
  runFrames(3, 100);
  assert.ok(analysed >= 3);
  assert.ok(e.calls.at(-1)[1] > 0.9, 'a loud recording opens the mouth wide');
});

test('happy, sad and wave become the avatar’s emotions and greeting', async () => {
  const e = fakeEngine();
  const f = await createMeshFriend(box, { base: 'a', load: e.load });
  f.react('happy'); f.react('sad'); f.wave();
  assert.deepEqual(e.calls.slice(1), [['setEmotion', 'happy'], ['setEmotion', 'sad'], ['play', 'greet']]);
});

test('loudness helpers', () => {
  assert.equal(rmsLevel(new Float32Array(10)), 0);
  assert.equal(rmsLevel(new Float32Array(10).fill(1)), 1);
  const v = fakeVoice();
  const ls = Array.from({ length: 60 }, () => v.level(1 / 60));
  assert.ok(Math.min(...ls) < 0.3 && Math.max(...ls) > 0.6, 'it opens and closes');
});

test('moods become the avatar’s emotions and motions', async () => {
  const e = fakeEngine();
  const f = await createMeshFriend(box, { base: 'a', load: e.load });
  for (const m of ['surprised', 'curious', 'thinking', 'excited', 'calm', 'playful', 'nonsense']) f.mood(m);
  assert.deepEqual(e.calls.slice(1), [['setEmotion', 'surprised'], ['setEmotion', 'neutral'], ['play', 'tilt'], ['setEmotion', 'neutral'], ['play', 'think'],
    ['setEmotion', 'happy', { playMotion: false }], ['play', 'giggle'], ['setEmotion', 'relaxed'], ['setEmotion', 'happy', { playMotion: false }], ['play', 'wink']]);
});


test('a recording with mouth shapes: the vowel of each moment, closed when quiet, released at the end', async () => {
  const e = fakeEngine();
  const f = await createMeshFriend(box, { base: 'a', load: e.load });
  f.unlock();
  f.talking(true);
  const el = { src: 'blob:chrome-extension://abc/9', currentTime: 0 };
  f.audio(el, [[0.1, 'a'], [0.3, 'n'], [0.4, 'o']]);
  for (const t of [0, 0.15, 0.2, 0.35, 0.5]) { el.currentTime = t; runFrames(1); }
  assert.deepEqual(e.calls.filter((c) => c[0] === 'holdMouth').map((c) => c[1]), ['n', 'a', 'n', 'o']);
  f.talking(false);
  assert.ok(e.calls.some((c) => c[0] === 'stopLipSync'));
});
