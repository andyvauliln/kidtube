// What a check uses to say what it expected and what it found (no chrome.* here: the tests use it as is).
// A check gets an Expect (t) and calls t.eq / t.ok / t.has; every miss becomes one mismatch line
// { what, expected, actual }. No mismatch: the check passed. The lines go into the report as they are, so
// they name the value (settings.mode, the tab's address, answer.ok), not a feeling ("the mode is wrong").

export class Expect {
  constructor() { this.mismatch = []; this.evidence = {}; this.skipped = null; }
  // expected and actual the same (compared as JSON).
  eq(what, expected, actual) {
    if (JSON.stringify(expected) !== JSON.stringify(actual)) this.mismatch.push({ what, expected: clip(expected), actual: clip(actual) });
    return this;
  }
  // cond true. expected: the words for what should be (shown when it isn't).
  ok(what, cond, actual, expected = 'true') {
    if (!cond) this.mismatch.push({ what, expected, actual: clip(actual) });
    return !!cond;
  }
  // A value that is there: not null, not undefined, not '' and not an empty list.
  has(what, actual, expected = 'a value') {
    const there = actual != null && actual !== '' && !(Array.isArray(actual) && !actual.length);
    return this.ok(what, there, actual ?? null, expected);
  }
  // Something the AI needs to see the cause, kept with the report (redacted like everything else).
  note(key, value) { this.evidence[key] = value; return this; }
  // Not checked this time, and why (no token, offline, a page that left). Not a failure.
  skip(why) { this.skipped = why; return this; }
  get passed() { return !this.mismatch.length; }
}

// Long values cut, so one report stays small.
export function clip(v, max = 300) {
  if (v === undefined) return '(nothing)';
  if (typeof v === 'string') return v.length > max ? `${v.slice(0, max)}… (${v.length} chars)` : v;
  try {
    const s = JSON.stringify(v);
    return s.length > max ? `${s.slice(0, max)}… (${s.length} chars)` : v;
  } catch { return String(v); }
}

// Never in a report: tokens, keys, the PIN, the account switcher's text (names and emails), notes and page text.
const SECRET_KEY = /token|key$|hash|salt|secret|password|switcher|cookie|authorization/i;
const PRIVATE_KEY = /^(text|comment|answers|screen|email|name|svg|src|prompt|datasyncId|why)$/i;
const SECRET_VALUE = /\b(github_pat_|ghp_|gho_|ghs_|AIza|sk-or-|sk-|gsk_)[A-Za-z0-9_-]{6,}/g;
export function redact(v, depth = 0) {
  if (depth > 6) return '(deeper)';
  if (typeof v === 'string') return clip(v.replace(SECRET_VALUE, '$1•••'), 600);
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => redact(x, depth + 1));
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (SECRET_KEY.test(k)) out[k] = x == null || x === '' ? x : '(hidden)';
    else if (PRIVATE_KEY.test(k) && typeof x === 'string') out[k] = x ? `(hidden, ${x.length} chars)` : x;
    else out[k] = redact(x, depth + 1);
  }
  return out;
}

// The keys of an answer (YouTube's JSON, GitHub's), without its values: shows a changed structure, nobody's data.
export function shapeOf(v, depth = 0) {
  if (Array.isArray(v)) return v.length ? [shapeOf(v[0], depth + 1), `×${v.length}`] : [];
  if (v && typeof v === 'object') {
    if (depth >= 4) return `{${Object.keys(v).length} keys}`;
    return Object.fromEntries(Object.keys(v).slice(0, 25).map((k) => [k, shapeOf(v[k], depth + 1)]));
  }
  return v === null ? 'null' : typeof v;
}

// An address without what identifies a person: the path, YouTube's v= and the page's #tab stay.
export function safeUrl(u) {
  try {
    const x = new URL(u);
    const v = x.searchParams.get('v'), f = x.searchParams.get('for');
    return `${x.protocol}//${x.host}${x.pathname}${v ? `?v=${v}` : f ? `?for=${f}` : ''}${x.hash.slice(0, 40)}`;
  } catch { return clip(String(u ?? ''), 200); }
}

// One problem, the same on every tablet with this version: what the server merges reports by.
export const fingerprint = (id, version, target) => `${id}|${version}|${target}`;
