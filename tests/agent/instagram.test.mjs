// The Instagram app's post rules (extension/apps/instagram/lib/posts.js) and its posts agent (agent/instagram.mjs),
// with Instagram's CDN, Groq's Whisper and ffmpeg faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { statusOf, duePosts, parseMedia, mergeSaved, repoPost, restoreFromRepo, emptyIg } from '../../extension/apps/instagram/lib/posts.js';
import { handlePost, runFolder, dueIn } from '../../agent/instagram.mjs';

const cdn = (name) => `https://scontent-ams2-1.cdninstagram.com/v/${name}`;

test('status: not handled, in the list, handled, failed; a newer request or note makes it due again', () => {
  const p = { id: '1', handle: null };
  assert.equal(statusOf(p, undefined), 'new');
  p.handle = { at: '2026-10-12T10:00:00Z', why: 'asked' };
  assert.equal(statusOf(p, undefined), 'queued');
  assert.equal(statusOf(p, { request: '2026-10-12T10:00:00Z', error: null }), 'handled');
  assert.equal(statusOf(p, { request: '2026-10-12T10:00:00Z', error: 'expired' }), 'failed');
  p.handle = { at: '2026-10-12T11:00:00Z', why: 'note' };
  assert.equal(statusOf(p, { request: '2026-10-12T10:00:00Z', error: null }), 'queued');
  const posts = [{ id: 'b', handle: { at: '2026-10-12T09:00:00Z' } }, { id: 'a', handle: { at: '2026-10-12T08:00:00Z' } }, { id: 'c', handle: null }];
  assert.deepEqual(duePosts(posts, {}).map((x) => x.id), ['a', 'b'], 'oldest request first');
});

test('Instagram’s posts: a reel, a carousel with a video, a picture; addresses only from Instagram’s CDN', () => {
  const reel = parseMedia({ pk: 31, id: '31_7', code: 'Rr', media_type: 2, product_type: 'clips', taken_at: 1790000000, user: { username: 'chef' },
    caption: { text: 'Pasta' }, image_versions2: { candidates: [{ url: cdn('big.jpg'), width: 1080 }, { url: cdn('small.jpg'), width: 320 }] },
    video_versions: [{ url: cdn('r.mp4'), width: 720 }], video_duration: 12.5, saved_collection_ids: [500] });
  assert.equal(reel.id, '31');
  assert.equal(reel.kind, 'video');
  assert.equal(reel.reel, true);
  assert.equal(reel.thumb, cdn('small.jpg'), 'the small picture for the grid');
  assert.deepEqual(reel.items, [{ kind: 'video', src: cdn('big.jpg'), video: cdn('r.mp4') }]);
  assert.deepEqual(reel.collections, ['500']);
  const car = parseMedia({ pk: '32', code: 'Cc', media_type: 8, user: { username: 'x' }, carousel_media: [
    { media_type: 1, image_versions2: { candidates: [{ url: cdn('a.jpg'), width: 640 }] } },
    { media_type: 2, image_versions2: { candidates: [{ url: cdn('b.jpg'), width: 640 }] }, video_versions: [{ url: cdn('b.mp4') }] }] });
  assert.equal(car.kind, 'carousel');
  assert.equal(car.thumb, cdn('a.jpg'));
  assert.deepEqual(car.items.map((i) => i.video), [null, cdn('b.mp4')]);
  assert.equal(car.collections, null, 'unknown: the merge keeps what it had');
  assert.equal(parseMedia({ pk: 1 }), null, 'no code: not a post');

  const ig = emptyIg();
  mergeSaved(ig, [reel, { ...car, thumb: 'https://evil.example/x.jpg' }]);
  assert.equal(ig.posts['32'].thumb, null, 'an address outside Instagram’s CDN is dropped');
  assert.deepEqual(ig.order, ['31', '32']);
  const out = repoPost(ig.posts['31'], undefined);
  assert.equal(out.videos, undefined, 'not in the list: no video address in the repo');
  ig.posts['31'].handle = { at: '2026-10-12T10:00:00Z', why: 'asked' };
  assert.deepEqual(repoPost(ig.posts['31'], undefined).videos, [cdn('r.mp4')]);

  const fresh = emptyIg();
  assert.equal(restoreFromRepo(fresh, { posts: [repoPost(ig.posts['31'])], defaultCollection: '500', collections: [{ id: '500', name: 'R', count: 1 }] }), 1);
  assert.equal(fresh.posts['31'].handle.at, '2026-10-12T10:00:00Z', 'a fresh tablet gets its requests and notes back');
  assert.equal(fresh.defaultCollection, '500');
});

// A data folder with posts.json; ffmpeg replaced by a copy (the fake Whisper does not read the sound).
function setup(posts) {
  const dir = mkdtempSync(join(tmpdir(), 'ig-test-'));
  writeFileSync(join(dir, 'posts.json'), JSON.stringify({ schemaVersion: 1, posts }));
  const ffmpeg = join(dir, 'ffmpeg.sh');
  writeFileSync(ffmpeg, '#!/bin/sh\neval last=\\${$#}\ncp "$5" "$last"\n');
  chmodSync(ffmpeg, 0o755);
  return { dir, ffmpeg };
}
function fakeNet({ expired = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(String(url));
    if (String(url).includes('cdninstagram.com')) return expired ? { ok: false, status: 403 } : { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('VIDEO').buffer };
    const form = init.body;
    const file = form.get('file');
    const said = (await file.text()) === 'VIDEO' ? 'Boil the water first.' : 'Note: add garlic.';
    return { ok: true, status: 200, json: async () => ({ text: ` ${said}`, language: 'english', duration: 3 }) };
  };
  return { calls, fetchImpl };
}

test('the posts agent: writes down the video and a recorded note, keeps the notes; a picture is skipped; an expired address fails clearly', async () => {
  const at = '2026-10-12T10:00:00Z';
  const { dir, ffmpeg } = setup([
    { id: '1', code: 'A', kind: 'video', reel: true, author: 'chef', caption: 'x', handle: { at, why: 'note' }, videos: [cdn('1.mp4')],
      notes: [{ id: 'n1', at, text: 'Try it' }, { id: 'n2', at, text: null, audio: 'notes/n2.wav' }] },
    { id: '2', code: 'B', kind: 'image', author: 'a', handle: { at, why: 'asked' }, notes: [] },
    { id: '3', code: 'C', kind: 'video', author: 'a', handle: null, notes: [] },
  ]);
  mkdirSync(join(dir, 'notes'));
  writeFileSync(join(dir, 'notes', 'n2.wav'), 'NOTE');
  assert.deepEqual(dueIn(dir).map((p) => p.id), ['1', '2'], 'only posts in the list');
  const net = fakeNet();
  const logs = [];
  assert.equal(await runFolder(dir, { key: 'k', fetchImpl: net.fetchImpl, ffmpeg, log: (m) => logs.push(m) }), 2);
  const handled = JSON.parse(readFileSync(join(dir, 'handled.json'), 'utf8'));
  assert.equal(handled.posts['1'].request, at);
  assert.equal(handled.posts['1'].error, null);
  assert.deepEqual(handled.posts['1'].notes, ['n1', 'n2'], 'the notes it read');
  assert.deepEqual(handled.posts['1'].noteTexts, { n2: 'Note: add garlic.' }, 'the recorded note, written down for the tablet');
  const r1 = JSON.parse(readFileSync(join(dir, 'posts', '1.json'), 'utf8'));
  assert.equal(r1.transcript.text, 'Boil the water first.');
  assert.equal(r1.transcript.model, 'whisper-large-v3');
  assert.deepEqual(r1.notes.map((n) => n.text), ['Try it', 'Note: add garlic.']);
  assert.equal(r1.url, 'https://www.instagram.com/reel/A/');
  const r2 = JSON.parse(readFileSync(join(dir, 'posts', '2.json'), 'utf8'));
  assert.match(r2.skipped, /picture/);
  assert.equal(handled.posts['2'].error, null);
  assert.equal(dueIn(dir).length, 0, 'nothing due after the run');
  assert.equal(existsSync(join(dir, 'posts', '3.json')), false);

  const expired = await handlePost({ id: '9', code: 'Z', kind: 'video', handle: { at }, videos: [cdn('9.mp4')], notes: [] }, dir, { key: 'k', fetchImpl: fakeNet({ expired: true }).fetchImpl, ffmpeg });
  assert.match(expired.entry.error, /expired/);
  const nokey = await handlePost({ id: '9', code: 'Z', kind: 'video', handle: { at }, videos: [cdn('9.mp4')], notes: [] }, dir, { key: '', fetchImpl: net.fetchImpl, ffmpeg });
  assert.match(nokey.entry.error, /GROQ_API_KEY/);
});
