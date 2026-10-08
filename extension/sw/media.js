// The talking friend's recorded voice (audio/*.mp3, kept in Cache Storage) and its picture (characters/*),
// both from the private data repo.
import { ghHeaders, contentsUrl, explainHttp, bytesToBase64 } from '../lib/github.js';
import { withState, effective } from './store.js';

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
  for (const req of await cache.keys()) if (!want.has(req.url.replace('https://kidtube.invalid/', ''))) await cache.delete(req);
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
