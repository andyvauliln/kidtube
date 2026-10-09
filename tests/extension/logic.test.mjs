import test from 'node:test';
import assert from 'node:assert/strict';
import { localParts, inAllowedWindow, nextOpening, lockReason } from '../../extension/core/lib/time.js';
import { visibleVideos } from '../../extension/apps/kidtube/lib/queue.js';
import { classifyUrl } from '../../extension/core/lib/youtube.js';

const cfg = { timezone: 'Europe/Moscow', time: { allowed: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '16:00', to: '18:30' }], maxMinutesPerDay: 40 } };
// 2026-10-01 is a Thursday. Moscow = UTC+3.
const at = (utc) => new Date(`2026-10-01T${utc}Z`);

test('local parts use the configured time zone', () => {
  assert.deepEqual(localParts(at('21:30:00'), 'Europe/Moscow'), { date: '2026-10-02', day: 'fri', minutes: 30 });
  assert.equal(localParts(at('21:30:00'), 'UTC').date, '2026-10-01');
});

test('window edges: from is inside, to is outside', () => {
  assert.equal(inAllowedWindow(cfg, at('12:59:00')), false);
  assert.equal(inAllowedWindow(cfg, at('13:00:00')), true);
  assert.equal(inAllowedWindow(cfg, at('15:29:00')), true);
  assert.equal(inAllowedWindow(cfg, at('15:30:00')), false);
});

test('next opening: later today, then the next allowed day', () => {
  assert.deepEqual(nextOpening(cfg, at('10:00:00')), { day: 'today', at: '16:00' });
  assert.deepEqual(nextOpening(cfg, at('16:00:00')), { day: 'tomorrow', at: '16:00' });
  const fri = new Date('2026-10-02T16:00:00Z');
  assert.deepEqual(nextOpening(cfg, fri), { day: 'mon', at: '16:00' });
});

test('lock reasons: hours first, then the daily cap', () => {
  assert.equal(lockReason(cfg, at('10:00:00'), 0), 'outsideHours');
  assert.equal(lockReason(cfg, at('14:00:00'), 40 * 60 - 1), null);
  assert.equal(lockReason(cfg, at('14:00:00'), 40 * 60), 'dailyCap');
  assert.equal(lockReason({ ...cfg, time: { ...cfg.time, maxMinutesPerDay: 0 } }, at('14:00:00'), 99999), null);
});

const v = (id, over = {}) => ({ videoId: id.padEnd(11, 'x'), title: id, channelId: 'UCa', durationSeconds: 300, ...over });

test('visible videos: watched, blocked, too short/long, duplicates, queueSize', () => {
  const q = { videos: [v('a'), v('b', { channelId: 'UCbad' }), v('c', { durationSeconds: 30 }), v('d', { durationSeconds: 5000 }), v('a'), v('e'), v('f', { allowRewatch: true }), v('g')] };
  const c = { blockedChannelIds: ['UCbad'], minVideoDurationSeconds: 60, maxVideoDurationSeconds: 1200, queueSize: 3 };
  const ids = visibleVideos(q, c, { [v('e').videoId]: 'x', [v('f').videoId]: 'x' }).map((x) => x.videoId[0]);
  assert.deepEqual(ids, ['a', 'f', 'g']);
});

test('URL classes', () => {
  assert.deepEqual(classifyUrl('https://m.youtube.com/'), { kind: 'home', host: 'm.youtube.com' });
  assert.deepEqual(classifyUrl('https://m.youtube.com/watch?v=asNWTdlBG14&t=3'), { kind: 'watch', host: 'm.youtube.com', videoId: 'asNWTdlBG14' });
  assert.equal(classifyUrl('https://www.youtube.com/shorts/abc').kind, 'shorts');
  assert.equal(classifyUrl('https://m.youtube.com/@numberblocks').kind, 'channel');
  assert.equal(classifyUrl('https://m.youtube.com/results?search_query=x').kind, 'search');
  assert.equal(classifyUrl('https://m.youtube.com/feed/subscriptions').kind, 'other');
  assert.equal(classifyUrl('https://example.com/').kind, 'external');
  assert.equal(classifyUrl('chrome-extension://abc/x.html').kind, 'internal');
});
