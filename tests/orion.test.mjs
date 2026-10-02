// Orion (WebKit) has no dynamic blocking rules: the navigation guard keeps him on allowed sites instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.mjs';

const fake = installFakeChrome();
fake.declarativeNetRequest.updateDynamicRules = async () => { throw new Error('not supported'); };
await import('../extension/sw.js');

async function navigate(url, tabId = 5) {
  fake.nav.updates.length = 0;
  fake.listeners.tabUpdated[0](tabId, { url });
  await new Promise((r) => setTimeout(r, 30));
  return fake.nav.updates.at(-1) ?? url;
}

test('without dynamic rules, other websites go back home; allowed ones stay', async () => {
  fake.store.data = { config: { schemaVersion: 1, updatedAt: '2026-10-01T00:00:00Z', blockOutboundLinks: true, allowedSiteDomains: ['wikipedia.org'] } };
  fake.store.dnrWorks = false;
  assert.equal(await navigate('https://games.example.com/play'), 'https://www.youtube.com/');
  assert.equal(await navigate('https://en.wikipedia.org/wiki/Cat'), 'https://en.wikipedia.org/wiki/Cat');
  assert.equal(await navigate('https://andyvauliln.github.io/kidtube/'), 'https://andyvauliln.github.io/kidtube/');
});

test('with blocking off, nothing is redirected', async () => {
  fake.store.data = { config: { schemaVersion: 1, updatedAt: '2026-10-01T00:00:00Z', blockOutboundLinks: false } };
  assert.equal(await navigate('https://games.example.com/play'), 'https://games.example.com/play');
});
