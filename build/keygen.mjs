#!/usr/bin/env node
// Creates the one signing key. Keep the .pem OUT of git (GitHub secret CRX_KEY for CI).
//   node build/keygen.mjs ~/kidtube-key.pem
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { extensionId, publicKeyDer } from './crx.mjs';

const out = process.argv[2];
if (!out) { console.error('usage: keygen.mjs <out.pem>'); process.exit(2); }
if (existsSync(out)) { console.error(`${out} exists; refusing to overwrite (the extension id depends on it)`); process.exit(1); }
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
writeFileSync(out, privateKey, { mode: 0o600 });
const der = publicKeyDer(privateKey);
console.log(`key file:      ${out}`);
console.log(`extension id:  ${extensionId(der)}`);
console.log(`manifest "key": ${der.toString('base64')}`);
