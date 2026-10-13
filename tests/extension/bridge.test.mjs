// Dev mode (core/background/bridge.js): off by default, on only where the header can act, the key's hash in the data
// repo, the socket to the bridge server, the commands, what it refuses, and off again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { installFakeChrome } from '../helpers/fake-chrome.mjs';

// A bridge server: the sockets the worker opens, what it sent, and the server's side of a command.
class FakeSocket {
  static all = [];
  constructor(url) {
    this.url = url; this.readyState = 0; this.sent = [];
    FakeSocket.all.push(this);
    setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
  }
  send(d) { this.sent.push(JSON.parse(d)); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.(); }
  says(m) { this.onmessage?.({ data: JSON.stringify(m) }); }
}
globalThis.WebSocket = FakeSocket;

const fake = installFakeChrome();
fake.alarms.clear = (name) => { delete fake.alarms.set[name]; };
fake.runtime.id = 'ext-id';
// GitHub's contents API for the data repo: files by path, and every PUT.
const repo = {}, puts = [];
const fakeFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const m = String(url).match(/^https:\/\/api\.github\.com\/repos\/me\/kidtube-data\/contents\/(.+)$/);
  if (!m) return fakeFetch(url, opts);
  const path = m[1];
  if (opts.method === 'PUT') {
    const body = JSON.parse(opts.body);
    const json = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
    puts.push({ path, json });
    repo[path] = { json, sha: `sha${puts.length}` };
    return { ok: true, status: 200, json: async () => ({}) };
  }
  if (!repo[path]) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ content: Buffer.from(JSON.stringify(repo[path].json)).toString('base64'), sha: repo[path].sha }) };
};

const TOKEN = 'github_pat_11AAAAAAA0secretsecretsecret';
fake.store.account = { key: 'kid@example.com', email: 'kid@example.com', app: 'kidtube', folder: 'kid' };
fake.store.settings = { token: TOKEN, repo: 'me/kidtube-data', pinHash: 'pinhash-secret', pinSalt: 'salt', mode: 'kid' };
fake.nav.tabs = [{ id: 7, url: 'https://m.youtube.com/', active: true, windowId: 1, title: 'YouTube' }];
await import('../../extension/core/background/main.js');
const { BRIDGE_URL } = await import('../../extension/core/background/constants.js');

const YT = { tab: { id: 7, url: 'https://m.youtube.com/' } };
const send = (msg, sender = YT) => new Promise((resolve) => fake.listeners.message[0](msg, sender, resolve));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
let ids = 0;
async function command(sock, cmd, args = {}) {
  const id = `c${++ids}`;
  sock.says({ type: 'cmd', id, cmd, args });
  for (let i = 0; i < 100; i++) {
    const a = sock.sent.find((m) => m.type === 'answer' && m.id === id);
    if (a) return a;
    await wait(10);
  }
  throw new Error(`no answer to ${cmd}`);
}

test('dev mode is off by default: no socket, and the header says off', async () => {
  await wait(20);
  assert.equal(FakeSocket.all.length, 0);
  const r = await send({ type: 'devMode', get: true });
  assert.equal(r.dev.on, false);
  assert.equal(r.dev.url, BRIDGE_URL);
  assert.match(BRIDGE_URL, /^wss:\/\/68-183-124-79\.sslip\.io\//);   // this server by default
});

test('dev mode: refused in kid mode, and without GitHub', async () => {
  assert.match((await send({ type: 'devMode', on: true })).error, /PIN/);
  fake.store.settings.mode = 'parent';
  const token = fake.store.settings.token;
  delete fake.store.settings.token;
  assert.match((await send({ type: 'devMode', on: true })).error, /Connect GitHub/);
  fake.store.settings.token = token;
  assert.equal(FakeSocket.all.length, 0);
  assert.equal(puts.length, 0);
});

let sock, device, key;
test('dev mode on: the key’s hash goes to the data repo, the key only to the bridge server', async () => {
  const r = await send({ type: 'devMode', on: true, life: 'hour' });
  assert.equal(r.ok, true, r.error);
  key = fake.store.settings.devKey;
  assert.match(key, /^[0-9a-f]{64}$/);
  const put = puts.at(-1);
  device = put.json.device;
  assert.equal(put.path, `devices/${device}/bridge.json`);
  assert.equal(put.json.on, true);
  assert.equal(put.json.keyHash, sha256(key));
  assert.ok(!JSON.stringify(put.json).includes(key), 'no key in the repo');
  assert.ok(Date.parse(put.json.until) > Date.now() + 3500e3);
  await wait(20);
  sock = FakeSocket.all.at(-1);
  assert.equal(sock.url, BRIDGE_URL);
  const hello = sock.sent[0];
  assert.deepEqual([hello.type, hello.device, hello.key], ['hello', device, key]);
  sock.says({ type: 'welcome' });
  const v = await send({ type: 'devMode', get: true });
  assert.equal(v.dev.on, true);
  assert.equal(v.dev.connected, true);
  assert.ok(fake.alarms.set.bridge, 'the alarm reconnects every minute');
});

test('dev mode: state has the build, the profile and the steps, never the token or the key', async () => {
  const a = await command(sock, 'state');
  assert.equal(a.ok, true, a.error);
  assert.equal(a.result.device, device);
  assert.equal(a.result.context.app.devMode, true);
  assert.equal(a.result.tabs[0].id, 7);
  const s = JSON.stringify(a);
  for (const secret of [TOKEN, key, 'pinhash-secret']) assert.ok(!s.includes(secret), secret.slice(0, 12));
  const st = await command(sock, 'storage', { keys: ['settings'] });
  assert.equal(st.ok, true);
  assert.ok(!JSON.stringify(st).includes(TOKEN) && !JSON.stringify(st).includes(key));
  assert.equal(st.result.settings.mode, 'parent');
});

test('dev mode: a message runs as from the extension’s pages, with its checks; every command counts', async () => {
  const before = fake.store.bridgeLog?.n ?? 0;
  const a = await command(sock, 'message', { msg: { type: 'setMode', mode: 'kid' } });
  assert.equal(a.ok, true, a.error);
  assert.equal(a.result.ok, true);
  assert.equal(fake.store.settings.mode, 'kid');
  assert.equal(fake.store.bridgeLog.n, before + 1);
  assert.equal(fake.store.bridgeLog.cmd, 'message');
  const steps = (await command(sock, 'state')).result.steps;
  assert.ok(steps.some((x) => x.kind === 'ai' && x.type === 'message' && x.label === 'setMode'), JSON.stringify(steps.slice(-3)));
  await command(sock, 'message', { msg: { type: 'setMode', mode: 'parent' } });
});

test('dev mode refuses the rules, the minutes, the GitHub connection, the settings file, the PIN and itself', async () => {
  for (const type of ['saveRules', 'resetToday', 'connectGitHub', 'exportSettings', 'importSettings', 'devMode', 'devStop', 'clearChecks', 'setPin']) {
    const a = await command(sock, 'message', { msg: { type, on: false } });
    assert.equal(a.ok, false, type);
    assert.match(a.error, /Refused in dev mode/, type);
  }
  assert.equal(fake.store.settings.devMode, true);
  assert.match((await command(sock, 'nope')).error, /Unknown command/);
});

test('dev mode navigates to web pages and the extension’s pages, nothing else', async () => {
  const a = await command(sock, 'navigate', { url: 'core/pages/check.html' });
  assert.equal(a.ok, true, a.error);
  assert.equal(fake.nav.at[7], 'ext://core/pages/check.html');
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'chrome://settings']) {
    assert.match((await command(sock, 'navigate', { url })).error, /Not an address/, url);
  }
});

test('dev mode: a page command reaches the tab’s frames and takes their answer', async () => {
  const sent = [];
  fake.tabs.sendMessage = (tabId, msg, cb) => { sent.push({ tabId, msg }); cb?.(); };
  fake.runtime.sendMessage = (msg, cb) => { cb?.(); };
  const answer = command(sock, 'page', { do: 'tap', ref: 'abcde:3' });
  await wait(20);
  const req = sent.at(-1).msg;
  assert.deepEqual([req.type, req.tabId, req.fid, req.do, req.args.ref], ['bridgePage', 7, 'abcde', 'tap', 'abcde:3']);
  await send({ type: 'bridgeFrame', id: req.id, fid: 'abcde', url: 'https://m.youtube.com/', top: true, result: { ok: true, tapped: 'button "Play"' } });
  const a = await answer;
  assert.equal(a.result.tapped, 'button "Play"');
});

test('dev mode ends by itself when its time is over', async () => {
  fake.store.settings.devUntil = Date.now() - 1000;
  const a = await command(sock, 'state');
  assert.equal(a.ok, false);
  assert.match(a.error, /ended/);
  await wait(30);
  assert.equal(fake.store.settings.devMode, false);
});

test('dev mode off: the file says off, the socket closes, nothing more is answered', async () => {
  await send({ type: 'devMode', on: true, life: 'never', url: 'wss://example.org/bridge' });
  await wait(20);
  const s2 = FakeSocket.all.at(-1);
  assert.equal(s2.url, 'wss://example.org/bridge');
  assert.equal(repo[`devices/${device}/bridge.json`].json.until, null);
  assert.notEqual(fake.store.settings.devKey, key, 'a new key each time');
  // Stop on a page works from anywhere, even a YouTube tab in kid mode.
  fake.store.settings.mode = 'kid';
  const r = await send({ type: 'devStop' });
  assert.equal(r.ok, true);
  assert.equal(s2.readyState, 3);
  assert.equal(fake.store.settings.devMode, false);
  assert.equal(fake.store.settings.devKey, undefined);
  const file = repo[`devices/${device}/bridge.json`].json;
  assert.deepEqual([file.on, file.keyHash], [false, null]);
  const n = s2.sent.length;
  s2.says({ type: 'cmd', id: 'late', cmd: 'state', args: {} });
  await wait(50);
  assert.equal(s2.sent.length, n, 'a closed socket gets nothing');
  assert.equal(fake.alarms.set.bridge, undefined);
  await wait(50);
  assert.equal(FakeSocket.all.at(-1), s2, 'no new socket while dev mode is off');
});
