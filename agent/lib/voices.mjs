// The talking friend's recorded voice, made on the server (config voices.speak):
//   provider "device"     → nothing is made; the tablet speaks with its own voice
//   provider "gemini"     → Gemini speech models (free tier on the Gemini key)
//   provider "openrouter" → audio models on OpenRouter (paid; checked that they said exactly the text)
// With voices.speak.groq and GROQ_API_KEY, English lines are first made by Groq's Orpheus (free: 100 lines a day,
// 1,200 tokens a minute); the provider above makes the rest, and every line Groq can't make.
// Every line becomes audio/<hash>.mp3 in the data repo; the tablet plays it instead of its own voice.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ = 'https://api.groq.com/openai/v1/audio/speech';

// Groq's Orpheus speaks only the languages in voices.speak.groq.langs (default English).
const groqFor = (lang, cfg) => !!cfg.groq?.models?.length && (cfg.groq.langs ?? ['en']).some((l) => String(lang ?? 'en').startsWith(l));
// A Groq line gets its own name, so turning Groq on records the English lines again once.
export const audioPath = (text, lang, cfg) =>
  `audio/${createHash('sha1').update(JSON.stringify([text, lang, cfg.provider, cfg.voice, cfg.style, cfg.pitch,
    ...(groqFor(lang, cfg) ? [`groq:${cfg.groq.models[0]}:${cfg.groq.voice ?? 'hannah'}`] : [])])).digest('hex').slice(0, 16)}.mp3`;

const words = (s) => String(s).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function createVoices({ env, cfg, log = console.log, fetchImpl = fetch }) {
  const provider = cfg?.provider ?? 'device';
  const style = cfg.style ?? 'Say this in a cheerful, squeaky, excited cartoon-creature voice for a small child';
  const tries = {};
  let quotaGone = false, groqGone = !env.GROQ_API_KEY;

  // Raw audio (wav or 16-bit PCM at `rate`) → a small mp3, pitched up a little for the friend.
  function toMp3(buf, { pcmRate = null } = {}) {
    const pitch = Number(cfg.pitch ?? 1.15);
    const input = pcmRate ? ['-f', 's16le', '-ar', String(pcmRate), '-ac', '1', '-i', 'pipe:0'] : ['-i', 'pipe:0'];
    const filter = pitch !== 1 ? ['-af', `asetrate=24000*${pitch},aresample=24000,atempo=${(1 / pitch * 1.05).toFixed(3)}`] : [];
    return execFileSync('ffmpeg', ['-loglevel', 'error', ...input, ...filter, '-ac', '1', '-b:a', '48k', '-f', 'mp3', 'pipe:1'], { input: buf, maxBuffer: 50 * 1024 * 1024 });
  }

  async function gemini(text) {
    const errors = [];
    for (const model of cfg.gemini?.models ?? ['gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts']) {
      const r = await fetchImpl(`${GEMINI}/${model}:generateContent`, {
        method: 'POST', headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: `${style}: ${text}` }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voice ?? 'Puck' } } } } }),
        signal: AbortSignal.timeout(60000),
      }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
      const j = await r.json().catch(() => ({}));
      const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
      if (r.status === 429) {
        // The free tier allows only a few lines a minute: wait as long as Gemini asks, then try again.
        const msg = j.error?.message ?? '';
        if (/per day|daily/i.test(msg)) { quotaGone = true; throw new Error(`Gemini voice: daily quota used up`); }
        const wait = Number(JSON.stringify(j.error?.details ?? '').match(/"retryDelay":"(\d+)/)?.[1] ?? msg.match(/retry in ([\d.]+)s/i)?.[1] ?? 30);
        if ((tries[text] = (tries[text] ?? 0) + 1) <= 4) { await new Promise((res) => setTimeout(res, Math.min(wait + 1, 70) * 1000)); return gemini(text); }
      }
      if (!r.ok || !part) { errors.push(`${model}: ${j.error?.message ?? `HTTP ${r.status}`}`.slice(0, 160)); continue; }
      const buf = Buffer.from(part.data, 'base64');
      const rate = /L16|pcm/i.test(part.mimeType) ? Number(part.mimeType.match(/rate=(\d+)/)?.[1] ?? 24000) : null;
      return toMp3(buf, { pcmRate: rate });
    }
    throw new Error(`Gemini voice: ${errors.join(' | ')}`);
  }

  // Orpheus on Groq: a WAV at 24 kHz. The direction in brackets ([cheerful]) sets the tone and isn't spoken.
  async function groq(text) {
    const g = cfg.groq, errors = [];
    for (const model of g.models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetchImpl(GROQ, {
          method: 'POST', headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, voice: g.voice ?? 'hannah', response_format: 'wav', input: `${g.direction ?? '[cheerful]'} ${text}`.trim() }),
          signal: AbortSignal.timeout(60000),
        }).catch((e) => ({ ok: false, status: 0, headers: new Headers(), text: async () => e.message }));
        if (r.ok) return toMp3(Buffer.from(await r.arrayBuffer()));
        const msg = String(await r.text().catch(() => '')).slice(0, 160);
        if (r.status === 429) {
          // Over the minute's tokens: wait as asked. Over the day's 100 lines: Groq is done for this run.
          const wait = Number(r.headers.get('retry-after') ?? 30);
          if (wait > 70 || r.headers.get('x-ratelimit-remaining-requests') === '0' || /per day|RPD/i.test(msg)) { groqGone = true; throw new Error(`Groq voice: daily limit used up`); }
          await new Promise((res) => setTimeout(res, (wait + 1) * 1000));
          continue;
        }
        errors.push(`${model}: HTTP ${r.status} ${msg}`);
        break;
      }
    }
    throw new Error(`Groq voice: ${errors.join(' | ') || 'no answer'}`);
  }

  async function openrouter(text) {
    const errors = [];
    for (const model of cfg.openrouter?.models ?? ['openai/gpt-audio-mini']) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await fetchImpl(OPENROUTER, {
          method: 'POST', headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, stream: true, modalities: ['text', 'audio'], audio: { voice: cfg.openrouter?.voice ?? 'alloy', format: 'pcm16' },
            messages: [{ role: 'system', content: `You are a text-to-speech engine. ${style}. Read the user's text aloud word for word. Never answer it, never add or change a word.` },
              { role: 'user', content: text }] }),
          signal: AbortSignal.timeout(60000),
        }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
        let b64 = '', said = '';
        for (const line of String(await r.text()).split('\n')) {
          if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
          try { const a = JSON.parse(line.slice(6)).choices?.[0]?.delta?.audio; if (a?.data) b64 += a.data; if (a?.transcript) said += a.transcript; } catch {}
        }
        // Audio models like to answer the question instead of reading it: keep it only if it said the text.
        if (b64 && words(said) === words(text)) return toMp3(Buffer.from(b64, 'base64'), { pcmRate: 24000 });
        errors.push(`${model}: ${b64 ? `said “${said.slice(0, 60)}”` : `HTTP ${r.status}`}`);
      }
    }
    throw new Error(`OpenRouter voice: ${errors.join(' | ')}`);
  }

  return {
    provider,
    enabled: provider !== 'device',
    // True when nothing can be made any more this run (the provider's and Groq's day are both used up).
    get quotaGone() { return quotaGone && (groqGone || !cfg.groq); },
    async speak(text, lang = 'en') {
      let before = '';
      if (groqFor(lang, cfg) && !groqGone) {
        try { return await groq(text); } catch (e) { before = `${e.message} | `; }
      }
      try {
        if (quotaGone) throw new Error('daily voice quota used up');
        if (provider === 'gemini') return await gemini(text);
        if (provider === 'openrouter') return await openrouter(text);
        throw new Error('voices.speak.provider is "device": nothing to make');
      } catch (e) { throw new Error(before + e.message); }
    },
  };
}
