// Just enough of the chrome.* API to run extension/sw.js in node.
import { readFileSync } from 'node:fs';

export function installFakeChrome() {
  const store = {};
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => ((listeners[name] ??= []).push(fn)) });
  const nav = { updates: [] };
  const fake = {
    store, listeners, nav, rules: [],
    runtime: {
      getURL: (p) => `ext://${p}`, getManifest: () => ({ version: '0.1.0' }),
      onMessage: on('message'), onInstalled: on('installed'), onStartup: on('startup'), onUpdateAvailable: on('updateAvailable'),
      requestUpdateCheck: (cb) => cb('throttled'), reload: () => {},
      openOptionsPage: async () => { throw new Error('not here'); },
    },
    storage: { local: {
      get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
      set: async (obj) => { for (const [k, v] of Object.entries(obj)) store[k] = structuredClone(v); },
      remove: async (k) => { delete store[k]; },
    } },
    tabs: {
      onUpdated: on('tabUpdated'), onRemoved: on('tabRemoved'),
      update: async (id, { url }) => { nav.updates.push(url); },
      create: async ({ url }) => { nav.created = [...(nav.created ?? []), url]; return { id: 99 }; },
    },
    alarms: { create: () => {}, onAlarm: on('alarm') },
    declarativeNetRequest: { updateDynamicRules: async (r) => { fake.rules = r.addRules; } },
  };
  globalThis.chrome = fake;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('ext://')) {
      const body = readFileSync(new URL(`../extension/${String(url).slice(6)}`, import.meta.url), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    }
    return { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } };
  };
  return fake;
}
