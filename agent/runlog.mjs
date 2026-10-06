// After a Claude run (daily.sh): prints its report for the log and adds one line to kidtube-data runs.json
// (time, turns, cost, errors) so parent mode can show how the runs go. Usage: node agent/runlog.mjs <claude json> [request]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, syncClone, commitAndPush } from './lib/data.mjs';
import { locate } from './lib/profile.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(ROOT, 'agent/config.json'), 'utf8'));
// runs.json of this run's profile (KIDTUBE_PROFILE); the clone is pulled and pushed as a whole.
const { cloneDir, dataDir, profile } = locate(config);
const [file, kind] = process.argv.slice(2);
let r = {};
try { r = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.log(`=== no JSON result from claude (${e.message})`); }
if (r.result) console.log(r.result);
const run = {
  at: new Date().toISOString(), kind: kind || 'nightly', ok: r.is_error === false,
  minutes: r.duration_ms ? Math.round(r.duration_ms / 6000) / 10 : null, turns: r.num_turns ?? null,
  costUsd: typeof r.total_cost_usd === 'number' ? Math.round(r.total_cost_usd * 100) / 100 : null,
  tokens: r.usage ? { input: (r.usage.input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0), output: r.usage.output_tokens ?? 0 } : null,
  models: r.modelUsage ? Object.keys(r.modelUsage) : [],
};
console.log(`=== run: ${JSON.stringify(run)}`);
try {
  syncClone(cloneDir, config.dataRepo);
  const path = join(dataDir, 'runs.json');
  const log = readJson(path, { schemaVersion: 1, runs: [] });
  log.runs = [...log.runs, run].slice(-60);
  writeJson(path, log);
  commitAndPush(cloneDir, `helper: run log (${run.minutes ?? '?'} min, ${run.turns ?? '?'} turns)${profile ? ` (${profile.path})` : ''}`);
} catch (e) { console.log(`=== runs.json not saved: ${e.message}`); }
