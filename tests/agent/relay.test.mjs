// Dev mode's server side: the relay (agent/devices/relay.mjs) accepts a tablet only with the key whose hash is in the
// data repo, passes the agents' commands and logs them; the MCP server (agent/devices/mcp.mjs) gives them as tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startRelay, refusal } from '../../agent/devices/relay.mjs';
import { relay } from '../../agent/devices/common.mjs';

const dir = mkdtempSync(join(tmpdir(), 'kt-relay-'));
const dataDir = join(dir, 'data'), state = join(dir, 'state', 'devices');
const KEY = 'a'.repeat(64), DEVICE = 'tab-1234abcd';
const file = (over = {}) => ({ schemaVersion: 1, device: DEVICE, on: true, keyHash: createHash('sha256').update(KEY).digest('hex'), until: null, at: new Date().toISOString(), version: '0.12.16', target: 'quetta', ...over });
mkdirSync(join(dataDir, 'devices', DEVICE), { recursive: true });
writeFileSync(join(dataDir, 'devices', DEVICE, 'bridge.json'), JSON.stringify(file()));
const cfg = { dataDir, dir: state, socket: join(state, 'relay.sock'), port: 18790 + Math.floor(Math.random() * 1000) };
const r = startRelay(cfg, { log: () => {} });
await r.ready();
test.after(() => r.close());

// A tablet: says hello, answers each command with what answer() gives.
function tablet(hello, answer = (m) => ({ ok: true, result: { echo: m.cmd, args: m.args } })) {
  const ws = new WebSocket(`ws://127.0.0.1:${cfg.port}/bridge`);
  const said = [];
  const done = new Promise((resolve) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', ...hello })));
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      said.push(m);
      if (m.type === 'welcome' || m.type === 'refused') resolve(m);
      if (m.type === 'cmd') ws.send(JSON.stringify({ type: 'answer', id: m.id, ...answer(m) }));
    });
    ws.on('close', () => resolve({ type: 'closed' }));
  });
  return { ws, said, done };
}

test('refusal: no file, off, ended, a wrong key', () => {
  assert.match(refusal(null, { key: KEY }), /no devices/);
  assert.match(refusal(file({ on: false }), { key: KEY }), /off/);
  assert.match(refusal(file({ until: new Date(Date.now() - 1000).toISOString() }), { key: KEY }), /ended/);
  assert.match(refusal(file(), { key: 'b'.repeat(64) }), /key/);
  assert.equal(refusal(file(), { key: KEY }), null);
});

test('the relay refuses a wrong key and a made-up device id', async () => {
  assert.equal((await tablet({ device: DEVICE, key: 'nope' }).done).type, 'refused');
  assert.equal((await tablet({ device: '../../etc', key: KEY }).done).type, 'refused');
  assert.equal((await tablet({ device: 'tab-99999999', key: KEY }).done).type, 'refused');
  assert.deepEqual((await relay('GET', '/devices', null, cfg.socket)).devices.map((d) => [d.device, d.connected]), [[DEVICE, false]]);
});

let t;
test('the relay passes a command to the tablet and its answer back, and logs it', async () => {
  t = tablet({ device: DEVICE, key: KEY, version: '0.12.16', target: 'quetta' });
  assert.equal((await t.done).type, 'welcome');
  const list = (await relay('GET', '/devices', null, cfg.socket)).devices;
  assert.equal(list[0].connected, true);
  assert.ok(!JSON.stringify(list).includes(KEY), 'the key stays out');
  const a = await relay('POST', '/cmd', { device: DEVICE, cmd: 'state', args: { x: 1 } }, cfg.socket);
  assert.deepEqual(a.result, { echo: 'state', args: { x: 1 } });
  const log = readFileSync(join(state, 'log', `${DEVICE}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log.map((l) => l.event ?? l.cmd), ['connected', 'state']);
  assert.match((await relay('POST', '/cmd', { device: 'tab-00000000', cmd: 'state' }, cfg.socket)).error, /not connected/);
});

test('the MCP server gives the relay’s devices and commands as tools', async () => {
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['agent/devices/mcp.mjs'],
    env: { ...process.env, KIDTUBE_RELAY_SOCKET: cfg.socket, KIDTUBE_STATE_DIR: join(dir, 'state') } }));
  try {
    const names = (await client.listTools()).tools.map((x) => x.name);
    for (const n of ['device_list', 'device_state', 'device_snapshot', 'device_tap', 'device_type', 'device_message', 'device_screenshot', 'device_update']) assert.ok(names.includes(n), n);
    const list = await client.callTool({ name: 'device_list', arguments: {} });
    assert.match(list.content[0].text, new RegExp(DEVICE));
    const st = await client.callTool({ name: 'device_state', arguments: {} });   // the only connected tablet
    assert.match(st.content[0].text, /"echo": "state"/);
    const bad = await client.callTool({ name: 'device_state', arguments: { device: 'tab-00000000' } });
    assert.equal(bad.isError, true);
  } finally { await client.close(); }
});

test('a tablet that goes away: the waiting command ends, the tablet is not connected', async () => {
  const slow = tablet({ device: DEVICE, key: KEY }, () => ({ ok: true }));
  await slow.done;
  t.ws.terminate();
  slow.ws.removeAllListeners('message');
  const p = relay('POST', '/cmd', { device: DEVICE, cmd: 'state', ms: 5000 }, cfg.socket);
  setTimeout(() => slow.ws.close(), 100);
  assert.match((await p).error, /went away|No answer/);
  await new Promise((res) => setTimeout(res, 100));
  assert.equal((await relay('GET', '/devices', null, cfg.socket)).devices[0].connected, false);
});

test('poll.sh: devices off gives the agents today’s command line; on adds the device tools', async () => {
  const { readFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const sh = readFileSync('agent/poll.sh', 'utf8');
  const expr = sh.match(/DEVICES=\$\(cfg "([^"]+)"\)/)[1];
  const devices = (c) => String(new Function('c', `return (${expr})`)(c) ?? '');
  assert.equal(devices({}), '');
  assert.equal(devices({ devices: { enabled: false } }), '');
  assert.equal(devices({ devices: { enabled: true } }), 'on');
  // Both agents' commands take the extra arguments only through the guarded arrays (empty under set -u: nothing).
  assert.equal(sh.match(/\$\{AGENT_TOOLS\[@\]\+"\$\{AGENT_TOOLS\[@\]\}"\} \\\n\s+\$\{AGENT_MCP\[@\]\+"\$\{AGENT_MCP\[@\]\}"\} --add-dir/g)?.length, 2);
  const line = (on) => execFileSync('bash', ['-c', `set -u; AGENT_TOOLS=(); AGENT_MCP=(); ${on ? 'AGENT_TOOLS=("mcp__device"); AGENT_MCP=(--mcp-config agent/devices/mcp.json);' : ''}
    printf '[%s]' "Task" \${AGENT_TOOLS[@]+"\${AGENT_TOOLS[@]}"} \${AGENT_MCP[@]+"\${AGENT_MCP[@]}"} --add-dir`], { encoding: 'utf8' });
  assert.equal(line(false), '[Task][--add-dir]');
  assert.equal(line(true), '[Task][mcp__device][--mcp-config][agent/devices/mcp.json][--add-dir]');
});
