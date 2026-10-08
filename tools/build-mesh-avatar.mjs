// Bundles the mesh-avatar-studio engine (https://github.com/shinshin86/mesh-avatar-studio, MIT) into one ES module
// for the talking friend: extension/vendor/mesh-avatar/mesh-avatar.js. Avatars go in extension/avatars/<name>/
// (rig.json + built/ from a studio project), and presenter.avatar = "<name>" shows one.
//   git clone --depth 1 https://github.com/shinshin86/mesh-avatar-studio /tmp/mas
//   node tools/build-mesh-avatar.mjs /tmp/mas
import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve(process.argv[2] ?? '');
const out = 'extension/vendor/mesh-avatar';
const commit = execFileSync('git', ['-C', src, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
execFileSync('npx', ['--yes', 'esbuild@0.25.10', `${src}/src/engine/index.ts`, '--bundle', '--format=esm', '--target=chrome111,safari16',
  '--legal-comments=none', `--outfile=${out}/mesh-avatar.js`,
  `--banner:js=// mesh-avatar-studio engine, bundled from https://github.com/shinshin86/mesh-avatar-studio @ ${commit} (MIT, see LICENSE). Rebuild: node tools/build-mesh-avatar.mjs <checkout>`],
{ stdio: 'inherit' });
copyFileSync(`${src}/LICENSE`, `${out}/LICENSE`);
console.log(`${out}/mesh-avatar.js from ${commit}`);
