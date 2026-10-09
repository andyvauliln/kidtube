// Profiles on the server: which ones the helper runs, where each one's files are, and the move of the old
// one-child layout into a profile folder (kt.mjs migrate-root), against a throwaway git repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolveProfiles, locate } from '../../agent/lib/profile.mjs';
import { validateDataDir, profileDirs } from '../../tools/validate.mjs';

const config = JSON.parse(readFileSync('agent/config.json', 'utf8'));
const tmp = () => mkdtempSync(join(tmpdir(), 'kt-profiles-'));
const errorsOnly = (r) => r.errors.filter((m) => !m.startsWith('warning:'));
const profileJson = (app, folder) => JSON.stringify({ schemaVersion: 1, app, folder, email: `${folder}@example.com`, name: null, createdAt: '2026-10-06T00:00:00Z' });

test('profiles: named ones, "*" finds folders with profile.json, a named one keeps its own defaults', () => {
  const clone = tmp();
  for (const f of ['ann', 'bob', 'no-profile']) mkdirSync(join(clone, 'kidtube', f), { recursive: true });
  writeFileSync(join(clone, 'kidtube/ann/profile.json'), profileJson('kidtube', 'ann'));
  writeFileSync(join(clone, 'kidtube/bob/profile.json'), profileJson('kidtube', 'bob'));
  const cfg = { ...config, profiles: ['kidtube/*', { path: 'kidtube/bob', defaults: { languageMins: { ru: 2 } } }, 'other-app/x', '../evil'] };
  const all = resolveProfiles(cfg, clone);
  assert.deepEqual(all.map((p) => p.path), ['kidtube/bob', 'kidtube/ann']);   // unknown apps and bad paths are left out
  assert.deepEqual(all[0].defaults, { languageMins: { ru: 2 } });

  const w = locate(cfg, { KIDTUBE_DATA_DIR: clone, KIDTUBE_STATE_DIR: '/st', KIDTUBE_PROFILE: 'kidtube/bob' });
  assert.equal(w.dataDir, join(clone, 'kidtube/bob'));
  assert.equal(w.stateDir, '/st/kidtube/bob');
  assert.equal(w.stateRoot, '/st');
  assert.deepEqual(w.defaults.languageMins, { ru: 2 });
  assert.equal(w.defaults.videosPerDay, config.defaults.videosPerDay);
  assert.equal(w.appConfig.daily, 'agent/DAILY.md');

  // No profiles: the old layout, everything at the root.
  const old = locate({ ...config, profiles: [] }, { KIDTUBE_DATA_DIR: clone, KIDTUBE_STATE_DIR: '/st' });
  assert.equal(old.dataDir, clone);
  assert.equal(old.stateDir, '/st');
  assert.throws(() => locate(cfg, { KIDTUBE_DATA_DIR: clone, KIDTUBE_PROFILE: 'kidtube/*' }));
});

// A bare "GitHub" repo with the old one-child layout, and the helper's clone of it.
function oldLayoutRepo() {
  const dir = tmp();
  const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { stdio: 'pipe', encoding: 'utf8' });
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', join(dir, 'remote.git')]);
  const seed = join(dir, 'seed');
  execFileSync('git', ['clone', '--quiet', join(dir, 'remote.git'), seed], { stdio: 'pipe' });
  cpSync('tests/fixtures/good/data', seed, { recursive: true });
  mkdirSync(join(seed, 'context'));
  writeFileSync(join(seed, 'context/kid.md'), '# About him\n');
  git(seed, 'add', '-A');
  git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'old layout');
  git(seed, 'push', '--quiet', 'origin', 'HEAD:main');
  const clone = join(dir, 'clone');
  execFileSync('git', ['clone', '--quiet', join(dir, 'remote.git'), clone], { stdio: 'pipe' });
  const state = join(dir, 'state');
  mkdirSync(state);
  writeFileSync(join(state, 'last-save'), '2026-10-05');
  writeFileSync(join(state, 'models.json'), '{}');
  return { dir, clone, state, git };
}
const kt = (env, ...args) => JSON.parse(execFileSync(process.execPath, ['agent/kt.mjs', ...args], { env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));

test('migrate-root moves the one child into kidtube/<folder>/, with its server state; then a new profile gets starter files', () => {
  const { clone, state, git, dir } = oldLayoutRepo();
  const env = { KIDTUBE_DATA_DIR: clone, KIDTUBE_STATE_DIR: state, KIDTUBE_PROFILE: 'kidtube/johnnypitt.ind', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_EMAIL: 't@t' };
  const r = kt(env, 'migrate-root', 'kidtube/johnnypitt.ind', 'johnnypitt.ind@gmail.com');
  assert.equal(r.ok, true);
  assert.ok(r.moved.includes('parent-config.json') && r.moved.includes('activity') && r.moved.includes('context'));
  assert.equal(r.pushed, true);
  const p = join(clone, 'kidtube/johnnypitt.ind');
  assert.ok(!existsSync(join(clone, 'queue.json')), 'nothing left at the root');
  assert.ok(existsSync(join(p, 'queue.json')) && existsSync(join(p, 'context/kid.md')));
  assert.equal(JSON.parse(readFileSync(join(p, 'profile.json'), 'utf8')).email, 'johnnypitt.ind@gmail.com');
  assert.equal(readFileSync(join(state, 'kidtube/johnnypitt.ind/last-save'), 'utf8'), '2026-10-05');
  assert.ok(existsSync(join(state, 'models.json')), 'shared state stays at the root');
  for (const res of profileDirs(clone).flatMap(validateDataDir)) assert.deepEqual(errorsOnly(res), [], res.path);
  // The push reached "GitHub".
  assert.ok(git(join(dir, 'remote.git'), 'ls-tree', '-r', '--name-only', 'main').includes('kidtube/johnnypitt.ind/queue.json'));

  // A second child: the tablet wrote only profile.json; the helper adds the rest.
  mkdirSync(join(clone, 'kidtube/second'));
  writeFileSync(join(clone, 'kidtube/second/profile.json'), profileJson('kidtube', 'second'));
  git(clone, 'add', '-A');
  git(clone, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'tablet: new profile');
  git(clone, 'push', '--quiet', 'origin', 'HEAD');
  assert.ok(validateDataDir(join(clone, 'kidtube/second')).every((res) => errorsOnly(res).length === 0), 'a new profile is not an error');
  const init = kt({ ...env, KIDTUBE_PROFILE: 'kidtube/second' }, 'init-profile');
  assert.deepEqual(init.added.sort(), ['context/kid.md', 'context/letters.md', 'context/math.md', 'context/strategy.md', 'context/world.md', 'memory.json', 'parent-config.json', 'queue.json']);
  for (const res of validateDataDir(join(clone, 'kidtube/second'))) assert.deepEqual(errorsOnly(res), [], res.path);
  assert.deepEqual(readdirSync(join(clone, 'kidtube')).sort(), ['johnnypitt.ind', 'second']);
  assert.ok(readFileSync(join(clone, 'kidtube/johnnypitt.ind/context/kid.md'), 'utf8').startsWith('# About him'), 'the first child is untouched');
});
