#!/usr/bin/env node
// The bridge server of dev mode (docs/plans/DEVICE-BRIDGE.md). Tablets with dev mode on connect here
// (wss://…/bridge through nginx → 127.0.0.1:<port>, extension/core/background/bridge.js); the MCP server
// (agent/devices/mcp.mjs) sends them commands through this relay's local socket. No AI here.
//   node agent/devices/relay.mjs        (agent/poll.sh starts it when it is not running)
// A tablet is accepted when devices/<device>/bridge.json in the data repo says on, with the SHA-256 of the key the
// tablet sends, and its time is not over. Every command goes to <state>/devices/log/<device>.jsonl.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, appendFileSync, readdirSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { devicesConfig, DEVICE_ID } from './common.mjs';

const HELLO_MS = 10000;
const DEFAULT_MS = 30000;
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
const now = () => new Date().toISOString();

// --- who may connect ----------------------------------------------------------------------------------------------
// The data repo's file for a device: the clone poll.sh keeps (fresh within a minute); fetched when it says no, since
// the tablet writes the file a moment before it connects.
export function bridgeFile(dataDir, device, { fetch = true } = {}) {
  if (!DEVICE_ID.test(device)) return null;
  const path = `devices/${device}/bridge.json`;
  const read = () => { try { return JSON.parse(readFileSync(join(dataDir, path), 'utf8')); } catch { return null; } };
  const local = read();
  if (local?.on || !fetch) return local;
  try {
    execFileSync('git', ['-C', dataDir, 'fetch', '--quiet', 'origin'], { stdio: 'ignore', timeout: 20000 });
    return JSON.parse(execFileSync('git', ['-C', dataDir, 'show', `origin/HEAD:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { return local; }
}
const ended = (file, at = Date.now()) => !!file?.until && Date.parse(file.until) < at;
// Why a hello is refused, or null.
export function refusal(file, hello, at = Date.now()) {
  if (!file) return 'no devices/<device>/bridge.json in the data repo (turn dev mode on again)';
  if (!file.on) return 'dev mode is off for this tablet in the data repo';
  if (ended(file, at)) return 'dev mode ended for this tablet';
  if (!hello?.key || sha256(hello.key) !== file.keyHash) return 'the key does not match the data repo';
  return null;
}

// --- the relay ------------------------------------------------------------------------------------------------------
export function startRelay(cfg = devicesConfig(), { log = console.log } = {}) {
  const devices = new Map();   // device → { ws, hello, file, since, lastSeen, pending }
  mkdirSync(join(cfg.dir, 'log'), { recursive: true });
  const record = (device, line) => { try { appendFileSync(join(cfg.dir, 'log', `${device}.jsonl`), `${JSON.stringify({ at: now(), ...line })}\n`); } catch {} };

  // The tablets.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  const web = createServer((req, res) => { res.writeHead(404); res.end('dev mode bridge\n'); });
  web.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/bridge')) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => welcome(ws, req));
  });
  function welcome(ws, req) {
    const from = req.headers['x-real-ip'] ?? req.socket.remoteAddress;
    let device = null;
    const timer = setTimeout(() => { ws.close(4000, 'no hello'); }, HELLO_MS);
    ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (!device) {
        if (m.type !== 'hello') return;
        clearTimeout(timer);
        const file = bridgeFile(cfg.dataDir, String(m.device ?? ''));
        const why = DEVICE_ID.test(String(m.device ?? '')) ? refusal(file, m) : 'not a tablet id';
        if (why) {
          log(`${now()} refused ${String(m.device).slice(0, 20)} from ${from}: ${why}`);
          ws.send(JSON.stringify({ type: 'refused', error: why }));
          ws.close(4001, why.slice(0, 100));
          return;
        }
        device = m.device;
        const old = devices.get(device);
        if (old) old.ws.close(4002, 'connected again');
        const { key: _key, ...hello } = m;
        devices.set(device, { ws, hello, file, since: now(), lastSeen: now(), from, pending: new Map() });
        ws.send(JSON.stringify({ type: 'welcome' }));
        record(device, { event: 'connected', version: m.version, target: m.target, from });
        log(`${now()} ${device} connected (${m.version} ${m.target}) from ${from}`);
        return;
      }
      const d = devices.get(device);
      if (!d || d.ws !== ws) return;
      d.lastSeen = now();
      if (m.type === 'answer') {
        const p = d.pending.get(m.id);
        if (p) { d.pending.delete(m.id); clearTimeout(p.timer); p.resolve(m); }
      }
    });
    ws.on('close', () => {
      clearTimeout(timer);
      const d = device && devices.get(device);
      if (!d || d.ws !== ws) return;
      for (const p of d.pending.values()) { clearTimeout(p.timer); p.resolve({ ok: false, error: 'The tablet went away (the browser closed, the screen locked, or dev mode turned off).' }); }
      devices.delete(device);
      record(device, { event: 'disconnected' });
      log(`${now()} ${device} disconnected`);
    });
  }
  // Dev mode's time over, or turned off in a newer file of the data repo: the socket closes (checked every minute).
  // (The tablet closes it itself when the parent turns dev mode off; this is for a tablet that could not.)
  const sweep = setInterval(() => {
    for (const d of devices.values()) {
      const cur = bridgeFile(cfg.dataDir, d.hello.device, { fetch: false });
      const file = cur && Date.parse(cur.at) > Date.parse(d.file.at) ? cur : d.file;
      if (!file.on || ended(file)) d.ws.close(4003, 'dev mode is off or ended');
    }
  }, 60000);

  function command(device, cmd, args = {}, ms = DEFAULT_MS) {
    const d = devices.get(device);
    if (!d) return Promise.resolve({ ok: false, error: `${device} is not connected. Dev mode must be on there, with the app open (an iPad or a locked screen stops it).` });
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const t0 = Date.now();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { d.pending.delete(id); resolve({ ok: false, error: `No answer from ${device} in ${ms} ms.` }); }, ms);
      d.pending.set(id, { resolve, timer });
      d.ws.send(JSON.stringify({ type: 'cmd', id, cmd, args }));
    }).then((a) => {
      record(device, { cmd, args: logArgs(args), ok: a.ok, ms: Date.now() - t0, ...(a.ok ? {} : { error: String(a.error).slice(0, 300) }) });
      return a;
    });
  }
  // The devices with dev mode on in the data repo, connected or not.
  function list() {
    const out = [];
    let known = [];
    try { known = readdirSync(join(cfg.dataDir, 'devices')).filter((x) => DEVICE_ID.test(x)); } catch {}
    for (const device of new Set([...known, ...devices.keys()])) {
      const d = devices.get(device);
      const file = d?.file ?? bridgeFile(cfg.dataDir, device, { fetch: false });
      if (!d && !file?.on) continue;
      out.push({ device, connected: !!d, since: d?.since ?? null, lastSeen: d?.lastSeen ?? null,
        version: d?.hello.version ?? file?.version ?? null, target: d?.hello.target ?? file?.target ?? null,
        userAgent: d?.hello.userAgent ?? file?.userAgent ?? null, kidtubeDevice: d?.hello.kidtubeDevice ?? file?.kidtubeDevice ?? null,
        devModeSince: file?.at ?? null, until: file?.until ?? null });
    }
    return out;
  }

  // The MCP server's side: a unix socket only this user can open.
  const api = createServer(async (req, res) => {
    const reply = (code, json) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
    try {
      if (req.method === 'GET' && req.url === '/devices') return reply(200, { ok: true, devices: list() });
      if (req.method === 'POST' && req.url === '/cmd') {
        let body = '';
        for await (const c of req) body += c;
        const { device, cmd, args, ms } = JSON.parse(body || '{}');
        return reply(200, await command(String(device), String(cmd), args ?? {}, Math.min(Number(ms) || DEFAULT_MS, 120000)));
      }
      reply(404, { ok: false, error: 'GET /devices or POST /cmd' });
    } catch (e) { reply(500, { ok: false, error: String(e?.message ?? e) }); }
  });
  mkdirSync(cfg.dir, { recursive: true });
  rmSync(cfg.socket, { force: true });
  api.listen(cfg.socket, () => { try { chmodSync(cfg.socket, 0o600); } catch {} });
  web.listen(cfg.port, '127.0.0.1');
  writeFileSync(join(cfg.dir, 'relay.pid'), String(process.pid));
  log(`${now()} relay: tablets on 127.0.0.1:${cfg.port}/bridge, agents on ${cfg.socket}`);
  return {
    devices, command, list,
    ready: () => Promise.all([new Promise((r) => (web.listening ? r() : web.once('listening', r))), new Promise((r) => (api.listening ? r() : api.once('listening', r)))]),
    close: () => { clearInterval(sweep); for (const d of devices.values()) d.ws.close(); wss.close(); web.close(); api.close(); rmSync(cfg.socket, { force: true }); },
  };
}
// A command's arguments in the log: what was typed is shortened, never a picture.
const logArgs = (args) => JSON.parse(JSON.stringify(args ?? {}, (k, v) => (typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v)));

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = devicesConfig();
  if (!existsSync(cfg.dataDir)) { console.error(`No data repo clone at ${cfg.dataDir}.`); process.exit(1); }
  startRelay(cfg);
}
