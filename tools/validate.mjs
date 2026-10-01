#!/usr/bin/env node
// Validates the data files the agent and the tablet exchange (PLAN.md §3).
//
//   node tools/validate.mjs <data-dir>          parent-config.json, queue.json, memory.json, activity/*.json + cross-file checks
//   node tools/validate.mjs <file.json> ...     single files; kind is taken from the file name
//
// Exit code 0 when everything is valid, 1 otherwise.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { mergeConfig } from '../extension/lib/merge.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = join(ROOT, 'schemas');
const DEFAULT_CONFIG_PATH = join(ROOT, 'extension', 'default-config.json');
const QUIZ_TYPES_PATH = join(ROOT, 'extension', 'quiz-types.json');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const f of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(join(SCHEMA_DIR, f), 'utf8')));
}

export function kindOf(path) {
  const name = basename(path);
  if (name === 'default-config.json') return 'default-config';
  if (name === 'parent-config.json') return 'parent-config';
  if (name === 'queue.json') return 'queue';
  if (name === 'memory.json') return 'memory';
  if (/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) return 'activity';
  return null;
}

function schemaErrors(kind, data) {
  const validate = ajv.getSchema(`${kind}.schema.json`);
  if (validate(data)) return [];
  // anyOf/if wrappers and the "or null" branch only repeat the real error.
  const noise = (e) => e.keyword === 'anyOf' || e.keyword === 'if' || (e.keyword === 'type' && e.params?.type === 'null');
  return validate.errors.filter((e) => !noise(e)).map((e) => `${e.instancePath || '/'} ${e.message}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(', ')})` : ''}`);
}

// --- semantic checks: things JSON Schema can't say -------------------------

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function checkConfig(cfg) {
  const errs = [];
  if (cfg.timezone != null && !isValidTimeZone(cfg.timezone)) errs.push(`/timezone "${cfg.timezone}" is not an IANA time zone`);
  (cfg.time?.allowed ?? []).forEach((w, i) => {
    if (toMinutes(w.from) >= toMinutes(w.to)) errs.push(`/time/allowed/${i} from ${w.from} must be before to ${w.to} (no windows past midnight)`);
  });
  const min = cfg.minVideoDurationSeconds, max = cfg.maxVideoDurationSeconds;
  if (min != null && max != null && max !== 0 && min > max) errs.push(`/minVideoDurationSeconds ${min} > maxVideoDurationSeconds ${max}`);
  for (const [id, item] of Object.entries(cfg.quiz?.items ?? {})) {
    if (item?.answer?.kind === 'choice' && !item.answer.options.includes(item.answer.correct)) {
      errs.push(`/quiz/items/${id}/answer correct "${item.answer.correct}" is not one of options`);
    }
  }
  return errs;
}

// Checks that need the effective (merged) config.
export function checkEffectiveConfig(eff, quizTypes) {
  const errs = [];
  const items = eff.quiz?.items ?? {};
  for (const id of eff.quiz?.defaultIds ?? []) {
    if (!items[id]) errs.push(`/quiz/defaultIds "${id}" has no item in quiz.items`);
  }
  if (eff.quiz?.enabled && (eff.quiz.defaultIds ?? []).length === 0) {
    errs.push('/quiz enabled but defaultIds is empty: videos without quizIds would get no quiz');
  }
  if (quizTypes) {
    for (const [id, item] of Object.entries(items)) {
      if (item && !quizTypes.includes(item.type)) errs.push(`/quiz/items/${id} type "${item.type}" is not supported by this build (${quizTypes.join(', ')})`);
    }
  }
  return errs;
}

export function checkQueue(queue, eff) {
  const errs = [];
  const seen = new Set();
  queue.videos.forEach((v, i) => {
    if (seen.has(v.videoId)) errs.push(`/videos/${i} duplicate videoId ${v.videoId}`);
    seen.add(v.videoId);
    if (!eff) return;
    if (eff.blockedChannelIds?.includes(v.channelId)) errs.push(`/videos/${i} ${v.videoId} is from blocked channel ${v.channelId}`);
    if (v.durationSeconds < eff.minVideoDurationSeconds) errs.push(`/videos/${i} ${v.videoId} is ${v.durationSeconds}s, shorter than minVideoDurationSeconds ${eff.minVideoDurationSeconds}`);
    if (eff.maxVideoDurationSeconds > 0 && v.durationSeconds > eff.maxVideoDurationSeconds) errs.push(`/videos/${i} ${v.videoId} is ${v.durationSeconds}s, longer than maxVideoDurationSeconds ${eff.maxVideoDurationSeconds}`);
    for (const q of v.quizIds ?? []) {
      if (!eff.quiz?.items?.[q]) errs.push(`/videos/${i} quizIds "${q}" has no item in quiz.items`);
    }
  });
  if (eff) {
    const usable = queue.videos.filter((v) => !eff.blockedChannelIds?.includes(v.channelId)).length;
    if (usable < eff.queueSize) errs.push(`warning: only ${usable} usable videos, queueSize is ${eff.queueSize}`);
  }
  return errs;
}

export function checkActivity(act, fileName) {
  const errs = [];
  if (fileName && basename(fileName) !== `${act.date}.json`) errs.push(`/date ${act.date} does not match file name ${basename(fileName)}`);
  const seen = new Set();
  act.events.forEach((e, i) => {
    if (seen.has(e.eventId)) errs.push(`/events/${i} duplicate eventId ${e.eventId}`);
    seen.add(e.eventId);
  });
  return errs;
}

// --- driver -----------------------------------------------------------------

function readJson(path) {
  try {
    return { data: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (e) {
    return { error: `cannot parse: ${e.message}` };
  }
}

// Returns [{ path, errors: [] }]. Errors starting with "warning:" don't fail the run.
export function validateFile(path, ctx = {}) {
  const kind = kindOf(path);
  if (!kind) return { path, errors: [`unknown file kind (expected parent-config.json, queue.json, memory.json, default-config.json or YYYY-MM-DD.json)`] };
  const { data, error } = readJson(path);
  if (error) return { path, errors: [error] };
  const errors = schemaErrors(kind, data);
  if (errors.length) return { path, kind, data, errors };
  if (kind === 'parent-config' || kind === 'default-config') errors.push(...checkConfig(data));
  if (kind === 'queue') errors.push(...checkQueue(data, ctx.effectiveConfig));
  if (kind === 'activity') errors.push(...checkActivity(data, path));
  return { path, kind, data, errors };
}

export function loadQuizTypes() {
  return JSON.parse(readFileSync(QUIZ_TYPES_PATH, 'utf8'));
}

export function validateDataDir(dir) {
  const results = [];
  const defaults = JSON.parse(readFileSync(DEFAULT_CONFIG_PATH, 'utf8'));
  let effectiveConfig = defaults;

  const cfgPath = join(dir, 'parent-config.json');
  if (existsSync(cfgPath)) {
    const r = validateFile(cfgPath);
    if (!r.errors.some(isError)) {
      effectiveConfig = mergeConfig(defaults, r.data);
      r.errors.push(...checkEffectiveConfig(effectiveConfig, loadQuizTypes()));
    }
    results.push(r);
  } else {
    results.push({ path: cfgPath, errors: ['missing'] });
  }

  for (const name of ['queue.json', 'memory.json']) {
    const p = join(dir, name);
    results.push(existsSync(p) ? validateFile(p, { effectiveConfig }) : { path: p, errors: ['missing'] });
  }

  const actDir = join(dir, 'activity');
  if (existsSync(actDir)) {
    for (const f of readdirSync(actDir).filter((f) => f.endsWith('.json')).sort()) results.push(validateFile(join(actDir, f)));
  }
  return results;
}

const isError = (msg) => !msg.startsWith('warning:');

function main(argv) {
  if (argv.length === 0) {
    console.error('usage: validate.mjs <data-dir> | <file.json> ...');
    return 2;
  }
  const results = argv.flatMap((p) => (statSync(p).isDirectory() ? validateDataDir(p) : [validateFile(p)]));
  let failed = false;
  for (const r of results) {
    const errs = r.errors.filter(isError);
    const warns = r.errors.filter((m) => !isError(m));
    failed ||= errs.length > 0;
    console.log(`${errs.length ? 'FAIL' : 'ok  '} ${r.path}`);
    for (const m of [...errs, ...warns]) console.log(`     ${m}`);
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
