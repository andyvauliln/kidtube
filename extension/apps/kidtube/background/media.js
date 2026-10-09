// The talking friend's recorded voice (audio/*.mp3, kept in Cache Storage) and its picture (characters/*),
// both from the private data repo.
import { ghHeaders, contentsUrl, explainHttp, bytesToBase64 } from '../../../core/lib/github.js';
import { withState } from '../../../core/background/store.js';
import { effective } from './config.js';

export const AUDIO_CACHE = 'kidtube-audio';
const audioKey = (path) => `https://kidtube.invalid/${path}`;

// Every "repo:audio/x.mp3" the queue and the rules refer to.
export function audioRefs(queue, config) {
  const refs = new Set();
  const walk = (x) => {
    if (typeof x === 'string') { if (/^repo:audio\/[A-Za-z0-9_-]+\.(mp3|wav|ogg)$/.test(x)) refs.add(x.slice(5)); }
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(queue?.videos);
  walk(config?.quiz?.items);
  walk(config?.presenter);
  return refs;
}

const AUDIO_TYPE = { mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav' };
export async function syncAudio(loc, token) {
  if (!self.caches) return;
  const { data = {}, localConfig } = await chrome.storage.local.get(['data', 'localConfig']);
  const { config, queue } = await effective({ data, localConfig });
  const want = audioRefs(queue, config);
  const cache = await caches.open(AUDIO_CACHE);
  for (const req of await cache.keys()) if (!want.has(req.url.replace('https://kidtube.invalid/', '')) && !req.url.endsWith(`/${LIPS}`)) await cache.delete(req);
  await syncLips(loc, token, cache, want.size);
  let failed = 0;
  for (const path of want) {
    if (await cache.match(audioKey(path))) continue;
    const r = await fetch(contentsUrl(loc, path), { headers: ghHeaders(token), cache: 'no-store' });
    if (!r.ok) { failed++; continue; }
    const type = AUDIO_TYPE[path.split('.').pop()] ?? 'audio/wav';
    await cache.put(audioKey(path), new Response(await r.blob(), { headers: { 'Content-Type': type } }));
  }
  if (failed) throw new Error(`${failed} of ${want.size} could not be downloaded; the tablet's own voice is used for those.`);
}

// The mouth shapes of the recordings (audio/lips.json, made with them on the server). Fetched again only when it
// changed (ETag); none yet is fine.
const LIPS = 'audio/lips.json';
async function syncLips(loc, token, cache, recordings) {
  const old = await cache.match(audioKey(LIPS));
  if (!recordings) { if (old) await cache.delete(audioKey(LIPS)); return; }
  const etag = old?.headers.get('ETag');
  const r = await fetch(contentsUrl(loc, LIPS), { headers: { ...ghHeaders(token), Accept: 'application/vnd.github.raw+json', ...(etag ? { 'If-None-Match': etag } : {}) }, cache: 'no-store' }).catch(() => null);
  if (r?.status === 404) await cache.delete(audioKey(LIPS));
  else if (r?.ok) await cache.put(audioKey(LIPS), new Response(await r.blob(), { headers: { 'Content-Type': 'application/json', ...(r.headers.get('ETag') ? { ETag: r.headers.get('ETag') } : {}) } }));
}

const IMAGE_TYPE = { png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
// The talking friend's picture from the private data repo ("repo:characters/x.svg").
export async function loadCharacter(loc, token) {
  const { data = {}, localConfig, character, account } = await chrome.storage.local.get(['data', 'localConfig', 'character', 'account']);
  const only = { account: account?.key ?? null };
  const { config } = await effective({ data, localConfig });
  const ref = config.presenter?.imageUrl ?? '';
  if (!ref.startsWith('repo:')) { if (character) await withState((s) => { s.character = null; }, only); return; }
  const path = ref.slice(5);
  const r = await fetch(contentsUrl(loc, path), {
    headers: { ...ghHeaders(token), ...(character?.path === path && character.etag ? { 'If-None-Match': character.etag } : {}) }, cache: 'no-store',
  });
  if (r.status === 304) return;
  if (!r.ok) throw new Error(await explainHttp(r.status, loc, token, path));
  const etag = r.headers.get('etag');
  if (path.endsWith('.svg')) {
    const svg = await r.text();
    return withState((s) => { s.character = { path, etag, svg: svg.slice(0, 300000) }; }, only);
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  const type = IMAGE_TYPE[path.split('.').pop()] ?? 'image/jpeg';
  return withState((s) => { s.character = { path, etag, src: `data:${type};base64,${bytesToBase64(bytes.subarray(0, 2_000_000))}` }; }, only);
}

// Moving avatars kept in the private data repo (avatars/<name>/: rig.json and built/, as mesh-avatar-studio saves
// them), for characters that can't be in the public code (Pikachu). presenter.avatar "repo:<name>" picks one.
// The chosen one is kept in Cache Storage under avatars/<name>/ (kid/mesh.js cachedAvatar reads it there); a file is
// downloaded again only when GitHub's sha for it changed. s.repoAvatars: the names Settings offers.
export const AVATAR_CACHE = 'kidtube-avatar';
const AVATAR_FILE = /\.(json|png|webp)$/;
export const repoAvatarName = (ref) => (/^repo:[a-z0-9-]+$/.test(ref ?? '') ? ref.slice(5) : null);

async function listDir(loc, token, path) {
  const r = await fetch(contentsUrl(loc, path), { headers: ghHeaders(token, 'application/vnd.github+json'), cache: 'no-store' });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(await explainHttp(r.status, loc, token, path));
  const list = await r.json();
  return Array.isArray(list) ? list : [];
}

export async function syncAvatar(loc, token) {
  const { data = {}, localConfig, account } = await chrome.storage.local.get(['data', 'localConfig', 'account']);
  const only = { account: account?.key ?? null };
  const names = (await listDir(loc, token, 'avatars')).filter((x) => x.type === 'dir' && /^[a-z0-9-]+$/.test(x.name)).map((x) => x.name);
  await withState((s) => { s.repoAvatars = names; }, only);
  if (!globalThis.caches) return;
  const cache = await caches.open(AVATAR_CACHE);
  const { config } = await effective({ data, localConfig });
  const name = repoAvatarName(config.presenter?.avatar);
  const root = `https://kidtube.invalid/avatars/${name}/`;
  // Only the chosen avatar stays on the tablet.
  for (const req of await cache.keys()) if (!name || !req.url.startsWith(root)) await cache.delete(req);
  if (!name) return;
  // Gone from the data repo: a copy already here stays (as the last good list and rules do).
  if (!names.includes(name)) throw new Error(`avatars/${name}/ is not in the data repo (a copy already on this tablet stays).`);
  const files = [];
  const walk = async (dir, depth) => {
    for (const x of await listDir(loc, token, dir)) {
      if (x.type === 'dir' && depth < 3) await walk(`${dir}/${x.name}`, depth + 1);
      else if (x.type === 'file' && AVATAR_FILE.test(x.name) && !(x.size > 3_000_000)) files.push({ path: `${dir}/${x.name}`, sha: x.sha });
    }
  };
  await walk(`avatars/${name}`, 0);
  if (!files.some((f) => f.path === `avatars/${name}/rig.json`)) throw new Error(`avatars/${name}/ has no rig.json; the picture shows instead.`);
  const shas = (await (await cache.match(`${root}.files`))?.json().catch(() => null)) ?? {};
  const want = new Set(files.map((f) => f.path));
  for (const req of await cache.keys()) {
    const path = req.url.replace('https://kidtube.invalid/', '');
    if (!want.has(path) && !path.endsWith('/.files')) { await cache.delete(req); delete shas[path]; }
  }
  for (const f of files.slice(0, 120)) {
    if (shas[f.path] === f.sha && await cache.match(`https://kidtube.invalid/${f.path}`)) continue;
    const r = await fetch(contentsUrl(loc, f.path), { headers: ghHeaders(token), cache: 'no-store' });
    if (!r.ok) throw new Error(await explainHttp(r.status, loc, token, f.path));
    const type = f.path.endsWith('.json') ? 'application/json' : IMAGE_TYPE[f.path.split('.').pop()];
    await cache.put(`https://kidtube.invalid/${f.path}`, new Response(await r.blob(), { headers: { 'Content-Type': type } }));
    shas[f.path] = f.sha;
    await cache.put(`${root}.files`, new Response(JSON.stringify(shas), { headers: { 'Content-Type': 'application/json' } }));
  }
}
