// core/ui/watch.js: the rule "no dead buttons" with a tiny fake page (no browser needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../extension/core/ui/watch.js', import.meta.url), 'utf8');
const BASE = 'chrome-extension://kt/';

// watch.js on an Instagram page: the timers run when the test says, the background's messages are kept.
function load() {
  const timers = [], sent = [];
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.attrs = {}; this.textContent = ''; this.className = ''; this.disabled = false; this.isConnected = true; this.rects = 1; }
    matches(sel) { return sel.split(',').some((s) => s.trim() === this.tagName.toLowerCase()); }
    closest() { return null; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    getClientRects() { return { length: this.rects }; }
  }
  const listeners = {};
  const ctx = {
    Element,
    location: { href: 'https://www.instagram.com/an_dreidel/saved/all-posts/', pathname: '/an_dreidel/saved/all-posts/', hash: '' },
    document: { visibilityState: 'visible', title: 'Instagram', documentElement: {} },
    innerWidth: 1788, innerHeight: 833,
    performance: { now: () => 0 },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    addEventListener() {}, removeEventListener() {},
    MutationObserver: class { observe() {} disconnect() {} },   // nothing changes inside the header's own root
    chrome: { runtime: { getURL: (p) => BASE + p, sendMessage: (m, cb) => { sent.push(m); cb?.({ ok: true }); } }, storage: { onChanged: { addListener() {} } } },
  };
  ctx.globalThis = ctx;
  ctx.window = ctx; ctx.top = {};
  vm.runInNewContext(SRC, ctx);
  timers.length = 0;   // the alert's first ask
  const root = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  ctx.KidTubeWatch.watchTaps(root, 'header');
  const tap = (b) => listeners.click({ composedPath: () => [b, root] });
  const later = () => { while (timers.length) timers.shift()(); };
  const dead = () => sent.filter((m) => m.result?.id?.startsWith('rule.deadButton.'));
  return { ctx, tap, later, dead, button: (label) => Object.assign(new ctx.Element('button'), { textContent: label }) };
}

// Report rule.deadButton.Instagram|quetta (0.12.0): in the Instagram app's view the header's App | Instagram
// switch hides the app's layer (apps/instagram/content/app.js siteView): the header itself, inside that layer, does
// not change, but the whole screen does.
test('a tap that hides the header with the app around it is not a dead button', () => {
  const w = load();
  const b = w.button('Instagram');
  w.tap(b);
  b.rects = 0;   // the app's layer: display none
  w.later();
  assert.deepEqual(w.dead(), []);
});

test('a tap after which nothing changes is still a dead button', () => {
  const w = load();
  w.tap(w.button('Instagram'));
  w.later();
  assert.equal(w.dead().length, 1);
  assert.equal(w.dead()[0].result.id, 'rule.deadButton.Instagram');
});
