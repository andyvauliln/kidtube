// The notes agent's trigger: agent/notes.mjs (which notes are new, no AI) and agent/poll.sh end to end,
// with real git repos in a temp dir and a fake `claude` that records how it was called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { noteOf, allNotes } from '../../agent/notes.mjs';

const sh = (cmd, cwd) => execFileSync('bash', ['-c', cmd], { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
const ev = (id, at, type, extra) => ({ eventId: id, at, type, ...extra });

test('which events are notes', () => {
  assert.equal(noteOf(ev('a', 't', 'wish', { text: 'More animals' })).where, 'message to the helper');
  assert.match(noteOf(ev('a', 't', 'wish', { text: 'x', list: 'settings' })).where, /the app/);
  assert.equal(noteOf(ev('a', 't', 'parentNote', { videoId: 'v', comment: 'Too fast' })).text, 'Too fast');
  assert.equal(noteOf(ev('a', 't', 'parentNote', { videoId: 'v', liked: true })), null);   // a 👍 alone is not a note
  assert.ok(noteOf(ev('a', 't', 'prompt', { action: 'add', text: 'x', noteId: 'a' })));
  assert.equal(noteOf(ev('a', 't', 'prompt', { action: 'remove', noteId: 'a' })), null);
  assert.ok(noteOf(ev('a', 't', 'context', { doc: 'math', text: 'x' })));
  assert.equal(noteOf(ev('a', 't', 'watch', { videoId: 'v' })), null);
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
function world() {
  const dir = mkdtempSync(join(tmpdir(), 'kt-notes-'));
  const p = (...x) => join(dir, ...x);
  sh(`git init -q --bare -b main ${p('data.git')} && git init -q --bare -b main ${p('code.git')}`);
  sh(`git clone -q ${p('data.git')} ${p('data')} 2>/dev/null; cd ${p('data')} && mkdir -p activity && echo '{}' > memory.json && git add -A && git commit -qm init && git push -q origin HEAD:main && git remote set-head origin main`);
  sh(`git clone -q ${p('code.git')} ${p('root')} 2>/dev/null`);
  mkdirSync(p('root', 'agent', 'lib'), { recursive: true });
  for (const f of ['poll.sh', 'notes.mjs', 'NOTES.md', 'lib/profile.mjs', 'lib/data.mjs']) copyFileSync(join('agent', f), p('root', 'agent', f));
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
fs.writeFileSync(result, fs.readFileSync(${JSON.stringify(p('answer.json'))}, 'utf8'));
console.log('{}');
`);
  chmodSync(p('bin', 'claude'), 0o755);
  const env = { ...process.env, PATH: `${p('bin')}:${process.env.PATH}`, KIDTUBE_STATE_DIR: p('state'), KIDTUBE_DATA_DIR: p('data'), KIDTUBE_APP_DIR: p('app'),
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
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
    answer: (a) => writeFileSync(p('answer.json'), JSON.stringify(a)),
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
