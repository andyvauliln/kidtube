// The parent's report of an AI run (agent/report.mjs): the steps in plain words, the facts from their outputs, what the
// parent should know, and no secret in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { redact, stepOf, readStream, factsOf, buildReport, prune } from '../../agent/report.mjs';

const line = (j) => JSON.stringify(j);
const say = (text) => line({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const call = (id, name, input) => line({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const out = (id, content, is_error = false) => line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });

test('no secret survives', () => {
  const s = redact('ghp_abcdefghijklmnopqrstuvwxyz0123 github_pat_11ABCDEFGHIJKLMNOPQRSTUV gsk_abcdefghijklmnopqrstuvwxyz AIzaSyA1234567890abcdefghijklmnopqrstu sk-or-v1-abcdefghijklmnopqrstuvwxyz '
    + 'https://me:secretpass@github.com/x Authorization: token abcdefghijklmnop -----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----');
  for (const bad of ['ghp_', 'github_pat_', 'gsk_', 'AIza', 'sk-or', 'secretpass', 'abcdefghijklmnop', 'PRIVATE KEY']) assert.ok(!s.includes(bad), `${bad} in ${s}`);
  assert.match(s, /https:\/\/\*\*\*@github\.com/);
});

test('each tool call in plain words', () => {
  const app = '/srv/app';
  assert.deepEqual(stepOf('Read', { file_path: '/srv/app/extension/x.js' }, app), { kind: 'read', what: 'Read extension/x.js' });
  assert.equal(stepOf('Edit', { file_path: '/srv/app/a.js', old_string: 'a', new_string: 'b' }, app).what, 'Changed a.js');
  assert.equal(stepOf('Bash', { command: 'npm test 2>&1 | tail', description: 'Run the tests' }).kind, 'test');
  assert.equal(stepOf('Bash', { command: 'npm run ship -- -m "x"' }).kind, 'release');
  assert.equal(stepOf('Bash', { command: 'git commit -m x' }).kind, 'commit');
  assert.equal(stepOf('Bash', { command: 'ls' }).what, 'ls');
  assert.equal(stepOf('mcp__device__device_tap', { ref: '1:2' }).what, 'On your tablet: tap');
  assert.equal(stepOf('mcp__lab__browser_click', {}).kind, 'lab');
  assert.equal(stepOf('Agent', { description: 'find videos', prompt: 'p' }).kind, 'agent');
});

test('the stream: words, steps with outputs, a failed step; the helper agents’ own steps only counted', () => {
  const lines = [
    line({ type: 'system', subtype: 'init', model: 'm' }),
    say('I look at the settings first.'),
    call('a', 'Read', { file_path: '/app/s.js' }), out('a', '1\tx\n2\ty'),
    call('b', 'Bash', { command: 'false' }), out('b', 'Exit code 1', true),
    line({ type: 'assistant', parent_tool_use_id: 'z', message: { content: [{ type: 'text', text: 'inside a helper' }] } }),
    call('c', 'Edit', { file_path: '/app/s.js', old_string: 'a', new_string: 'b' }), out('c', 'The file was updated'),
    'not json',
  ];
  const { init, steps, sub } = readStream(lines, '/app');
  assert.equal(init.model, 'm');
  assert.equal(sub, 1);
  assert.deepEqual(steps.map((s) => [s.kind, s.out ?? null, !!s.failed]), [['say', null, false], ['read', '2 lines', false], ['run', 'Exit code 1', true], ['edit', null, false]]);
});

test('facts from the outputs: commits, the release, the last test numbers', () => {
  const steps = [{ raw: '[main 1a2b3c4] Settings: one box\n 2 files changed' }, { raw: '# pass 10\n# fail 2' }, { raw: '# pass 12\n# fail 0\nship: released 0.12.30: Quetta.' }];
  assert.deepEqual(factsOf(steps), { commits: [{ sha: '1a2b3c4', subject: 'Settings: one box' }], released: '0.12.30', tests: { pass: 12, fail: 0 } });
});

test('For you: a run stopped by the usage limit says so first; a good run says nothing needs you', () => {
  const stopped = buildReport({ kind: 'notes', id: 'x', lines: [line({ type: 'result', is_error: true, result: 'You’ve hit your session limit · resets 4:30pm (UTC)' })], input: [{ text: 'a note' }], out: null });
  assert.equal(stopped.ok, false);
  assert.match(stopped.forYou[0].text, /stopped before its end: You’ve hit your session limit/);
  const good = buildReport({ kind: 'notes', id: 'y', lines: [line({ type: 'result', is_error: false, result: 'ok' })], input: [{ text: 'n' }], out: { summary: 'Done it.' },
    server: { runs: { notes: { used: 3, perDay: 10 } } } });
  assert.equal(good.forYou[0].tone, 'ok');
  assert.ok(good.forYou.some((x) => /today: 3 of 10/.test(x.text)));
  const noSummary = buildReport({ kind: 'notes', id: 'z', lines: [line({ type: 'result', is_error: false })], input: [{ text: 'n', ask: true }], out: {} });
  assert.ok(noSummary.forYou.some((x) => /no summary/.test(x.text)));
  assert.ok(noSummary.forYou.some((x) => /1 question\(s\) got no answer/.test(x.text)));
  const fix = buildReport({ kind: 'fix', id: 'f', lines: [line({ type: 'result', is_error: false })], out: { fixes: [{ key: 'k|quetta', state: 'needs-you', message: 'Turn on dev mode.' }] } });
  assert.ok(fix.forYou.some((x) => x.tone === 'do' && /Needs you: Turn on dev mode/.test(x.text)));
  const none = buildReport({ kind: 'helper', id: 'h', lines: [] });
  assert.equal(none.stopped, 'no result');
});

test('prune keeps the newest reports, by their time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reports-'));
  for (const f of ['notes-20261001T000000Z.json', 'helper-20261002T000000Z.json', 'notes-20261003T000000Z.json', 'x.jsonl']) writeFileSync(join(dir, f), '{}');
  prune(dir, 2);
  assert.deepEqual(readdirSync(dir).sort(), ['helper-20261002T000000Z.json', 'notes-20261003T000000Z.json', 'x.jsonl']);
});
