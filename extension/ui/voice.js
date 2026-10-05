// Speaking and listening with the browser's own speech engines (no server, no key).
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

// --- listening through OpenRouter (when the parent chose it and stored a key on this tablet) ------

// Records one answer as 16 kHz mono WAV. Stops after `seconds`, or after a short silence once he has spoken.
export async function recordAnswer({ seconds = 6, onLevel, stopSignal, silenceStop = true } = {}) {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { return null; }
  const ctx = new AudioContext({ sampleRate: 16000 });
  const src = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  let spoke = false, quietSince = 0;
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
  await ctx.close();
  if (!spoke) return new Uint8Array(0);
  return wav(chunks, 16000);
}

function wav(chunks, rate) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const buf = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) buf.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); buf.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true); str(36, 'data'); buf.setUint32(40, n * 2, true);
  let o = 44;
  for (const c of chunks) for (const x of c) { buf.setInt16(o, Math.max(-1, Math.min(1, x)) * 0x7fff, true); o += 2; }
  return new Uint8Array(buf.buffer);
}

const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

// Sends the recording to the audio models in order. Returns [text] | [] (nothing said) | null (failed: use the device).
export async function transcribeAnswer(audio, { key, models = ['openai/gpt-audio-mini'], lang = 'en-US', question = '', instruction = '', maxTokens = 60 } = {}) {
  if (!audio) return null;
  if (!audio.length) return [];
  for (const model of models) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'KidTube tablet' },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, messages: [{ role: 'user', content: [
          { type: 'text', text: instruction || `A small child answers this question out loud${question ? `: "${question}"` : ''}. The language is ${lang}. Write down exactly the words the child says, nothing else. Numbers as digits. If nothing is said, reply with nothing.` },
          { type: 'input_audio', input_audio: { data: b64(audio), format: 'wav' } }] }] }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) continue;
      const text = (await r.json()).choices?.[0]?.message?.content?.trim() ?? '';
      return text ? [text.replace(/^["“]|["”]$/g, '')] : [];
    } catch {}
  }
  return null;
}
