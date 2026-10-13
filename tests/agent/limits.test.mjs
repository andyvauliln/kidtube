// The server's AI runs a day: agent/limits.mjs (the parent's numbers from parent-config.json `agents`, kept inside
// SAFE; config.json's defaults) and server.json, which Settings → AI on the server shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pick, defaults, fixLimit, serverStatus, usedToday, account, SAFE } from '../../agent/limits.mjs';

const CONFIG = { apps: { kidtube: {} }, profiles: ['kidtube/*'], notesAgent: { perDay: 10 }, orchestrator: { onDemandPerDay: 6 }, fixAgent: { perDay: 6 } };
const json = (p, j) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(j)); };

function repo() {
  const clone = mkdtempSync(join(tmpdir(), 'limits-data-')), state = mkdtempSync(join(tmpdir(), 'limits-state-'));
  for (const f of ['a', 'b']) json(join(clone, 'kidtube', f, 'profile.json'), { schemaVersion: 1 });
  return { clone, state };
}

test('the parent’s number, kept inside the safe limit', () => {
  assert.deepEqual(defaults(CONFIG), { notes: 10, helper: 6, fix: 6 });
  assert.deepEqual(defaults({}), { notes: 10, helper: 6, fix: 6 });
  assert.equal(pick('notes', { notesPerDay: 15 }, 10), 15);
  assert.equal(pick('notes', { notesPerDay: 0 }, 10), 0, '0 = no runs');
  assert.equal(pick('notes', { notesPerDay: 500 }, 10), SAFE.notes.max);
  assert.equal(pick('helper', { helperPerDay: 99 }, 6), SAFE.helper.max);
  for (const bad of [-1, 2.5, '20', null]) assert.equal(pick('notes', { notesPerDay: bad }, 10), 10, String(bad));
  assert.equal(pick('notes', undefined, 10), 10);
});

test('the fix agent: the newest parent-config.json with a fixPerDay wins', () => {
  const { clone } = repo();
  assert.equal(fixLimit(CONFIG, clone), 6);
  json(join(clone, 'kidtube/a/parent-config.json'), { schemaVersion: 1, updatedAt: '2026-10-13T10:00:00Z', agents: { fixPerDay: 2 } });
  json(join(clone, 'kidtube/b/parent-config.json'), { schemaVersion: 1, updatedAt: '2026-10-13T11:00:00Z', agents: { fixPerDay: 9 } });
  assert.equal(fixLimit(CONFIG, clone), 9);
  json(join(clone, 'kidtube/a/parent-config.json'), { schemaVersion: 1, updatedAt: '2026-10-13T12:00:00Z', agents: { fixPerDay: 50 } });
  assert.equal(fixLimit(CONFIG, clone), SAFE.fix.max);
});

test('server.json: the numbers and today’s runs, written only when they change', () => {
  const { clone, state } = repo();
  const day = '2026-10-13';
  json(join(clone, 'kidtube/a/parent-config.json'), { schemaVersion: 1, agents: { notesPerDay: 20, helperPerDay: 3 } });
  mkdirSync(join(state, 'kidtube/a'), { recursive: true });
  writeFileSync(join(state, 'kidtube/a/notes-runs.log'), `2026-10-12 x 1\n${day} y 1\n${day} z 2\n`);
  writeFileSync(join(state, 'kidtube/a/on-demand'), `${day} r1\n`);
  writeFileSync(join(state, 'fix-runs.log'), `${day} 1\n`);
  assert.equal(usedToday(join(state, 'kidtube/a/notes-runs.log'), day), 2);
  assert.equal(usedToday(join(state, 'none'), day), 0);
  const cfgDir = mkdtempSync(join(tmpdir(), 'limits-claude-'));
  writeFileSync(join(cfgDir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'parent@example.com' }, other: 'secret' }));
  const env = { CLAUDE_CONFIG_DIR: cfgDir };
  assert.equal(account(env), 'parent@example.com');

  assert.equal(serverStatus(CONFIG, clone, state, { day, env }), 2);
  const a = JSON.parse(readFileSync(join(clone, 'kidtube/a/server.json'), 'utf8'));
  assert.equal(a.schemaVersion, 1);
  assert.equal(a.day, day);
  assert.equal(a.account, 'parent@example.com');
  assert.deepEqual(a.runs.notes, { used: 2, perDay: 20, default: 10, max: 30 });
  assert.deepEqual(a.runs.helper, { used: 1, perDay: 3, default: 6, max: 12 });
  assert.deepEqual(a.runs.fix, { used: 1, perDay: 6, default: 6, max: 20 });
  assert.ok(!JSON.stringify(a).includes('secret'), 'only the e-mail address of the account');
  const b = JSON.parse(readFileSync(join(clone, 'kidtube/b/server.json'), 'utf8'));
  assert.deepEqual(b.runs.notes, { used: 0, perDay: 10, default: 10, max: 30 });

  assert.equal(serverStatus(CONFIG, clone, state, { day, env }), 0, 'no change, no new file');
  writeFileSync(join(state, 'kidtube/a/notes-runs.log'), `${day} y 1\n${day} z 2\n${day} w 1\n`);
  assert.equal(serverStatus(CONFIG, clone, state, { day, env }), 1, 'a new run: only that profile');
});

test('the command line: get and status', () => {
  const { clone, state } = repo();
  json(join(clone, 'kidtube/a/parent-config.json'), { schemaVersion: 1, agents: { notesPerDay: 4, helperPerDay: 99 } });
  const run = (...args) => execFileSync('node', ['agent/limits.mjs', ...args], { encoding: 'utf8' }).trim();
  assert.equal(run('get', 'notes', '--data', join(clone, 'kidtube/a')), '4');
  assert.equal(run('get', 'helper', '--data', join(clone, 'kidtube/a')), '12');
  assert.equal(run('get', 'notes', '--data', join(clone, 'kidtube/b')), String(JSON.parse(readFileSync('agent/config.json', 'utf8')).notesAgent?.perDay ?? 10));
  assert.match(run('get', 'fix', '--data', clone), /^\d+$/);
  assert.match(run('status', '--data', clone, '--state', state), /^\d+$/);
});
