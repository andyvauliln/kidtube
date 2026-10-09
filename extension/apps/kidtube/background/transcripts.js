// Transcripts: YouTube refuses them to cloud servers, so the tablet (on the home internet) fetches them
// and puts them in the data repo as transcripts/<videoId>.json. The agent writes the talking
// friend's intro, summary and questions from them.
import { parseCaptions, captionsToText } from '../lib/captions.js';
import { isVideoId } from '../../../core/lib/youtube.js';
import { nowIso } from '../../../core/lib/time.js';
import { getRepoFile, putRepoFile } from '../../../core/lib/github.js';
import { withState } from '../../../core/background/store.js';
import { effective } from './config.js';

const TRANSCRIPTS_PER_SYNC = 12;
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

async function fetchTranscript(videoId) {
  const page = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, { credentials: 'include' });
  const html = await page.text();
  const key = html.match(/"INNERTUBE_API_KEY":\s*"([A-Za-z0-9_-]+)"/)?.[1];
  if (!key) throw new Error('YouTube page without player data');
  const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', hl: 'en' } }, videoId }),
  });
  const pr = await res.json();
  const d = pr?.videoDetails ?? {};
  const file = {
    schemaVersion: 1, videoId, title: d.title ?? '', channelTitle: d.author ?? '',
    durationSeconds: Number(d.lengthSeconds) || 0, description: (d.shortDescription ?? '').slice(0, 5000),
    fetchedAt: nowIso(), available: false, lang: null, kind: null, text: '',
  };
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const en = (t) => t.languageCode?.startsWith('en');
  const track = tracks.find((t) => en(t) && t.kind !== 'asr') ?? tracks.find(en) ?? tracks.find((t) => t.kind !== 'asr') ?? tracks[0];
  if (track) {
    const xml = await (await fetch(track.baseUrl.replace('&fmt=srv3', ''), { credentials: 'include' })).text();
    const text = captionsToText(parseCaptions(xml));
    if (text) Object.assign(file, { available: true, lang: track.languageCode, kind: track.kind === 'asr' ? 'auto' : 'manual', text: text.slice(0, 60000) });
  }
  return file;
}

export async function uploadTranscripts(loc, token) {
  const { transcripts = {}, data = {}, planLog, account } = await chrome.storage.local.get(['transcripts', 'data', 'planLog', 'account']);
  const { queue } = await effective({ data, planLog });
  // Today's videos first, then the planned ones (`upcoming`) so the helper can prepare them.
  const ids = [...new Set([...queue.videos, ...(queue.upcoming ?? [])].map((v) => v.videoId))];
  const due = ids.filter(isVideoId).filter((id) => {
    const t = transcripts[id];
    return !t || (t.status === 'error' && Date.now() - t.at > RETRY_AFTER_MS);
  }).slice(0, TRANSCRIPTS_PER_SYNC);
  const done = {};
  for (const id of due) {
    const path = `transcripts/${id}.json`;
    try {
      if (await getRepoFile(loc, token, path)) { done[id] = { status: 'uploaded', at: Date.now() }; continue; }
      const file = await fetchTranscript(id);
      await putRepoFile(loc, token, path, file, null, `transcript ${id}`);
      done[id] = { status: 'uploaded', at: Date.now(), available: file.available };
    } catch (e) {
      done[id] = { status: 'error', at: Date.now(), error: String(e.message ?? e).slice(0, 200) };
    }
  }
  if (due.length) await withState((s) => { s.transcripts = { ...(s.transcripts ?? {}), ...done }; }, { account: account?.key ?? null });
  const failed = Object.values(done).filter((d) => d.status === 'error');
  if (failed.length) throw new Error(`${failed.length} of ${due.length} could not be fetched (${failed[0].error}); will retry tomorrow.`);
}
