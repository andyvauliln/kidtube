// The helper's bookkeeping, without any network: what he watched, which videos go on today's list.
// A video record (memory.json → helper.videos[videoId]):
//   { title, channelId, channelTitle, durationSeconds, lang, topics, why, addedAt, status,
//     approved, required, day, comment, watchedAt, liked, quiz, content }
// status: idea (suggested) | planned | today | watched | no (parent said no)
// required: null | 'yes' (must watch, any day) | 'today' (must watch on `day`, or as soon as possible)

import { applyPlanEvent, applyPromptNotes } from '../../extension/apps/kidtube/lib/plan.js';

export { applyPromptNotes };

export const OPEN = new Set(['idea', 'planned', 'today']);

// Fields each tablet plan change sets (parent mode).
export const PLAN_FIELDS = { today: ['status', 'approved'], notToday: ['status'], drop: ['status'], restore: ['status'], required: ['required'], approve: ['approved', 'status'] };

// Folds tablet activity into the records. Returns what the model should hear about.
export function applyActivity(videos, events, { minSecondsBeforeLeave = 120 } = {}) {
  const news = { watched: [], notes: [], quiz: [], wishes: [], blocked: [], plan: [], edited: {}, prompt: [], context: [] };
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    const v = e.videoId ? videos[e.videoId] : null;
    if (e.type === 'watch') {
      const done = e.endReason === 'ended' || e.watchedSeconds >= minSecondsBeforeLeave;
      if (v && done) { v.status = 'watched'; v.watchedAt ??= e.at; }
      news.watched.push({ videoId: e.videoId, title: v?.title, watchedSeconds: e.watchedSeconds, durationSeconds: e.durationSeconds, endReason: e.endReason, counted: done });
    } else if (e.type === 'parentNote') {
      if (v) { if (typeof e.liked === 'boolean') v.liked = e.liked; if (e.comment) v.comment = e.comment; }
      news.notes.push({ videoId: e.videoId, title: v?.title, liked: e.liked, comment: e.comment });
    } else if (e.type === 'quiz') {
      if (v) (v.quiz ??= []).push({ quizId: e.quizId, result: e.result, attempts: e.attempts, at: e.at });
      news.quiz.push({ videoId: e.videoId, title: v?.title, quizId: e.quizId, result: e.result, attempts: e.attempts, answers: e.answers, answeredBy: e.answeredBy });
    } else if (e.type === 'wish') {
      // Notes from Settings are about the app: the notes agent (agent/notes.sh) handles them, not the helper.
      if (e.list !== 'settings') news.wishes.push({ at: e.at, text: e.text, ...(e.list ? { aboutList: e.list } : {}) });
    } else if (e.type === 'plan') {
      // The parent changed the plan on the tablet (parent mode): it already works there, and wins here.
      if (v && PLAN_FIELDS[e.action]) {
        applyPlanEvent(v, e);
        news.edited[e.videoId] = [...new Set([...(news.edited[e.videoId] ?? []), ...PLAN_FIELDS[e.action]])];
      }
      news.plan.push({ videoId: e.videoId, title: v?.title, action: e.action, ...(typeof e.value === 'boolean' ? { value: e.value } : {}), at: e.at });
    } else if (e.type === 'prompt') {
      news.prompt.push({ action: e.action, noteId: e.noteId, at: e.at, ...(e.text ? { text: e.text } : {}) });
    } else if (e.type === 'context') {
      news.context.push({ doc: e.doc, text: e.text, at: e.at });
    } else if (e.type === 'blocked') {
      news.blocked.push({ target: e.target, url: e.url });
    }
  }
  return news;
}

// Ranks one video for today: lower is earlier.
function tier(v, today) {
  const due = !v.day || v.day <= today;
  if (v.required === 'today' && due) return 0;
  if (v.required === 'yes' && v.approved && due) return 1;
  if (v.required === 'yes' && due) return 2;
  if (v.approved && due) return 3;
  if (!v.approved && due && !v.content?.tooHard) return 5; // the helper's own pick, used only when approved ones run out
  if (!v.approved && due) return 7;       // flagged as too hard: only if nothing else is left
  return 9;                               // planned for a later day
}

// Today's list. languageMins: { ru: 3 } = at least 3 Russian videos when there are any.
export function composeToday(videos, { today, count = 10, languageMins = {}, blockedChannelIds = [], ready = new Set() }) {
  const blocked = new Set(blockedChannelIds);
  const pool = Object.entries(videos)
    .filter(([, v]) => OPEN.has(v.status) && !blocked.has(v.channelId))
    .map(([videoId, v]) => ({ videoId, v, t: tier(v, today) }))
    .filter((x) => x.t < 9)
    .sort((a, b) => a.t - b.t || ready.has(b.videoId) - ready.has(a.videoId) || (a.v.day ?? '').localeCompare(b.v.day ?? '') || (a.v.addedAt ?? '').localeCompare(b.v.addedAt ?? ''));
  const picked = pool.slice(0, count);
  const rest = pool.slice(count);
  // Language minimums: swap in videos of that language for the latest, least important picks.
  for (const [lang, min] of Object.entries(languageMins)) {
    const has = () => picked.filter((x) => (x.v.lang ?? 'en').startsWith(lang)).length;
    while (has() < min) {
      const inIdx = rest.findIndex((x) => (x.v.lang ?? 'en').startsWith(lang));
      if (inIdx < 0) break;
      let outIdx = -1;
      for (let i = picked.length - 1; i >= 0; i--) {
        const x = picked[i];
        if (x.t >= 3 && !(x.v.lang ?? 'en').startsWith(lang) && !Object.keys(languageMins).some((l) => l !== lang && (x.v.lang ?? 'en').startsWith(l))) { outIdx = i; break; }
      }
      const [inn] = rest.splice(inIdx, 1);
      if (outIdx < 0) { if (picked.length < count) picked.push(inn); else break; }
      else rest.unshift(...picked.splice(outIdx, 1, inn));
    }
  }
  // Must-watch first, then the order above.
  return picked.sort((a, b) => (a.t <= 2 ? 0 : 1) - (b.t <= 2 ? 0 : 1) || a.t - b.t).map((x) => x.videoId);
}

// After choosing: today's videos become "today", yesterday's unwatched ones go back to "planned".
export function markToday(videos, ids) {
  const set = new Set(ids);
  for (const [id, v] of Object.entries(videos)) {
    if (set.has(id)) v.status = 'today';
    else if (v.status === 'today') v.status = v.approved ? 'planned' : 'idea';
  }
}

// Planned videos for the tablet to fetch transcripts of (queue.upcoming), most likely first.
export function upcoming(videos, todayIds, { today, max = 40 } = {}) {
  const skip = new Set(todayIds);
  return Object.entries(videos)
    .filter(([id, v]) => OPEN.has(v.status) && !skip.has(id))
    .map(([videoId, v]) => ({ videoId, title: v.title.slice(0, 200), t: tier(v, today) }))
    .sort((a, b) => a.t - b.t)
    .slice(0, max)
    .map(({ videoId, title }) => ({ videoId, title }));
}

// New ideas today: none once the plan holds `target` open videos; otherwise as many as Gemini can still
// transcribe today (an idea without a transcript gets no questions), but always enough for today's list.
export function ideasAllowed(videos, { target = 50, geminiLeft = 0, perDay = 10 } = {}) {
  const open = Object.values(videos).filter((v) => OPEN.has(v.status)).length;
  if (open >= target) return { open, target, allowed: 0 };
  return { open, target, allowed: Math.max(0, Math.min(target - open, Math.max(geminiLeft, perDay - open))) };
}

// Search results the helper may suggest: right length, unknown, not blocked, not a live stream.
export function freshCandidates(results, videos, { minSeconds = 60, maxSeconds = 1200, blockedChannelIds = [], badChannels = [] } = {}) {
  const blocked = new Set([...blockedChannelIds, ...badChannels]);
  const seen = new Set();
  return results.filter((r) => {
    if (!r?.videoId || seen.has(r.videoId) || videos[r.videoId] || blocked.has(r.channelId) || r.isLive) return false;
    if (!(r.durationSeconds >= Math.max(61, minSeconds)) || (maxSeconds > 0 && r.durationSeconds > maxSeconds)) return false;
    seen.add(r.videoId);
    return true;
  });
}

// A short text of the list for the model (keeps prompts small).
export function backlogText(videos, { limit = 60 } = {}) {
  return Object.entries(videos)
    .filter(([, v]) => OPEN.has(v.status))
    .slice(-limit)
    .map(([id, v]) => `${id} | ${v.lang ?? '?'} | ${v.status}${v.approved ? ' ✓approved' : ''}${v.required ? ` must:${v.required}` : ''}${v.day ? ` day:${v.day}` : ''} | ${v.title} | ${(v.topics ?? []).join(', ')}`)
    .join('\n');
}
