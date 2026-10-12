#!/usr/bin/env node
// The posts agent of the Instagram app: it handles the posts the tablet put in the list (a tap on "Add to the list",
// or a note about the post). No AI model but Whisper yet: it writes down what each video says (Groq's Whisper) and
// what each recorded note says, and keeps the notes with the result, so a later AI step can make more metadata
// from the transcript and the notes (result.metadata, empty for now).
//   node agent/instagram.mjs run  [--data DIR] [--state DIR] [--max N] [--pull]   handle what is due, push the results
//   node agent/instagram.mjs due  [--data DIR]                                   list what is due (JSON), change nothing
// agent/poll.sh runs `run` every minute the data repo changed (its clone is fresh then; --pull syncs it here).
// Reads   instagram/<folder>/posts.json   (the tablet: posts, notes, handle requests, video addresses of due posts)
//         instagram/<folder>/notes/<id>.wav (the tablet: a recorded note it could not write down)
// Writes  instagram/<folder>/handled.json  ({ posts: { id: { at, request, notes, transcript, error, noteTexts } } })
//         instagram/<folder>/posts/<id>.json (the transcript, the notes it read, metadata)
// The status rules are the tablet's own: extension/apps/instagram/lib/posts.js.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, mkdtempSync, rmSync, appendFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { duePosts, postUrl } from '../extension/apps/instagram/lib/posts.js';
import { syncClone, commitAndPush, readJson, writeJson } from './lib/data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, 'config.json'), 'utf8'));
const home = (p) => p.replace(/^~/, process.env.HOME);
const IG = { perRun: 10, maxVideos: 5, maxVideoMB: 200, models: ['whisper-large-v3', 'whisper-large-v3-turbo'], ...(config.instagram ?? {}) };
const GROQ = 'https://api.groq.com/openai/v1/audio/transcriptions';

function readEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n')
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
}

class Failed extends Error {}

// One audio or video file → { text, language, model }. Groq's Whisper takes up to 25 MB: ffmpeg makes 16 kHz mono
// MP3 first (about 4 MB for 15 minutes). null text: the file has no sound.
export async function transcribeFile(file, { key, models = IG.models, fetchImpl = fetch, ffmpeg = 'ffmpeg' } = {}) {
  if (!key) throw new Failed('GROQ_API_KEY is missing in the server’s agent.env.');
  const dir = mkdtempSync(join(tmpdir(), 'ig-audio-'));
  try {
    const mp3 = join(dir, 'a.mp3');
    try { execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', mp3], { stdio: 'pipe', timeout: 300000 }); }
    catch (e) {
      if (/does not contain any stream|matches no streams|Output file is empty/i.test(String(e.stderr ?? ''))) return { text: null, language: null, model: null };
      throw new Failed(`ffmpeg could not read it: ${String(e.stderr ?? e.message).trim().split('\n').at(-1)}`);
    }
    const bytes = readFileSync(mp3);
    let last = '';
    for (const model of models) {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), 'audio.mp3');
      form.append('model', model);
      form.append('response_format', 'verbose_json');
      const r = await fetchImpl(GROQ, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(300000) }).catch((e) => ({ ok: false, status: 0, text: async () => String(e.message ?? e) }));
      if (r.ok) {
        const j = await r.json();
        return { text: String(j.text ?? '').trim(), language: j.language ?? null, seconds: j.duration ?? null, model };
      }
      last = `${model}: ${r.status} ${(await r.text()).slice(0, 200)}`;
    }
    throw new Failed(`Whisper refused it (${last}).`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// A video address → a file in dir. The addresses expire after some days, and Instagram says 403 then.
async function download(url, dir, name, fetchImpl = fetch) {
  const r = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36' }, signal: AbortSignal.timeout(300000) })
    .catch((e) => { throw new Failed(`Could not download the video (${e.message}).`); });
  if (r.status === 403 || r.status === 410) throw new Failed('The video address expired. Open the post in the app and tap Try again.');
  if (!r.ok) throw new Failed(`Could not download the video (Instagram answered ${r.status}).`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length > IG.maxVideoMB * 1e6) throw new Failed(`The video is larger than ${IG.maxVideoMB} MB.`);
  const file = join(dir, name);
  writeFileSync(file, bytes);
  return file;
}

// One due post → { result (posts/<id>.json), entry (handled.json) }. Never throws: a failure is the entry's error.
export async function handlePost(p, folderDir, { key, fetchImpl = fetch, ffmpeg, now = new Date().toISOString() } = {}) {
  const result = { schemaVersion: 1, id: p.id, code: p.code, url: p.url ?? postUrl(p), kind: p.kind, author: p.author, caption: p.caption ?? '',
    handledAt: now, request: p.handle.at, notes: [], transcript: null, skipped: null, metadata: {} };
  const noteTexts = {};
  let error = null;
  // The notes: typed, written down on the tablet, or a recording written down here.
  for (const n of p.notes ?? []) {
    let text = n.text ?? null;
    if (text == null && n.audio) {
      const file = join(folderDir, n.audio);
      try {
        if (!existsSync(file)) throw new Failed(`the recording ${n.audio} is not in the repo yet`);
        text = (await transcribeFile(file, { key, fetchImpl, ffmpeg })).text ?? '';
        noteTexts[n.id] = text;
      } catch (e) { error ??= `A recorded note: ${e.message}`; }
    }
    result.notes.push({ id: n.id, at: n.at, text });
  }
  // The videos.
  const videos = (p.videos ?? []).slice(0, IG.maxVideos);
  if (p.kind === 'image') result.skipped = 'A picture: there is nothing to write down.';
  else if (!videos.length) result.skipped = p.kind === 'carousel' ? 'No video among its items.' : null;
  if (p.kind === 'video' && !videos.length) error ??= 'The tablet sent no video address. Open the post in the app and tap Try again.';
  if (videos.length) {
    const dir = mkdtempSync(join(tmpdir(), 'ig-video-'));
    try {
      const parts = [];
      for (const [i, url] of videos.entries()) {
        const t = await transcribeFile(await download(url, dir, `v${i}.mp4`, fetchImpl), { key, fetchImpl, ffmpeg });
        parts.push({ index: i, ...t });
      }
      const said = parts.filter((x) => x.text);
      result.transcript = said.length ? {
        text: said.map((x) => (parts.length > 1 ? `[${x.index + 1}] ${x.text}` : x.text)).join('\n\n'),
        language: said[0].language, model: said[0].model, parts: parts.map(({ index, text, language, seconds }) => ({ index, text, language, seconds })),
      } : null;
      if (!said.length) result.skipped = 'The video has no words.';
    } catch (e) { error = e instanceof Failed ? e.message : `Unexpected: ${e.message ?? e}`; }
    finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const entry = { at: now, request: p.handle.at, notes: (p.notes ?? []).map((n) => n.id), transcript: result.transcript?.text.length ?? 0,
    error, ...(Object.keys(noteTexts).length ? { noteTexts } : {}) };
  return { result, entry };
}

// Every Instagram profile folder of the clone: instagram/<folder>/ with a posts.json.
export function folders(clone) {
  const root = join(clone, 'instagram');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((f) => existsSync(join(root, f, 'posts.json')) && statSync(join(root, f)).isDirectory()).map((f) => join(root, f));
}

export function dueIn(folderDir) {
  const posts = readJson(join(folderDir, 'posts.json'))?.posts ?? [];
  const handled = readJson(join(folderDir, 'handled.json'))?.posts ?? {};
  return duePosts(posts.filter((p) => p?.id && p.code), handled);
}

// Handles what is due in one folder and writes the files (the caller commits). Returns how many were handled.
export async function runFolder(folderDir, { key, max = IG.perRun, log = () => {}, fetchImpl, ffmpeg } = {}) {
  const due = dueIn(folderDir).slice(0, max);
  if (!due.length) return 0;
  const file = join(folderDir, 'handled.json');
  const handled = readJson(file) ?? { schemaVersion: 1, posts: {} };
  for (const p of due) {
    const started = Date.now();
    const { result, entry } = await handlePost(p, folderDir, { key, fetchImpl, ffmpeg });
    writeJson(join(folderDir, 'posts', `${p.id}.json`), result);
    handled.posts[p.id] = entry;
    handled.updatedAt = new Date().toISOString();
    writeJson(file, handled);   // after each post: a crash keeps what was done
    log(`${p.id} (${p.kind}, ${p.notes?.length ?? 0} notes): ${entry.error ? `failed: ${entry.error}` : `${entry.transcript} chars`} in ${Math.round((Date.now() - started) / 1000)} s`);
  }
  return due.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    data: { type: 'string' }, state: { type: 'string' }, max: { type: 'string' }, pull: { type: 'boolean' } } });
  const clone = home(values.data ?? process.env.KIDTUBE_DATA_DIR ?? config.dataDir);
  const stateRoot = home(values.state ?? process.env.KIDTUBE_STATE_DIR ?? config.stateDir ?? '~/.local/share/kidtube/state');
  const cmd = positionals[0] ?? 'due';
  if (cmd === 'due') {
    console.log(JSON.stringify(folders(clone).map((d) => ({ folder: d, due: dueIn(d).map((p) => ({ id: p.id, kind: p.kind, notes: p.notes?.length ?? 0, asked: p.handle.at })) })), null, 1));
  } else if (cmd === 'run') {
    if (config.instagram?.enabled === false) process.exit(0);
    if (values.pull) syncClone(clone, config.dataRepo ?? 'andyvauliln/kidtube-data');
    const env = { ...readEnv(home(config.envFile)), ...process.env };
    mkdirSync(stateRoot, { recursive: true });
    const log = (msg) => { const line = `[${new Date().toISOString()}] ${msg}`; console.log(line); try { appendFileSync(join(stateRoot, 'instagram.log'), `${line}\n`); } catch {} };
    for (const dir of folders(clone)) {
      const name = dir.split('/').slice(-2).join('/');
      if (!dueIn(dir).length) continue;
      const n = await runFolder(dir, { key: env.GROQ_API_KEY, max: Number(values.max) || IG.perRun, log: (m) => log(`${name} ${m}`) });
      if (n) { commitAndPush(clone, `instagram agent: ${n} post${n === 1 ? '' : 's'} handled for ${name}`); log(`${name}: ${n} handled, pushed`); }
    }
  } else {
    console.error('usage: node agent/instagram.mjs run|due [--data DIR] [--state DIR] [--max N] [--pull]');
    process.exit(2);
  }
}
