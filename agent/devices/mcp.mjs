#!/usr/bin/env node
// The device tools of dev mode for Claude Code (an MCP server on stdio; agent/devices/mcp.json names it "device").
// Each tool is one command to a tablet through the relay (agent/devices/relay.mjs) and the extension's bridge
// (extension/core/background/bridge.js, core/ui/bridge.js). docs/plans/DEVICE-BRIDGE.md has the whole design.
//   claude --mcp-config agent/devices/mcp.json     (agent/poll.sh adds it when devices.enabled in agent/config.json)
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { devicesConfig, relay } from './common.mjs';

const cfg = devicesConfig();
const server = new McpServer({ name: 'device', version: '1.0.0' });

const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });

// The device asked for, or the only connected one.
async function pick(device) {
  if (device) return device;
  const { devices = [] } = await relay('GET', '/devices');
  const on = devices.filter((d) => d.connected);
  if (on.length === 1) return on[0].device;
  throw new Error(on.length ? `Several tablets are connected (${on.map((d) => d.device).join(', ')}): name one with device.` : 'No tablet is connected: device_list says which have dev mode on.');
}
async function send(device, cmd, args = {}, ms) {
  const a = await relay('POST', '/cmd', { device: await pick(device), cmd, args, ms });
  if (!a.ok) throw new Error(a.error ?? 'The tablet said no.');
  return a.result;
}
// Every tool: its errors are the tool's answer (the agent reads them), never a crash.
const tool = (name, description, shape, fn) => server.tool(name, description, shape, async (args) => {
  try { return await fn(args); } catch (e) { return fail(String(e?.message ?? e)); }
});

const device = z.string().optional().describe('The tablet id (tab-xxxxxxxx) from device_list or the report’s deviceId; optional when one tablet is connected.');
const tab = z.number().int().optional().describe('A tab id from device_tabs; default: the tab in front.');
const ref = z.string().optional().describe('An element ref from device_snapshot, like "k3f9a:12".');

tool('device_list', 'The tablets with dev mode on: connected now or not, version, browser, since when.', {}, async () => {
  const r = await relay('GET', '/devices');
  return text(r.devices?.length ? r.devices : 'No tablet has dev mode on. The parent turns it on in the apps header: the account menu → Dev mode.');
});

tool('device_state', 'Everything a problem report has, now: build, browser, profile, mode, sync errors, the checks (results and reports), the last 40 steps, the tabs.', { device }, async (a) =>
  text(await send(a.device, 'state')));

tool('device_storage', 'Stored keys of the extension (chrome.storage.local), redacted: no token, key, PIN hash, names or texts.', {
  device, keys: z.array(z.string()).min(1).describe('e.g. ["settings", "syncStatus", "account", "checks"]'),
}, async (a) => text(await send(a.device, 'storage', { keys: a.keys })));

tool('device_tabs', 'The tablet’s open tabs: id, address, title, which is in front.', { device }, async (a) => text(await send(a.device, 'tabs')));

tool('device_snapshot', 'What a tab shows, as an outline: headings, texts, and every button, link and field with a ref for device_tap / device_type. The app’s own screens (closed shadow roots) are included; "parent only" marks what dev mode may not tap.', {
  device, tab, frame: z.string().optional().describe('Only this frame (the part before ":" of a ref).'),
}, async (a) => {
  const r = await send(a.device, 'page', { do: 'snapshot', tab: a.tab, frame: a.frame });
  const frames = r.frames ?? [r];
  return text(frames.map((f) => [`## ${f.top ? 'page' : 'frame'} ${f.frame} · ${f.title ?? ''} · ${f.href ?? f.url} · ${f.viewport ?? ''} · scrollY ${f.scrollY ?? 0}`,
    ...(f.ok === false ? [`(error: ${f.error})`] : f.lines ?? []), ...(f.cut ? ['(cut: more below; scroll or use frame)'] : [])].join('\n')).join('\n\n'));
});

tool('device_tap', 'Taps an element (ref from device_snapshot, or its text). Refused: the PIN, the rules, the GitHub card, dev mode, and on YouTube/Instagram what acts for the account (like, subscribe, follow, comment, share, send).', {
  device, tab, ref, text: z.string().optional().describe('The element’s label, when there is no ref.'),
}, async (a) => text(await send(a.device, 'page', { do: 'tap', tab: a.tab, ref: a.ref, text: a.text })));

tool('device_type', 'Types into a field (its input and change events; enter: true presses Enter). On YouTube/Instagram only their search box.', {
  device, tab, ref, text: z.string(), enter: z.boolean().optional(),
}, async (a) => text(await send(a.device, 'page', { do: 'type', tab: a.tab, ref: a.ref, text: a.text, enter: a.enter })));

tool('device_scroll', 'Scrolls an element into view (ref), or the page by dy pixels (default: most of a screen down; negative: up).', {
  device, tab, ref, dy: z.number().optional(),
}, async (a) => text(await send(a.device, 'page', { do: 'scroll', tab: a.tab, ref: a.ref, dy: a.dy })));

tool('device_wait', 'Waits until a text or a CSS selector is on the page (gone: true: until it is not), at most 15 s.', {
  device, tab, text: z.string().optional(), selector: z.string().optional(), gone: z.boolean().optional(), ms: z.number().int().max(15000).optional(),
}, async (a) => text(await send(a.device, 'page', { do: 'wait', tab: a.tab, text: a.text, selector: a.selector, gone: a.gone, ms: a.ms ?? 5000 }, 25000)));

tool('device_errors', 'The page’s last uncaught errors (the app’s own scripts).', { device, tab }, async (a) =>
  text(await send(a.device, 'page', { do: 'errors', tab: a.tab })));

tool('device_navigate', 'Opens an address in a tab: a web page (https://m.youtube.com/…) or an extension page by its path (apps/kidtube/parent/parent.html, core/pages/check.html). The app’s guard still decides, as for the child.', {
  device, tab, url: z.string(), newTab: z.boolean().optional(),
}, async (a) => text(await send(a.device, 'navigate', { url: a.url, tab: a.tab, newTab: a.newTab })));

tool('device_message', 'Sends a message to the extension’s background as its own pages do (core/background/messages.js and the apps’ handlers), with the same checks after it. Examples: {type:"state"}, {type:"setMode",mode:"parent"}, {type:"sync"}, {type:"checks"}, {type:"version",fresh:true}. Refused: the rules, the minutes, the GitHub connection, the settings file, the PIN, the reports and dev mode.', {
  device, tab, msg: z.record(z.string(), z.any()).describe('The message, with its type.'),
}, async (a) => text(await send(a.device, 'message', { msg: a.msg, tab: a.tab }, 60000)));

tool('device_run_checks', 'Runs the start checks now (as “Run the start checks”) and gives their results.', { device }, async (a) => {
  await send(a.device, 'message', { msg: { type: 'runChecks' } }, 60000);
  return text(await send(a.device, 'message', { msg: { type: 'checks' } }));
});

tool('device_update', 'Asks the tablet’s browser for the newest version (after npm run ship), then says which version it has. Quetta with a .crx install updates by itself; a .zip install or Orion needs the parent.', { device }, async (a) => {
  const asked = await send(a.device, 'message', { msg: { type: 'updateApp' } }, 60000).catch((e) => ({ error: String(e.message) }));
  const version = await send(a.device, 'message', { msg: { type: 'version', fresh: true } }).catch((e) => ({ error: String(e.message) }));
  return text({ asked, version });
});

tool('device_screenshot', 'A picture of what the tab shows (it comes to the front first). Kept in the server’s state folder, never in git.', {
  device, tab, quality: z.number().int().min(20).max(90).optional(),
}, async (a) => {
  const id = await pick(a.device);
  const r = await send(id, 'screenshot', { tab: a.tab, quality: a.quality }, 45000);
  const [, mime = 'image/jpeg', data = ''] = String(r.image ?? '').match(/^data:([^;]+);base64,(.*)$/) ?? [];
  mkdirSync(join(cfg.dir, 'shots'), { recursive: true });
  const file = join(cfg.dir, 'shots', `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  return { content: [{ type: 'image', data, mimeType: mime }, { type: 'text', text: `${r.url} · saved ${file}` }] };
});

await server.connect(new StdioServerTransport());
