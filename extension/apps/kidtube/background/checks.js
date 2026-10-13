// KidTube's checks (core/checks/runner.js runs them): its files at the start, and what each of its messages must
// have done. The same form as core/checks/start.js and core/checks/actions.js.
import { isVideoId } from '../../../core/lib/youtube.js';
import { loadBundled, effective } from './config.js';
import { okConfig, okQueue } from './sync.js';
import { visibleVideos } from '../lib/queue.js';
import { AVATAR_CACHE, repoAvatarName } from './media.js';

const kid = (p) => chrome.runtime.getURL(`apps/kidtube/kid/${p}`);
const parentOn = (settings) => settings?.mode === 'parent';
const held = (outbox, type) => (outbox ?? []).filter((e) => e.held && (!type || e.type === type));
const refused = (t, answer) => t.has('answer.error (why it was refused)', answer?.error);

async function tabIs(t, c, test, expected) {
  if (c.tabId == null) return;
  const now = await c.tabUrl(c.tabId);
  if (now == null) return t.note('tab', 'the browser did not say where the tab is');
  t.ok('the tab’s address', test(now), now, expected);
}
const home = (u) => { try { const x = new URL(u); return /(^|\.)youtube\.com$/.test(x.hostname) && (x.pathname === '/' || x.pathname === ''); } catch { return false; } };
const watching = (id) => (u) => u.includes(`/watch?v=${id}`) || u.startsWith(kid('talk.html'));

// A note for the AI waits on the tablet (held) until ↻ Update: one more of its kind after the answer.
const notePlus = (type, expect, code) => ({
  area: 'notes', expect, code, snap: ['outbox'],
  check(t, { answer, before, after }) {
    if (!answer?.ok) return;   // an empty note or a wrong document: refused on purpose, the page says so
    t.eq(`held "${type}" notes`, held(before.outbox, type).length + 1, held(after.outbox, type).length);
  },
});

export const KIDTUBE_CHECKS = {
  start: [
    {
      id: 'kidtube.files', area: 'kid', expect: 'KidTube’s built-in rules, starter list and quiz types load',
      code: ['apps/kidtube/background/config.js loadBundled', 'apps/kidtube/data/'],
      async run(t) {
        const b = await loadBundled();
        t.ok('data/default-config.json', okConfig(b.config), b.config?.schemaVersion, 'a schemaVersion 1 file');
        t.ok('data/default-queue.json', okQueue(b.queue), b.queue?.videos?.length, 'a valid list');
        t.ok('data/quiz-types.json', Array.isArray(b.quizTypes) && b.quizTypes.length > 0, b.quizTypes, 'a list of quiz types');
      },
    },
    {
      id: 'kidtube.lists', area: 'kid', expect: 'The profile’s rules and list from GitHub are valid, and his list can be drawn',
      code: ['apps/kidtube/background/sync.js syncKidTube', 'apps/kidtube/background/config.js effective', 'apps/kidtube/lib/queue.js'],
      async run(t) {
        const s = await chrome.storage.local.get(['account', 'data', 'localConfig', 'planLog', 'watched', 'settings']);
        if (s.account?.app && s.account.app !== 'kidtube') return t.skip('another app runs');
        if (s.data?.queue) t.ok('queue.json from GitHub', okQueue(s.data.queue), { schemaVersion: s.data.queue.schemaVersion, videos: s.data.queue.videos?.length }, 'a valid list');
        if (s.data?.config) t.ok('parent-config.json from GitHub', okConfig(s.data.config), s.data.config.schemaVersion, 'a schemaVersion 1 file');
        const { config, queue } = await effective(s);
        const shown = visibleVideos(queue, config, s.watched ?? {});
        t.note('list', { source: s.data?.queue ? 'GitHub' : 'built-in', videos: queue.videos.length, shown: shown.length, minutesPerDay: config.time?.maxMinutesPerDay ?? null });
        t.ok('every video id', queue.videos.every((v) => isVideoId(v.videoId)), queue.videos.map((v) => v.videoId).filter((id) => !isVideoId(id)), '11 characters');
      },
    },
    {
      id: 'kidtube.avatar', area: 'kid', expect: 'A moving avatar chosen from the data repo (repo:<name>) is kept on the tablet',
      code: ['apps/kidtube/background/media.js syncAvatar', 'apps/kidtube/kid/mesh.js cachedAvatar'],
      async run(t) {
        const s = await chrome.storage.local.get(['account', 'data', 'localConfig', 'repoAvatars', 'syncStatus']);
        if (s.account?.app && s.account.app !== 'kidtube') return t.skip('another app runs');
        const name = repoAvatarName((await effective(s)).config.presenter?.avatar);
        if (!name) return t.skip('no avatar from the data repo chosen');
        if (!globalThis.caches) return t.skip('no Cache Storage in this browser');
        const kept = !!await (await caches.open(AVATAR_CACHE)).match(`https://kidtube.invalid/avatars/${name}/rig.json`);
        const why = (s.syncStatus?.errors ?? []).find((e) => e.startsWith('Moving avatar: '));
        // Not downloaded and no error: the first sync has not reached it yet.
        if (!kept && !why) return t.skip('not downloaded yet');
        t.note('in the data repo', s.repoAvatars ?? []);
        t.ok(`avatars/${name}/rig.json on the tablet`, kept, why ?? 'missing', 'kept');
      },
    },
  ],

  actions: {
    // Playback time: what he played is counted (not in parent mode).
    tick: {
      area: 'kid', expect: 'Playback time is counted (not in parent mode)',
      code: ['apps/kidtube/background/handlers.js tick', 'apps/kidtube/content/youtube.js (playback time)'],
      snap: ['today', 'settings'],
      skip: ({ before, after }) => !before.today || before.today.date !== after.today?.date,
      check(t, { msg, answer, before, after }) {
        const add = Math.min(Math.max(Number(msg.seconds) || 0, 0), 15);
        const grew = (after.today?.playedSeconds ?? 0) - (before.today?.playedSeconds ?? 0);
        if (parentOn(before.settings)) return t.eq('seconds counted in parent mode', 0, grew);
        t.ok('today.playedSeconds grew by the seconds played', grew >= add, { before: before.today?.playedSeconds, after: after.today?.playedSeconds, played: add }, `+${add}`);
        t.ok('answer.action', ['none', 'lock', 'home'].includes(answer?.action), answer?.action, 'none, lock or home');
      },
    },

    open: {
      area: 'kid', expect: 'A card he taps opens that video (or the talking friend first)',
      code: ['apps/kidtube/background/handlers.js open', 'apps/kidtube/kid/render.js cards'],
      skip: ({ answer }) => !answer?.ok,   // locked, not on his list, or another video still running: refused on purpose
      check() {},
      later: { ms: 4000, check: (t, c) => tabIs(t, c, watching(c.msg.videoId), `the video ${c.msg.videoId} or the talking friend`) },
    },

    goHome: {
      area: 'kid', expect: 'Home on the strip: his list',
      code: ['apps/kidtube/background/handlers.js goHome', 'apps/kidtube/kid/render.js mountStrip'],
      skip: ({ answer }) => !answer?.ok,
      check() {},
      later: { ms: 4000, check: (t, c) => tabIs(t, c, home, 'YouTube’s home (his list)') },
    },

    ended: {
      area: 'kid', expect: 'At the end of a video: it counts as watched, then the talking friend or his list',
      code: ['apps/kidtube/background/handlers.js ended', 'apps/kidtube/content/youtube.js (ended)'],
      snap: ['session', 'watched'],
      skip: ({ msg, before }) => before.session?.videoId !== msg.videoId,
      check(t, { msg, after }) {
        t.eq('session (the video is over)', null, after.session ?? null);
        t.has(`watched["${msg.videoId}"]`, after.watched?.[msg.videoId]);
      },
      later: { ms: 4000, check: (t, c) => tabIs(t, c, (u) => home(u) || u.startsWith(kid('talk.html')), 'his list or the talking friend') },
    },

    quizResults: {
      area: 'kid', expect: 'The quiz answers are kept, and the next step is decided',
      code: ['apps/kidtube/background/handlers.js quizResults'],
      snap: ['pendingTalk', 'outbox'],
      skip: ({ msg, before }) => !(before.pendingTalk?.mode === 'outro' && before.pendingTalk.videoId === msg.videoId),
      check(t, { msg, answer, before, after }) {
        t.ok('answer.next', ['home', 'rewatch', 'stopForToday'].includes(answer?.next), answer?.next, 'home, rewatch or stopForToday');
        const answered = [].concat(msg.results ?? []).filter((r) => before.pendingTalk.quizIds.includes(r.quizId)).length;
        const quiz = (o) => (o ?? []).filter((e) => e.type === 'quiz').length;
        if (answered) t.ok('quiz events added', quiz(after.outbox) > quiz(before.outbox), { before: quiz(before.outbox), after: quiz(after.outbox) }, 'more than before');
      },
    },

    note: {
      ...notePlus('parentNote', 'A note on a video waits for ↻ Update; a 👍 / 👎 is saved', ['apps/kidtube/background/parent.js noteVideo']),
      snap: ['outbox', 'notes'],
      check(t, { msg, answer, before, after }) {
        if (!answer?.ok) return;
        if (msg.comment) t.eq('held notes on videos', held(before.outbox, 'parentNote').length + 1, held(after.outbox, 'parentNote').length);
        if (typeof msg.liked === 'boolean') t.eq(`notes.liked["${msg.videoId}"]`, msg.liked, after.notes?.liked?.[msg.videoId]);
      },
    },
    wish: notePlus('wish', 'A note for the AI (a list, Settings, a message) waits for ↻ Update', ['apps/kidtube/background/parent.js wish']),
    contextNote: notePlus('context', 'A note on a context document waits for ↻ Update', ['apps/kidtube/background/parent.js contextNote']),
    promptNote: {
      area: 'notes', expect: 'A change to the helper’s prompt is kept', code: ['apps/kidtube/background/parent.js promptNote'], snap: ['outbox'],
      check(t, { msg, answer, before, after }) {
        if (!answer?.ok) return;
        const n = (o) => (o ?? []).filter((e) => e.type === 'prompt').length;
        t.ok('prompt events', n(after.outbox) > n(before.outbox) || msg.action === 'remove', { before: n(before.outbox), after: n(after.outbox) }, 'one more');
      },
    },

    dropNote: {
      area: 'notes', expect: '✕ on a note (or Clear all): it is gone from the tablet',
      code: ['apps/kidtube/background/parent.js dropHeld'],
      snap: ['outbox'],
      check(t, { msg, answer, after }) {
        if (!answer?.ok) return;
        if (msg.all) t.eq('held notes left', 0, held(after.outbox).length);
        else t.ok('the note is gone', !(after.outbox ?? []).some((e) => e.eventId === msg.id), msg.id, 'not in the outbox');
      },
    },

    saveRules: {
      area: 'rules', net: true, expect: 'Saved rules go to GitHub, or stay on the tablet with a reason',
      code: ['apps/kidtube/background/sync.js saveRules', 'apps/kidtube/parent/settings.js'],
      snap: ['localConfig'],
      check(t, { answer, after }) {
        t.ok('answer.saved', ['github', 'tablet'].includes(answer?.saved), answer?.saved, 'github or tablet');
        if (answer?.saved === 'github') t.eq('rules waiting on the tablet (localConfig)', null, after.localConfig ?? null);
        if (answer?.saved === 'tablet') { t.has('answer.error (why only on the tablet)', answer.error); t.has('localConfig (kept for the next sync)', after.localConfig); }
      },
    },

    runHelper: {
      area: 'notes', net: true, expect: '↻ Update: the notes are sent and the server is asked for a run',
      code: ['apps/kidtube/background/sync.js requestRun', 'apps/kidtube/parent/kit.js runNow'],
      snap: ['outbox', 'data'],
      check(t, { answer, after }) {
        if (!answer?.ok) return refused(t, answer);
        // A recorded note the server still writes down waits on purpose (background/voice.js).
        t.eq('notes still waiting', 0, held(after.outbox).filter((e) => !e.voice).length);
        t.has('data.runRequest.id', after.data?.runRequest?.id);
      },
    },

    resetToday: {
      area: 'rules', expect: 'Reset today: his time today starts again', code: ['apps/kidtube/background/handlers.js resetToday'], snap: ['today'],
      check(t, { after }) { t.eq('today', null, after.today ?? null); },
    },

    plan: {
      area: 'notes', expect: 'A change to today’s list or the planned videos is kept', code: ['apps/kidtube/background/parent.js planChange'], snap: ['planLog'],
      check(t, { answer, after }) {
        if (!answer?.ok) return;
        t.has('planLog.events', after.planLog?.events);
      },
    },
  },
};
