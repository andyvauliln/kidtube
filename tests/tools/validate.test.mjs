import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateDataDir, validateFile, checkQueue, checkEffectiveConfig } from '../../tools/validate.mjs';
import { mergeConfig } from '../../extension/core/lib/merge.js';

const errorsOnly = (r) => r.errors.filter((m) => !m.startsWith('warning:'));

test('good data dir passes', () => {
  for (const r of validateDataDir('tests/fixtures/good/data')) assert.deepEqual(errorsOnly(r), [], r.path);
});

test('bundled default-config passes', () => {
  assert.deepEqual(errorsOnly(validateFile('extension/apps/kidtube/data/default-config.json')), []);
});

for (const dir of readdirSync('tests/fixtures/bad')) {
  test(`bad fixture fails: ${dir}`, () => {
    for (const f of readdirSync(join('tests/fixtures/bad', dir))) {
      assert.ok(errorsOnly(validateFile(join('tests/fixtures/bad', dir, f))).length > 0, `${dir}/${f} should fail`);
    }
  });
}

const defaults = JSON.parse(readFileSync('extension/apps/kidtube/data/default-config.json', 'utf8'));
const CH = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const video = (over = {}) => ({ videoId: 'AAAAAAAAAA1', title: 't', channelId: CH, durationSeconds: 300, addedAt: '2026-10-01T12:00:00Z', ...over });

test('queue: unknown quizId is rejected (C15)', () => {
  const errs = checkQueue({ videos: [video({ quizIds: ['nope'] })] }, defaults);
  assert.ok(errs.some((e) => e.includes('"nope"')));
});

test('queue: blocked channel and duration limits', () => {
  const eff = mergeConfig(defaults, { blockedChannelIds: [CH] });
  assert.ok(checkQueue({ videos: [video()] }, eff).some((e) => e.includes('blocked channel')));
  assert.ok(checkQueue({ videos: [video({ durationSeconds: 30 })] }, defaults).some((e) => e.includes('shorter')));
  assert.ok(checkQueue({ videos: [video({ durationSeconds: 5000 })] }, defaults).some((e) => e.includes('longer')));
});

test('queue: fewer videos than queueSize is only a warning', () => {
  const errs = checkQueue({ videos: [video()] }, defaults);
  assert.ok(errs.length === 1 && errs[0].startsWith('warning:'));
});

test('effective config: quiz type the build lacks is rejected (C10)', () => {
  const eff = mergeConfig(defaults, { quiz: { defaultIds: ['m'], items: { m: { type: 'memory-game', prompt: 'p', answer: { kind: 'text', accept: ['x'] } } } } });
  assert.ok(checkEffectiveConfig(eff, ['text', 'choice', 'audio']).some((e) => e.includes('memory-game')));
});

test('effective config: enabled quiz without defaultIds is a warning', () => {
  const eff = mergeConfig(defaults, { quiz: { enabled: true } });
  assert.ok(checkEffectiveConfig(eff, ['text']).some((e) => e.includes('defaultIds is empty')));
});

test('quiz types come from the tablet’s newest activity, else the build', async () => {
  const { mkdtempSync, cpSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'kt-'));
  cpSync('tests/fixtures/good/data', dir, { recursive: true });
  rmSync(join(dir, 'activity'), { recursive: true });
  const cfg = validateDataDir(dir).find((r) => r.path.endsWith('parent-config.json'));
  const builds = JSON.parse(readFileSync('extension/apps/kidtube/data/quiz-types.json', 'utf8'));
  if (!builds.includes('text')) assert.ok(cfg.errors.some((e) => e.includes('not supported by this build')));
  rmSync(dir, { recursive: true });
});
