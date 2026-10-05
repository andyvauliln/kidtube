#!/usr/bin/env node
// Builds the Orion (iPad/iPhone/Mac) variant of extension/ and publishes it under docs/orion/.
//   node tools/build-orion.mjs [--out docs/orion] [--base-url https://andyvauliln.github.io/kidtube/orion] [--allow-dirty]
// extension/ stays the one source (developed for Quetta). The Orion build differs only in:
//   lib/target.js  TARGET = 'orion' (no blocking rules, manual updates, its own latest.json)
//   manifest.json  no update_url / minimum_chrome_version, no declarativeNetRequest permission
// Orion is released only when asked, so docs/orion/latest.json records the commit it was built from.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { zipDir } from './crx.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

// HEAD, with "-dirty" when the directory has uncommitted changes; null outside git.
export function sourceCommit(dir) {
  try {
    const head = git('rev-parse', 'HEAD');
    return git('status', '--porcelain', '--', resolve(dir)) ? `${head}-dirty` : head;
  } catch { return null; }
}

export function orionManifest(manifest) {
  const m = structuredClone(manifest);
  delete m.update_url;
  delete m.minimum_chrome_version;
  m.permissions = (m.permissions ?? []).filter((p) => !p.startsWith('declarativeNetRequest'));
  return m;
}

function cmpVersion(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

export function buildOrion({ src = join(ROOT, 'extension'), out = join(ROOT, 'docs/orion'), stage = join(ROOT, 'dist/orion'),
  baseUrl = 'https://andyvauliln.github.io/kidtube/orion', quettaLatest = join(ROOT, 'docs/latest.json'), allowDirty = false } = {}) {
  const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
  const { version } = manifest;
  const commit = sourceCommit(src);
  if (commit?.endsWith('-dirty') && !allowDirty) throw new Error(`${src} has uncommitted changes: commit them first, so this release can be traced to a commit`);
  const sourceHash = createHash('sha256').update(zipDir(src)).digest('hex');

  // A version number means one set of files, whichever browser it was released for.
  const prev = readJson(join(out, 'latest.json'));
  if (prev && cmpVersion(version, prev.version) < 0) throw new Error(`version ${version} is older than the published Orion ${prev.version}`);
  if (prev?.version === version && prev.sourceHash !== sourceHash) {
    throw new Error(`extension/ changed since Orion ${version} was built, but the version is still ${version}: bump "version" in extension/manifest.json`);
  }
  const quetta = readJson(quettaLatest);
  if (quetta?.version === version && quetta.sourceCommit && commit && !commit.endsWith('-dirty')) {
    let same = true;
    try { git('diff', '--quiet', quetta.sourceCommit.replace(/-dirty$/, ''), commit, '--', resolve(src)); } catch { same = false; }
    if (!same) throw new Error(`Quetta ${version} was released from different code: bump "version" in extension/manifest.json`);
  }

  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  cpSync(src, stage, { recursive: true });
  const targetFile = join(stage, 'lib/target.js');
  const target = readFileSync(targetFile, 'utf8');
  if (!/export const TARGET = 'quetta';/.test(target)) throw new Error('lib/target.js no longer has the line `export const TARGET = \'quetta\';`');
  writeFileSync(targetFile, target.replace(/export const TARGET = 'quetta';/, "export const TARGET = 'orion';"));
  writeFileSync(join(stage, 'manifest.json'), JSON.stringify(orionManifest(manifest), null, 2) + '\n');

  mkdirSync(out, { recursive: true });
  const zipName = `kidtube-orion-${version}.zip`;
  for (const f of readdirSync(out)) if (/^kidtube-orion-.*\.zip$/.test(f) && f !== zipName) rmSync(join(out, f));
  writeFileSync(join(out, zipName), zipDir(stage));
  const latest = {
    version, target: 'orion', zipUrl: `${baseUrl.replace(/\/$/, '')}/${zipName}`,
    sourceCommit: commit, sourceHash, builtAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    quizTypes: readJson(join(src, 'quiz-types.json')) ?? [],
  };
  writeFileSync(join(out, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
  return { ...latest, zipPath: join(out, zipName), previous: prev?.version ?? null, previousCommit: prev?.sourceCommit ?? null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { out: { type: 'string' }, 'base-url': { type: 'string' }, 'allow-dirty': { type: 'boolean', default: false } } });
  try {
    const r = buildOrion({ ...(values.out ? { out: resolve(values.out) } : {}), ...(values['base-url'] ? { baseUrl: values['base-url'] } : {}), allowDirty: values['allow-dirty'] });
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.error(`build-orion: ${e.message}`);
    process.exit(1);
  }
}
