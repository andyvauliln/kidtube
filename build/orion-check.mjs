#!/usr/bin/env node
// Lists every chrome.* API the extension uses, with Orion's support on iPad/iPhone (build/orion-apis.json,
// a snapshot of Kagi's table). Exits 1 when an API Orion lacks is used without being handled for the Orion build.
//   node build/orion-check.mjs [extension-dir] [--json]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const TABLE = JSON.parse(readFileSync(join(ROOT, 'build/orion-apis.json'), 'utf8'));

// APIs Orion lacks that the Orion build deals with on purpose. Add a line here only after handling the API
// (behind TARGET === 'orion' in extension/core/lib/target.js, or with ?. and a fallback).
export const HANDLED = {
  'declarativeNetRequest.updateDynamicRules': 'skipped when TARGET is orion (applySiteRules); externalGuard sends other sites home',
};

const EVENT_METHODS = new Set(['addListener', 'removeListener', 'hasListener']);

function orionStatus(api) {
  const parts = api.split('.');
  // storage.local.get → storage.StorageArea.get (that is how the table names it)
  if (parts[0] === 'storage' && ['local', 'session', 'sync', 'managed'].includes(parts[1]) && parts[2]) {
    const area = TABLE.apis[`storage.${parts[1]}`]?.ios, method = TABLE.apis[`storage.StorageArea.${parts[2]}`]?.ios;
    if (area && method) return area === 'full' ? method : area;
  }
  for (let n = parts.length; n >= 2; n--) {
    const hit = TABLE.apis[parts.slice(0, n).join('.')];
    if (hit) return hit.ios;
  }
  return 'unknown';
}

function* jsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* jsFiles(p);
    else if (name.endsWith('.js')) yield p;
  }
}

export function checkExtension(dir = join(ROOT, 'extension')) {
  const uses = {};
  for (const file of jsFiles(dir)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/\bchrome\.([a-zA-Z]+(?:\??\.[a-zA-Z]+)*)/g)) {
        const parts = m[1].replace(/\?/g, '').split('.');
        while (parts.length > 2 && EVENT_METHODS.has(parts.at(-1))) parts.pop();
        const api = parts.join('.');
        if (parts.length < 2) continue;   // a bare namespace (chrome.alarms), used as an "is it there?" check
        (uses[api] ??= []).push(`${relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  const apis = Object.entries(uses).sort().map(([api, at]) => {
    const status = orionStatus(api);
    const handled = HANDLED[api] ?? null;
    const level = status === 'full' ? 'ok' : handled ? 'handled' : status === 'none' ? 'error' : 'warn';
    return { api, status, level, handled, at };
  });

  // Manifest keys Orion doesn't document (the Orion build removes update_url, minimum_chrome_version and DNR itself).
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const notes = [];
  for (const cs of manifest.content_scripts ?? []) {
    if (cs.world === 'MAIN') notes.push(`content script ${cs.js.join(', ')} uses world "MAIN": not documented for Orion; if it doesn't run there, its job (real channel and length) is skipped`);
  }
  for (const p of manifest.permissions ?? []) {
    if (p.startsWith('declarativeNetRequest')) continue;
    if (orionStatus(`${p}.x`) === 'unknown' && !Object.keys(TABLE.apis).some((k) => k.startsWith(`${p}.`))) notes.push(`permission "${p}" has no row in Orion's table`);
  }
  return { snapshot: TABLE.snapshot, apis, notes, errors: apis.filter((a) => a.level === 'error').length, warnings: apis.filter((a) => a.level === 'warn').length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const r = checkExtension(args.find((a) => !a.startsWith('--')) ? resolve(args.find((a) => !a.startsWith('--'))) : undefined);
  if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    const mark = { ok: '✓', handled: '↷', warn: '?', error: '✗' };
    console.log(`Orion (iPad/iPhone) support for the chrome.* APIs in use — table snapshot ${r.snapshot}`);
    for (const a of r.apis) console.log(`${mark[a.level]} ${a.api.padEnd(44)} ${a.status.padEnd(8)} ${a.handled ?? (a.level === 'ok' ? '' : a.at.join(' '))}`);
    for (const n of r.notes) console.log(`note: ${n}`);
    console.log(`${r.errors} error(s), ${r.warnings} warning(s)`);
  }
  process.exit(r.errors ? 1 : 0);
}
