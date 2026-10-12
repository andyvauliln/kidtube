#!/usr/bin/env node
// The tablets' problem reports (their checks, extension/core/checks/) that the fix agent has not worked on yet.
// No AI here: agent/poll.sh asks every minute and starts the fix agent (agent/FIX.md) only when there are some.
//   node agent/problems.mjs new    --data DIR --state DIR              → JSON array of problems to work on, one per check
//   node agent/problems.mjs mark   FILE --state DIR [--result RESULT]  → the problems in FILE (the array from `new`) are handled
//                                                                         (with RESULT: only those the agent answered)
//   node agent/problems.mjs record RESULT --data DIR                   → the fix agent's answers go into fixes.json (the tablets read it)
// The reports are in the data repo's problems/<day>.json (every tablet and profile). One problem is one check on one
// browser (Quetta or Orion): the same check from several tablets or versions is merged.
// Not worked on again: a report already handled (a higher count of it later is the same problem: tablets up to 0.11.1
// send their repeats again); a check fixed (or found not a bug) in a newer version than the report's, or with no new
// version, before the fix; a check the agent could not reproduce or left for the parent, for 24 hours; any check, for
// 2 hours after a run. A problem the agent gave no answer for (it stopped, a usage limit) is tried again after those
// 2 hours, at most 3 times.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };
const cmp = (a, b) => {
  const x = String(a ?? '0').split('.').map(Number), y = String(b ?? '0').split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
const HOUR = 3600000, TRIES = 3;
export const keyOf = (r) => `${r.check}|${r.context?.app?.target ?? r.fingerprint?.split('|')[2] ?? '?'}`;
const versionOf = (r) => r.context?.app?.version ?? r.fingerprint?.split('|')[1] ?? null;

export function allReports(dataDir) {
  const dir = join(dataDir, 'problems');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()) {
    for (const r of readJson(join(dir, f), {}).reports ?? []) if (r?.type === 'problem' && r.reportId && r.check) out.push(r);
  }
  return out;
}

// handled: { reports: { reportId: count }, runs: { key: ISO time }, tries: { key: runs with no answer } }.
// fixes: fixes.json's list.
export function newProblems(reports, handled, fixes, now = Date.now()) {
  const fixOf = (key) => fixes.find((f) => f.key === key);
  const groups = new Map();
  for (const r of reports) {
    if (handled.reports?.[r.reportId] != null) continue;
    const key = keyOf(r);
    const fix = fixOf(key);
    const done = ['fixed', 'not-a-bug'].includes(fix?.state);
    if (done && (fix.version ? cmp(versionOf(r), fix.version) < 0 : r.firstAt < fix.at)) continue;      // fixed since
    if (['not-reproduced', 'needs-you'].includes(fix?.state) && now - Date.parse(fix.at) < 24 * HOUR) continue;
    const ran = handled.runs?.[key];
    if (ran && now - Date.parse(ran) < 2 * HOUR) continue;
    const g = groups.get(key) ?? { key, check: r.check, target: key.split('|')[1], kind: r.kind, area: r.area, expect: r.expect,
      count: 0, versions: [], devices: [], firstAt: r.firstAt, lastAt: r.lastAt, regressionOf: done ? fix.version : null, reports: [] };
    g.count += r.count ?? 1;
    for (const [list, v] of [[g.versions, versionOf(r)], [g.devices, r.deviceId]]) if (v && !list.includes(v)) list.push(v);
    if (r.firstAt < g.firstAt) g.firstAt = r.firstAt;
    if (r.lastAt > g.lastAt) g.lastAt = r.lastAt;
    g.reports.push(r);
    groups.set(key, g);
  }
  // The newest 3 reports of each problem in full (the AI needs the mismatch, the context and the steps; more repeat it).
  return [...groups.values()].map((g) => ({ ...g, reports: g.reports.sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 3),
    reportIds: g.reports.map((r) => [r.reportId, r.count ?? 1]) }));
}

// The fix agent's result → fixes.json: { schemaVersion, updatedAt, fixes: [{ key, check, target, state, version, message, at }] }.
const STATES = ['fixed', 'not-reproduced', 'needs-you', 'not-a-bug'];
export function recordFixes(file, result, now = new Date().toISOString()) {
  const list = file?.fixes ?? [];
  for (const f of result?.fixes ?? []) {
    if (!f?.key || !STATES.includes(f.state)) continue;
    const entry = { key: String(f.key), check: String(f.key).split('|')[0], target: String(f.key).split('|')[1] ?? null, state: f.state,
      version: typeof f.version === 'string' ? f.version : null, message: String(f.message ?? '').slice(0, 500), at: now };
    const i = list.findIndex((x) => x.key === entry.key);
    if (i >= 0) list[i] = entry; else list.push(entry);
  }
  return { schemaVersion: 1, updatedAt: now, fixes: list.slice(-200) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { data: { type: 'string' }, state: { type: 'string' }, result: { type: 'string' } } });
  const [cmd, file] = positionals;
  const HANDLED = values.state ? join(values.state, 'problems-handled.json') : null;
  if (cmd === 'new' && values.data && HANDLED) {
    const fixes = readJson(join(values.data, 'fixes.json'), {}).fixes ?? [];
    console.log(JSON.stringify(newProblems(allReports(values.data), readJson(HANDLED, {}), fixes), null, 2));
  } else if (cmd === 'mark' && file && HANDLED) {
    const h = readJson(HANDLED, { reports: {}, runs: {} });
    h.reports ??= {}; h.runs ??= {}; h.tries ??= {};
    const now = new Date().toISOString();
    const answered = values.result ? new Set((readJson(values.result, {}).fixes ?? []).map((f) => f?.key)) : null;
    let kept = 0;
    for (const p of readJson(file, [])) {
      h.runs[p.key] = now;
      if (answered && !answered.has(p.key) && (h.tries[p.key] = (h.tries[p.key] ?? 0) + 1) < TRIES) { kept++; continue; }
      delete h.tries[p.key];
      for (const [id, n] of p.reportIds ?? []) h.reports[id] = Math.max(h.reports[id] ?? 0, n);
    }
    mkdirSync(values.state, { recursive: true });
    writeFileSync(HANDLED, JSON.stringify(h, null, 2) + '\n');
    console.log(`marked ${readJson(file, []).length - kept}${kept ? `, ${kept} with no answer: tried again in 2 hours` : ''}`);
  } else if (cmd === 'record' && file && values.data) {
    const p = join(values.data, 'fixes.json');
    writeFileSync(p, JSON.stringify(recordFixes(readJson(p, {}), readJson(file, {})), null, 2) + '\n');
    console.log('recorded');
  } else {
    console.error('usage: problems.mjs new --data DIR --state DIR | mark FILE --state DIR [--result RESULT] | record RESULT --data DIR');
    process.exit(2);
  }
}
