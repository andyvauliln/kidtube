#!/usr/bin/env node
// One command for every writer of main: a chat session, the fix agent (agent/FIX.md), the notes agent
// (agent/NOTES.md). Commit your change first, then:
//   npm run ship -- -m "short summary" [-m "another line"] [--orion] [--no-test] [--key FILE]
// It rebases on origin/main, sets the version (one patch above main's when extension/ changed), runs npm test,
// pushes the code, and only then makes the Quetta release on top of it (build/pack.mjs), commits site/ and pushes.
// A push refused there: it resets to origin/main (the code is on main already) and makes the release again with
// the next number. Nobody solves a site/ file by hand. Orion only with --orion (when the parent asks): each -m is
// then one line of site/orion/CHANGES.md, in words the parent understands.
//   node build/ship.mjs verify       is the newest release on origin/main made from main's code? exit 1 if not
//   node build/ship.mjs pre-push     the git hook (.githooks/pre-push): refuses a push to main that breaks the rules
// Writers take turns: ship and verify hold a lock (flock on push.lock in the server's state folder) from the fetch
// to the last push. All writers run on the same server; a writer elsewhere is still stopped by the hook.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { cmpVersion } from '../extension/core/lib/version.js';

const ME = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(ME), '..');
const ZERO = /^0+$/;
// extension/ files that change what the tablet runs (a README does not need a new version).
const CODE = ['--', 'extension', ':(exclude)extension/**/*.md', ':(exclude)extension/*.md'];

// The release files in site/: only ship makes them (site/remote.json, index.html and README.md are by hand).
const MADE = ['--', 'site/latest.json', 'site/updates.xml', ':(glob)site/*.crx', ':(glob)site/*.zip', 'site/orion'];

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (...args) => { try { return git(...args); } catch { return null; } };
const ok = (...args) => spawnSync('git', args, { cwd: ROOT, stdio: 'ignore' }).status === 0;
// A push: git's and the hook's messages go to the writer. false when refused.
const push = () => spawnSync('git', ['push', '--quiet', 'origin', 'HEAD:main'], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] }).status === 0;
// Refused: main moved (true, try again), or the hook refused it (stop: the reason is printed above).
function moved(was) {
  git('fetch', '--quiet', 'origin');
  if (git('rev-parse', 'origin/main') === was) stop('the push was refused (see above); nothing else changed on main.');
  return true;
}
const show = (ref, path) => tryGit('show', `${ref}:${path}`);
const json = (text) => { try { return JSON.parse(text); } catch { return null; } };
const versionAt = (ref) => json(show(ref, 'extension/manifest.json'))?.version ?? null;
const releaseAt = (ref) => json(show(ref, 'site/latest.json'));
const next = (v) => v.split('.').map(Number).map((n, i) => (i === 2 ? n + 1 : n)).join('.');
const say = (s) => console.log(`ship: ${s}`);
class Stop extends Error {}
const stop = (s) => { throw new Stop(s); };

// Code in extension/ after the release's commit: the tablets don't have it yet.
export function unreleased(ref, release) {
  const from = release?.sourceCommit?.replace(/-dirty$/, '');
  if (!from || !ok('cat-file', '-e', `${from}^{commit}`)) return true;
  return !ok('diff', '--quiet', from, ref, ...CODE);
}

// What is wrong with the release at ref (its site/ files against its code): a list of sentences, empty when fine.
export function releaseProblems(ref) {
  const rel = releaseAt(ref);
  if (!rel?.version) return ['site/latest.json is missing or not readable.'];
  const out = [];
  const from = rel.sourceCommit ?? '';
  if (!from || from.endsWith('-dirty')) out.push(`Release ${rel.version} was made from uncommitted code (sourceCommit “${from}”).`);
  else if (!ok('merge-base', '--is-ancestor', from, ref)) out.push(`Release ${rel.version} was made from commit ${from.slice(0, 7)}, which is not on main (a release made before a rebase).`);
  else if (versionAt(from) !== rel.version) out.push(`Release ${rel.version} was made from code with version ${versionAt(from)}.`);
  else if (unreleased(ref, rel)) out.push(`extension/ changed after release ${rel.version} (${git('rev-list', '--count', `${from}..${ref}`, ...CODE)} commit(s)): the tablets don't have it.`);
  const name = rel.crxUrl?.split('/').pop();
  if (!name || !ok('cat-file', '-e', `${ref}:site/${name}`)) out.push(`site/ has no ${name ?? '.crx'} for release ${rel.version}.`);
  const xml = show(ref, 'site/updates.xml') ?? '';
  if (!xml.includes(`version='${rel.version}'`) && !xml.includes(`version="${rel.version}"`)) out.push(`site/updates.xml does not offer ${rel.version}.`);
  return out;
}

// The pre-push rules for one update of main: local (what is pushed) over remote (main on GitHub now).
export function pushProblems(local, remote) {
  const out = [];
  const vl = versionAt(local), vr = versionAt(remote);
  const rl = releaseAt(local), rr = releaseAt(remote);
  if (vl && vr && cmpVersion(vl, vr) < 0) out.push(`extension/manifest.json goes back from ${vr} to ${vl}: rebase on origin/main.`);
  if (rr?.version && vl && !ok('diff', '--quiet', remote, local, ...CODE) && cmpVersion(vl, rr.version) <= 0) {
    out.push(`extension/ changes but the version stays ${vl}, which is released already: raise it (npm run ship does it).`);
  }
  if (JSON.stringify(rl) !== JSON.stringify(rr)) {
    if (rr?.version && rl?.version && cmpVersion(rl.version, rr.version) <= 0) out.push(`site/latest.json goes from ${rr.version} to ${rl.version}: a release must be newer than main's.`);
    out.push(...releaseProblems(local));
  }
  return out;
}

// --- the lock: flock on one file, the same for every checkout on this server --------------------------------------
const LOCK = process.env.KIDTUBE_PUSH_LOCK ?? join(homedir(), '.local/share/kidtube/state/push.lock');
const WAIT_S = Number(process.env.KIDTUBE_PUSH_WAIT ?? 1200);
function locked(args) {
  if (process.env.KIDTUBE_PUSH_LOCKED === LOCK || spawnSync('flock', ['-V'], { stdio: 'ignore' }).status !== 0) return false;
  mkdirSync(dirname(LOCK), { recursive: true });
  const r = spawnSync('flock', ['-w', String(WAIT_S), '-E', '75', LOCK, process.execPath, ME, ...args],
    { stdio: 'inherit', env: { ...process.env, KIDTUBE_PUSH_LOCKED: LOCK } });
  if (r.status === 75) console.error(`ship: another writer held ${LOCK} for ${WAIT_S} s; try again later.`);
  process.exit(r.status ?? 1);
}

// --- rebase on origin/main ------------------------------------------------------------------------------------------
// A conflict where both sides only changed "version" in the manifest takes main's (the version is set again after).
// Any other conflict stops: solve it by keeping both changes, `git rebase --continue`, then ship again.
function versionOnly(file) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  let bad = false;
  const fixed = text.replace(/<<<<<<< [^\n]*\n([\s\S]*?)(?:\|\|\|\|\|\|\| [^\n]*\n[\s\S]*?)?=======\n([\s\S]*?)>>>>>>> [^\n]*\n/g, (all, main, mine) => {
    const lines = (s) => s.split('\n').filter(Boolean);
    if (![...lines(main), ...lines(mine)].every((l) => /^\s*"version":/.test(l))) bad = true;
    return main;
  });
  if (bad) return false;
  writeFileSync(join(ROOT, file), fixed);
  return true;
}
function rebase() {
  if (ok('rebase', 'origin/main')) return;
  for (let i = 0; i < 50; i++) {
    const files = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
    if (!files.length || files.some((f) => f !== 'extension/manifest.json') || !versionOnly(files[0])) {
      ok('rebase', '--abort');
      stop(`the rebase on origin/main stopped on ${files.join(', ') || 'a commit'}. Run \`git rebase origin/main\`, keep both changes, \`git rebase --continue\`, then ship again.`);
    }
    git('add', files[0]);
    if (spawnSync('git', ['-c', 'core.editor=true', 'rebase', '--continue'], { cwd: ROOT, stdio: 'ignore' }).status === 0) return;
  }
  ok('rebase', '--abort');
  stop('the rebase did not finish.');
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) stop(`${cmd} ${args.join(' ')} failed.`);
}

// The Co-Authored-By lines of the newest commit of this writer, for ship's own commits.
const trailers = (ref) => (tryGit('log', '-1', '--format=%(trailers:key=Co-Authored-By)', ref) ?? '').trim();
const commit = (message, trailer) => git('commit', '--quiet', '-m', trailer ? `${message}\n\n${trailer}` : message);

function ship(o) {
  if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') stop('ship works on main only.');
  if (git('status', '--porcelain', '--untracked-files=no')) stop('commit your changes first (git status shows changes).');
  if (!tryGit('config', 'core.hooksPath')) git('config', 'core.hooksPath', '.githooks');
  const key = o.key ?? process.env.KIDTUBE_KEY ?? join(homedir(), 'kidtube-key.pem');
  const lines = [].concat(o.message ?? []).map((l) => l.trim()).filter(Boolean);
  let summary = lines.length ? lines.join('; ') : undefined;
  let trailer = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    git('fetch', '--quiet', 'origin');
    if (git('log', '--format=%H', 'origin/main..HEAD', ...MADE).length) {
      stop('your commits change the release files in site/. ship makes them: take those changes out, then ship again.');
    }
    rebase();
    const mine = git('log', '--format=%s', 'origin/main..HEAD').split('\n').filter(Boolean);
    trailer ||= trailers('HEAD');
    summary ??= mine.reverse().join('; ').slice(0, 200) || 'release of main';
    if (!lines.length) lines.push(summary);
    const rel = releaseAt('HEAD');
    const release = unreleased('HEAD', rel);
    if (release) {
      if (!existsSync(key)) stop(`no signing key at ${key} (--key or KIDTUBE_KEY): nothing pushed.`);
      // Above the newest release and not below main's manifest. A number not released yet stays (the lock says
      // nobody else is releasing it); else one patch above main's newest.
      const main = versionAt('origin/main'), cur = versionAt('HEAD');
      const fresh = (!rel?.version || cmpVersion(cur, rel.version) > 0) && cmpVersion(cur, main) >= 0;
      const want = fresh ? cur : next([main, rel?.version].filter(Boolean).sort(cmpVersion).pop());
      if (want !== cur) {
        const p = join(ROOT, 'extension/manifest.json');
        writeFileSync(p, readFileSync(p, 'utf8').replace(/("version":\s*")[^"]*(")/, `$1${want}$2`));
        git('add', 'extension/manifest.json');
        commit(`${want}: ${summary}`, trailer);
        say(`version ${want}`);
      }
    }
    const ahead = Number(git('rev-list', '--count', 'origin/main..HEAD'));
    const was = git('rev-parse', 'origin/main');
    if (ahead) {
      if (!o.noTest) run('npm', ['test']);
      if (!push() && moved(was)) { say(`main moved while testing: again (${attempt})`); continue; }
      say(`pushed ${ahead} commit(s)`);
    }
    const version = versionAt('HEAD');
    const orion = o.orion && json(show('HEAD', 'site/orion/latest.json'))?.version !== version;
    if (!release && !orion) { say(`no release needed: ${rel?.version} has main's code${o.orion ? ', Orion too' : ''}`); return; }
    const made = [];
    if (release) {
      run(process.execPath, ['build/pack.mjs', 'extension', '--key', key, '--out', 'site']);
      git('add', '-A', 'site');
      commit(`quetta ${version}: release`, trailer);
      made.push('Quetta');
    }
    if (orion) {
      run(process.execPath, ['build/orion-check.mjs']);
      run(process.execPath, ['build/build-orion.mjs']);
      // Each -m is one line for the parent in CHANGES.md.
      const changes = join(ROOT, 'site/orion/CHANGES.md');
      const text = existsSync(changes) ? readFileSync(changes, 'utf8') : '# Orion changes\n';
      if (!text.includes(`## ${version} `)) {
        const at = text.search(/^## /m);
        const entry = `## ${version} (${new Date().toISOString().slice(0, 10)})\n\n${lines.map((l) => `- ${l}`).join('\n')}\n\n`;
        writeFileSync(changes, at < 0 ? `${text.trimEnd()}\n\n${entry}` : text.slice(0, at) + entry + text.slice(at));
      }
      git('add', '-A', 'site/orion');
      commit(`orion ${version}: ${summary}`, trailer);
      made.push('Orion');
    }
    const codeOnMain = git('rev-parse', `HEAD~${made.length}`);
    if (push()) {
      say(`released ${version}: ${made.join(' and ')}. Pages publishes it in a few minutes.`);
      return;
    }
    // Someone pushed in between: the code is on main already; the release is made again on top of theirs.
    moved(codeOnMain);
    say(`the release push was refused: making it again on the newest main (${attempt})`);
    git('reset', '--quiet', '--hard', 'origin/main');
  }
  stop('main kept moving: try again in a few minutes.');
}

function verify(o) {
  if (!o.noFetch) git('fetch', '--quiet', 'origin');
  const problems = releaseProblems('origin/main');
  const rel = releaseAt('origin/main');
  console.log(JSON.stringify({ ok: !problems.length, version: rel?.version ?? null, problems }));
  return problems.length ? 1 : 0;
}

// git runs the hook with "<local ref> <local sha> <remote ref> <remote sha>" lines on stdin.
function prePush() {
  let bad = [];
  for (const line of readFileSync(0, 'utf8').split('\n').filter(Boolean)) {
    const [, local, ref, remote] = line.split(' ');
    if (ref !== 'refs/heads/main' || ZERO.test(local) || ZERO.test(remote) || !ok('cat-file', '-e', `${remote}^{commit}`)) continue;
    bad = bad.concat(pushProblems(local, remote));
  }
  if (!bad.length) return 0;
  console.error(`push to main refused (build/ship.mjs, the rules in CLAUDE.md):\n- ${bad.join('\n- ')}\nUse \`npm run ship\`. Skip this check only if you know why: git push --no-verify.`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === ME) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    message: { type: 'string', short: 'm', multiple: true }, orion: { type: 'boolean', default: false }, 'no-test': { type: 'boolean', default: false },
    key: { type: 'string' }, 'no-fetch': { type: 'boolean', default: false } } });
  const cmd = positionals[0] ?? 'ship';
  try {
    if (cmd === 'pre-push') process.exit(prePush());
    if (cmd !== 'ship' && cmd !== 'verify') { console.error('usage: ship.mjs [-m summary] [--orion] [--no-test] [--key FILE] | verify | pre-push'); process.exit(2); }
    locked(process.argv.slice(2));
    const o = { message: values.message, orion: values.orion, noTest: values['no-test'], key: values.key, noFetch: values['no-fetch'] };
    process.exit(cmd === 'verify' ? verify(o) : (ship(o), 0));
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    console.error(`ship: ${e.message}`);
    process.exit(1);
  }
}
