// The messages of Instagram's screen (content/app.js on instagram.com). Each one works only while the running
// profile is an Instagram one: the screen may still be open after a switch.
import { appOf } from '../../registry.js';
import { withState, dataLocation, folderShown, headerOpen } from '../../../core/background/store.js';
import { syncSoon, fetchDataFile } from '../../../core/background/sync.js';
// The notes are written down like KidTube's parent notes: Groq's Whisper, then Gemini, then OpenRouter (keys.json or Settings).
import { transcribeAnswer, listenKeys, NOTE_LISTEN_MODELS } from '../../kidtube/lib/voice.js';
import { statusOf, mergeSaved, mergeCollection, cleanPost, parseMedia, exportFile } from '../lib/posts.js';
import { readerRules } from '../lib/rules.js';
import { remoteData } from '../../../core/background/remote.js';

const NOT_HERE = { ok: false, notHere: true, error: 'Instagram is not the app that runs now.' };
const running = async () => appOf((await chrome.storage.local.get('account')).account).id === 'instagram';
const nowIso = () => new Date().toISOString();
const newId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Runs fn(s) on the state only while Instagram runs.
const onIg = async (fn) => ((await running()) ? withState(fn) : NOT_HERE);
// Posts as Instagram's API sent them (content/api.js cuts them down) → our posts.
const parsed = (media) => (Array.isArray(media) ? media.slice(0, 100) : []).map(parseMedia).filter(Boolean);

// What the screen shows: every post with its status, newest saved first.
async function view(s) {
  const handled = s.data.handled?.posts ?? {};
  const posts = s.ig.order.map((id) => s.ig.posts[id]).filter(Boolean).map((p) => {
    const done = handled[p.id];
    const texts = done?.noteTexts ?? {};
    return { ...p, status: statusOf(p, done), error: statusOf(p, done) === 'failed' ? done.error : null, handledAt: done?.at ?? null,
      transcript: done?.transcript ?? null, notes: p.notes.map((n) => (n.text == null && texts[n.id] ? { ...n, text: texts[n.id] } : n)) };
  });
  const { igAudio = {}, account } = await chrome.storage.local.get(['igAudio', 'account']);
  return { ok: true, folder: await folderShown(), who: account?.username ? `@${account.username}` : null, posts, collections: s.ig.collections, defaultCollection: s.ig.defaultCollection,
    loadedAt: s.ig.loadedAt, complete: s.ig.complete, cursor: s.ig.cursor, sync: s.syncStatus ?? {},
    unsent: s.ig.rev !== s.ig.pushedRev || Object.keys(igAudio).length > 0, github: !!s.settings.token };
}

// A recording (base64 WAV) → its words, or why not. null text: no model could do it; the agent will.
async function writeDown(b64, lang) {
  const audio = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const fails = [];
  const heard = await transcribeAnswer(audio, { keys: await listenKeys(), lang, maxTokens: 6000, freeModels: NOTE_LISTEN_MODELS,
    instruction: 'Someone dictates a note about an Instagram post they saved. Use punctuation.',
    onFail: (r, why) => fails.push(`${r.model}: ${why}`) });
  if (heard?.length) return { text: heard[0] };
  if (heard) return { empty: true };
  return { text: null, why: fails.join('; ') || 'no listening key on this tablet' };
}

export const HANDLERS = {
  // Instagram's pages: show the Connect bar and the app only where the header could act (not in kid mode, not
  // locked); who: the running Instagram profile's username (its Saved page is the app); rules: how the app reads
  // Instagram's own page (lib/rules.js, with site/remote.json).
  // offer: the header's Instagram tile was tapped without a profile (core/background/profiles.js plainSite): once
  // signed in, the page asks to switch to the app now.
  igSite: async () => {
    const { account, siteOffer } = await chrome.storage.local.get(['account', 'siteOffer']);
    const who = appOf(account).id === 'instagram' ? account?.username ?? null : null;
    const offer = siteOffer?.app === 'instagram' && Date.now() - siteOffer.at < 60 * 60000;
    return { ok: true, open: await headerOpen(), who, offer, rules: readerRules((await remoteData()).instagram?.reader) };
  },
  // The page's "Not now": it asks no more.
  igOfferDone: async () => { await chrome.storage.local.remove('siteOffer'); return { ok: true }; },

  // The screen.
  igState: async () => ((await running()) ? withState(view) : NOT_HERE),

  // The Saved tab's Export: every saved post as one JSON file (lib/posts.js exportFile).
  igExport: () => onIg(async (s) => {
    const { account } = await chrome.storage.local.get('account');
    const who = account?.username ? `@${account.username}` : null;
    const file = exportFile(s.ig, s.data.handled?.posts ?? {}, { who });
    const day = file.exportedAt.slice(0, 10);
    return { ok: true, file, name: `instagram-saved-${account?.username ?? 'posts'}-${day}.json` };
  }),

  // One page of the saved list (media: Instagram's posts). at 'top': the newest; at 'end': the rest, read once
  // (cursor: where to go on). finished: this read of Instagram is over.
  igSaved: (msg) => onIg((s) => {
    const posts = parsed(msg.media);
    const added = mergeSaved(s.ig, posts, { at: msg.at === 'top' ? 'top' : 'end', page: Number(msg.page) || 0 });
    if (msg.at === 'end') {
      s.ig.cursor = typeof msg.cursor === 'string' ? msg.cursor : null;
      if (!s.ig.cursor) s.ig.complete = true;
    }
    if (msg.finished) s.ig.loadedAt = nowIso();
    if (added) syncSoon(5000);
    return { ok: true, added, known: posts.length - added };
  }),

  // Fresh picture and video addresses for posts already here (an expired picture, a post opened, a request).
  igPosts: (msg) => onIg((s) => {
    let n = 0;
    for (const raw of parsed(msg.media)) {
      const p = cleanPost(raw);
      const old = p && s.ig.posts[p.id];
      if (!old) continue;
      s.ig.posts[p.id] = { ...old, ...p, collections: p.collections ?? old.collections, mediaAt: nowIso() };
      n++;
    }
    return { ok: true, updated: n };
  }),

  // The account's collections (the dropdown).
  igCollections: (msg) => onIg((s) => {
    const list = (Array.isArray(msg.list) ? msg.list : []).filter((c) => /^\d+$/.test(String(c?.id ?? '')))
      .map((c) => ({ id: String(c.id), name: String(c.name ?? '').slice(0, 80) || 'Collection', count: Number(c.count) || 0 }));
    if (JSON.stringify(list) !== JSON.stringify(s.ig.collections)) { s.ig.collections = list; s.ig.rev++; }
    return { ok: true, collections: list };
  }),

  // One page of a collection's posts; done: every id of the collection (the others leave it).
  igCollection: (msg) => onIg((s) => {
    const added = mergeCollection(s.ig, msg.id, parsed(msg.media), { done: !!msg.done, allIds: msg.ids ?? null });
    return { ok: true, added };
  }),

  // The collection the Saved tab opens with ('all': every saved post).
  igDefault: (msg) => onIg((s) => {
    const c = String(msg.collection ?? 'all');
    if (c !== 'all' && !s.ig.collections.some((x) => x.id === c)) return { ok: false, error: 'No such collection.' };
    s.ig.defaultCollection = c;
    s.ig.rev++;
    syncSoon(5000);
    return { ok: true, defaultCollection: c };
  }),

  // Into the list the agent handles (again), or out of it (off) while it waits. media: the post with fresh addresses.
  igHandle: (msg) => onIg((s) => {
    const p = s.ig.posts[String(msg.id)];
    if (!p) return { ok: false, error: 'No such post.' };
    const fresh = cleanPost(parsed([msg.media])[0]);
    if (fresh?.id === p.id) Object.assign(p, { ...fresh, collections: fresh.collections ?? p.collections, mediaAt: nowIso() });
    const done = s.data.handled?.posts?.[p.id];
    if (msg.off) {
      if (statusOf(p, done) !== 'queued') return { ok: false, error: 'It is not waiting in the list.' };
      p.handle = done ? { at: done.request, why: 'kept' } : null;   // back to what the agent last did
    } else p.handle = { at: nowIso(), why: done ? 'again' : 'asked' };
    s.ig.rev++;
    syncSoon(4000);
    return { ok: true, status: statusOf(p, done) };
  }),

  // A note about a post: typed (text) or recorded (audio, base64 16 kHz WAV). It puts the post in the list,
  // so the agent handles it with the note.
  igNote: async (msg) => {
    if (!(await running())) return NOT_HERE;
    let text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 4000) : null;
    let why = null;
    if (!text && typeof msg.audio === 'string' && msg.audio) {
      const r = await writeDown(msg.audio, String(msg.lang || 'en-US'));
      if (r.empty) return { ok: false, error: 'Heard nothing. Try again closer to the microphone.' };
      text = r.text;
      why = r.why ?? null;
    }
    if (!text && !msg.audio) return { ok: false, error: 'An empty note.' };
    const note = { id: newId(), at: nowIso(), text: text ?? null };
    if (!text) {   // no model wrote it down here: the recording goes to GitHub, and the agent writes it down
      note.audio = `notes/${note.id}.wav`;
      const { igAudio = {} } = await chrome.storage.local.get('igAudio');
      await chrome.storage.local.set({ igAudio: { ...igAudio, [note.id]: msg.audio } });
    }
    const r = await withState((s) => {
      const p = s.ig.posts[String(msg.id)];
      if (!p) return { ok: false, error: 'No such post.' };
      p.notes = [...p.notes, note];
      p.handle = { at: nowIso(), why: 'note' };
      s.ig.rev++;
      return { ok: true, note };
    });
    if (r.ok) syncSoon(4000);
    return why ? { ...r, notice: `Kept as a recording: the agent writes it down (${why}).` } : r;
  },

  igDropNote: (msg) => onIg(async (s) => {
    const p = s.ig.posts[String(msg.id)];
    if (!p) return { ok: false, error: 'No such post.' };
    p.notes = p.notes.filter((n) => n.id !== msg.noteId);
    s.ig.rev++;
    const { igAudio = {} } = await chrome.storage.local.get('igAudio');
    if (igAudio[msg.noteId]) { delete igAudio[msg.noteId]; await chrome.storage.local.set({ igAudio }); }
    syncSoon(5000);
    return { ok: true };
  }),

  // What the agent wrote for a post (posts/<id>.json in the data repo): the transcript and the notes it read.
  igResult: async (msg) => {
    if (!(await running())) return NOT_HERE;
    if (!/^\d+$/.test(String(msg.id ?? ''))) return { ok: false, error: 'No such post.' };
    const { settings = {} } = await chrome.storage.local.get('settings');
    if (!settings.token) return { ok: false, error: 'GitHub is not connected.' };
    try {
      const f = await fetchDataFile(await dataLocation(settings), settings.token, `posts/${msg.id}.json`);
      return { ok: true, result: f.json };
    } catch (e) {
      return { ok: false, error: e.missing ? 'The agent has not written anything for this post yet.' : String(e.message ?? e) };
    }
  },
};
