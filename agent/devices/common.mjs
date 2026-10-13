// What the relay (relay.mjs), the MCP server (mcp.mjs) and the lab (agent/lab/lab.mjs) share: the settings
// (agent/config.json "devices"), where things live, and a request to the relay on its local socket.
import { readFileSync, existsSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ROOT = join(import.meta.dirname, '../..');
const home = (p) => String(p ?? '').replace(/^~/, homedir());
const config = () => JSON.parse(readFileSync(join(ROOT, 'agent/config.json'), 'utf8'));

// devices: { enabled, relayUrl, port, lab }. Off (enabled: false): poll.sh starts the agents as before.
export function devicesConfig() {
  const c = config();
  const d = c.devices ?? {};
  const state = home(process.env.KIDTUBE_STATE_DIR ?? c.stateDir ?? '~/.local/share/kidtube/state');
  return {
    enabled: d.enabled !== false && !!c.devices,
    relayUrl: d.relayUrl ?? 'wss://68-183-124-79.sslip.io/bridge',
    port: Number(process.env.KIDTUBE_RELAY_PORT ?? d.port ?? 8790),
    lab: d.lab !== false,
    dataDir: home(process.env.KIDTUBE_DATA_DIR ?? c.dataDir),
    dir: join(state, 'devices'),
    socket: process.env.KIDTUBE_RELAY_SOCKET ?? join(state, 'devices', 'relay.sock'),
  };
}

// A tablet's id as the extension makes it (core/checks/runner.js deviceIdNow): nothing else reaches a path.
export const DEVICE_ID = /^tab-[0-9a-f]{8}$/;

// The relay's local API: GET /devices, POST /cmd { device, cmd, args, ms }. Rejects when the relay is not running.
export function relay(method, path, body, socket = devicesConfig().socket) {
  return new Promise((resolve, reject) => {
    if (!existsSync(socket)) return reject(new Error(`The relay is not running (no ${socket}). agent/poll.sh starts it within a minute; or run node agent/devices/relay.mjs.`));
    const data = body ? JSON.stringify(body) : null;
    const req = request({ socketPath: socket, method, path, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => { try { resolve(JSON.parse(text)); } catch { reject(new Error(`The relay answered ${res.statusCode}: ${text.slice(0, 200)}`)); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
