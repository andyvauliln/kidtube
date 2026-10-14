// The Instagram app's screen (apps/instagram/content/app.js) with a tiny fake page (no browser needed): what it does
// with what Instagram's own page receives, and a collection Instagram's web API does not give.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { readerRules } from '../../extension/apps/instagram/lib/rules.js';

const read = (p) => readFileSync(new URL(`../../extension/apps/instagram/${p}`, import.meta.url), 'utf8');
const SRC = { reader: read('lib/reader.js'), api: read('content/api.js'), app: read('content/app.js') };
const FIX = JSON.parse(readFileSync(new URL('../fixtures/ig-collection-page.json', import.meta.url), 'utf8'));
const COL = FIX.meta.collectionId;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// Elements that take whatever the screen does with them.
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.attrs = {}; this.listeners = {}; this.isConnected = true; this.scrollTop = 0;
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; }
  get childElementCount() { return this.children.length; }
  get firstChild() { return this.children[0] ?? null; }
  append(...k) { this.children.push(...k); }
  prepend(...k) { this.children.unshift(...k); }
  replaceChildren(...k) { this.children = k; }
  remove() {}
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; }
  addEventListener(t, fn) { this.listeners[t] = fn; }
  removeEventListener() {}
  attachShadow() { return new El('shadow'); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
}

// view: the tab's view ('app' or 'instagram'). state: igState's answer. fetch(path): Instagram's web API.
// site(): igSite's answer (undefined: none). path: the Instagram page. header: the apps header (core/ui/header.js).
function load({ view = 'instagram', state, fetch, site = () => ({ ok: true, open: true, rules: readerRules() }), path = '/an_dreidel/saved/all-posts/', header = undefined }) {
  const sent = [], listeners = {}, timers = [];
  const answer = (m) => {
    if (m.type === 'igSite') return site();
    if (m.type === 'igState') return state;
    return { ok: true };
  };
  const ctx = {
    location: { href: `https://www.instagram.com${path}`, pathname: path, search: '', hash: '', origin: 'https://www.instagram.com' },
    document: { documentElement: new El('html'), visibilityState: 'visible', cookie: 'ds_user_id=42', createElement: (t) => new El(t), createElementNS: (_, t) => new El(t), querySelectorAll: () => [] },
    sessionStorage: { getItem: () => view, setItem() {} },
    history: { replaceState() {} },
    setTimeout, clearTimeout, setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval() {},
    KidTubeHeader: header, ResizeObserver: class { observe() {} disconnect() {} },
    addEventListener: (t, fn) => { (listeners[t] ??= []).push(fn); }, removeEventListener() {},
    postMessage() {},
    fetch: async (path) => {
      const [status, body] = fetch(String(path));
      return { status, ok: status < 400, url: `https://www.instagram.com${path}`, text: async () => JSON.stringify(body) };
    },
    chrome: { runtime: { sendMessage: (m, cb) => { sent.push(m); cb?.(answer(m)); }, lastError: null }, storage: { onChanged: { addListener() {} } } },
    URL, URLSearchParams, Headers: class {}, FormData: class {}, JSON, Promise, Error, Date,
  };
  ctx.globalThis = ctx; ctx.window = ctx; ctx.top = ctx;
  vm.createContext(ctx);
  for (const s of [SRC.reader, SRC.api, SRC.app]) vm.runInContext(s, ctx);
  // A message from the page world (content/net.js).
  const page = vm.runInContext('window', ctx);   // the context's own global, as the page world's messages say
  const fromPage = (m) => { for (const fn of listeners.message) fn({ source: page, data: { 'kidtube-ig': true, ...m } }); };
  return { ctx, sent, fromPage, timers };
}

const STATE = { ok: true, who: '@an_dreidel', posts: [], collections: [{ id: COL, name: 'Cooking', count: 1 }], defaultCollection: 'all', complete: true, github: true, sync: { errors: [] } };

// Report ig.parentSent|quetta (0.12.0): Instagram's own Saved page showed a collection's post
// (PolarisSavedCollectionPageWWWQuery), and the app did not keep it: that collection stayed empty in the app.
test('a collection’s posts that Instagram’s own page receives go into that collection', async () => {
  const R = (await import('../../extension/apps/instagram/lib/reader.js'), globalThis.KidTubeIgReader);
  const found = R.classify(FIX.meta, FIX.answer, readerRules(), true);
  assert.equal(found.saved, null, 'not the whole saved list');
  assert.deepEqual([found.collection.id, found.collection.media.map((m) => m.code)], [COL, ['DPanCake01']]);

  const w = load({ state: STATE, fetch: () => [404, {}] });
  w.fromPage({ type: 'answer', meta: { id: 3, ...FIX.meta }, found: JSON.parse(JSON.stringify(found)), tag: null });
  await tick();
  const col = w.sent.find((m) => m.type === 'igCollection');
  assert.ok(col, 'the collection’s posts go to the background');
  assert.equal(col.id, COL);
  assert.deepEqual(col.media.map((m) => [m.code, m.pk, m.user.username, m.caption.text]), [['DPanCake01', '3700000000000000001', 'chef', 'Pancakes']]);
  assert.ok(!('media_notes' in col.media[0]), 'cut down like the web API’s posts');
});

// The app's own read of a collection (Instagram's web API) failed: the parent is told how to get its posts, and the
// fix agent gets the report by itself (ig.read), as for a failed read of the saved posts.
test('a collection the web API does not give: a way to get it, and a report by itself', async () => {
  const w = load({ view: 'app', state: { ...STATE, defaultCollection: COL }, fetch: (p) => {
    if (p.startsWith('/api/v1/accounts/edit/')) return [200, { form_data: { username: 'an_dreidel' }, status: 'ok' }];
    if (p.startsWith('/api/v1/feed/saved/posts/')) return [200, { items: [], more_available: false, status: 'ok' }];
    return [404, { message: 'Page not found', status: 'fail' }];
  } });
  for (let i = 0; i < 40 && !w.sent.some((m) => m.type === 'checkResult'); i++) await tick(100);
  const report = w.sent.find((m) => m.type === 'checkResult');
  assert.ok(report, 'a failed collection read is reported');
  assert.equal(report.result.id, 'ig.read');
  assert.match(report.result.mismatch[0].actual, /\/api\/v1\/feed\/collection\/.*404/);
  assert.match(report.result.mismatch[0].actual, /open it on Instagram/i);
});

// The parent's note (2026-10-14): after signing in on Instagram nothing of the app showed (no header, no way back). On
// Instagram's own pages the apps header is now on top while the header may show, as on YouTube; a lost igSite answer
// is asked again; in kid mode (the header closed) there is none.
test('Instagram’s own pages: the apps header on top while the header may show; asked again when the background did not answer', async () => {
  const mounted = [];
  const header = { mount: (host) => { mounted.push(host); return { destroy() { host.gone = true; } }; } };
  let answers = [undefined, { ok: true, open: true, rules: readerRules(), offer: false }];
  const w = load({ state: STATE, fetch: () => [404, {}], path: '/', header, site: () => answers.shift() });
  await tick(20);
  assert.equal(mounted.length, 0, 'no answer yet: nothing to show');
  const realNow = Date.now;
  Date.now = () => realNow() + 6000;   // 6 s later: the page asks again
  try { for (const fn of w.timers) fn(); } finally { Date.now = realNow; }
  await tick(20);
  assert.equal(w.sent.filter((m) => m.type === 'igSite').length, 2, 'igSite asked again');
  assert.equal(mounted.length, 1, 'the apps header is on the page');
  assert.match(mounted[0].style.cssText, /position:fixed!important;top:0!important/, 'fixed at the top');
  for (const fn of w.timers) fn();
  assert.equal(mounted.length, 1, 'only one header');

  // Kid mode: the header is closed, so Instagram has none.
  answers = [{ ok: true, open: false, rules: readerRules() }];
  const k = load({ state: STATE, fetch: () => [404, {}], path: '/', header, site: () => answers.shift() });
  await tick(20);
  for (const fn of k.timers) fn();
  assert.equal(mounted.length, 1, 'no header in kid mode');

  const src = SRC.app;
  assert.match(src, /id: 'instagram\.siteHeader'/, 'its check in the app');
  assert.match(src, /bar\?\.row\?\.toggleAttribute\('hidden', !!topHost\)/, 'the bar keeps only its messages and the offer under the header');
});
