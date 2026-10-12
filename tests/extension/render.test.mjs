// kid/render.js: the kid's screens with a tiny fake DOM (no browser needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../extension/apps/kidtube/kid/render.js', import.meta.url), 'utf8');

function node(tag) {
  const cls = new Set();
  return {
    tag, children: [], style: {}, attrs: {}, textContent: '', hidden: false,
    get className() { return [...cls].join(' '); }, set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); },
    classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)),
      toggle: (c, on = !cls.has(c)) => (on ? cls.add(c) : cls.delete(c), on), contains: (c) => cls.has(c) },
    append(...n) { this.children.push(...n); }, replaceChildren(...n) { this.children = n; },
    get firstChild() { return this.children[0] ?? null; },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {},
  };
}

// render.js with a fake document and a KidTubeWatch that runs the screen checks at once.
function load() {
  const results = [];
  const ctx = {
    document: { createElement: node, createElementNS: (ns, t) => node(t) },
    chrome: { runtime: { getURL: (p) => p } },
    setInterval: () => 0, clearInterval() {},
    KidTubeWatch: {
      check(def, fn) {
        const t = { mismatch: [], skipped: null, notes: {},
          ok(what, v, actual, expected) { if (!v) this.mismatch.push({ what, expected, actual }); return !!v; },
          note(k, v) { this.notes[k] = v; }, skip(why) { this.skipped = why; return this; } };
        fn(t);
        results.push({ id: def.id, result: t.skipped ? 'skip' : t.mismatch.length ? 'fail' : 'pass', t });
      },
    },
  };
  ctx.globalThis = ctx;
  vm.runInNewContext(SRC, ctx);
  return { UI: ctx.KidTubeUI, results };
}

// Report kid.list|quetta and rule.pageError.render-js-172|quetta (0.10.4): the YouTube tile in parent mode.
// The content script covers YouTube with the home frame until the state says no KidTube profile runs; the frame
// asked meanwhile and got the blank app's state (no list), and refresh() threw on st.videos.map.
const BLANK = { app: 'blank', parentMode: true, shell: { on: true, locked: false } };

test('home: the state of another app (plain YouTube) draws nothing and throws nothing', async () => {
  const { UI, results } = load();
  const root = node('body');
  const home = UI.mountHome(root, { ask: async () => BLANK });
  await home.refresh();
  await new Promise((r) => setTimeout(r, 0));
  const kid = results.filter((r) => r.id === 'kid.list');
  assert.equal(kid.length, 1);
  assert.equal(kid[0].result, 'skip', 'no KidTube profile runs: not his list to check');
  assert.equal(root.children[1].children.length, 0, 'the home body stays empty');
});

test('strip: the state of another app throws nothing', async () => {
  const { UI } = load();
  const strip = UI.mountStrip(node('body'), { ask: async () => BLANK });
  await strip.refresh();
});

test('home: KidTube runs but the state has no list: kid.list fails and the problem screen shows', async () => {
  const { UI, results } = load();
  const root = node('body');
  const home = UI.mountHome(root, { ask: async () => ({ app: 'kidtube', parentMode: false, shell: { on: false } }) });
  await home.refresh();
  assert.equal(results.find((r) => r.id === 'kid.list').result, 'fail');
  assert.equal(root.children[1].children.length, 1);
});

test('home: his list draws its cards', async () => {
  const { UI, results } = load();
  const root = node('body');
  const videos = [{ videoId: 'a1', title: 'A' }, { videoId: 'b2', title: 'B' }];
  const home = UI.mountHome(root, { ask: async () => ({ app: 'kidtube', videos, lock: null, shell: { on: false } }) });
  await home.refresh();
  assert.equal(results.find((r) => r.id === 'kid.list').result, 'pass');
  assert.equal(root.children[1].children.length, 1);
});
