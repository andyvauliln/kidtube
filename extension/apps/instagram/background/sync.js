// Instagram's files in the profile's folder of the data repo (instagram/<folder>/):
//   posts.json      written here: every saved post with its notes and handle request (lib/posts.js repoPost)
//   notes/<id>.wav  written here: a note recording no model on the tablet could write down
//   handled.json    written by the posts agent (agent/instagram.mjs): what it did for each post
//   posts/<id>.json written by the agent: a post's transcript and the notes it read (the screen asks for one: igResult)
import { ghHeaders, contentsUrl, explainHttp, bytesToBase64, readOnly } from '../../../core/lib/github.js';
import { withState } from '../../../core/background/store.js';
import { fetchDataFile } from '../../../core/background/sync.js';
import { repoPost, restoreFromRepo } from '../lib/posts.js';

const toB64 = (text) => bytesToBase64(new TextEncoder().encode(text));

// The sha of a file (any size: the object media type has no content above 1 MB), or null when it isn't there.
async function shaOf(loc, token, path) {
  const r = await fetch(contentsUrl(loc, path), { headers: ghHeaders(token, 'application/vnd.github.object+json'), cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(await explainHttp(r.status, loc, token, path));
  return (await r.json()).sha ?? null;
}

// Writes a file (content: base64). The tablet is the only writer of these files, so a stale sha is read again once.
async function putFile(loc, token, path, content, sha, message) {
  if (await readOnly()) return sha ?? null;
  for (let i = 0; i < 2; i++) {
    const r = await fetch(contentsUrl(loc, path), {
      method: 'PUT',
      headers: { ...ghHeaders(token, 'application/vnd.github+json'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content, ...(sha ? { sha } : {}) }),
    });
    if (r.ok) return (await r.json()).content?.sha ?? null;
    if (r.status !== 409 && r.status !== 422) throw new Error(await explainHttp(r.status, loc, token, path));
    sha = await shaOf(loc, token, path);
  }
  throw new Error(`${path}: GitHub kept refusing the write (someone else writes it too?).`);
}

// keys.json beside the profile folders (instagram/keys.json, else KidTube's): the listening keys for the notes.
async function pullKeys(loc, token) {
  for (const app of [loc.base.split('/')[0], 'kidtube']) {
    const r = await fetch(contentsUrl({ ...loc, base: `${app}/` }, 'keys.json'), { headers: ghHeaders(token), cache: 'no-store' });
    if (!r.ok) continue;
    const j = await r.json().catch(() => null);
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    await chrome.storage.local.set({ repoKeys: { groq: str(j?.groqKey), gemini: str(j?.geminiKey), openrouter: str(j?.openrouterKey) } });
    return;
  }
}

// One sync (core/background/sync.js calls it for an Instagram profile). ctx: { loc, token, data, status, acct }.
export async function syncInstagram({ loc, token, data, status, acct }) {
  if (!token) return;   // the screen says it: everything stays on this device until GitHub is connected
  const etags = { ...(data.etags ?? {}) };
  let handled = null;
  try {
    const r = await fetchDataFile(loc, token, 'handled.json', data.handled ? etags['handled.json'] : null);
    if (!r.notModified && r.json?.schemaVersion === 1) { handled = r.json; etags['handled.json'] = r.etag; }
  } catch (e) { if (!e.missing) status.errors.push(String(e.message ?? e)); }
  try { await pullKeys(loc, token); } catch {}

  // A fresh tablet: the notes and requests come back from posts.json.
  const empty = await withState((s) => !s.ig.order.length && !s.ig.restored, { account: acct });
  if (empty === undefined) return false;
  let restore = null, restoreFailed = false;
  if (empty) {
    try { restore = (await fetchDataFile(loc, token, 'posts.json')).json; }
    catch (e) { if (!e.missing) { restoreFailed = true; status.errors.push(String(e.message ?? e)); } }
  }

  const ok = await withState((s) => {
    if (handled) s.data.handled = handled;
    s.data.etags = etags;
    if (empty && !restoreFailed && !s.ig.order.length) { if (restore) restoreFromRepo(s.ig, restore); s.ig.restored = true; }
    // The agent wrote down a recorded note: keep its words with the note.
    for (const [id, done] of Object.entries(s.data.handled?.posts ?? {})) {
      const p = s.ig.posts[id];
      for (const n of p?.notes ?? []) if (n.text == null && done.noteTexts?.[n.id]) { n.text = done.noteTexts[n.id]; s.ig.rev++; }
    }
    return true;
  }, { account: acct });
  if (!ok) return false;

  // Recordings waiting for the agent.
  const { igAudio = {} } = await chrome.storage.local.get('igAudio');
  for (const [noteId, b64] of Object.entries(igAudio)) {
    try {
      await putFile(loc, token, `notes/${noteId}.wav`, b64, await shaOf(loc, token, `notes/${noteId}.wav`), `note recording ${noteId}`);
      const now = (await chrome.storage.local.get('igAudio')).igAudio ?? {};
      delete now[noteId];
      await chrome.storage.local.set({ igAudio: now });
    } catch (e) { status.errors.push(`Note recording: ${e.message ?? e}`); break; }
  }

  // posts.json, when something changed here since the last write.
  const out = await withState((s) => {
    if (s.ig.rev === s.ig.pushedRev && s.ig.postsSha) return null;
    const done = s.data.handled?.posts ?? {};
    return { rev: s.ig.rev, sha: s.ig.postsSha ?? null, file: {
      schemaVersion: 1, updatedAt: new Date().toISOString(), defaultCollection: s.ig.defaultCollection, collections: s.ig.collections,
      posts: s.ig.order.map((id) => s.ig.posts[id]).filter(Boolean).map((p) => repoPost(p, done[p.id])),
    } };
  }, { account: acct });
  if (out === undefined) return false;
  if (out && (out.file.posts.length || out.sha)) {
    try {
      const sha = await putFile(loc, token, 'posts.json', toB64(JSON.stringify(out.file, null, 1) + '\n'), out.sha ?? await shaOf(loc, token, 'posts.json'),
        `instagram: ${out.file.posts.length} saved posts`);
      await withState((s) => { s.ig.pushedRev = out.rev; s.ig.postsSha = sha; }, { account: acct });
    } catch (e) { status.errors.push(`posts.json: ${e.message ?? e}`); }
  }
  return true;
}
