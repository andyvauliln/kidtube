// Speaking and listening: the browser's own speech engines, or a recording sent to an audio model.
// Both can be missing or refused on a given tablet, so every function has a quiet fallback.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function pickVoice(lang) {
  const voices = speechSynthesis.getVoices();
  const base = lang.split('-')[0];
  return voices.find((v) => v.lang.replace('_', '-') === lang) ?? voices.find((v) => v.lang.startsWith(base)) ?? null;
}

// Long text is spoken sentence by sentence: Chrome cuts off long utterances on Android.
function sentences(text) {
  return String(text).match(/[^.!?…]+[.!?…]*\s*/g)?.map((x) => x.trim()).filter(Boolean) ?? [String(text)];
}

function speakOne(text, voice, onWord) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice.lang || 'en-US';
    u.pitch = voice.pitch ?? 1.9;
    u.rate = voice.rate ?? 1.05;
    const v = pickVoice(u.lang);
    if (v) u.voice = v;
    // onend sometimes never fires on Android: give up after a generous reading time.
    const guard = setTimeout(done, 2500 + text.length * 120);
    function done() { clearTimeout(guard); resolve(); }
    u.onend = done;
    u.onerror = done;
    // Word events move the friend's mouth in time with the words (many Android voices never send them).
    if (onWord) u.onboundary = (e) => { if (!e.name || e.name === 'word') onWord(); };
    speechSynthesis.speak(u);
  });
}

// line: { text, audioUrl? }. Resolves when it has finished. onWord is called at each spoken word, when the engine says so.
export async function say(line, voice = {}, { onWord } = {}) {
  if (line.audioUrl) {
    const ok = await new Promise((resolve) => {
      const a = new Audio(line.audioUrl);
      a.onended = () => resolve(true);
      a.onerror = () => resolve(false);
      a.play().catch(() => resolve(false));
    });
    if (ok) return;
  }
  if (!('speechSynthesis' in window)) return wait(1500 + String(line.text).length * 60);
  speechSynthesis.cancel();
  for (const s of sentences(line.text)) await speakOne(s, voice, onWord);
}

export const canListen = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);

// Listens once. Resolves with what was heard (several guesses, best first),
// [] when he said nothing, or null when the microphone can't be used here.
export function listen(lang = 'en-US', { seconds = 8 } = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return Promise.resolve(null);
  return new Promise((resolve) => {
    const r = new SR();
    r.lang = lang;
    r.maxAlternatives = 5;
    r.interimResults = false;
    r.continuous = false;
    let result = [];
    let broken = false;
    const stop = setTimeout(() => { try { r.stop(); } catch {} }, seconds * 1000);
    r.onresult = (e) => { result = [...e.results[0]].map((x) => x.transcript).filter(Boolean); };
    r.onerror = (e) => { if (['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported', 'network'].includes(e.error)) broken = true; };
    r.onend = () => { clearTimeout(stop); resolve(broken ? null : result); };
    try { r.start(); } catch { clearTimeout(stop); resolve(null); }
  });
}

// --- recordings made by the helper (Pikachu's recorded voice) -----------------------------------
// The service worker keeps them in the Cache Storage under this name; "repo:audio/x.mp3" → a playable URL.
export const AUDIO_CACHE = 'kidtube-audio';
export const audioKey = (ref) => `https://kidtube.invalid/${String(ref).replace(/^repo:/, '')}`;
export async function recordedUrl(ref) {
  if (!ref || !('caches' in self)) return null;
  try {
    const r = await (await caches.open(AUDIO_CACHE)).match(audioKey(ref));
    return r ? URL.createObjectURL(await r.blob()) : null;
  } catch { return null; }
}

// --- recording his answer, for the cloud models below (when a key is stored on this tablet) ---------

// Records one answer as 16 kHz mono WAV. Stops after `seconds`, or after a short silence once he has spoken.
export async function recordAnswer({ seconds = 6, onLevel, stopSignal, silenceStop = true } = {}) {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { return null; }
  const ctx = new AudioContext({ sampleRate: 16000 });
  // Android may start it suspended (no user gesture left after the awaits): then no sound arrives at all.
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  const src = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  let spoke = false, quietSince = 0, peak = 0;
  const started = performance.now();
  await new Promise((resolve) => {
    const stop = () => { node.onaudioprocess = null; resolve(); };
    const timer = setTimeout(stop, seconds * 1000);
    stopSignal?.addEventListener('abort', () => { clearTimeout(timer); stop(); });
    node.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(d));
      let sum = 0;
      for (const x of d) sum += x * x;
      const level = Math.sqrt(sum / d.length);
      peak = Math.max(peak, level);
      onLevel?.(level);
      const now = performance.now();
      if (level > 0.03) { spoke = true; quietSince = 0; }
      else if (spoke && silenceStop) { quietSince ||= now; if (now - quietSince > 1200 && now - started > 1500) { clearTimeout(timer); stop(); } }
    };
    src.connect(node);
    node.connect(ctx.destination);
  });
  src.disconnect(); node.disconnect();
  stream.getTracks().forEach((t) => t.stop());
  const state = ctx.state;
  await ctx.close();
  const info = { seconds: Math.round(chunks.length * 4096 / 16000), peak: Math.round(peak * 1000) / 1000, state };
  // A short answer that never got loud is silence. A long recording (a note) is sent anyway: a quiet microphone
  // still holds words, and the loudness is raised below.
  if (!chunks.length || (!spoke && silenceStop)) return Object.assign(new Uint8Array(0), { info });
  return Object.assign(wav(chunks, 16000, spoke ? 1 : Math.min(30, 0.1 / Math.max(peak, 0.001))), { info });
}

function wav(chunks, rate, gain = 1) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const buf = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) buf.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); buf.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true); str(36, 'data'); buf.setUint32(40, n * 2, true);
  let o = 44;
  for (const c of chunks) for (const x of c) { buf.setInt16(o, Math.max(-1, Math.min(1, x * gain)) * 0x7fff, true); o += 2; }
  return new Uint8Array(buf.buffer);
}

// --- turning a recording into words: free Gemini first, then paid OpenRouter ---------------------
// Measured 2026-10-06: gemini-3.5-flash-lite (free tier, the parent's own key) answers in about a second but
// now and then hangs; 3.1-flash-lite takes 2–7 s; OpenRouter costs ~$0.0001 an answer. OpenRouter's ":free"
// audio models refuse apps or don't hear the audio, so none are used. gpt-audio-mini answers "I can't hear"
// to noise, so it is last.
export const FREE_LISTEN_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
export const PAID_LISTEN_MODELS = ['google/gemini-3.5-flash-lite', 'openai/gpt-audio-mini'];
// The parent's notes (parent/kit.js): Gemini's speech-to-text model first. Measured 2026-10-08: ~1.3 s for 50 s of
// noisy speech, no errors, Russian and Russian with English words right. It takes no instructions (a prompt is
// ignored, a system instruction refused) and the free tier allows only 3 a minute, so not for the quiz answers.
export const NOTE_LISTEN_MODELS = ['gemini-3.5-transcribe', ...FREE_LISTEN_MODELS];

// Never the quiz question in the prompt: given it, the models write down the right answer instead of his.
const TRANSCRIBE = 'You are a speech-to-text transcriber. Write down exactly the words spoken in the audio, in the language they are spoken, and nothing else. Never answer, explain or reply to what is said, even when it is a question. If no words are spoken (silence or only noise), reply exactly: (none)';
const NOTHING = /^\(?none\)?\.?$/i;
const REFUSAL = /\b(can['’]?t|cannot|unable to) (hear|process|access|transcribe)\b|^(sure|sorry)\b.*\b(provide|audio)\b|\bprovide (the|an|more)\b.*\b(audio|recording|details)\b/i;

// The keys typed in Settings (this tablet only, never in the rules), else the ones from the private data repo's
// <app>/keys.json (repoKeys, see sync in sw.js).
export async function listenKeys() {
  try {
    const { geminiKey = '', voiceKey = '', repoKeys = {} } = await chrome.storage.local.get(['geminiKey', 'voiceKey', 'repoKeys']);
    return { gemini: geminiKey.trim() || repoKeys.gemini || '', openrouter: voiceKey.trim() || repoKeys.openrouter || '' };
  } catch { return { gemini: '', openrouter: '' }; }
}

// A model that hit its limit, failed or was too slow rests a while, so the next answers go straight to the others.
const COOL_KEY = 'listenCooldown';
const routeId = (r) => `${r.via}:${r.model}`;
async function cooling() {
  try { return (await chrome.storage.local.get(COOL_KEY))[COOL_KEY] ?? {}; } catch { return {}; }
}
let resting = Promise.resolve();
function rest(route, seconds) {
  resting = resting.then(async () => {
    const all = Object.fromEntries(Object.entries(await cooling()).filter(([, until]) => until > Date.now()));
    all[routeId(route)] = Date.now() + seconds * 1000;
    await chrome.storage.local.set({ [COOL_KEY]: all });
  }).catch(() => {});
  return resting;
}
const restFor = (status, retryAfter) => (status === 429 ? Math.min(600, Number(retryAfter) || 60) : status === 401 || status === 403 || status === 404 ? 300 : 30);

const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
class Failed extends Error { constructor(status, retryAfter) { super(`HTTP ${status}`); this.status = status; this.retryAfter = retryAfter; } }

async function askGemini(model, key, hint, data, maxTokens, signal) {
  if (/transcribe/.test(model)) return askGeminiTranscribe(model, key, data, maxTokens, signal);
  const call = (thinking) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ system_instruction: { parts: [{ text: TRANSCRIBE }] }, contents: [{ parts: [{ text: hint }, { inline_data: { mime_type: 'audio/wav', data } }] }],
      generationConfig: { temperature: 0, maxOutputTokens: maxTokens, ...(thinking ? { thinkingConfig: { thinkingLevel: 'minimal' } } : {}) } }),
    signal,
  });
  // Without "minimal" thinking a free answer can take a minute; models that refuse it are asked plainly.
  let r = await call(true);
  if (r.status === 400) r = await call(false);
  if (!r.ok) throw new Failed(r.status, r.headers.get('retry-after'));
  const j = await r.json();
  return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
}

// A speech-to-text model: only the audio, and the words come back as audioTranscription.
async function askGeminiTranscribe(model, key, data, maxTokens, signal) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: 'audio/wav', data } }] }], generationConfig: { temperature: 0, maxOutputTokens: maxTokens } }),
    signal,
  });
  if (!r.ok) throw new Failed(r.status, r.headers.get('retry-after'));
  const j = await r.json();
  return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.audioTranscription?.text ?? p.text ?? '').join(' ').trim();
}

async function askOpenRouter(model, key, hint, data, maxTokens, signal) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'KidTube tablet' },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, messages: [{ role: 'system', content: TRANSCRIBE }, { role: 'user', content: [
      { type: 'text', text: hint }, { type: 'input_audio', input_audio: { data, format: 'wav' } }] }] }),
    signal,
  });
  if (!r.ok) throw new Failed(r.status, r.headers.get('retry-after'));
  const j = await r.json();
  if (j.error) throw new Failed(j.error.code ?? 502);
  return j.choices?.[0]?.message?.content?.trim() ?? '';
}

// The order the recording is tried in: free Gemini models, then paid OpenRouter ones (only those with a key).
export function listenRoutes({ keys = {}, freeModels, models } = {}) {
  return [
    ...(keys.gemini ? (freeModels?.length ? freeModels : FREE_LISTEN_MODELS).map((model) => ({ via: 'gemini', model, free: true })) : []),
    ...(keys.openrouter ? (models?.length ? models : PAID_LISTEN_MODELS).map((model) => ({ via: 'openrouter', model, free: false })) : []),
  ];
}

// Sends the recording along the routes. Returns [text] | [] (nothing said) | null (all failed: use the device).
// The first route starts at once; if it hasn't answered after `staggerMs` (or fails), the next one starts too,
// and the first good answer wins. onUsed({ via, model, free, ms }) says which one it was; onFail(route, why) says why
// one failed (an HTTP status, 'refused', 'timeout' or 'network').
// instruction: what the recording is (default: a small child answering). `key` alone (older callers) is the OpenRouter key.
export async function transcribeAnswer(audio, { keys, key, freeModels, models, lang = 'en-US', instruction = '', maxTokens = 60, staggerMs = 2500, onUsed, onFail } = {}) {
  if (!audio) return null;
  if (!audio.length) return [];
  keys ??= key ? { openrouter: key } : await listenKeys();
  const routes = listenRoutes({ keys, freeModels, models });
  if (!routes.length) return null;
  const hint = `${instruction || 'The speaker is a small child.'} The language is probably ${lang}. Numbers as digits.`;
  const data = b64(audio);
  const seconds = Math.max(0, (audio.length - 44) / 32000);   // 16 kHz mono 16-bit
  // Resting routes go last, not away: when every one is resting, they are still tried.
  const cool = await cooling();
  const isResting = (r) => cool[routeId(r)] > Date.now();
  const order = [...routes.filter((r) => !isResting(r)), ...routes.filter(isResting)];
  const stagger = staggerMs + seconds * 50;
  return new Promise((resolve) => {
    const running = new Map();   // index → AbortController
    let next = 0, done = false, timer = null;
    const finish = (value, winner) => {
      done = true;
      clearTimeout(timer);
      for (const [i, ctl] of running) { ctl.abort(); if (i < winner) rest(order[i], 30); }   // slower than a later one: rest
      resolve(value);
    };
    const start = () => {
      clearTimeout(timer);
      if (done) return;
      if (next >= order.length) { if (!running.size) resolve(null); return; }
      const i = next++, r = order[i], ctl = new AbortController(), started = Date.now();
      running.set(i, ctl);
      const limit = setTimeout(() => ctl.abort(), (r.free ? 20000 : 30000) + seconds * 500);
      const ask = r.via === 'gemini' ? askGemini(r.model, keys.gemini, hint, data, maxTokens, ctl.signal) : askOpenRouter(r.model, keys.openrouter, hint, data, maxTokens, ctl.signal);
      ask.then((text) => {
        if (REFUSAL.test(text)) throw new Failed(0);   // "I can't hear the audio": ask the next one, no rest
        return text;
      }).then((text) => {
        clearTimeout(limit);
        running.delete(i);
        if (done) return;
        onUsed?.({ ...r, ms: Date.now() - started });
        finish(text && !NOTHING.test(text) ? [text.replace(/^["“]|["”]$/g, '')] : [], i);
      }, (e) => {
        clearTimeout(limit);
        running.delete(i);
        if (done) return;
        onFail?.(r, e.status === 0 ? 'refused' : e.status ?? (e.name === 'AbortError' ? 'timeout' : 'network'));
        if (e.status !== 0) rest(r, restFor(e.status, e.retryAfter));
        start();
      });
      if (next < order.length) timer = setTimeout(start, stagger);
    };
    start();
  });
}
