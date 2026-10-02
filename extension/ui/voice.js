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
