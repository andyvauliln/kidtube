// KidTube's background part: what the core (core/background/apps.js) asks the app of a KidTube profile.
import { nowIso } from '../../../core/lib/time.js';
import { effective } from './config.js';
import { guard, viewState, leaveSession } from './rules.js';
import { HANDLERS, PAGE_ONLY } from './handlers.js';
import { syncKidTube, releaseNotes } from './sync.js';

export default {
  id: 'kidtube',
  // localConfig: rules saved on the parent page that haven't reached GitHub yet.
  // seen: title/channel of videos he opened, for the parent's list after the queue has moved on.
  // pendingTalk: the talking friend's screen he is on (before or after a video).
  // planLog: the parent's changes to today's list and the planned videos (lib/plan.js).
  // history: what he watched, newest last (parent mode → History). notes: the parent's notes for the AI.
  // outbox: events waiting for activity/<day>.json.
  stateKeys: ['watched', 'today', 'session', 'outbox', 'localConfig', 'seen', 'pendingTalk', 'quizTurn', 'transcripts', 'character', 'planLog', 'history', 'notes'],
  // The helper's files and the context documents, kept per profile too.
  profileKeys: ['memory', 'helperInfo', 'contextDocs'],
  // The listening keys typed in Settings go into the settings file.
  fileKeys: ['voiceKey', 'geminiKey', 'groqKey'],
  prepare(s) { s.watched ??= {}; s.outbox ??= []; s.seen ??= {}; },
  // A new KidTube starts with no list at all (not the built-in starter list): the helper fills it.
  created(s) { s.data.queue ??= { schemaVersion: 1, updatedAt: nowIso(), videos: [] }; },
  guard,
  view: viewState,
  handlers: HANDLERS,
  pageOnly: PAGE_ONLY,
  sync: syncKidTube,
  beforeSync: (msg) => (msg.notes ? releaseNotes() : undefined),
  async siteRules(stored) {
    const { config } = await effective(stored);
    return { block: !!config.blockOutboundLinks, allowed: config.allowedSiteDomains ?? [] };
  },
  async tabRemoved(s, tabId) {
    if (s.session?.tabId === tabId) leaveSession(s, (await effective(s)).config, 'closed');
  },
};
