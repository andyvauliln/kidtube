#!/usr/bin/env node
// Packs and signs an extension directory and writes updates.xml + latest.json next to the CRX.
//   node build/pack.mjs <ext-dir> --key <key.pem> --out <dist-dir> --base-url https://OWNER.github.io/kidtube
// The key comes from a file or the CRX_KEY environment variable (CI).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { buildCrx, extensionId, publicKeyDer, updatesXml, zipDir } from './crx.mjs';
import { sourceCommit } from './build-orion.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { key: { type: 'string' }, out: { type: 'string', default: 'dist' }, 'base-url': { type: 'string' } } });
const [extDir] = positionals;
if (!extDir || !values['base-url']) { console.error('usage: pack.mjs <ext-dir> --key key.pem --out dist --base-url URL'); process.exit(2); }

const pem = values.key ? readFileSync(values.key, 'utf8') : process.env.CRX_KEY;
if (!pem) { console.error('no key: pass --key or set CRX_KEY'); process.exit(2); }

const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
const der = publicKeyDer(pem);
if (manifest.key !== der.toString('base64')) { console.error('manifest "key" does not match the signing key; the extension id would change'); process.exit(1); }

const id = extensionId(der);
const base = values['base-url'].replace(/\/$/, '');
const crxName = `${manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${manifest.version}.crx`;
mkdirSync(values.out, { recursive: true });
const zip = zipDir(extDir);
writeFileSync(join(values.out, crxName), buildCrx(zip, pem));
// Same files unsigned, for browsers that install from a .zip (the manifest "key" keeps the id the same).
writeFileSync(join(values.out, crxName.replace(/\.crx$/, '.zip')), zip);
writeFileSync(join(values.out, 'updates.xml'), updatesXml({ id, version: manifest.version, crxUrl: `${base}/${crxName}` }));
const quizTypesPath = join(extDir, 'apps/kidtube/data/quiz-types.json');
const latest = { version: manifest.version, target: 'quetta', sourceCommit: sourceCommit(extDir), id, crxUrl: `${base}/${crxName}`, zipUrl: `${base}/${crxName.replace(/\.crx$/, '.zip')}`, quizTypes: existsSync(quizTypesPath) ? JSON.parse(readFileSync(quizTypesPath, 'utf8')) : [] };
writeFileSync(join(values.out, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
console.log(`packed ${crxName}  id=${id}  -> ${values.out}/`);
