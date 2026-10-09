import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfig } from '../../extension/core/lib/merge.js';

const base = {
  queueSize: 10,
  blockedChannelIds: ['UCa'],
  time: { allowed: [{ days: ['mon'], from: '16:00', to: '18:00' }], maxMinutesPerDay: 40 },
  quiz: { enabled: false, items: { a: { type: 'text' } } },
};

test('nested object deep-merges instead of replacing (C4)', () => {
  const out = mergeConfig(base, { time: { maxMinutesPerDay: 30 } });
  assert.equal(out.time.maxMinutesPerDay, 30);
  assert.deepEqual(out.time.allowed, base.time.allowed);
});

test('arrays replace', () => {
  assert.deepEqual(mergeConfig(base, { blockedChannelIds: ['UCb'] }).blockedChannelIds, ['UCb']);
  assert.deepEqual(mergeConfig(base, { blockedChannelIds: [] }).blockedChannelIds, []);
});

test('null resets to the bundled default', () => {
  assert.equal(mergeConfig(base, { queueSize: null }).queueSize, 10);
  assert.equal(mergeConfig(base, { quiz: { items: { a: null } } }).quiz.items.a.type, 'text');
});

test('quiz items add by key without resending the rest', () => {
  const out = mergeConfig(base, { quiz: { items: { b: { type: 'choice' } } } });
  assert.deepEqual(Object.keys(out.quiz.items).sort(), ['a', 'b']);
});

test('base is not mutated', () => {
  const snapshot = structuredClone(base);
  mergeConfig(base, { time: { maxMinutesPerDay: 5 }, quiz: { enabled: true } });
  assert.deepEqual(base, snapshot);
});

test('non-object overlay returns a copy of base', () => {
  assert.deepEqual(mergeConfig(base, null), base);
});
