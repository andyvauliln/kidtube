// The private data repo (kidtube-data): a git clone the helper owns, plus file helpers.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// Fresh copy of the remote. The clone belongs to the helper, so local leftovers are dropped.
export function syncClone(dir, repo) {
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dirname(dir), { recursive: true });
    execFileSync('git', ['clone', '--quiet', `https://github.com/${repo}.git`, dir], { stdio: 'pipe' });
  }
  git(dir, 'fetch', '--quiet', 'origin');
  const branch = git(dir, 'rev-parse', '--abbrev-ref', 'origin/HEAD').replace('origin/', '') || 'main';
  git(dir, 'checkout', '--quiet', branch);
  git(dir, 'reset', '--quiet', '--hard', `origin/${branch}`);
  return branch;
}

export function commitAndPush(dir, message) {
  git(dir, 'add', '-A');
  if (!git(dir, 'status', '--porcelain')) return false;
  git(dir, '-c', 'user.name=KidTube helper', 'commit', '--quiet', '-m', message);
  for (let i = 0; ; i++) {
    try { git(dir, 'push', '--quiet', 'origin', 'HEAD'); return true; }
    catch (e) {
      // The tablet writes activity and rules too: put our commit on top of theirs and try again.
      if (i >= 3) throw new Error(`push failed: ${e.stderr || e.message}`);
      git(dir, 'pull', '--quiet', '--rebase', 'origin', git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'));
    }
  }
}

export const readJson = (path, fallback = null) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);
export function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

// Tablet events after `since` (ISO time), from activity/YYYY-MM-DD.json files.
export function activitySince(dir, since) {
  const adir = join(dir, 'activity');
  if (!existsSync(adir)) return { events: [], devices: [] };
  const events = [];
  const devices = [];
  for (const f of readdirSync(adir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()) {
    if (since && f.slice(0, 10) < since.slice(0, 10)) continue;
    const file = readJson(join(adir, f));
    if (file?.device) devices.push(file.device);
    for (const e of file?.events ?? []) if (!since || e.at > since) events.push(e);
  }
  return { events, devices };
}

export const transcript = (dir, videoId) => readJson(join(dir, 'transcripts', `${videoId}.json`));
