// OpenRouter, free models first. The list of free models is refreshed once a day and models
// that fail (busy, broken JSON, refused) rest for a while, so every call rotates to one that works.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://openrouter.ai/api/v1';
const DAY = 24 * 3600 * 1000;
// Never useful for writing text: music, safety classifiers, code-only, "agentic harness only" models.
const SKIP = /lyria|safety|guard|code|inkling|embed|whisper|tts|image/i;

export function createLLM({ apiKey, stateDir, config = {}, log = console.log, fetchImpl = fetch }) {
  const statsPath = join(stateDir, 'models.json');
  let state = existsSync(statsPath) ? JSON.parse(readFileSync(statsPath, 'utf8')) : { list: [], listAt: 0, stats: {} };
  const save = () => writeFileSync(statsPath, JSON.stringify(state, null, 2));
  let calls = 0;

  async function refreshModels() {
    if (state.list.length && Date.now() - state.listAt < DAY) return;
    const r = await fetchImpl(`${API}/models`);
    if (!r.ok) throw new Error(`OpenRouter models: HTTP ${r.status}`);
    const all = (await r.json()).data ?? [];
    state.list = all
      .filter((m) => Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0)
      .filter((m) => (m.architecture?.output_modalities ?? ['text']).includes('text') && (m.architecture?.input_modalities ?? ['text']).includes('text'))
      .filter((m) => !SKIP.test(m.id) && (m.context_length ?? 0) >= 32000)
      .map((m) => ({ id: m.id, context: m.context_length, created: m.created }));
    state.listAt = Date.now();
    save();
    log(`free models: ${state.list.map((m) => m.id).join(', ')}`);
  }

  // Preferred models first (config.llm.preferred), then the rest by success rate, then newest.
  function order(minContext) {
    const pref = config.preferred ?? [];
    const now = Date.now();
    const score = (id) => { const s = state.stats[id] ?? {}; return (s.ok ?? 0) + 1 - 2 * (s.bad ?? 0); };
    const ids = state.list.filter((m) => m.context >= minContext).map((m) => m.id);
    const ready = ids.filter((id) => !(state.stats[id]?.restUntil > now));
    ready.sort((a, b) => {
      const pa = pref.indexOf(a), pb = pref.indexOf(b);
      if (pa >= 0 || pb >= 0) return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
      return score(b) - score(a) || (state.list.find((m) => m.id === b).created - state.list.find((m) => m.id === a).created);
    });
    if (config.router !== false) ready.push('openrouter/free');
    if (config.paidModel) ready.push(config.paidModel);
    return [...new Set(ready)];
  }

  function mark(id, ok, restMinutes = 0) {
    const s = (state.stats[id] ??= { ok: 0, bad: 0 });
    if (ok) s.ok++; else s.bad++;
    if (restMinutes) s.restUntil = Date.now() + restMinutes * 60000;
    save();
  }

  async function complete(model, messages, { maxTokens, json }) {
    const r = await fetchImpl(`${API}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'KidTube helper' },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.6, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
      signal: AbortSignal.timeout(180000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.error) {
      const err = new Error(`${model}: ${body.error?.message ?? `HTTP ${r.status}`}`);
      err.status = body.error?.code ?? r.status;
      throw err;
    }
    return body.choices?.[0]?.message?.content ?? '';
  }

  // Asks for JSON and checks it. check(obj) returns an error string or null.
  async function json(task, { system, user, check = () => null, maxTokens = 4000, minContext = 32000 }) {
    await refreshModels();
    if (calls >= (config.maxCallsPerRun ?? 80)) throw new Error('too many model calls in one run');
    const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
    const tried = [];
    for (const model of order(minContext).slice(0, config.maxModelsPerCall ?? 8)) {
      for (let attempt = 0; attempt < 2; attempt++) {
        calls++;
        try {
          const text = await complete(model, messages, { maxTokens, json: attempt === 0 });
          const obj = parseJson(text);
          const problem = obj ? check(obj) : 'not JSON';
          if (!problem) { mark(model, true); log(`  ${task}: ${model}`); return obj; }
          tried.push(`${model}: ${problem}`);
          messages.push({ role: 'assistant', content: text.slice(0, 4000) }, { role: 'user', content: `That was not right: ${problem}. Reply again with only the corrected JSON.` });
        } catch (e) {
          tried.push(e.message.slice(0, 160));
          const busy = e.status === 429 || /rate|temporar|overload/i.test(e.message);
          mark(model, false, busy ? 30 : e.status === 403 || e.status === 404 ? 24 * 60 : 60);
          break; // next model
        }
      }
      messages.splice(2); // fresh conversation for the next model
    }
    throw new Error(`${task}: no model gave a usable answer (${tried.slice(-4).join(' | ')})`);
  }

  return { json, refreshModels, get calls() { return calls; }, usedModels: () => Object.entries(state.stats).filter(([, s]) => s.ok).map(([id]) => id) };
}

// Models wrap JSON in prose or ``` fences, or think out loud first; take the outermost {...}.
export function parseJson(text) {
  const t = String(text).replace(/<think>[\s\S]*?<\/think>/g, '');
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  for (const candidate of [fence?.[1], t]) {
    if (!candidate) continue;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try { return JSON.parse(candidate.slice(start, end + 1)); } catch {}
  }
  return null;
}
