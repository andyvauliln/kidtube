// Recorded notes the tablet could not write down: every speech service refused it (Google and Groq refuse some
// countries; the server can reach them). The parent screens save the note with a stand-in text and the recording
// (parent/kit.js writeDown); here, at each sync, the recording goes to the profile's folder as voice/<id>.wav, the
// server writes it down with Whisper (agent/notes.mjs voice, within a minute) into voice/<id>.json, and the note gets
// its words. The note's ev.voice.state (background/parent.js):
//   upload   the recording waits on this tablet (storage voice:<id>)
//   server   it is on GitHub; the server writes it down
//   failed   the server could not either (ev.voice.error): the parent types the note (Edit) or deletes it
// Until it has words the note is not sent (releaseNotes), and the core syncs every minute (the part's waiting()).
import { contentsUrl, ghHeaders, getRepoFile, explainHttp } from '../../../core/lib/github.js';
import { withState } from '../../../core/background/store.js';
import { setWords } from './parent.js';

const KEY = (id) => `voice:${id}`;
const LATE_MS = 30 * 60000;   // on GitHub this long with no words: the server is off or broken

export const voicePending = (s) => (s.outbox ?? []).some((e) => e.held && e.voice && e.voice.state !== 'failed');

// The recording, from the parent screens (handlers.js): kept until it is on GitHub.
export async function keepRecording(id, audio) {
  await chrome.storage.local.set({ [KEY(id)]: audio });
}

// A new file with base64 content. A file already there (the same recording, a write cut off before) is fine.
async function putNew(loc, token, path, content, message) {
  const r = await fetch(contentsUrl(loc, path), {
    method: 'PUT',
    headers: { ...ghHeaders(token, 'application/vnd.github+json'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content }),
  });
  if (r.ok) return;
  if (r.status === 422) {
    const there = await fetch(contentsUrl(loc, path), { method: 'HEAD', headers: ghHeaders(token, 'application/vnd.github+json'), cache: 'no-store' });
    if (there.ok) return;
  }
  throw new Error(await explainHttp(r.status, loc, token, path));
}

function mark(s, id, change) {
  const ev = s.outbox.find((e) => e.voice?.id === id);
  if (!ev) return null;
  if (change.words) return setWords(s, ev, change.words);
  Object.assign(ev.voice, change);
  return ev;
}

export async function syncVoice(loc, token, acct) {
  const notes = await withState((s) => (s.outbox ?? []).filter((e) => e.held && e.voice && e.voice.state !== 'failed').map((e) => ({ ...e.voice })), { account: acct });
  if (!notes) return;
  for (const v of notes) {
    if (v.state === 'upload') {
      const audio = (await chrome.storage.local.get(KEY(v.id)))[KEY(v.id)];
      if (!audio) { await withState((s) => mark(s, v.id, { state: 'failed', error: 'The recording is no longer on this tablet.' }), { account: acct }); continue; }
      await putNew(loc, token, `voice/${v.id}.wav`, audio, `tablet: a recorded note to write down (${v.seconds} s)`);
      await withState((s) => mark(s, v.id, { state: 'server', sentAt: new Date().toISOString() }), { account: acct });
      await chrome.storage.local.remove(KEY(v.id));
    } else if (v.state === 'server') {
      const f = await getRepoFile(loc, token, `voice/${v.id}.json`);
      const words = typeof f?.json?.text === 'string' ? f.json.text.trim().slice(0, 2000) : '';
      if (words) await withState((s) => mark(s, v.id, { words }), { account: acct });
      else if (f) await withState((s) => mark(s, v.id, { state: 'failed', error: f.json.error || 'The server heard no words in it.' }), { account: acct });
      else if (v.sentAt && Date.now() - Date.parse(v.sentAt) > LATE_MS) {
        await withState((s) => mark(s, v.id, { state: 'failed', error: 'The server did not write it down in 30 minutes (it may be off).' }), { account: acct });
      }
    }
  }
}

// A recorded note deleted before its recording went up: the recording goes too.
export const dropRecording = (id) => chrome.storage.local.remove(KEY(id));
