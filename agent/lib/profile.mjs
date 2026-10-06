// Profiles: one folder per child (one YouTube account) in the data repo, <app>/<folder>/, e.g.
// kidtube/johnnypitt.ind/. config.json `profiles` says which ones the helper runs, one after another:
//   "kidtube/johnnypitt.ind"                      one profile
//   "kidtube/*"                                   every folder under kidtube/ with a profile.json (the tablet writes it)
//   { "path": "kidtube/x", "defaults": { … } }    one profile with its own helper defaults (e.g. languageMins)
// KIDTUBE_PROFILE picks the profile of this run (daily.sh, poll.sh set it); without it the first one is used.
// KIDTUBE_DATA_DIR is the clone of the whole repo and KIDTUBE_STATE_DIR the state root; each profile has its
// own state folder under it (session, last save, requests), while the log and the API quotas stay shared.
//
//   node agent/lib/profile.mjs list [--sync]       the profiles to run, one per line (--sync: pull the clone first)
//   node agent/lib/profile.mjs get <profile> <key> a setting of its app (daily, system, fallback) or the profile's dirs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncClone } from './data.mjs';

const home = (p) => p.replace(/^~(?=\/)/, homedir());
const PATH = /^([a-z0-9_-]+)\/([a-z0-9._-]+|\*)$/;

export function resolveProfiles(config, cloneDir) {
  const entries = (config.profiles ?? []).map((e) => (typeof e === 'string' ? { path: e } : e)).filter((e) => PATH.test(e.path ?? ''));
  const found = new Map();
  const add = (app, folder, extra) => { if (config.apps?.[app] && !found.has(`${app}/${folder}`)) found.set(`${app}/${folder}`, { ...extra, path: `${app}/${folder}`, app, folder }); };
  // Named profiles first, so their own settings win over a "*" that also finds them.
  for (const { path, ...extra } of entries) { const [, app, folder] = path.match(PATH); if (folder !== '*') add(app, folder, extra); }
  for (const { path, ...extra } of entries) {
    const [, app, folder] = path.match(PATH);
    if (folder !== '*') continue;
    const dir = join(cloneDir, app);
    for (const f of existsSync(dir) ? readdirSync(dir).sort() : []) if (PATH.test(`${app}/${f}`) && existsSync(join(dir, f, 'profile.json'))) add(app, f, extra);
  }
  return [...found.values()];
}

// Where this run reads and writes. No profiles in config.json: the old layout (everything at the repo root).
export function locate(config, env = process.env) {
  const cloneDir = home(env.KIDTUBE_DATA_DIR ?? config.dataDir);
  const stateRoot = home(env.KIDTUBE_STATE_DIR ?? config.stateDir);
  const all = resolveProfiles(config, cloneDir);
  let profile = all[0] ?? null;
  if (env.KIDTUBE_PROFILE) {
    const m = env.KIDTUBE_PROFILE.match(PATH);
    if (!m || m[2] === '*') throw new Error(`KIDTUBE_PROFILE: not a profile (app/folder): ${env.KIDTUBE_PROFILE}`);
    profile = all.find((p) => p.path === env.KIDTUBE_PROFILE) ?? { path: env.KIDTUBE_PROFILE, app: m[1], folder: m[2] };
  }
  const app = profile?.app ?? 'kidtube';
  return {
    cloneDir, stateRoot, profile, app, appConfig: config.apps?.[app] ?? {},
    dataDir: profile ? join(cloneDir, profile.path) : cloneDir,
    stateDir: profile ? join(stateRoot, profile.path) : stateRoot,
    defaults: { ...config.defaults, ...(profile?.defaults ?? {}) },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const config = JSON.parse(readFileSync(join(ROOT, 'agent/config.json'), 'utf8'));
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'list') {
    const where = locate(config, { ...process.env, KIDTUBE_PROFILE: '' });
    if (args.includes('--sync') && (config.profiles ?? []).some((p) => String(p.path ?? p).endsWith('/*'))) syncClone(where.cloneDir, config.dataRepo);
    for (const p of resolveProfiles(config, where.cloneDir)) console.log(p.path);
  } else if (cmd === 'get') {
    const where = locate(config, { ...process.env, KIDTUBE_PROFILE: args[0] });
    const v = { dataDir: where.dataDir, stateDir: where.stateDir, ...where.appConfig }[args[1]];
    process.stdout.write(typeof v === 'string' ? v : '');
  } else {
    console.error('usage: node agent/lib/profile.mjs list [--sync] | get <app/folder> <dataDir|stateDir|daily|system|fallback>');
    process.exit(2);
  }
}
