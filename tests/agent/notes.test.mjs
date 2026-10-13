// The notes agent's trigger: agent/notes.mjs (which notes are new, no AI) and agent/poll.sh end to end,
// with real git repos in a temp dir and a fake `claude` that records how it was called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { publicKeyDer } from '../../build/crx.mjs';
import { noteOf, allNotes, writeAnswers, writeVoice } from '../../agent/notes.mjs';

const sh = (cmd, cwd) => execFileSync('bash', ['-c', cmd], { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
const ev = (id, at, type, extra) => ({ eventId: id, at, type, ...extra });

test('which events are notes', () => {
  assert.equal(noteOf(ev('a', 't', 'wish', { text: 'More animals' })).where, 'message to the helper');
  assert.match(noteOf(ev('a', 't', 'wish', { text: 'x', list: 'settings' })).where, /the app/);
  assert.equal(noteOf(ev('a', 't', 'wish', { text: 'x', list: 'settings', section: 'Talking friend' })).where, 'note about the app (Settings, the box “Talking friend”)');
  assert.equal(noteOf(ev('a', 't', 'parentNote', { videoId: 'v', comment: 'Too fast' })).text, 'Too fast');
  assert.equal(noteOf(ev('a', 't', 'parentNote', { videoId: 'v', liked: true })), null);   // a 👍 alone is not a note
  assert.ok(noteOf(ev('a', 't', 'prompt', { action: 'add', text: 'x', noteId: 'a' })));
  assert.equal(noteOf(ev('a', 't', 'prompt', { action: 'remove', noteId: 'a' })), null);
  assert.ok(noteOf(ev('a', 't', 'context', { doc: 'math', text: 'x' })));
  assert.equal(noteOf(ev('a', 't', 'watch', { videoId: 'v' })), null);
});

test('a question: the note says so, and the agent’s answers go to answers.json', () => {
  assert.equal(noteOf(ev('a', 't', 'wish', { text: 'Why?', ask: true })).question, true);
  assert.equal(noteOf(ev('a', 't', 'parentNote', { videoId: 'v', comment: 'Is it too long?', ask: true })).question, true);
  assert.equal(noteOf(ev('a', 't', 'wish', { text: 'More animals' })).question, undefined);
  const dir = mkdtempSync(join(tmpdir(), 'kt-answers-'));
  const notes = [{ eventId: 'q1', text: 'Why does he skip songs?', question: true }, { eventId: 'n2', text: 'More trains' }];
  assert.equal(writeAnswers(dir, { answers: [{ eventId: 'q1', answer: ' He skips long ones. ' }, { eventId: 'other', answer: 'not this run' }, { eventId: 'n2', answer: '' }] }, notes, '2026-10-13T10:00:00Z'), 1);
  let file = JSON.parse(readFileSync(join(dir, 'answers.json'), 'utf8'));
  assert.deepEqual(file.answers, [{ eventId: 'q1', question: 'Why does he skip songs?', answer: 'He skips long ones.', at: '2026-10-13T10:00:00Z' }]);
  // A new answer to the same question replaces the old one; no answers: the file stays as it is.
  writeAnswers(dir, { answers: [{ eventId: 'q1', answer: 'Better: they are too slow.' }] }, notes, '2026-10-13T11:00:00Z');
  assert.equal(writeAnswers(dir, { summary: 'x' }, notes), 0);
  file = JSON.parse(readFileSync(join(dir, 'answers.json'), 'utf8'));
  assert.deepEqual(file.answers.map((a) => a.answer), ['Better: they are too slow.']);
});

test('a note keeps the context the parent attached on the tablet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-notes-ctx-'));
  mkdirSync(join(dir, 'activity'));
  const context = { screen: { where: 'the Today tab', text: 'Today 3' }, app: { version: '0.10.0' } };
  writeFileSync(join(dir, 'activity', '2026-10-09.json'), JSON.stringify({ events: [ev('c1', '2026-10-09T10:00:00Z', 'wish', { text: 'This button', list: 'today', context }), ev('c2', '2026-10-09T10:01:00Z', 'wish', { text: 'Plain' })] }));
  const [a, b] = allNotes(dir);
  assert.deepEqual(a.context, context);
  assert.equal(b.context, undefined);
});

// A world: data repo + code repo (bare "GitHub" remotes), the main checkout with agent/, a state dir, a fake claude.
function world(extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kt-notes-'));
  const p = (...x) => join(dir, ...x);
  sh(`git init -q --bare -b main ${p('data.git')} && git init -q --bare -b main ${p('code.git')}`);
  sh(`git clone -q ${p('data.git')} ${p('data')} 2>/dev/null; cd ${p('data')} && mkdir -p activity && echo '{}' > memory.json && git add -A && git commit -qm init && git push -q origin HEAD:main && git remote set-head origin main`);
  sh(`git clone -q ${p('code.git')} ${p('root')} 2>/dev/null`);
  mkdirSync(p('root', 'agent', 'lib'), { recursive: true });
  for (const f of ['poll.sh', 'notes.mjs', 'NOTES.md', 'problems.mjs', 'FIX.md', 'report.mjs', 'limits.mjs', 'lib/profile.mjs', 'lib/data.mjs']) copyFileSync(join('agent', f), p('root', 'agent', f));
  // The old layout: one child at the root of the data repo, no profiles.
  writeFileSync(p('root', 'agent', 'config.json'), JSON.stringify({ ...JSON.parse(readFileSync('agent/config.json', 'utf8')), profiles: [] }));
  // The helper: commits a new list the way the real one does.
  writeFileSync(p('root', 'agent', 'daily.sh'), `#!/usr/bin/env bash\necho ran >> "${p('helper-ran')}"\ncd "${p('data')}" && git pull -q --rebase origin main && echo '{}' > queue.json && git add -A && git commit -qm "helper: 2026-10-06: list" && git push -q origin HEAD:main\n`);
  chmodSync(p('root', 'agent', 'daily.sh'), 0o755);
  sh(`git add -A && git commit -qm agent && git push -q origin HEAD:main`, p('root'));
  // The fake claude: records its cwd and prompt, answers through the result file named in the prompt.
  mkdirSync(p('bin'));
  writeFileSync(p('bin', 'claude'), `#!/usr/bin/env node
const fs = require('fs');
const prompt = process.argv[process.argv.indexOf('-p') + 1];
fs.appendFileSync(${JSON.stringify(p('claude-calls.jsonl'))}, JSON.stringify({ cwd: process.cwd(), prompt, args: process.argv.slice(2) }) + '\\n');
const result = prompt.match(/Result file: (\\S+)/)[1];
const work = ${JSON.stringify(p('agent-does.sh'))};
if (fs.existsSync(work)) require('child_process').execFileSync('bash', [work], { stdio: 'ignore' });
fs.writeFileSync(result, fs.readFileSync(${JSON.stringify(p('answer.json'))}, 'utf8'));
// The run's recording (stream-json), when the test gives one.
if (fs.existsSync(${JSON.stringify(p('stream.jsonl'))})) process.stdout.write(fs.readFileSync(${JSON.stringify(p('stream.jsonl'))}, 'utf8'));
console.log('{}');
`);
  chmodSync(p('bin', 'claude'), 0o755);
  const env = { ...process.env, PATH: `${p('bin')}:${process.env.PATH}`, KIDTUBE_STATE_DIR: p('state'), KIDTUBE_DATA_DIR: p('data'), KIDTUBE_APP_DIR: p('app'),
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', ...extraEnv };
  const tablet = p('tablet');
  sh(`git clone -q ${p('data.git')} ${tablet} 2>/dev/null`);
  return {
    p,
    poll: () => execFileSync(p('root', 'agent', 'poll.sh'), { env, encoding: 'utf8' }),
    // The tablet writes activity (and maybe a run request) to GitHub.
    send: (events, request) => {
      sh(`git pull -q --rebase origin main`, tablet);
      mkdirSync(join(tablet, 'activity'), { recursive: true });
      const f = join(tablet, 'activity', '2026-10-06.json');
      const cur = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { schemaVersion: 1, date: '2026-10-06', events: [] };
      cur.events.push(...events);
      writeFileSync(f, JSON.stringify(cur));
      if (request) { mkdirSync(join(tablet, 'requests'), { recursive: true }); writeFileSync(join(tablet, 'requests', 'run.json'), JSON.stringify({ schemaVersion: 1, id: request, at: 'now' })); }
      sh(`git add -A && git commit -qm tablet && git push -q origin HEAD:main`, tablet);
    },
    // A tablet's checks report problems (extension/core/checks/runner.js sendReports).
    report: (reports, day = '2026-10-06') => {
      sh(`git pull -q --rebase origin main`, tablet);
      mkdirSync(join(tablet, 'problems'), { recursive: true });
      const f = join(tablet, 'problems', `${day}.json`);
      const cur = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { schemaVersion: 1, date: day, reports: [] };
      for (const r of reports) { const i = cur.reports.findIndex((x) => x.reportId === r.reportId); if (i >= 0) cur.reports[i] = r; else cur.reports.push(r); }
      writeFileSync(f, JSON.stringify(cur));
      sh(`git add -A && git commit -qm "problems ${day}" && git push -q origin HEAD:main`, tablet);
    },
    fixes: () => { sh('git pull -q --rebase origin main', tablet); return JSON.parse(readFileSync(join(tablet, 'fixes.json'), 'utf8')).fixes; },
    answer: (a) => writeFileSync(p('answer.json'), JSON.stringify(a)),
    stream: (events) => writeFileSync(p('stream.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n'),
    calls: () => (existsSync(p('claude-calls.jsonl')) ? readFileSync(p('claude-calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []),
    status: () => { sh('git pull -q --rebase origin main', tablet); return JSON.parse(readFileSync(join(tablet, 'run-status.json'), 'utf8')); },
  };
}

test('poll.sh: old notes are not worked on; a new note wakes the notes agent once, in its own checkout', () => {
  const w = world();
  w.send([ev('old-1', '2026-10-06T08:00:00Z', 'wish', { text: 'Old wish' })]);
  w.poll();                                            // first run: what is there counts as handled
  assert.equal(w.calls().length, 0);
  assert.deepEqual(allNotes(w.p('data')).map((n) => n.eventId), ['old-1']);

  w.answer({ summary: 'Parent mode now opens on Planned (0.8.10).', runHelper: false, version: '0.8.10' });
  w.send([ev('n-1', '2026-10-06T14:00:00Z', 'wish', { list: 'settings', text: 'Open parent mode on Planned' }),
          ev('w-1', '2026-10-06T14:00:05Z', 'watch', { videoId: 'abcdefghijk' })], 'req-1');
  w.poll();
  const calls = w.calls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, w.p('app'));             // never the main checkout
  assert.match(calls[0].prompt, /# KidTube: the parent's notes/);
  assert.match(calls[0].prompt, /Open parent mode on Planned/);
  assert.doesNotMatch(calls[0].prompt, /Old wish/);
  assert.ok(calls[0].args.includes('--permission-mode'));
  const st = w.status();
  assert.equal(st.requestId, 'req-1');
  assert.equal(st.state, 'done');
  assert.equal(st.message, 'Parent mode now opens on Planned (0.8.10).');
  assert.equal(existsSync(w.p('helper-ran')), false);
  // The tablet deletes the notes the AI worked on: their ids go to notes-done.json with the status.
  assert.deepEqual(JSON.parse(readFileSync(w.p('tablet', 'notes-done.json'), 'utf8')).ids, ['n-1']);

  w.poll();                                            // nothing new: no second run
  assert.equal(w.calls().length, 1);
});

test('poll.sh: a question gets its answer in answers.json, pushed with the status', () => {
  const w = world();
  w.send([]);
  w.poll();                                            // first run: nothing old
  w.answer({ summary: 'Answered your question.', runHelper: false, version: null, answers: [{ eventId: 'q-1', answer: 'He skips the songs longer than 5 minutes.' }] });
  w.send([ev('q-1', '2026-10-13T10:00:00Z', 'wish', { list: 'today', text: 'Why does he skip the songs?', ask: true })], 'req-q');
  w.poll();
  assert.match(w.calls()[0].prompt, /"question": true/);
  assert.equal(w.status().state, 'done');
  const file = JSON.parse(readFileSync(w.p('tablet', 'answers.json'), 'utf8'));
  assert.deepEqual(file.answers.map((a) => [a.eventId, a.question, a.answer]), [['q-1', 'Why does he skip the songs?', 'He skips the songs longer than 5 minutes.']]);
});

// A short run as claude -p --output-format stream-json --verbose writes it: words, a test run, a release, the end.
const STREAM = [
  { type: 'system', subtype: 'init', model: 'claude-opus-5-5' },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'The note asks for Planned first. I change the default tab.' }] } },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '# pass 280\n# fail 0' }] }, timestamp: '2026-10-13T10:01:00Z' },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm run ship -- -m x', description: 'Release' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ship: released 0.8.10: Quetta. token ghp_abcdefghijklmnopqrstuvwxyz0123' }] } },
  { type: 'result', subtype: 'success', is_error: false, num_turns: 3, duration_ms: 120000, total_cost_usd: 0.42, result: 'done' },
];

test('poll.sh: a notes run leaves its report (every step, what changed, what to check); the status and the answers point to it', () => {
  const w = world();
  w.send([]);
  w.poll();
  w.answer({ summary: 'Parent mode opens on Planned (0.8.10).', runHelper: false, version: '0.8.10', answers: [{ eventId: 'q-2', answer: 'Yes.' }] });
  w.stream(STREAM);
  w.send([ev('q-2', '2026-10-13T10:00:00Z', 'wish', { list: 'settings', text: 'Can it open on Planned?', ask: true })], 'req-r');
  w.poll();
  const st = w.status();
  assert.match(st.report, /^reports\/notes-\d{8}T\d{6}Z\.json$/);
  const r = JSON.parse(readFileSync(w.p('tablet', st.report), 'utf8'));
  assert.equal(r.kind, 'notes');
  assert.equal(r.ok, true);
  assert.equal(r.released, '0.8.10');
  assert.deepEqual(r.tests, { pass: 280, fail: 0 });
  assert.deepEqual(r.input.map((n) => n.title), ['Can it open on Planned?']);
  assert.equal(r.said, 'Parent mode opens on Planned (0.8.10).');
  assert.deepEqual(r.steps.map((s) => s.kind), ['say', 'test', 'release']);
  assert.ok(r.forYou.some((x) => /New version 0\.8\.10/.test(x.text)));
  assert.ok(!readFileSync(w.p('tablet', st.report), 'utf8').includes('ghp_'), 'no token in the report');
  assert.equal(JSON.parse(readFileSync(w.p('tablet', 'answers.json'), 'utf8')).answers[0].report, st.report);
});

test('poll.sh: a note about the lists → the notes agent asks for a helper run, which runs after it', () => {
  const w = world();
  w.poll();
  w.answer({ summary: 'More animal videos: the helper is choosing them.', runHelper: true, version: null });
  w.send([ev('n-2', '2026-10-06T15:00:00Z', 'wish', { list: 'today', text: 'More animals' })], 'req-2');
  w.poll();
  assert.equal(w.calls().length, 1);
  assert.equal(readFileSync(w.p('helper-ran'), 'utf8').trim(), 'ran');
  const st = w.status();
  assert.equal(st.state, 'done');
  assert.match(st.message, /^More animal videos: the helper is choosing them\. The new lists are on the tablet/);
});

test('poll.sh: ↻ Update with no new notes runs the helper only, as before', () => {
  const w = world();
  w.poll();
  w.send([ev('w-2', '2026-10-06T16:00:00Z', 'watch', { videoId: 'abcdefghijk' })], 'req-3');
  w.poll();
  assert.equal(w.calls().length, 0);
  assert.equal(readFileSync(w.p('helper-ran'), 'utf8').trim(), 'ran');
  assert.equal(w.status().state, 'done');
});

test('poll.sh: if the agent writes no result, the parent sees it failed, and the note is not retried every minute', () => {
  const w = world();
  w.poll();
  writeFileSync(w.p('bin', 'claude'), '#!/usr/bin/env bash\nexit 1\n');
  w.send([ev('n-3', '2026-10-06T17:00:00Z', 'parentNote', { videoId: 'abcdefghijk', comment: 'Too loud' })], 'req-4');
  w.poll();
  assert.equal(w.status().state, 'failed');
  assert.match(readFileSync(w.p('state', 'notes-handled.json'), 'utf8'), /n-3/);
  assert.equal(existsSync(w.p('tablet', 'notes-done.json')), false);   // the note stays on the tablet, to send again
});

test('poll.sh: a run request pushed while the notes agent works is not lost (↻ Update: notes first, the request after)', () => {
  const w = world();
  w.poll();
  w.answer({ summary: 'Apps row starts closed (0.10.3).', runHelper: false, version: '0.10.3' });
  // The fake claude: while it works, the tablet pushes the run request (as requestRun does after its sync).
  const claude = readFileSync(w.p('bin', 'claude'), 'utf8');
  writeFileSync(w.p('bin', 'claude'), claude.replace("console.log('{}');", `require('child_process').execSync(${JSON.stringify(`cd ${w.p('tablet')} && git pull -q --rebase origin main && mkdir -p requests && echo '{"schemaVersion":1,"id":"req-late","at":"now"}' > requests/run.json && git add -A && git commit -qm "tablet: run the helper now" && git push -q origin HEAD:main`)});\nconsole.log('{}');`));
  w.send([ev('n-9', '2026-10-06T17:51:00Z', 'wish', { list: 'settings', text: 'Apps row closed by default' })]);
  w.poll();                                            // the notes agent (the request arrives meanwhile)
  assert.equal(w.calls().length, 1);
  assert.equal(existsSync(w.p('helper-ran')), false);
  w.poll();                                            // the next minute sees the request
  assert.equal(readFileSync(w.p('helper-ran'), 'utf8').trim(), 'ran');
  const st = w.status();
  assert.equal(st.requestId, 'req-late');
  assert.equal(st.state, 'done');
});

const problem = (id, check, version, count = 1, at = '2026-10-06T18:00:00Z') => ({ type: 'problem', reportId: id, deviceId: 'tab-1', fingerprint: `${check}|${version}|orion`,
  check, kind: 'action', area: 'mode', expect: 'Kid: kid mode is on', saw: 'settings.mode: expected kid, saw parent',
  mismatch: [{ what: 'settings.mode', expected: 'kid', actual: 'parent' }], code: ['core/background/messages.js kidHome'],
  count, firstAt: at, lastAt: at, context: { app: { version, target: 'orion' } }, steps: [] });

test('poll.sh: a problem the tablets reported wakes the fix agent once; its answer goes to fixes.json for the tablets', () => {
  const w = world();
  w.poll();
  w.answer({ summary: 'Kid fixed.', version: '0.10.5', fixes: [{ key: 'action.kidHome|orion', state: 'fixed', version: '0.10.5', message: 'Kid waits for Orion to move the tab.' }] });
  w.report([problem('r-1', 'action.kidHome', '0.10.4'), problem('r-2', 'action.kidHome', '0.10.4')]);
  w.poll();
  const calls = w.calls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, w.p('app'));
  assert.match(calls[0].prompt, /# KidTube: problems the tablets found by themselves/);
  assert.match(calls[0].prompt, /"key": "action.kidHome\|orion"/);
  assert.match(calls[0].prompt, /"count": 2/, 'two reports of one check: one problem');
  const fixes = w.fixes();
  assert.deepEqual(fixes.map((f) => [f.key, f.state, f.version]), [['action.kidHome|orion', 'fixed', '0.10.5']]);
  const log = sh('git log --format=%s -3', w.p('tablet'));
  assert.match(log, /helper: fixes \(1 problem\(s\)\)\nhelper: working on 1 problem\(s\)/, 'the tablets saw "working" while it ran');
  assert.equal(fixes[0].message, 'Kid waits for Orion to move the tab.');
  assert.match(fixes[0].report, /^reports\/fix-\d{8}T\d{6}Z\.json$/, 'its Details opens the run’s report');
  assert.equal(JSON.parse(readFileSync(w.p('tablet', fixes[0].report), 'utf8')).kind, 'fix');
  w.poll();
  assert.equal(w.calls().length, 1, 'nothing new: no second run');
  // The same problem again from a tablet that still has 0.10.4: fixed since, not worked on again.
  w.report([problem('r-1', 'action.kidHome', '0.10.4', 5)]);
  w.poll();
  assert.equal(w.calls().length, 1);
});

test('problems.mjs: what is new, merged per check and browser; a fix holds for older versions; a comeback is a regression', async () => {
  const { newProblems, recordFixes } = await import('../../agent/problems.mjs');
  const now = Date.parse('2026-10-07T12:00:00Z');
  const reports = [problem('a', 'action.kidHome', '0.10.4'), problem('b', 'action.kidHome', '0.10.5', 2), problem('c', 'yt.player', '0.10.5')];
  let got = newProblems(reports, {}, [], now);
  assert.deepEqual(got.map((g) => [g.key, g.count, g.versions]), [['action.kidHome|orion', 3, ['0.10.4', '0.10.5']], ['yt.player|orion', 1, ['0.10.5']]]);
  const handled = { reports: { a: 1, b: 2, c: 1 }, runs: {} };
  assert.equal(newProblems(reports, handled, [], now).length, 0, 'handled');
  const fixes = recordFixes({}, { fixes: [{ key: 'action.kidHome|orion', state: 'fixed', version: '0.10.5', message: 'x' }, { key: 'bad', state: 'maybe' }] }, '2026-10-07T10:00:00Z').fixes;
  assert.equal(fixes.length, 1, 'only known states');
  got = newProblems([problem('d', 'action.kidHome', '0.10.4', 9)], {}, fixes, now);
  assert.equal(got.length, 0, 'an older version than the fix: fixed since');
  got = newProblems([problem('e', 'action.kidHome', '0.10.5')], {}, fixes, now);
  assert.equal(got[0].regressionOf, '0.10.5', 'in the fixed version itself: it came back');
  const left = recordFixes({}, { fixes: [{ key: 'yt.player|orion', state: 'not-reproduced', message: 'y' }] }, '2026-10-07T10:00:00Z').fixes;
  assert.equal(newProblems([problem('f', 'yt.player', '0.10.5', 3)], {}, left, now).length, 0, 'not reproduced: left alone for a day');
  assert.equal(newProblems([problem('f', 'yt.player', '0.10.5', 3)], {}, left, now + 25 * 3600000).length, 1);
  assert.equal(newProblems([problem('g', 'yt.player', '0.10.5')], { runs: { 'yt.player|orion': '2026-10-07T11:00:00Z' } }, [], now).length, 0, 'two hours between runs');
  // The same report sent again with a higher count (tablets up to 0.11.1): handled already, the same problem.
  assert.equal(newProblems([problem('a', 'action.kidHome', '0.10.4', 7)], handled, [], now).length, 0, 'a higher count is not new');
  // The check was wrong and was fixed (not a bug): it holds for older versions like a fix.
  const wrong = recordFixes({}, { fixes: [{ key: 'kid.list|orion', state: 'not-a-bug', version: '0.10.6', message: 'z' }] }, '2026-10-07T10:00:00Z').fixes;
  assert.equal(newProblems([problem('h', 'kid.list', '0.10.5')], {}, wrong, now).length, 0, 'not a bug: holds for older versions');
  assert.equal(newProblems([problem('h', 'kid.list', '0.10.6')], {}, wrong, now)[0].regressionOf, '0.10.6');
  // Fixed with no new version (a test or agent change): holds for reports from before the fix.
  const noVersion = recordFixes({}, { fixes: [{ key: 'gh.sync|orion', state: 'fixed', version: null, message: 'w' }] }, '2026-10-07T10:00:00Z').fixes;
  assert.equal(newProblems([problem('i', 'gh.sync', '0.10.5', 4, '2026-10-07T09:00:00Z')], {}, noVersion, now).length, 0, 'from before the fix');
  assert.equal(newProblems([problem('j', 'gh.sync', '0.10.5', 1, '2026-10-07T11:00:00Z')], {}, noVersion, now).length, 1, 'after the fix: new');
});

test('poll.sh: a problem the fix agent gave no answer for (a usage limit) is tried again after 2 hours, at most 3 times', () => {
  const w = world();
  w.poll();
  writeFileSync(w.p('bin', 'claude'), '#!/usr/bin/env bash\nexit 1\n');
  const file = w.p('state', 'problems-handled.json');
  const handled = () => JSON.parse(readFileSync(file, 'utf8'));
  const runs = () => readFileSync(w.p('state', 'fix-runs.log'), 'utf8').trim().split('\n').length;
  const twoHoursLater = () => { const h = handled(); h.runs['start.kept|orion'] = '2000-01-01T00:00:00Z'; writeFileSync(file, JSON.stringify(h)); };
  const anyPush = (n) => w.send([ev(`w-${n}`, '2026-10-06T19:00:00Z', 'watch', { videoId: 'abcdefghijk' })]);   // the data repo changes
  w.report([problem('r-7', 'start.kept', '0.11.1')]);
  w.poll();
  assert.equal(runs(), 1);
  assert.equal(handled().reports['r-7'], undefined, 'no answer: not handled');
  assert.equal(handled().tries['start.kept|orion'], 1);
  assert.deepEqual(w.fixes().map((f) => [f.state, f.message]), [['no-answer', 'The AI stopped before it answered. It tries again after 2 hours (try 2 of 3).']], 'the tablet sees it');
  anyPush(1);
  w.poll();
  assert.equal(runs(), 1, 'not again within 2 hours');
  twoHoursLater(); anyPush(2);
  w.poll();
  assert.equal(runs(), 2, 'tried again');
  assert.equal(handled().tries['start.kept|orion'], 2);
  twoHoursLater(); anyPush(3);
  w.poll();
  assert.equal(runs(), 3);
  assert.equal(handled().reports['r-7'], 1, 'the third time with no answer: given up');
  assert.equal(handled().tries['start.kept|orion'], undefined);
  assert.equal(w.fixes()[0].state, 'gave-up');
  twoHoursLater(); anyPush(4);
  w.poll();
  assert.equal(runs(), 3);
});

// The code repo with a real Quetta release (build/ship.mjs and what it needs, a test signing key) and an agent that
// pushes its code but stops before the release.
function releaseWorld({ key = true } = {}) {
  const keys = mkdtempSync(join(tmpdir(), 'kt-key-'));
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  writeFileSync(join(keys, 'key.pem'), privateKey);
  const w = world({ KIDTUBE_KEY: join(keys, key ? 'key.pem' : 'missing.pem'), KIDTUBE_PUSH_LOCK: join(keys, 'push.lock'), KIDTUBE_PUSH_LOCKED: '' });
  const root = w.p('root');
  mkdirSync(join(root, 'build'));
  mkdirSync(join(root, 'extension', 'core', 'lib'), { recursive: true });
  for (const f of ['ship.mjs', 'pack.mjs', 'crx.mjs', 'build-orion.mjs']) copyFileSync(join('build', f), join(root, 'build', f));
  copyFileSync('extension/core/lib/version.js', join(root, 'extension/core/lib/version.js'));
  mkdirSync(join(root, '.githooks'));
  copyFileSync('.githooks/pre-push', join(root, '.githooks/pre-push'));
  chmodSync(join(root, '.githooks/pre-push'), 0o755);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node -e 0' } }));
  writeFileSync(join(root, 'extension/manifest.json'), JSON.stringify({ name: 'Custom Apps', version: '0.1.0', key: publicKeyDer(privateKey).toString('base64') }, null, 2) + '\n');
  sh(`git add -A && git commit -qm "0.1.0: app" && node build/pack.mjs extension --key ${join(keys, 'key.pem')} --out site >/dev/null && git add -A && git commit -qm "quetta 0.1.0: release" && git push -q origin HEAD:main`, root);
  writeFileSync(w.p('agent-does.sh'), `set -e\necho 'export const fixed = 1;' > extension/fix.js\nsed -i 's/"version": "0.1.0"/"version": "0.1.1"/' extension/manifest.json\ngit add -A && git commit -qm "0.1.1: the fix" && git push -q origin HEAD:main\n`);
  w.answer({ summary: 'Fixed.', version: '0.1.1', fixes: [{ key: 'action.kidHome|orion', state: 'fixed', version: '0.1.1', message: 'Kid waits.' }] });
  w.poll();
  return w;
}
const released = (w) => JSON.parse(sh(`git --git-dir=${w.p('code.git')} show main:site/latest.json`));

test('poll.sh: an agent pushed its code but no release → the server releases it after the run', () => {
  const w = releaseWorld();
  w.report([problem('r-1', 'action.kidHome', '0.1.0')]);
  w.poll();
  assert.equal(w.calls().length, 1);
  const rel = released(w);
  assert.equal(rel.version, '0.1.1');
  assert.equal(sh(`git --git-dir=${w.p('code.git')} show ${rel.sourceCommit}:extension/fix.js`).trim(), 'export const fixed = 1;');
  assert.equal(w.fixes()[0].message, 'Kid waits.', 'released: nothing more to say');
  assert.match(readFileSync(w.p('state', 'fix.log'), 'utf8'), /release check: main's code is not released/);
});

test('poll.sh: the server could not release it either → the parent reads that in the fix’s message', () => {
  const w = releaseWorld({ key: false });
  w.report([problem('r-1', 'action.kidHome', '0.1.0')]);
  w.poll();
  assert.equal(released(w).version, '0.1.0');
  assert.match(w.fixes()[0].message, /^Kid waits\. The new version could not be published yet/);
});

test('a recorded note the tablet could not write down: the server writes it down into voice/<id>.json, the .wav goes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-voice-'));
  mkdirSync(join(dir, 'voice'));
  writeFileSync(join(dir, 'voice', 'rec-0001-aaaa.wav'), 'RIFF');
  writeFileSync(join(dir, 'voice', 'rec-0002-bbbb.wav'), 'RIFF');
  writeFileSync(join(dir, 'voice', '..bad.wav'), 'RIFF');
  const said = { 'rec-0001-aaaa': { text: 'Bigger buttons, please.', model: 'whisper-large-v3' }, 'rec-0002-bbbb': { text: 'Thank you.' } };   // Whisper on silence
  const { NO_WORDS } = await import('../../extension/apps/kidtube/lib/voice.js');
  assert.equal(await writeVoice(dir, async (f) => said[f.split('/').pop().slice(0, -4)], '2026-10-13T12:00:00Z', NO_WORDS), 2);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'voice', 'rec-0001-aaaa.json'), 'utf8')),
    { schemaVersion: 1, id: 'rec-0001-aaaa', at: '2026-10-13T12:00:00Z', text: 'Bigger buttons, please.', model: 'whisper-large-v3' });
  assert.match(JSON.parse(readFileSync(join(dir, 'voice', 'rec-0002-bbbb.json'), 'utf8')).error, /heard no words/);
  assert.ok(!existsSync(join(dir, 'voice', 'rec-0001-aaaa.wav')), 'the recording is deleted');
  assert.ok(existsSync(join(dir, 'voice', '..bad.wav')), 'a name that is not an id is left alone');
  // Whisper failing is an answer too, so the tablet stops waiting.
  writeFileSync(join(dir, 'voice', 'rec-0003-cccc.wav'), 'RIFF');
  await writeVoice(dir, async () => { throw new Error('Whisper refused it (429).'); });
  assert.match(JSON.parse(readFileSync(join(dir, 'voice', 'rec-0003-cccc.json'), 'utf8')).error, /could not write it down: Whisper refused it \(429\)/);
});

test('poll.sh: a recording the tablet pushed is answered in voice/<id>.json within the minute, with no AI', () => {
  const w = world({ GROQ_API_KEY: '' });   // no key: the answer is the reason (the real key is never used in tests)
  const root = w.p('root');
  copyFileSync('agent/instagram.mjs', join(root, 'agent', 'instagram.mjs'));
  mkdirSync(join(root, 'extension', 'apps', 'instagram', 'lib'), { recursive: true });
  copyFileSync('extension/apps/instagram/lib/posts.js', join(root, 'extension', 'apps', 'instagram', 'lib', 'posts.js'));
  mkdirSync(join(root, 'extension', 'apps', 'kidtube', 'lib'), { recursive: true });
  for (const f of ['voice.js', 'lips.js']) copyFileSync(`extension/apps/kidtube/lib/${f}`, join(root, 'extension', 'apps', 'kidtube', 'lib', f));
  w.poll();
  const tablet = w.p('tablet');
  sh('git pull -q --rebase origin main', tablet);
  mkdirSync(join(tablet, 'voice'));
  writeFileSync(join(tablet, 'voice', 'rec-0001-aaaa.wav'), 'RIFF');
  sh('git add -A && git commit -qm "tablet: a recorded note" && git push -q origin HEAD:main', tablet);
  w.poll();
  sh('git pull -q --rebase origin main', tablet);
  assert.ok(!existsSync(join(tablet, 'voice', 'rec-0001-aaaa.wav')));
  assert.match(JSON.parse(readFileSync(join(tablet, 'voice', 'rec-0001-aaaa.json'), 'utf8')).error, /GROQ_API_KEY is missing/);
  assert.equal(w.calls().length, 0, 'no AI');
});
