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
