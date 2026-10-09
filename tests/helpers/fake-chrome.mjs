// Just enough of the chrome.* API to run extension/core/background/main.js in node.
import { readFileSync } from 'node:fs';

export function installFakeChrome() {
  // An app runs (no apps header): the tests of the apps header set shell themselves.
  const store = { shell: { on: false, locked: false } };
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
      remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
    } },
    tabs: {
      onUpdated: on('tabUpdated'), onRemoved: on('tabRemoved'),
      update: async (id, { url }) => { nav.updates.push(url); },
      create: async ({ url }) => { nav.created = [...(nav.created ?? []), url]; return { id: 99 }; },
      // The open tabs (nav.tabs: [{ id, url }]); remove() takes them away and notes the ids.
      query: async () => structuredClone(nav.tabs ?? []),
      remove: async (ids) => { nav.removed = [...(nav.removed ?? []), ...[].concat(ids)]; nav.tabs = (nav.tabs ?? []).filter((t) => !nav.removed.includes(t.id)); },
    },
    alarms: { create: () => {}, onAlarm: on('alarm') },
    declarativeNetRequest: { updateDynamicRules: async (r) => { fake.rules = r.addRules; } },
  };
  globalThis.chrome = fake;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('ext://')) {
      const body = readFileSync(new URL(`../../extension/${String(url).slice(6)}`, import.meta.url), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    }
    return { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } };
  };
  return fake;
}
