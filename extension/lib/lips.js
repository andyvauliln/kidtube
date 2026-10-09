// Mouth shapes for the friend's recordings (the mesh avatar): Groq's Whisper says when each word of a recording
// starts and ends, and each word becomes its vowels: a track [[seconds, shape], ...]. Shapes: a i u e o, n = closed.
// Used by the helper on the server (agent/lib/lips.mjs) and by the tablet for the lines it records itself.

const WHISPER = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const LIPS_MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3'];

const RU = { а: 'a', я: 'a', о: 'o', ё: 'o', у: 'u', ю: 'u', ы: 'i', и: 'i', е: 'e', э: 'e' };
// English spelling → the nearest of the five shapes (rough on purpose: the mouth only needs open, wide or round).
const EN_PAIRS = { ee: 'i', ea: 'i', ie: 'i', ey: 'i', oo: 'u', ew: 'u', ue: 'u', ui: 'u', oa: 'o', ow: 'o', oe: 'o',
  ai: 'e', ay: 'e', ei: 'e', au: 'o', aw: 'o', oi: 'o', oy: 'o', ou: 'a' };
const EN_ONE = { a: 'a', e: 'e', i: 'i', o: 'o', u: 'a', y: 'i' };
// Short words the spelling rules get wrong.
const EN_WORDS = { you: 'u', to: 'u', do: 'u', two: 'u', who: 'u', too: 'u', one: 'a', once: 'a', are: 'a', have: 'a', love: 'a',
  some: 'a', come: 'a', done: 'a', give: 'i', live: 'i', the: 'a', what: 'a', was: 'a' };
const LABIAL = /[mbpмбп]$/;          // the lips close before the vowel

// "Spider" → [{ v: 'a' }, { v: 'e' }]; close: the lips shut first (m, b, p).
export function vowelsOf(word) {
  let w = String(word).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
  if (/^\d+$/.test(w)) return [...w].map(() => ({ v: 'e' }));       // a number: about one syllable a digit
  if (EN_WORDS[w]) return [{ v: EN_WORDS[w], close: /^[mbp]/.test(w) }];
  const out = [];
  if (/[а-яё]/.test(w)) {
    let before = '';
    for (const c of w) { if (RU[c]) out.push({ v: RU[c], close: LABIAL.test(before) }); before = RU[c] ? '' : before + c; }
    return out;
  }
  if (w.length > 2 && /[^aeiouy]e$/.test(w) && /[aeiouy]/.test(w.slice(0, -1))) w = w.slice(0, -1);   // silent e: "make"
  let before = '';
  for (let i = 0; i < w.length;) {
    const pair = EN_PAIRS[w.slice(i, i + 2)];
    const one = EN_ONE[w[i]] && !(w[i] === 'y' && (i === 0 || /[aeiou]/.test(w[i + 1] ?? ''))) ? EN_ONE[w[i]] : null;
    if (pair || one) {
      if (out.length && !before) { i += pair ? 2 : 1; continue; }    // "beautiful": vowels in a row are one syllable
      out.push({ v: pair ?? one, close: LABIAL.test(before) });
      i += pair ? 2 : 1;
      before = '';
    } else { before += w[i]; i++; }
  }
  return out;
}

const r2 = (t) => Math.round(t * 100) / 100;

// Words with times (Whisper) → [[seconds, shape], ...]: each word's time is shared by its vowels; between words
// with a pause the mouth closes.
export function lipTrack(words) {
  const track = [];
  const put = (t, s) => { if (track.at(-1)?.[1] !== s) track.push([r2(t), s]); };
  let lastEnd = null;
  for (const { word, start, end } of words ?? []) {
    const vs = vowelsOf(word);
    if (!vs.length || !(end > start)) continue;
    if (lastEnd !== null && start - lastEnd > 0.08) put(lastEnd, 'n');
    const step = (end - start) / vs.length;
    vs.forEach((x, k) => {
      const t = start + k * step;
      if (x.close) { put(t, 'n'); put(t + Math.min(0.07, step * 0.3), x.v); } else put(t, x.v);
    });
    lastEnd = end;
  }
  if (lastEnd !== null) put(lastEnd, 'n');
  return track;
}

// The words of one recording with their times (Groq's OpenAI-style transcription API).
export async function whisperWords(audio, { key, lang, models = LIPS_MODELS, fetchImpl = fetch, type = 'audio/mpeg' }) {
  const errors = [];
  for (const model of models) {
    const form = new FormData();
    form.append('file', audio instanceof Blob ? audio : new Blob([audio], { type }), type === 'audio/wav' ? 'line.wav' : 'line.mp3');
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    if (lang) form.append('language', String(lang).slice(0, 2));
    const r = await fetchImpl(WHISPER, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(60000) })
      .catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    if (r.ok) {
      const j = await r.json();
      return (j.words ?? []).map((w) => ({ word: w.word, start: Number(w.start), end: Number(w.end) }));
    }
    const msg = String(await r.text().catch(() => '')).slice(0, 160);
    if (r.status === 429) { const e = new Error(`Groq Whisper: limit reached (${msg})`); e.limit = true; throw e; }
    errors.push(`${model}: HTTP ${r.status} ${msg}`);
  }
  throw new Error(`Groq Whisper: ${errors.join(' | ')}`);
}

// The shape at `t` seconds (track sorted by time); `from` is where the last lookup ended, so playback is O(1).
export function shapeAt(track, t, from = 0) {
  let i = Math.min(from, Math.max(0, track.length - 1));
  if (i && track[i][0] > t) i = 0;
  while (i + 1 < track.length && track[i + 1][0] <= t) i++;
  return { shape: track.length && track[0][0] <= t ? track[i][1] : 'n', index: i };
}
