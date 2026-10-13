#!/usr/bin/env node
// The parent's notes for the AI that nobody has handled yet. No AI here: agent/poll.sh asks every minute
// and starts the notes agent (agent/NOTES.md) only when there are some.
//   node agent/notes.mjs new  [--data DIR] [--state DIR]   → JSON array of new notes (first run: marks all old ones handled, prints [])
//   node agent/notes.mjs mark FILE [--state DIR]           → marks the notes in FILE (the array printed by `new`) handled
//   node agent/notes.mjs done FILE [--data DIR]            → adds them to notes-done.json in the data folder: the tablet
//                                                            deletes those notes from its lists (it keeps no history)
//   node agent/notes.mjs answers RESULT FILE [--data DIR]  → the agent's answers to the questions in FILE (RESULT's
//                                                            "answers": [{ eventId, answer }]) into answers.json in the
//                                                            data folder; the tablet shows each under its question
// A note: a message or a note about a list / Settings (wish), a note about a video (parentNote with a comment),
// a standing change to the helper's prompt (prompt add), a note on a context document (context). A note keeps the
// context the parent attached on the tablet (context.screen, context.app). question: true when the parent asked
// something (the ❓ switch, or a "?" in the words): the agent answers it.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, 'config.json'), 'utf8'));
const home = (p) => p.replace(/^~/, process.env.HOME);
const { values, positionals } = parseArgs({ allowPositionals: true, options: { data: { type: 'string' }, state: { type: 'string' } } });
const DATA = home(values.data ?? process.env.KIDTUBE_DATA_DIR ?? config.dataDir);
const STATE = home(values.state ?? process.env.KIDTUBE_STATE_DIR ?? config.stateDir ?? '~/.local/share/kidtube/state');
const HANDLED = join(STATE, 'notes-handled.json');
const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };

export function noteOf(e) {
  const n = noteKind(e);
  return n && e.ask === true ? { ...n, question: true } : n;
}
function noteKind(e) {
  if (e.type === 'wish' && e.text) return { where: e.list ? `note about ${e.list === 'settings' ? 'the app (Settings)' : `the ${e.list} list`}` : 'message to the helper', text: e.text };
  if (e.type === 'parentNote' && e.comment) return { where: 'note about a video', text: e.comment, videoId: e.videoId };
  if (e.type === 'prompt' && e.action === 'add' && e.text) return { where: 'standing change to the helper’s prompt', text: e.text };
  if (e.type === 'context' && e.text) return { where: `note on the context document “${e.doc}”`, text: e.text };
  return null;
}

export function allNotes(dataDir) {
  const dir = join(dataDir, 'activity');
  if (!existsSync(dir)) return [];
  const memory = readJson(join(dataDir, 'memory.json'), {});
  const title = (id) => memory.videos?.[id]?.title ?? null;
  const out = [];
  for (const f of readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()) {
    for (const e of readJson(join(dir, f), {}).events ?? []) {
      const n = noteOf(e);
      if (n) out.push({ eventId: e.eventId, at: e.at, ...n, ...(n.videoId && title(n.videoId) ? { videoTitle: title(n.videoId) } : {}), ...(e.context ? { context: e.context } : {}) });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// The agent's answers (result.answers) to notes of this run (notes): added to answers.json, newest last, at most 50.
// Only answers to a note of this run count; the words are cut at 2000 characters. Returns how many were added.
export function writeAnswers(dataDir, result, notes, now = new Date().toISOString()) {
  const asked = new Map(notes.map((n) => [n.eventId, n]));
  const fresh = (Array.isArray(result?.answers) ? result.answers : [])
    .filter((a) => asked.has(a?.eventId) && typeof a.answer === 'string' && a.answer.trim())
    .map((a) => ({ eventId: a.eventId, question: String(asked.get(a.eventId).text ?? '').slice(0, 500), answer: a.answer.trim().slice(0, 2000), at: now }));
  if (!fresh.length) return 0;
  const p = join(dataDir, 'answers.json');
  const ids = new Set(fresh.map((a) => a.eventId));
  const answers = [...(readJson(p, {}).answers ?? []).filter((a) => !ids.has(a.eventId)), ...fresh].slice(-50);
  writeFileSync(p, JSON.stringify({ schemaVersion: 1, updatedAt: now, answers }, null, 2) + '\n');
  return fresh.length;
}

function save(handled) {
  mkdirSync(STATE, { recursive: true });
  writeFileSync(HANDLED, JSON.stringify(handled, null, 2) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, file] = positionals;
  const handled = readJson(HANDLED, null);
  const notes = allNotes(DATA);
  if (cmd === 'new') {
    // First run: everything written before the notes agent existed counts as handled.
    if (!handled) { save({ since: new Date().toISOString(), ids: notes.map((n) => n.eventId) }); console.log('[]'); process.exit(0); }
    const seen = new Set(handled.ids);
    console.log(JSON.stringify(notes.filter((n) => !seen.has(n.eventId)), null, 2));
  } else if (cmd === 'mark' && file) {
    const done = readJson(file, []).map((n) => n.eventId).filter(Boolean);
    const h = handled ?? { since: new Date().toISOString(), ids: [] };
    h.ids = [...new Set([...h.ids, ...done])];
    save(h);
    console.log(`marked ${done.length}`);
  } else if (cmd === 'done' && file) {
    const p = join(DATA, 'notes-done.json');
    const done = readJson(file, []).map((n) => n.eventId).filter(Boolean);
    const ids = [...new Set([...(readJson(p, {}).ids ?? []), ...done])].slice(-300);
    writeFileSync(p, JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), ids }, null, 2) + '\n');
    console.log(`done ${done.length}`);
  } else if (cmd === 'answers' && file && positionals[2]) {
    console.log(`answers ${writeAnswers(DATA, readJson(file, {}), readJson(positionals[2], []))}`);
  } else {
    console.error('usage: notes.mjs new | mark FILE | done FILE | answers RESULT FILE');
    process.exit(2);
  }
}
