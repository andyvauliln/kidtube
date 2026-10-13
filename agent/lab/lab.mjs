#!/usr/bin/env node
// The lab browser (docs/plans/DEVICE-BRIDGE.md part 3): Chromium on this server with this checkout's extension/, for
// the agents when no tablet is connected and to try a build before `npm run ship`. Playwright MCP drives it
// (agent/devices/mcp.json "lab": browser_snapshot, browser_click, browser_console_messages, screenshots).
//   node agent/lab/lab.mjs [--profile <app>/<folder>] [--port 9333] [--ext <dir>]    starts it, stays in front
//   node agent/lab/lab.mjs --detach [--profile …]     starts it in the background, prints its JSON line when ready
//   node agent/lab/lab.mjs --stop                                                   stops the one running
// --profile kidtube/johnnypitt.ind: that profile's data from the data repo, read only (settings.readOnly: the app
// writes nothing to GitHub and sends no report). No --profile: a fresh tablet without GitHub (the built-in list).
// No Google or Instagram sign-in here: YouTube's own pages see nobody signed in. The extension's pages work fully.
// The browser: Playwright's Chromium in ~/.cache/ms-playwright, with the two libraries this server lacks from
// ~/.local/share/kidtube/lab/root (agent/lab/README.md says how they got there).
import { readFileSync, readdirSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { devicesConfig } from '../devices/common.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({ options: {
  profile: { type: 'string' }, port: { type: 'string', default: '9333' }, ext: { type: 'string', default: join(ROOT, 'extension') },
  stop: { type: 'boolean', default: false }, detach: { type: 'boolean', default: false }, repo: { type: 'string' },
} });
const cfg = devicesConfig();
const LAB = join(cfg.dir, '..', 'lab');
const INFO = join(LAB, 'lab.json');
const say = (o) => console.log(JSON.stringify(o));

const running = () => { try { const i = JSON.parse(readFileSync(INFO, 'utf8')); process.kill(i.pid, 0); return i; } catch { return null; } };
if (opt.stop) {
  const i = running();
  if (i) { process.kill(i.pid); say({ ok: true, stopped: i.pid }); } else say({ ok: false, error: 'No lab running.' });
  process.exit(0);
}
// One lab at a time: a new one replaces the one running.
if (running()) { process.kill(running().pid); await new Promise((r) => setTimeout(r, 1500)); }
if (opt.detach) {
  mkdirSync(LAB, { recursive: true });
  rmSync(INFO, { force: true });
  const out = openSync(join(LAB, 'lab.log'), 'a');
  const child = spawn(process.execPath, [import.meta.filename, ...process.argv.slice(2).filter((a) => a !== '--detach')], { detached: true, stdio: ['ignore', out, out] });
  child.unref();
  for (let i = 0; i < 120; i++) {
    const info = running();
    if (info?.pid === child.pid) { say(info); process.exit(0); }
    if (child.exitCode != null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  say({ ok: false, error: `The lab did not start: ${join(LAB, 'lab.log')} says why.` });
  process.exit(1);
}

// Playwright's newest Chromium on this server.
function browserPath() {
  const base = join(homedir(), '.cache/ms-playwright');
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
  for (const d of dirs) for (const sub of ['chrome-linux64', 'chrome-linux']) {
    const p = join(base, d, sub, 'chrome');
    if (existsSync(p)) return p;
  }
  throw new Error(`No Chromium in ${base}: run npx playwright install chromium.`);
}
// The data repo's token: the one git uses on this server (it never leaves this machine; the lab writes nothing).
function serverToken() {
  if (process.env.KIDTUBE_LAB_TOKEN) return process.env.KIDTUBE_LAB_TOKEN;
  try { return readFileSync(join(homedir(), '.git-credentials'), 'utf8').match(/https:\/\/[^:]*:([^@]+)@github\.com/)?.[1] ?? null; } catch { return null; }
}
// What a tablet has stored for that profile: the account (as core/background/profiles.js keys it) and the settings.
function seed(profile) {
  const settings = { mode: 'parent', readOnly: true };
  if (!profile) return { settings: { mode: 'parent' }, shell: { on: true, locked: false } };
  const [app, folder] = profile.split('/');
  const file = join(cfg.dataDir, app, folder, 'profile.json');
  if (!existsSync(file)) throw new Error(`No profile ${profile} in the data repo (${file}).`);
  const p = JSON.parse(readFileSync(file, 'utf8'));
  const name = p.username ? `@${p.username}` : p.email;
  const key = app === 'kidtube' ? name : `${app}:${name}`;
  const account = { key, email: p.email ?? null, ...(p.username ? { username: p.username } : {}), name: p.name ?? null, app, folder };
  const token = serverToken();
  if (!token) throw new Error('No GitHub token for the lab (KIDTUBE_LAB_TOKEN, or ~/.git-credentials).');
  const repo = opt.repo ?? JSON.parse(readFileSync(join(ROOT, 'agent/config.json'), 'utf8')).dataRepo;
  return { settings: { ...settings, token, repo }, account, accounts: { [key]: { ...account } }, shell: { on: false, locked: false } };
}

const slug = (opt.profile ?? 'fresh').replace(/[^a-z0-9.]+/gi, '-');
const dataDir = join(LAB, `profile-${slug}`);
rmSync(dataDir, { recursive: true, force: true });   // a fresh browser each start
mkdirSync(dataDir, { recursive: true });
const libs = join(homedir(), '.local/share/kidtube/lab/root/usr/lib/x86_64-linux-gnu');
const ext = resolve(opt.ext);
const stored = seed(opt.profile);
const context = await chromium.launchPersistentContext(dataDir, {
  executablePath: browserPath(), headless: true, viewport: { width: 1280, height: 860 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--remote-debugging-port=${opt.port}`, '--no-first-run'],
  env: { ...process.env, ...(existsSync(libs) ? { LD_LIBRARY_PATH: [libs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : {}) },
});
const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 20000 });
const id = new URL(sw.url()).host;
await sw.evaluate((s) => chrome.storage.local.set(s), stored);
// The first sync with the seeded profile, from one of the extension's pages (as Settings → Update now).
const page = context.pages()[0] ?? await context.newPage();
const parentPage = `chrome-extension://${id}/${opt.profile?.startsWith('instagram/') ? 'core/pages/check.html' : 'apps/kidtube/parent/parent.html'}`;
await page.goto(parentPage);
const synced = opt.profile ? await page.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'sync' }, r))).catch((e) => ({ error: String(e.message) })) : null;
await page.reload();
const info = { ok: true, pid: process.pid, cdp: `http://127.0.0.1:${opt.port}`, extensionId: id, profile: opt.profile ?? null,
  readOnly: !!opt.profile, page: parentPage, synced: synced ? { ok: !synced.error && !synced.errors?.length, errors: synced.errors ?? synced.error ?? null } : null,
  version: JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8')).version, startedAt: new Date().toISOString() };
writeFileSync(INFO, JSON.stringify(info, null, 2));
say(info);
const quit = async () => { await context.close().catch(() => {}); rmSync(INFO, { force: true }); process.exit(0); };
process.on('SIGTERM', quit);
process.on('SIGINT', quit);
context.on('close', () => { rmSync(INFO, { force: true }); process.exit(0); });
