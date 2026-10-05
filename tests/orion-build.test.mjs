// The Orion build: made from extension/ by tools/build-orion.mjs, and how that build behaves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOrion, orionManifest } from '../tools/build-orion.mjs';
import { checkExtension } from '../tools/orion-check.mjs';
import { installFakeChrome } from './fake-chrome.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'kidtube-orion-'));
const src = join(tmp, 'src'), out = join(tmp, 'out'), stage = join(tmp, 'stage');
cpSync('extension', src, { recursive: true });
const version = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8')).version;
const opts = { src, out, stage, baseUrl: 'https://example.test/orion', quettaLatest: join(tmp, 'none.json') };
const built = buildOrion(opts);

test('the Orion build differs from extension/ only in the target and the manifest', () => {
  assert.match(readFileSync(join(stage, 'lib/target.js'), 'utf8'), /export const TARGET = 'orion';/);
  assert.match(readFileSync(join(src, 'lib/target.js'), 'utf8'), /export const TARGET = 'quetta';/);
  const m = JSON.parse(readFileSync(join(stage, 'manifest.json'), 'utf8'));
  assert.equal(m.update_url, undefined);
  assert.equal(m.minimum_chrome_version, undefined);
  assert.equal(m.version_name, `${version} Orion`);
  assert.ok(!m.permissions.some((p) => p.startsWith('declarativeNetRequest')));
  assert.equal(readFileSync(join(stage, 'sw.js'), 'utf8'), readFileSync(join(src, 'sw.js'), 'utf8'));
  assert.deepEqual(orionManifest({ version: '1.2.3', permissions: ['storage', 'declarativeNetRequest'], update_url: 'x' }), { version: '1.2.3', permissions: ['storage'], version_name: '1.2.3 Orion' });
});

test('latest.json names the zip, the version and the source', () => {
  const latest = JSON.parse(readFileSync(join(out, 'latest.json'), 'utf8'));
  assert.equal(latest.version, version);
  assert.equal(latest.target, 'orion');
  assert.equal(latest.zipUrl, `https://example.test/orion/kidtube-orion-${version}.zip`);
  assert.match(latest.sourceHash, /^[0-9a-f]{64}$/);
  assert.ok(existsSync(join(out, `kidtube-orion-${version}.zip`)));
  assert.deepEqual(readFileSync(join(out, 'kidtube-orion.zip')), readFileSync(join(out, `kidtube-orion-${version}.zip`)));
  assert.equal(latest.stableZipUrl, 'https://example.test/orion/kidtube-orion.zip');
  assert.equal(built.previous, null);
});

test('same code builds again; changed code with the same version is refused', () => {
  assert.equal(buildOrion(opts).previous, version);
  writeFileSync(join(src, 'ui/home.js'), readFileSync(join(src, 'ui/home.js'), 'utf8') + '\n// changed\n');
  assert.throws(() => buildOrion(opts), /bump "version"/);
});

test('every chrome.* API in use is supported by Orion or handled for its build', () => {
  const r = checkExtension('extension');
  assert.equal(r.errors, 0, r.apis.filter((a) => a.level === 'error').map((a) => `${a.api} ${a.at.join(' ')}`).join('\n'));
});

// The built service worker, with Orion's missing pieces.
const fake = installFakeChrome();
let dnrCalls = 0;
fake.declarativeNetRequest.updateDynamicRules = async () => { dnrCalls++; };
fake.runtime.requestUpdateCheck = () => { throw new Error('the Orion build must not ask for updates'); };
const fetched = [];
const fakeFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  fetched.push(String(url));
  if (String(url).endsWith('/orion/latest.json')) return { ok: true, status: 200, json: async () => ({ version: '99.0.0' }) };
  return fakeFetch(url, init);
};
await import(join(stage, 'sw.js'));
const send = (msg) => new Promise((resolve) => fake.listeners.message[0](msg, { tab: { id: 3, url: 'https://www.youtube.com/' } }, resolve));

test('Orion build: no blocking rules; other sites go back home', async () => {
  fake.store.data = { config: { schemaVersion: 1, updatedAt: '2026-10-01T00:00:00Z', blockOutboundLinks: true } };
  await fake.listeners.installed[0]();
  assert.equal(dnrCalls, 0);
  fake.nav.updates.length = 0;
  fake.listeners.tabUpdated[0](3, { url: 'https://games.example.com/' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fake.nav.updates.at(-1), 'https://www.youtube.com/');
});

test('Orion build: updates are manual and come from orion/latest.json', async () => {
  const r = await send({ type: 'checkUpdate' });
  assert.equal(r.check.status, 'manual');
  assert.equal(r.latest, '99.0.0');
  assert.equal(r.installPage, 'https://andyvauliln.github.io/kidtube/#orion');
  assert.ok(fetched.includes('https://andyvauliln.github.io/kidtube/orion/latest.json'));
});

test('Orion build: the background answers a ping with its build', async () => {
  const r = await send({ type: 'ping' });
  assert.equal(r.ok, true);
  assert.equal(r.target, 'orion');
});
