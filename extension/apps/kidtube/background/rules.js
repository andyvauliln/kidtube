// The kid's rules: what he may open, the video he is on, his time today, and the guard on every URL change.
import { lockReason, nextOpening, localParts, nowIso } from '../../../core/lib/time.js';
import { visibleVideos, waitingIds } from '../lib/queue.js';
import { classifyUrl, homeUrl, watchUrl } from '../../../core/lib/youtube.js';
import { appOf } from '../../registry.js';
import { PARENT_PAGE } from '../../../core/background/constants.js';
import { effective, parentMode, shellOf, live } from '../../../core/background/store.js';
import { externalGuard } from '../../../core/background/sites.js';

// Seconds he watched today (the day boundary is the config's time zone). Starts a new day when needed.
export function todayPlayed(s, cfg, now = new Date()) {
  const date = localParts(now, cfg.timezone).date;
  if (s.today?.date !== date) s.today = { date, playedSeconds: 0 };
  return s.today.playedSeconds;
}

// Why he can't watch now: hours, daily cap, or "stop for today" after a quiz.
export function lockNow(s, cfg, now = new Date()) {
  return lockReason(cfg, now, todayPlayed(s, cfg, now)) ?? (s.today?.stopped ? 'stopped' : null);
}

export function videoInfo(s, queue, videoId) {
  const v = queue.videos.find((x) => x.videoId === videoId);
  return { videoId, ...(s.seen?.[videoId] ?? {}), ...(v ?? {}), title: v?.title ?? s.seen?.[videoId]?.title ?? 'this video' };
}

const LANGS = { en: 'en-US', ru: 'ru-RU', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', uk: 'uk-UA' };
// "ru" → "ru-RU"; a full tag stays as it is.
export function fullLang(l) {
  return !l ? null : l.includes('-') ? l : LANGS[l] ?? l;
}

// An event for activity/<day>.json.
export function newEvent(type, fields) {
  return { eventId: crypto.randomUUID(), type, at: nowIso(), ...fields };
}

export function sessionUnlocked(s, cfg) {
  const ses = s.session;
  return !ses || ses.ended || ses.playedSeconds >= (cfg.minSecondsBeforeLeave ?? 0);
}

export function endSession(s, endReason) {
  const ses = s.session;
  if (!ses) return;
  const ev = newEvent('watch', {
    videoId: ses.videoId, watchedSeconds: Math.round(ses.playedSeconds),
    ...(ses.durationSeconds ? { durationSeconds: ses.durationSeconds } : {}), endReason,
  });
  s.outbox.push(ev);
  // For the parent's History: kept on the tablet, per account.
  if (ses.playedSeconds >= 5 || endReason === 'ended') {
    s.history = [...(s.history ?? []), { videoId: ses.videoId, title: s.seen?.[ses.videoId]?.title ?? '', at: ev.at,
      watchedSeconds: ev.watchedSeconds, ...(ses.durationSeconds ? { durationSeconds: ses.durationSeconds } : {}), endReason }].slice(-300);
  }
  s.session = null;
}

export function markWatchedIfCounts(s, cfg) {
  const ses = s.session;
  if (ses && (ses.ended || ses.playedSeconds >= (cfg.minSecondsBeforeLeave ?? 0))) s.watched[ses.videoId] ??= nowIso();
}

// Ends the video he is on (if any), counting it as watched when he watched long enough.
export function leaveSession(s, cfg, reason) {
  if (!s.session) return;
  markWatchedIfCounts(s, cfg);
  endSession(s, s.session.ended ? 'ended' : reason);
}

// --- the view any screen asks for ----------------------------------------------------------
export async function viewState(s) {
  const { config, queue } = await effective(s);
  const now = new Date();
  const played = todayPlayed(s, config, now);
  const reason = lockNow(s, config, now);
  const parent = parentMode(s);
  const ses = s.session;
  const min = config.minSecondsBeforeLeave ?? 0;
  const cap = config.time?.maxMinutesPerDay || 0;
  return {
    videos: kidList(s, queue, config).filter((v) => v.videoId !== ses?.videoId),
    lock: reason ? { reason, opens: nextOpening(config, now) } : null,
    minutesLeft: cap ? Math.max(0, Math.ceil(cap - played / 60)) : null,
    maxMinutes: cap || null,
    session: ses ? { videoId: ses.videoId, secondsUntilUnlock: ses.ended ? 0 : Math.max(0, Math.ceil(min - ses.playedSeconds)) } : null,
    rules: { allowSkip: parent || !!config.allowSkip },
    friend: config.presenter?.name || 'Zippy',
    parent,
    parentMode: parentMode(s),
    shell: await shellOf(),
  };
}

// --- the list he sees ----------------------------------------------------------------------
// How many ⭐ and free videos he finished today (for config.requiredFirst).
export function watchedToday(s, queue, cfg) {
  const date = localParts(new Date(), cfg.timezone).date;
  const required = new Set(queue.videos.filter((v) => v.required).map((v) => v.videoId));
  const out = { required: 0, free: 0 };
  for (const [id, at] of Object.entries(s.watched)) {
    if (localParts(new Date(at), cfg.timezone).date === date) out[required.has(id) ? 'required' : 'free']++;
  }
  return out;
}

// The list he sees, with ⭐ videos marked and the ones that must wait greyed out.
export function kidList(s, queue, cfg) {
  const videos = visibleVideos(queue, cfg, s.watched);
  const waiting = waitingIds(videos, cfg, watchedToday(s, queue, cfg));
  return videos.map((v) => (waiting.has(v.videoId) ? { ...v, waiting: true } : v));
}

export function isOpenable(videoId, queue, cfg, s) {
  if (s.session?.videoId === videoId) return true;
  return kidList(s, queue, cfg).some((v) => v.videoId === videoId && !v.waiting);
}

// --- navigation guard ----------------------------------------------------------------------
const BLOCK_TARGET = { shorts: 'shorts', search: 'search', channel: 'channel', other: 'video', watch: 'video' };

// Returns the URL to send the tab to, or null to let it be.
export async function guard(s, tabId, href) {
  const c = classifyUrl(href);
  if (c.kind === 'internal') return null;
  if (c.kind === 'external') return externalGuard(c.host);         // normally DNR blocks them; this is the fallback
  if (c.kind === 'signin') return null;                             // Google signing in an account: let it finish
  live.host = c.host || live.host;
  const g = await chrome.storage.local.get(['shell', 'account']);
  // The apps header: plain YouTube, so the parent can sign in or switch the account (locked: content.js covers it).
  if ((await shellOf(g)).on) return null;
  // A profile whose app isn't KidTube: YouTube shows that app's page instead (the blank test app: a white page),
  // in parent mode too: KidTube's parent screens are not that app's screens.
  const app = appOf(g.account);
  if (app.page) return chrome.runtime.getURL(app.page);
  // Parent mode: YouTube's home is the parent's screens; everything else on YouTube is open.
  if (parentMode(s)) return c.kind === 'home' ? chrome.runtime.getURL(PARENT_PAGE) : null;
  const { config, queue } = await effective(s);
  const locked = lockNow(s, config);
  const ses = s.session;
  const backToSession = ses && !sessionUnlocked(s, config) && !locked ? watchUrl(c.host, ses.videoId) : null;

  if (c.kind === 'watch' && ses?.videoId === c.videoId && ses.tabId === tabId) return locked ? homeUrl(c.host) : null;

  if (c.kind === 'home') {
    if (backToSession) return backToSession;
    leaveSession(s, config, 'leftAfterLock');
    return null;
  }

  if (c.kind === 'watch' && !locked && isOpenable(c.videoId, queue, config, s)) {
    if (backToSession) return backToSession;
    leaveSession(s, config, 'leftAfterLock');
    const item = queue.videos.find((v) => v.videoId === c.videoId);
    if (item) {
      delete s.seen[c.videoId];
      s.seen[c.videoId] = { title: item.title, channelTitle: item.channelTitle, durationSeconds: item.durationSeconds, thumbnailUrl: item.thumbnailUrl };
      for (const old of Object.keys(s.seen).slice(0, -60)) delete s.seen[old];
    }
    s.session = { tabId, videoId: c.videoId, playedSeconds: 0, ended: false, startedAt: Date.now(), durationSeconds: item?.durationSeconds };
    return null;
  }

  if (!(c.kind === 'watch' && locked)) {
    s.outbox.push(newEvent('blocked', { target: BLOCK_TARGET[c.kind] ?? 'video', url: href.slice(0, 2000), ...(ses ? { videoId: ses.videoId } : {}) }));
  }
  return backToSession ?? homeUrl(c.host);
}

// The video's own questions, else the next ones from quiz.defaultIds in turn.
export function pickQuiz(s, config, queue, videoId) {
  const items = config.quiz?.items ?? {};
  const own = (queue.videos.find((v) => v.videoId === videoId)?.quizIds ?? []).filter((id) => items[id]);
  if (own.length) return own.slice(0, 5);
  const pool = (config.quiz?.defaultIds ?? []).filter((id) => items[id]);
  if (!pool.length) return [];
  const n = Math.min(config.quiz.itemsPerVideo ?? 1, pool.length);
  const start = s.quizTurn ?? 0;
  s.quizTurn = (start + n) % pool.length;
  return Array.from({ length: n }, (_, i) => pool[(start + i) % pool.length]);
}

// The talking friend has its own page; the tab goes there and comes back when it is done.
export async function openTalk(tabId, mode, videoId) {
  try {
    await chrome.tabs.update(tabId, { url: chrome.runtime.getURL(`apps/kidtube/kid/talk.html?mode=${mode}&v=${videoId}`) });
    return true;
  } catch {
    return false;
  }
}
