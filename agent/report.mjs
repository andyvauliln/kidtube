#!/usr/bin/env node
// A report of one AI run for the parent (the tablet's 🔔 → Details): what it got, what it did step by step (its words
// between the steps, each tool call with a short output), what it changed (commits, files, the release, the tests),
// and what the parent should know or check ("For you"). No AI here: it reads the run's stream-json recording
// (claude -p --output-format stream-json --verbose) and the agent's checkout. Secrets are cut out; long text is cut.
//   node agent/report.mjs build --kind notes|fix|helper --stream FILE --out FILE [--input FILE] [--result FILE]
//        [--app DIR] [--id ID] [--profile P] [--note TEXT] [--server FILE]
//   node agent/report.mjs result STREAM > FILE     the stream's last line ({"type":"result"}): the old --output-format json
//   node agent/report.mjs prune DIR                keeps the newest KEEP reports in DIR
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };
export const KEEP = 60;
const STEPS = 400;

// Tokens and keys the agents may print (GitHub, Groq, Gemini, OpenRouter, Anthropic, a PEM key), and auth headers.
const SECRET = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g, /gsk_[A-Za-z0-9]{20,}/g, /AIza[0-9A-Za-z_-]{30,}/g,
  /sk-(?:or-v1-|ant-[a-z0-9]+-)?[A-Za-z0-9_-]{20,}/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(authorization|x-api-key|bearer|token)(["':=\s]+)(?:(?:token|bearer|basic)\s+)?[A-Za-z0-9_.=+/-]{12,}/gi, /(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g,
];
export function redact(s) {
  let out = String(s ?? '');
  for (const re of SECRET) out = out.replace(re, (m, a, b) => (/^(authorization|x-api-key|bearer|token)$/i.test(a ?? '') ? `${a}${b}***` : a?.startsWith?.('http') ? `${a}***@` : '***'));
  return out;
}
const cut = (s, n) => { const t = redact(s).replace(/\s+\n/g, '\n').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// A tool's result as text (a string, or blocks of text and images).
function textOf(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (b?.type === 'text' ? b.text : b?.type === 'image' ? '[a picture]' : '')).join('\n');
  return c == null ? '' : JSON.stringify(c);
}

// Paths in the agent's checkout, relative to it.
const short = (p, app) => { const s = String(p ?? ''); return app && isAbsolute(s) && s.startsWith(app) ? relative(app, s) || '.' : s; };

// One tool call as a step the parent can read: its kind (an icon on the tablet), what it did, and on what.
export function stepOf(name, input = {}, app = '') {
  const i = input ?? {};
  if (name === 'Read') return { kind: 'read', what: `Read ${short(i.file_path, app)}` };
  if (name === 'Edit' || name === 'MultiEdit') return { kind: 'edit', what: `Changed ${short(i.file_path, app)}`, detail: i.old_string != null ? `- ${cut(i.old_string, 200)}\n+ ${cut(i.new_string, 200)}` : '' };
  if (name === 'Write') return { kind: 'edit', what: `Wrote ${short(i.file_path, app)}`, detail: cut(i.content, 200) };
  if (name === 'Grep') return { kind: 'search', what: `Searched for “${cut(i.pattern, 80)}”${i.path ? ` in ${short(i.path, app)}` : ''}` };
  if (name === 'Glob') return { kind: 'search', what: `Looked for files ${cut(i.pattern, 80)}` };
  if (name === 'Bash') {
    const cmd = String(i.command ?? '');
    const kind = /\bnpm (run )?test\b|node --test/.test(cmd) ? 'test' : /\bnpm run ship\b|build\/ship\.mjs/.test(cmd) ? 'release' : /\bgit (commit|push)\b/.test(cmd) ? 'commit' : 'run';
    return { kind, what: cut(i.description || cmd.split('\n')[0], 140), detail: cut(cmd, 400) };
  }
  if (name === 'Agent' || name === 'Task') return { kind: 'agent', what: `Asked a helper agent: ${cut(i.description || i.prompt, 120)}`, detail: cut(i.prompt, 400) };
  if (name === 'Skill') return { kind: 'skill', what: `Used the skill ${cut(i.skill ?? i.name, 60)}` };
  if (name === 'TodoWrite') return { kind: 'plan', what: 'Made its to-do list', detail: (i.todos ?? []).map((t) => `${t.status === 'completed' ? '✓' : '·'} ${t.content}`).join('\n').slice(0, 600) };
  if (name.startsWith('mcp__device__')) return { kind: 'device', what: `On your tablet: ${name.slice(13).replace(/^device_/, '')}`, detail: cut(JSON.stringify(i), 300) };
  if (name.startsWith('mcp__lab__')) return { kind: 'lab', what: `In the lab browser: ${name.slice(10).replace(/^browser_/, '')}`, detail: cut(JSON.stringify(i), 300) };
  return { kind: 'other', what: name, detail: cut(JSON.stringify(i), 300) };
}

// The stream's events → { init, result, steps }. The helper agents' own steps (parent_tool_use_id) are counted, not listed.
export function readStream(lines, app = '') {
  const steps = [], byId = new Map();
  let init = null, result = null, sub = 0, at = null;
  for (const line of lines) {
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.timestamp) at = j.timestamp;
    if (j.type === 'system' && j.subtype === 'init') init = j;
    else if (j.type === 'result') result = j;
    else if (j.parent_tool_use_id) { if (j.type === 'assistant') sub++; }
    else if (j.type === 'assistant') {
      for (const b of j.message?.content ?? []) {
        if (b.type === 'text' && b.text?.trim()) steps.push({ kind: 'say', what: cut(b.text, 1200), at });
        else if (b.type === 'thinking' && b.thinking?.trim()) steps.push({ kind: 'think', what: cut(b.thinking, 800), at });
        else if (b.type === 'tool_use') {
          const s = { ...stepOf(b.name, b.input, app), tool: b.name, at };
          if (!s.detail) delete s.detail;
          byId.set(b.id, s);
          steps.push(s);
        }
      }
    } else if (j.type === 'user') {
      for (const b of j.message?.content ?? []) {
        const s = b.type === 'tool_result' ? byId.get(b.tool_use_id) : null;
        if (!s) continue;
        const out = textOf(b.content);
        // A read: its size; a change: only when it failed; else the output's start (tests and releases: more of it).
        if (s.kind === 'read') s.out = `${out.split('\n').length} lines`;
        else if (s.kind !== 'edit' || b.is_error) s.out = cut(out, s.kind === 'test' || s.kind === 'release' ? 900 : 500);
        if (b.is_error) s.failed = true;
        s.raw = out;   // for the facts below; dropped before saving
      }
    }
  }
  return { init, result, steps, sub };
}

// What the steps' outputs say: the commits it made, the version it released, the tests' last numbers.
export function factsOf(steps) {
  const commits = [], seen = new Set();
  let released = null, tests = null;
  for (const s of steps) {
    const out = s.raw ?? '';
    for (const m of out.matchAll(/^\[(?:main|[\w./-]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/gm)) if (!seen.has(m[1])) { seen.add(m[1]); commits.push({ sha: m[1], subject: cut(m[2], 160) }); }
    const r = [...out.matchAll(/ship: released (\d+\.\d+\.\d+)/g)].at(-1);
    if (r) released = r[1];
    const pass = [...out.matchAll(/^# pass (\d+)/gm)].at(-1), fail = [...out.matchAll(/^# fail (\d+)/gm)].at(-1);
    if (pass && fail) tests = { pass: Number(pass[1]), fail: Number(fail[1]) };
  }
  return { commits, released, tests };
}

// The files of those commits (git show --numstat in the agent's checkout).
function filesOf(app, commits) {
  const files = new Map();
  for (const c of commits) {
    let out = '';
    try { out = execFileSync('git', ['-C', app, 'show', '--numstat', '--format=', c.sha], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { continue; }
    for (const line of out.trim().split('\n').filter(Boolean)) {
      const [add, del, path] = line.split('\t');
      const f = files.get(path) ?? { path, add: 0, del: 0 };
      f.add += Number(add) || 0; f.del += Number(del) || 0;
      files.set(path, f);
    }
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

const KIND = { notes: 'Run on your notes', fix: 'Fix run (problems the checks found)', helper: 'Helper run (new lists)' };

// The parent's short list: what happened that needs them, and what to check.
export function forYou({ kind, result, facts, files, steps, input, out, note, server }) {
  const say = [];
  const stopped = result?.is_error || !result;
  if (!result) say.push({ tone: 'bad', text: 'The run ended without a result: the server stopped it or it crashed. The server log has more.' });
  else if (result.is_error) say.push({ tone: 'bad', text: `The run stopped before its end: ${cut(result.result || result.subtype, 200)}` });
  if (facts.released) say.push({ tone: 'do', text: `New version ${facts.released}: update the tablet (tap the new version next to the logo), then check what changed.` });
  if (note) say.push({ tone: 'bad', text: cut(note, 300) });
  const code = files.filter((f) => f.path.startsWith('extension/'));
  if (code.length && !facts.released) say.push({ tone: 'bad', text: `It changed ${code.length} file(s) of the app but released no version.` });
  const helper = files.filter((f) => /^agent\/|^\.claude\//.test(f.path));
  if (helper.length) say.push({ tone: 'info', text: `It changed how the helper works: ${helper.map((f) => f.path).slice(0, 6).join(', ')}.` });
  if (facts.tests?.fail) say.push({ tone: 'bad', text: `The last test run had ${facts.tests.fail} failure(s).` });
  const device = steps.filter((s) => s.kind === 'device').length;
  if (device) say.push({ tone: 'info', text: `It used your tablet ${device} time(s) (dev mode).` });
  const denied = result?.permission_denials ?? [];
  if (denied.length) say.push({ tone: 'info', text: `${denied.length} tool call(s) were not allowed: ${[...new Set(denied.map((d) => d.tool_name))].join(', ')}.` });
  const failed = steps.filter((s) => s.failed).length;
  if (failed) say.push({ tone: 'info', text: `${failed} step(s) failed on the way (see the red steps).` });
  if (kind === 'notes' && out && !stopped) {
    if (!out.summary) say.push({ tone: 'bad', text: 'It wrote no summary, so your notes stay on the tablet as not done.' });
    if (out.runHelper) say.push({ tone: 'info', text: 'It asked for a helper run: the lists change after it.' });
    const asked = (input ?? []).filter((n) => n.ask).length;
    const answered = (out.answers ?? []).length;
    if (asked > answered) say.push({ tone: 'bad', text: `${asked - answered} question(s) got no answer.` });
  }
  if (kind === 'fix' && out) {
    for (const f of out.fixes ?? []) if (f.state === 'needs-you') say.push({ tone: 'do', text: `Needs you: ${cut(f.message, 240)}` });
  }
  if (kind === 'fix' && !out && !stopped) say.push({ tone: 'bad', text: 'It wrote no answers: the problems are tried again after 2 hours.' });
  const runs = server?.runs?.[kind];
  if (runs) say.push({ tone: 'info', text: `${KIND[kind]}s today: ${runs.used} of ${runs.perDay} (Settings → AI on the server).` });
  if (!say.some((x) => x.tone !== 'info')) say.unshift({ tone: 'ok', text: 'Nothing needs you. Read “What it said” to check that it understood you.' });
  return say;
}

// What the run got: the notes (text, where), or the problems (what, where, how often).
function inputOf(kind, input) {
  if (!Array.isArray(input)) return [];
  if (kind === 'fix') return input.slice(0, 20).map((p) => ({ title: cut(p.title ?? p.check, 200), detail: cut([p.expect && `Expected: ${p.expect}`, p.saw && `Saw: ${p.saw}`].filter(Boolean).join(' · '), 400), more: `${p.check ?? ''} · ×${p.count ?? 1} · ${(p.versions ?? []).join(', ')}` }));
  return input.slice(0, 30).map((n) => ({ title: cut(n.text, 1500), detail: cut(n.where ?? '', 200), more: n.ask ? 'a question' : '' }));
}

export function buildReport({ kind, lines, input = null, out = null, app = '', id, profile = null, note = null, server = null, now = new Date().toISOString() }) {
  const { init, result, steps, sub } = readStream(lines, app);
  const facts = factsOf(steps);
  const files = app ? filesOf(app, facts.commits) : [];
  const summary = kind === 'fix' ? (out?.fixes ?? []).map((f) => `${f.key}: ${f.state}${f.version ? ` (${f.version})` : ''}. ${f.message ?? ''}`).join('\n') : out?.summary ?? '';
  const report = {
    schemaVersion: 1, id, kind, title: KIND[kind] ?? kind, profile, at: now,
    ok: !!result && !result.is_error,
    stopped: result?.is_error ? cut(result.result || result.subtype, 300) : result ? null : 'no result',
    model: init?.model ?? Object.keys(result?.modelUsage ?? {})[0] ?? null,
    minutes: result?.duration_ms ? Math.round(result.duration_ms / 6000) / 10 : null,
    turns: result?.num_turns ?? null,
    costUsd: typeof result?.total_cost_usd === 'number' ? Math.round(result.total_cost_usd * 100) / 100 : null,
    helpers: sub,
    forYou: forYou({ kind, result, facts, files, steps, input, out, note, server }),
    input: inputOf(kind, input),
    said: cut(summary || result?.result || '', 3000),
    answers: (out?.answers ?? []).slice(0, 20).map((a) => ({ eventId: a.eventId, answer: cut(a.answer, 1500) })),
    released: facts.released, tests: facts.tests, commits: facts.commits.slice(0, 20), files: files.slice(0, 60),
    steps: steps.slice(0, STEPS).map(({ raw, tool, ...s }) => s),
    more: steps.length > STEPS ? steps.length - STEPS : 0,
  };
  return report;
}

// The newest KEEP reports (and recordings) of a folder stay; the names start with their time, so they sort.
export function prune(dir, keep = KEEP) {
  for (const ext of ['.json', '.jsonl']) {
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).sort((a, b) => a.replace(/^\D+/, '').localeCompare(b.replace(/^\D+/, ''))) : [];
    for (const f of files.slice(0, Math.max(0, files.length - keep))) unlinkSync(join(dir, f));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries(
    ['kind', 'stream', 'out', 'input', 'result', 'app', 'id', 'profile', 'note', 'server'].map((k) => [k, { type: 'string' }])) });
  const [cmd, arg] = positionals;
  const linesOf = (f) => { try { return readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
  if (cmd === 'result') {
    const last = linesOf(arg).reverse().find((l) => { try { return JSON.parse(l).type === 'result'; } catch { return false; } });
    process.stdout.write(last ? `${last}\n` : '{}\n');
  } else if (cmd === 'prune') {
    prune(arg);
  } else if (cmd === 'build') {
    const report = buildReport({ kind: values.kind, lines: linesOf(values.stream), input: values.input ? readJson(values.input, null) : null,
      out: values.result ? readJson(values.result, null) : null, app: values.app ?? '', id: values.id ?? new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15),
      profile: values.profile || null, note: values.note || null, server: values.server ? readJson(values.server, null) : null });
    mkdirSync(dirname(values.out), { recursive: true });
    writeFileSync(values.out, JSON.stringify(report, null, 1) + '\n');
    console.log(`report ${values.out}: ${report.steps.length} steps, ${report.commits.length} commits${report.released ? `, released ${report.released}` : ''}`);
  } else { console.error('usage: report.mjs build … | result STREAM | prune DIR'); process.exit(2); }
}
