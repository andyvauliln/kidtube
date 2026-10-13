#!/usr/bin/env node
// How many AI runs a day the server makes, and how many it made today. No AI here.
// The defaults are in agent/config.json (notesAgent.perDay, orchestrator.onDemandPerDay, fixAgent.perDay). The parent
// can change them in Settings → AI on the server: the tablet writes `agents` into the profile's parent-config.json, and
// the server keeps each number inside SAFE (0 = no runs). The fix agent works for every profile: the newest
// parent-config.json with a fixPerDay wins.
//   node agent/limits.mjs get notes|helper --data <profile folder>   → the number for this profile
//   node agent/limits.mjs get fix --data <clone>                      → the number for the fix agent
//   node agent/limits.mjs status --data <clone> --state <state root>  → writes server.json in each profile folder when it
//                                                                       changed (the tablet shows it); prints how many
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveProfiles } from './lib/profile.mjs';

const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };

// kind → the key in parent-config.json `agents`, the highest number the tablet may set.
export const SAFE = { notes: { key: 'notesPerDay', max: 30 }, helper: { key: 'helperPerDay', max: 12 }, fix: { key: 'fixPerDay', max: 20 } };

export function defaults(config) {
  return { notes: config.notesAgent?.perDay ?? 10, helper: config.orchestrator?.onDemandPerDay ?? 6, fix: config.fixAgent?.perDay ?? 6 };
}

// The parent's number, kept inside 0..max; anything else: the default.
export function pick(kind, agents, fallback) {
  const n = agents?.[SAFE[kind].key];
  return Number.isInteger(n) && n >= 0 ? Math.min(n, SAFE[kind].max) : fallback;
}

// The profile folders (data and state) of this repo; none in config.json: the old layout at the root.
export function folders(config, clone, state) {
  const all = resolveProfiles(config, clone);
  return all.length ? all.map((p) => ({ data: join(clone, p.path), state: join(state, p.path) })) : [{ data: clone, state }];
}

export function fixLimit(config, clone) {
  let best = null;
  for (const { data } of folders(config, clone, '')) {
    const c = readJson(join(data, 'parent-config.json'), null);
    if (!Number.isInteger(c?.agents?.fixPerDay)) continue;
    if (!best || String(c.updatedAt ?? '') > String(best.updatedAt ?? '')) best = c;
  }
  return pick('fix', best?.agents, defaults(config).fix);
}

// Lines of today (UTC, as agent/poll.sh writes them) in a run log.
export function usedToday(file, day) {
  try { return readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith(`${day} `)).length; } catch { return 0; }
}

// The Claude account the agents use (the crontab's CLAUDE_CONFIG_DIR, else the default one). Only the e-mail address.
export function account(env = process.env) {
  const file = env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json');
  return readJson(file, {})?.oauthAccount?.emailAddress ?? null;
}

export function serverStatus(config, clone, state, { day = new Date().toISOString().slice(0, 10), env = process.env } = {}) {
  const def = defaults(config), fix = fixLimit(config, clone), who = account(env);
  const fixUsed = usedToday(join(state, 'fix-runs.log'), day);
  let changed = 0;
  for (const f of folders(config, clone, state)) {
    if (!existsSync(f.data)) continue;
    const agents = readJson(join(f.data, 'parent-config.json'), {})?.agents;
    const run = (kind, perDay, used) => ({ used, perDay, default: def[kind], max: SAFE[kind].max });
    const next = {
      schemaVersion: 1, day, account: who,
      runs: {
        notes: run('notes', pick('notes', agents, def.notes), usedToday(join(f.state, 'notes-runs.log'), day)),
        helper: run('helper', pick('helper', agents, def.helper), usedToday(join(f.state, 'on-demand'), day)),
        fix: run('fix', fix, fixUsed),
      },
    };
    const path = join(f.data, 'server.json');
    const { updatedAt, ...old } = readJson(path, {});
    if (JSON.stringify(old) === JSON.stringify(next)) continue;
    writeFileSync(path, JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2) + '\n');
    changed++;
  }
  return changed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { data: { type: 'string' }, state: { type: 'string' } } });
  const config = readJson(join(dirname(fileURLToPath(import.meta.url)), 'config.json'), {});
  const [cmd, kind] = positionals;
  if (cmd === 'get' && kind === 'fix') console.log(fixLimit(config, values.data));
  else if (cmd === 'get' && SAFE[kind]) console.log(pick(kind, readJson(join(values.data, 'parent-config.json'), {})?.agents, defaults(config)[kind]));
  else if (cmd === 'status') console.log(serverStatus(config, values.data, values.state));
  else { console.error('usage: limits.mjs get notes|helper|fix --data DIR | status --data CLONE --state DIR'); process.exit(2); }
}
