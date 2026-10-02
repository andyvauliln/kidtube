// Transcripts from Gemini: Google's servers open the public YouTube video and the model writes down
// what is said and what is shown. Works from this server (YouTube blocks servers, not Google).
// Daily limits (videos and minutes of video) are kept in the state folder.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const PROMPT = `You are making a transcript of a children's video for a parent.
Write everything that is said, in the video's own language (do not translate), and the things a child would notice on screen.
Only what is really said and shown.`;
const SCHEMA = {
  type: 'object',
  properties: {
    language: { type: 'string', description: 'language code of the speech, e.g. en or ru' },
    transcript: { type: 'array', items: { type: 'object', properties: { t: { type: 'string', description: 'm:ss' }, text: { type: 'string' } }, required: ['t', 'text'] }, description: 'one line about every 10-20 seconds' },
    onScreen: { type: 'array', items: { type: 'object', properties: { t: { type: 'string' }, text: { type: 'string' } }, required: ['t', 'text'] } },
  },
  required: ['language', 'transcript', 'onScreen'],
};

export function createGemini({ apiKey, stateDir, config = {}, today, log = console.log, fetchImpl = fetch }) {
  const usagePath = join(stateDir, 'gemini-usage.json');
  const read = () => (existsSync(usagePath) ? JSON.parse(readFileSync(usagePath, 'utf8')) : {});
  let usage = read();
  if (usage.date !== today) usage = { date: today, videos: 0, seconds: 0 };
  const maxVideos = config.maxVideosPerDay ?? 10;
  const maxSeconds = (config.maxMinutesPerDay ?? 120) * 60;
  const models = config.models ?? ['gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.5-flash-lite'];
  let quotaGone = false;

  const left = () => ({ videos: maxVideos - usage.videos, seconds: maxSeconds - usage.seconds });
  const fits = (durationSeconds) => !quotaGone && usage.videos < maxVideos && usage.seconds + durationSeconds <= maxSeconds;

  // Returns a transcripts/<id>.json object (schemas/transcript.schema.json), or throws.
  async function transcribe(video) {
    if (!fits(video.durationSeconds)) throw new Error('over today’s Gemini limit');
    const errors = [];
    for (const model of models) {
      const r = await fetchImpl(`${API}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ file_data: { file_uri: `https://www.youtube.com/watch?v=${video.videoId}` } }, { text: PROMPT }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(300000),
      }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) {
        const msg = `${model}: ${j.error?.message ?? `HTTP ${r.status}`}`.slice(0, 200);
        errors.push(msg);
        // 429 = the free daily quota is used up: stop for today. 503/404 = busy or gone: next model.
        if (r.status === 429 && /quota|exhaust|per day/i.test(msg)) { quotaGone = true; break; }
        continue;
      }
      // The video was watched (and counts against the limit) even if the answer is unusable.
      usage.videos++;
      usage.seconds += video.durationSeconds;
      writeFileSync(usagePath, JSON.stringify(usage));
      const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      let o;
      try { o = JSON.parse(text); } catch { errors.push(`${model}: not JSON`); continue; }
      const lines = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => x?.text).map((x) => `[${String(x.t ?? '').replace(/[^\d:]/g, '') || '0:00'}] ${String(x.text).replace(/\s+/g, ' ').trim()}`).join('\n');
      const transcript = lines(o.transcript);
      log(`  transcript ${video.videoId}: ${model}, ${transcript.length} chars`);
      return {
        schemaVersion: 1, videoId: video.videoId, title: video.title ?? '', channelTitle: video.channelTitle ?? '',
        durationSeconds: video.durationSeconds ?? 0, fetchedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
        available: transcript.length > 0, lang: /^[a-z]{2}/.test(o.language ?? '') ? o.language.slice(0, 2) : null, kind: 'ai', source: 'gemini',
        text: transcript.slice(0, 60000), onScreen: lines(o.onScreen).slice(0, 20000),
      };
    }
    throw new Error(`Gemini: ${errors.join(' | ')}`);
  }

  return { transcribe, fits, left, get quotaGone() { return quotaGone; } };
}
