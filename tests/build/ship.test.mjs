// build/ship.mjs: several writers push to main (chat sessions, the fix agent, the notes agent). A fake GitHub (a bare
// repo) and two clones; each ships its own change. What must hold: no lost commit, one version number each, the
// release made from main's newest code, and the hook refuses a push that breaks it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicKeyDer } from '../../build/crx.mjs';

const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

function world() {
  const dir = mkdtempSync(join(tmpdir(), 'ship-'));
  const p = (...a) => join(dir, ...a);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  writeFileSync(p('key.pem'), privateKey);
  const env = { ...process.env, ...GIT_ENV, KIDTUBE_KEY: p('key.pem'), KIDTUBE_PUSH_LOCK: p('push.lock'), KIDTUBE_PUSH_LOCKED: '' };
  const sh = (cwd, cmd, args, extra = {}) => execFileSync(cmd, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const git = (cwd, ...args) => sh(cwd, 'git', args).trim();

  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', p('origin.git')]);
  const seed = p('seed');
  mkdirSync(join(seed, 'build'), { recursive: true });
  mkdirSync(join(seed, 'extension/core/lib'), { recursive: true });
  for (const f of ['ship.mjs', 'pack.mjs', 'crx.mjs', 'build-orion.mjs']) cpSync(join('build', f), join(seed, 'build', f));
  cpSync('extension/core/lib/version.js', join(seed, 'extension/core/lib/version.js'));
  cpSync('.githooks', join(seed, '.githooks'), { recursive: true });
  writeFileSync(join(seed, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node -e 0' } }));
  writeFileSync(join(seed, 'extension/manifest.json'), JSON.stringify({ name: 'Custom Apps', version: '0.1.0', key: publicKeyDer(privateKey).toString('base64') }, null, 2) + '\n');
  writeFileSync(join(seed, 'extension/a.js'), 'export const a = 0;\n');
  git(p(), 'init', '--quiet', '--initial-branch=main', seed);
  git(seed, 'add', '-A'); git(seed, 'commit', '--quiet', '-m', '0.1.0: start');
  sh(seed, process.execPath, ['build/pack.mjs', 'extension', '--key', p('key.pem'), '--out', 'site']);
  git(seed, 'add', '-A'); git(seed, 'commit', '--quiet', '-m', 'quetta 0.1.0: release');
  git(seed, 'remote', 'add', 'origin', p('origin.git')); git(seed, 'push', '--quiet', 'origin', 'main');

  const clone = (name) => {
    git(p(), 'clone', '--quiet', p('origin.git'), p(name));
    git(p(name), 'config', 'core.hooksPath', '.githooks');
    return p(name);
  };
  // One writer's change: a new file in extension/, committed (optionally with its own version number).
  const change = (cwd, file, version) => {
    writeFileSync(join(cwd, 'extension', file), `export const x = '${file}';\n`);
    if (version) {
      const m = join(cwd, 'extension/manifest.json');
      writeFileSync(m, readFileSync(m, 'utf8').replace(/"version": "[^"]*"/, `"version": "${version}"`));
    }
    git(cwd, 'add', '-A'); git(cwd, 'commit', '--quiet', '-m', `add ${file}`);
  };
  const ship = (cwd, ...args) => new Promise((done) => {
    const c = spawn(process.execPath, ['build/ship.mjs', ...args], { cwd, env });
    let out = '';
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => done({ code, out }));
  });
  const main = (cwd, path) => { git(cwd, 'fetch', '--quiet', 'origin'); return git(cwd, 'show', `origin/main:${path}`); };
  const verify = (cwd) => { try { return { code: 0, ...JSON.parse(sh(cwd, process.execPath, ['build/ship.mjs', 'verify'])) }; } catch (e) { return { code: e.status, ...JSON.parse(e.stdout) }; } };
  return { p, git, sh, clone, change, ship, main, verify };
}

test('ship: two writers at the same time → both changes on main, two version numbers, the release has both', async () => {
  const w = world();
  const a = w.clone('a'), b = w.clone('b');
  w.change(a, 'from-a.js', '0.1.1');   // each took a next number on its own: the second one's rebase stops on the
  w.change(b, 'from-b.js', '0.1.5');   // version line, and ship takes the next free number
  const [ra, rb] = await Promise.all([w.ship(a, '-m', 'change A', '-t', 'try A'), w.ship(b, '-m', 'change B')]);
  assert.equal(ra.code, 0, ra.out);
  assert.equal(rb.code, 0, rb.out);
  w.git(a, 'fetch', '--quiet', 'origin');
  const log = w.git(a, 'log', '--format=%s', 'origin/main');
  assert.match(log, /add from-a\.js/);
  assert.match(log, /add from-b\.js/);
  const releases = log.split('\n').filter((s) => s.startsWith('quetta ')).map((s) => s.split(' ')[1]);
  assert.equal(releases.length, 3, `0.1.0, then one release each: ${releases}`);
  assert.equal(new Set(releases).size, releases.length, `one number per release: ${releases}`);
  const latest = JSON.parse(w.main(a, 'site/latest.json'));
  assert.equal(latest.version, JSON.parse(w.main(a, 'extension/manifest.json')).version);
  // The newest release was made from the code with both changes.
  assert.ok(w.git(a, 'show', `${latest.sourceCommit}:extension/from-a.js`));
  assert.ok(w.git(a, 'show', `${latest.sourceCommit}:extension/from-b.js`));
  // What each release changed and what to test (the parent's note, 2026-10-14): newest first, both kept.
  assert.equal(latest.changes[0].version, latest.version);
  const a1 = latest.changes.find((c) => c.changed.includes('change A')), b1 = latest.changes.find((c) => c.changed.includes('change B'));
  assert.deepEqual(a1?.test, ['try A']);
  assert.deepEqual(b1?.test, []);
  assert.notEqual(a1.version, b1.version);
  assert.equal(w.verify(a).ok, true);
});

test('ship: code pushed without a release → verify says so, and ship with nothing of its own releases it', async () => {
  const w = world();
  const a = w.clone('a'), b = w.clone('b');
  w.change(a, 'quiet.js');
  // The hook refuses it: extension/ changed, the version is the released one.
  assert.throws(() => w.git(a, 'push', 'origin', 'main'), /version stays 0\.1\.0/);
  w.git(a, 'push', '--quiet', '--no-verify', 'origin', 'main');
  const v = w.verify(b);
  assert.equal(v.code, 1);
  assert.match(v.problems.join(' '), /extension\/ changed after release 0\.1\.0/);
  const r = await w.ship(b);
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(w.main(b, 'site/latest.json')).version, '0.1.1');
  assert.equal(w.verify(b).ok, true);
});

test('ship: the hook refuses a release made before a rebase (its code is not on main)', () => {
  const w = world();
  const a = w.clone('a');
  w.change(a, 'old.js', '0.1.1');
  const built = w.git(a, 'rev-parse', 'HEAD');
  w.sh(a, process.execPath, ['build/pack.mjs', 'extension', '--key', w.p('key.pem'), '--out', 'site']);
  w.git(a, 'stash', '--quiet');
  w.git(a, 'commit', '--quiet', '--amend', '-m', 'add old.js (rewritten, as a rebase does)');
  w.git(a, 'stash', 'pop', '--quiet');
  w.git(a, 'add', '-A'); w.git(a, 'commit', '--quiet', '-m', 'quetta 0.1.1: release');
  assert.equal(JSON.parse(readFileSync(join(a, 'site/latest.json'), 'utf8')).sourceCommit, built);
  assert.throws(() => w.git(a, 'push', 'origin', 'main'), /not on main/);
});

test('ship: a push that sets the version back is refused; site/ in your own commits stops ship', async () => {
  const w = world();
  const a = w.clone('a'), b = w.clone('b');
  w.change(a, 'one.js');
  assert.equal((await w.ship(a)).code, 0);
  w.git(b, 'pull', '--quiet', '--no-rebase', '--no-edit', 'origin', 'main');
  const m = join(b, 'extension/manifest.json');
  writeFileSync(m, readFileSync(m, 'utf8').replace(/"version": "[^"]*"/, '"version": "0.0.9"'));
  w.git(b, 'commit', '--quiet', '-am', 'oops');
  assert.throws(() => w.git(b, 'push', 'origin', 'main'), /goes back from 0\.1\.1 to 0\.0\.9/);
  w.git(b, 'reset', '--quiet', '--hard', 'origin/main');
  writeFileSync(join(b, 'site/updates.xml'), 'by hand\n');
  w.git(b, 'add', '-A'); w.git(b, 'commit', '--quiet', '-m', 'site by hand');
  const r = await w.ship(b);
  assert.equal(r.code, 1);
  assert.match(r.out, /your commits change the release files/);
});
