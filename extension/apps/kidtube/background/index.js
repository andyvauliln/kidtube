// KidTube's background part: what the core (core/background/apps.js) asks the app of a KidTube profile.
import { nowIso } from '../../../core/lib/time.js';
import { effective } from './config.js';
import { guard, viewState, leaveSession } from './rules.js';
import { HANDLERS, PAGE_ONLY } from './handlers.js';
import { syncKidTube, releaseNotes, requestRun } from './sync.js';
import { KIDTUBE_CHECKS } from './checks.js';
import { runView, heldNotes, editHeld, dropHeld, questionsView, dismissQuestion } from './parent.js';

// What a note is about, in the header's list (the parent screens' tabs and context documents).
const LISTS = { today: 'the Today list', planned: 'the Planned list', history: 'the History list', settings: 'the settings' };
const DOCS = { kid: 'About him', strategy: 'Strategy', math: 'Math', letters: 'Letters', world: 'World' };
const aboutOf = (n) => (n.videoId ? `the video “${n.title || n.videoId}”` : n.doc ? `the context document “${DOCS[n.doc] ?? n.doc}”`
  : n.type === 'prompt' ? 'the helper’s prompt' : LISTS[n.list] ?? 'KidTube');

export default {
  id: 'kidtube',
  // localConfig: rules saved on the parent page that haven't reached GitHub yet.
  // seen: title/channel of videos he opened, for the parent's list after the queue has moved on.
  // pendingTalk: the talking friend's screen he is on (before or after a video).
  // planLog: the parent's changes to today's list and the planned videos (lib/plan.js).
  // history: what he watched, newest last (parent mode → History). notes: the parent's notes for the AI.
  // outbox: events waiting for activity/<day>.json.
  stateKeys: ['watched', 'today', 'session', 'outbox', 'localConfig', 'seen', 'pendingTalk', 'quizTurn', 'transcripts', 'character', 'repoAvatars', 'planLog', 'history', 'notes'],
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
  checks: KIDTUBE_CHECKS,
  // The header's notifications: the notes ↻ Update has not sent yet, and the notes agent's latest run.
  aiView(s) {
    const r = runView(s);
    return { held: r.held, run: r.state, message: r.message ?? '', at: r.at ?? null, page: 'parent', send: '↻ Update' };
  },
  // The parent's notes not sent yet, each with Edit, Delete and Send in the header's list.
  notes: {
    list: async (s) => (await heldNotes(s)).notes.map((n) => ({ ...n, about: aboutOf(n) })),
    edit: (s, id, text) => editHeld(s, id, text),
    drop: (s, id) => dropHeld(s, id),
    send: (ids) => requestRun({ ids }),
  },
  // The questions already sent: waiting, answered, or no answer (the header's Question rows).
  questions: {
    list: (s) => questionsView(s).map((q) => ({ ...q, about: aboutOf(q) })),
    dismiss: (s, id) => dismissQuestion(s, id),
  },
  // Something waits for the server (a question, the run): the core syncs again in a minute, not in 15.
  waiting: (s) => questionsView(s).some((q) => q.state === 'waiting') || ['queued', 'running'].includes(runView(s).state),
  sync: syncKidTube,
  beforeSync: (msg) => (msg.notes ? releaseNotes() : undefined),
  async siteRules(stored) {
    const { config } = await effective(stored);
    return { block: !!config.blockOutboundLinks, allowed: config.allowedSiteDomains ?? [], ads: !!config.blockAds };
  },
  async tabRemoved(s, tabId) {
    if (s.session?.tabId === tabId) leaveSession(s, (await effective(s)).config, 'closed');
  },
};
