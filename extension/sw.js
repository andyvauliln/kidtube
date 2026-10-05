// KidTube service worker: the rules live here. Content scripts and the iframes only ask and show.
import { mergeConfig } from './lib/merge.js';
import { lockReason, nextOpening, localParts } from './lib/time.js';
import { visibleVideos, waitingIds } from './lib/queue.js';
import { classifyUrl, homeUrl, watchUrl } from './lib/url.js';
import { parseCaptions, captionsToText } from './lib/captions.js';
import { TARGET } from './lib/target.js';
import { accountFromSwitcher, accountKey } from './lib/account.js';
import { PLAN_ACTIONS, applyPlan, applyPlanEvent, pendingPlan, entryFromRecord, applyPromptNotes } from './lib/plan.js';

const SITE_RULE_ID = 100;
const POLL_MINUTES = 15;
const DEFAULT_REPO = 'andyvauliln/kidtube-data';
// Each build has its own release: Orion's lives under orion/ and is updated only when asked (tools/build-orion.mjs).
const LATEST_URL = TARGET === 'orion' ? 'https://andyvauliln.github.io/kidtube/orion/latest.json' : 'https://andyvauliln.github.io/kidtube/latest.json';
const INSTALL_PAGE = TARGET === 'orion' ? 'https://andyvauliln.github.io/kidtube/#orion' : 'https://andyvauliln.github.io/kidtube/';

let bundled; // { config, queue, quizTypes }
async function loadBundled() {
  if (!bundled) {
    const [config, queue, quizTypes] = await Promise.all(['default-config.json', 'default-queue.json', 'quiz-types.json'].map((f) => fetch(chrome.runtime.getURL(f)).then((r) => r.json())));
    bundled = { config, queue, quizTypes };
  }
  return bundled;
}

// --- storage: everything persistent, writes serialized so ticks don't race --------------

// localConfig: rules saved on the parent page that haven't reached GitHub yet.
// seen: title/channel of videos he opened, for the parent's list after the queue has moved on.
// parentPass: one tab where a parent watches a video without the kid's rules.
// pendingTalk: the talking friend's screen he is on (before or after a video).
// planLog: the parent's changes to today's list and the planned videos (lib/plan.js).
// history: what he watched, newest last (parent mode → History). notes: the parent's notes for the AI.
const KEYS = ['settings', 'data', 'watched', 'today', 'session', 'outbox', 'syncStatus', 'localConfig', 'seen', 'parentPass', 'pendingTalk', 'quizTurn', 'transcripts', 'character', 'planLog', 'history', 'notes'];
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}
// opts.account: run only if that account is still the signed-in one (a sync that started before a switch).
function withState(fn, { account } = {}) {
  return serial(async () => {
    if (account !== undefined && ((await chrome.storage.local.get('account')).account?.key ?? null) !== account) return undefined;
    const s = await chrome.storage.local.get(KEYS);
    s.settings ??= {}; s.data ??= {}; s.watched ??= {}; s.outbox ??= []; s.syncStatus ??= {}; s.seen ??= {};
    const before = Object.fromEntries(KEYS.map((k) => [k, JSON.stringify(s[k] ?? null)]));
    const result = await fn(s);
    // Only write what changed: the options page writes settings on its own.
    const changed = KEYS.filter((k) => JSON.stringify(s[k] ?? null) !== before[k]);
    if (changed.length) await chrome.storage.local.set(Object.fromEntries(changed.map((k) => [k, s[k] ?? null])));
    return result;
  });
}

// --- accounts: everything is kept per YouTube account (email) --------------------------------
// The signed-in account's data lives under the usual keys; the others wait in "acct:<key>".
// The parent PIN and the device id belong to the tablet, so they move along with every switch.
const ACCOUNT_KEYS = [...KEYS.filter((k) => k !== 'parentPass'), 'memory', 'helperInfo'];
const DEVICE_SETTINGS = ['pinHash', 'pinSalt', 'pinFails', 'pinLockedUntil', 'deviceId'];
const currentAccount = async () => (await chrome.storage.local.get('account')).account?.key ?? null;

async function useAccount(info) {
  const key = accountKey(info);
  if (!key) return { ok: false };
  const me = { key, email: info.email ?? null, name: info.name ?? null, datasyncId: info.datasyncId ?? null };
  const r = await serial(async () => {
    const g = await chrome.storage.local.get(['account', 'accounts']);
    const accounts = g.accounts ?? {};
    const cur = g.account;
    const remember = () => { accounts[key] = { ...(accounts[key] ?? {}), email: me.email, name: me.name, datasyncId: me.datasyncId, lastSeen: new Date().toISOString() }; };
    // The first account seen on this tablet keeps what is already here.
    // A profile known only by YouTube's id becomes the same profile under its email.
    const same = cur && (cur.key === key || (me.datasyncId && cur.key === accountKey({ datasyncId: me.datasyncId })));
    if (!cur || same) {
      if (cur && cur.key !== key) delete accounts[cur.key];
      remember();
      await chrome.storage.local.set({ account: me, accounts });
      return { switched: false };
    }
    const work = await chrome.storage.local.get(ACCOUNT_KEYS);
    const alias = me.datasyncId ? `acct:${accountKey({ datasyncId: me.datasyncId })}` : null;
    const saved = await chrome.storage.local.get([`acct:${key}`, ...(alias ? [alias] : [])]);
    const next = saved[`acct:${key}`] ?? (alias && saved[alias]) ?? {};
    const device = Object.fromEntries(DEVICE_SETTINGS.filter((k) => work.settings?.[k] != null).map((k) => [k, work.settings[k]]));
    next.settings = { ...(next.settings ?? {}), ...device };
    remember();
    await chrome.storage.local.set({ [`acct:${cur.key}`]: work, ...next, account: me, accounts });
    await chrome.storage.local.remove([`acct:${key}`, ...(alias ? [alias] : []), ...ACCOUNT_KEYS.filter((k) => !(k in next))]);
    return { switched: true };
  });
  if (r.switched) { await applySiteRules(); sync(); }
  return { ok: true, ...r };
}

// --- parent mode: the parent's screens instead of his list, no rules, nothing counted ----------

const PARENT_PAGE = 'parent/parent.html';
function parentMode(s) {
  const st = s.settings ?? {};
  return st.mode === 'parent' && (!st.parentUntil || st.parentUntil > Date.now());
}
// Messages that change the plan or the mode come only from the extension's own pages.
// (Some browsers leave out sender.url; a content script always comes with its YouTube tab.)
function fromExtensionPage(sender) {
  const base = chrome.runtime.getURL('');
  if (sender.url) return sender.url.startsWith(base);
  return !sender.tab?.url || sender.tab.url.startsWith(base);
}
let lastHost = 'm.youtube.com';

async function effective(s) {
  const b = await loadBundled();
  let config = mergeConfig(mergeConfig(b.config, s.data?.config), s.localConfig);
  const queue = applyPlan(s.data?.queue ?? b.queue, s.planLog);
  // Questions of planned videos the parent moved onto today's list.
  if (Object.keys(s.planLog?.items ?? {}).length) config = mergeConfig(config, { quiz: { items: s.planLog.items } });
  return { config, queue };
}

function todayPlayed(s, cfg, now = new Date()) {
  const date = localParts(now, cfg.timezone).date;
  if (s.today?.date !== date) s.today = { date, playedSeconds: 0 };
  return s.today.playedSeconds;
}

// Why he can't watch now: hours, daily cap, or "stop for today" after a quiz.
function lockNow(s, cfg, now = new Date()) {
  return lockReason(cfg, now, todayPlayed(s, cfg, now)) ?? (s.today?.stopped ? 'stopped' : null);
}

function parentTab(s, tabId) {
  return tabId != null && s.parentPass?.tabId === tabId && s.parentPass.until > Date.now();
}

function videoInfo(s, queue, videoId) {
  const v = queue.videos.find((x) => x.videoId === videoId);
  return { videoId, ...(s.seen?.[videoId] ?? {}), ...(v ?? {}), title: v?.title ?? s.seen?.[videoId]?.title ?? 'this video' };
}

const LANGS = { en: 'en-US', ru: 'ru-RU', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', uk: 'uk-UA' };
function fullLang(l) {
  return !l ? null : l.includes('-') ? l : LANGS[l] ?? l;
}

function newEvent(type, fields) {
  return { eventId: crypto.randomUUID(), type, at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), ...fields };
}

function sessionUnlocked(s, cfg) {
  const ses = s.session;
  return !ses || ses.ended || ses.playedSeconds >= (cfg.minSecondsBeforeLeave ?? 0);
}

function endSession(s, endReason) {
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

function markWatchedIfCounts(s, cfg) {
  const ses = s.session;
  if (ses && (ses.ended || ses.playedSeconds >= (cfg.minSecondsBeforeLeave ?? 0))) s.watched[ses.videoId] ??= new Date().toISOString();
}

// --- the view any screen asks for ----------------------------------------------------------

async function viewState(s, tabId) {
  const { config, queue } = await effective(s);
  const now = new Date();
  const played = todayPlayed(s, config, now);
  const reason = lockNow(s, config, now);
  const parent = parentTab(s, tabId) || parentMode(s);
  const ses = s.session;
  const min = config.minSecondsBeforeLeave ?? 0;
  return {
    videos: kidList(s, queue, config).filter((v) => v.videoId !== ses?.videoId),
    lock: reason ? { reason, opens: nextOpening(config, now) } : null,
    minutesLeft: config.time?.maxMinutesPerDay ? Math.max(0, Math.ceil(config.time.maxMinutesPerDay - played / 60)) : null,
    session: ses ? { videoId: ses.videoId, secondsUntilUnlock: ses.ended ? 0 : Math.max(0, Math.ceil(min - ses.playedSeconds)) } : null,
    rules: { allowSkip: parent || !!config.allowSkip },
    parent,
    parentMode: parentMode(s),
  };
}

// --- navigation guard ----------------------------------------------------------------------

// How many ⭐ and free videos he finished today (for config.requiredFirst).
function watchedToday(s, queue, cfg) {
  const date = localParts(new Date(), cfg.timezone).date;
  const required = new Set(queue.videos.filter((v) => v.required).map((v) => v.videoId));
  const out = { required: 0, free: 0 };
  for (const [id, at] of Object.entries(s.watched)) {
    if (localParts(new Date(at), cfg.timezone).date === date) out[required.has(id) ? 'required' : 'free']++;
  }
  return out;
}

// The list he sees, with ⭐ videos marked and the ones that must wait greyed out.
function kidList(s, queue, cfg) {
  const videos = visibleVideos(queue, cfg, s.watched);
  const waiting = waitingIds(videos, cfg, watchedToday(s, queue, cfg));
  return videos.map((v) => (waiting.has(v.videoId) ? { ...v, waiting: true } : v));
}

function isOpenable(videoId, queue, cfg, s) {
  if (s.session?.videoId === videoId) return true;
  return kidList(s, queue, cfg).some((v) => v.videoId === videoId && !v.waiting);
}

const BLOCK_TARGET = { shorts: 'shorts', search: 'search', channel: 'channel', other: 'video', watch: 'video' };

// Returns the URL to send the tab to, or null to let it be.
async function guard(s, tabId, href) {
  const c = classifyUrl(href);
  if (c.kind === 'internal') return null;
  if (c.kind === 'external') return externalGuard(c.host);         // normally DNR blocks them; this is the fallback
  lastHost = c.host || lastHost;
  // Parent mode: YouTube's home is the parent's screens; everything else on YouTube is open.
  if (parentMode(s)) return c.kind === 'home' ? chrome.runtime.getURL(PARENT_PAGE) : null;
  // A parent watching from the parent page: that one video in that one tab, no kid rules.
  const pass = s.parentPass;
  if (pass) {
    if (pass.until < Date.now()) s.parentPass = null;
    else if (pass.tabId == null && c.kind === 'watch' && c.videoId === pass.videoId) { pass.tabId = tabId; return null; }
    else if (pass.tabId === tabId) {
      if (c.kind === 'watch' && c.videoId === pass.videoId) return null;
      s.parentPass = null;
    }
  }
  const { config, queue } = await effective(s);
  const locked = lockNow(s, config);
  const ses = s.session;
  const backToSession = ses && !sessionUnlocked(s, config) && !locked ? watchUrl(c.host, ses.videoId) : null;

  if (c.kind === 'watch' && ses?.videoId === c.videoId && ses.tabId === tabId) return locked ? homeUrl(c.host) : null;

  if (c.kind === 'home') {
    if (backToSession) return backToSession;
    if (ses) { markWatchedIfCounts(s, config); endSession(s, ses.ended ? 'ended' : 'leftAfterLock'); }
    return null;
  }

  if (c.kind === 'watch' && !locked && isOpenable(c.videoId, queue, config, s)) {
    if (backToSession) return backToSession;
    if (ses) { markWatchedIfCounts(s, config); endSession(s, ses.ended ? 'ended' : 'leftAfterLock'); }
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

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url) return;
  withState((s) => guard(s, tabId, info.url)).then((target) => {
    if (target && target !== info.url) chrome.tabs.update(tabId, { url: target });
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  withState(async (s) => {
    if (s.parentPass?.tabId === tabId) s.parentPass = null;
    if (s.session?.tabId !== tabId) return;
    const { config } = await effective(s);
    markWatchedIfCounts(s, config);
    endSession(s, s.session.ended ? 'ended' : 'closed');
  });
});

// --- messages from content scripts, iframes, options --------------------------------------

async function handle(msg, sender) {
  const tabId = sender.tab?.id;
  const host = sender.tab?.url ? new URL(sender.tab.url).hostname : 'm.youtube.com';
  switch (msg.type) {
    case 'ping': // "Check this browser" and the screens' fallbacks: is the background alive, and what does it have?
      return { ok: true, version: chrome.runtime.getManifest().version, target: TARGET, at: new Date().toISOString(),
        apis: ['alarms', 'storage', 'tabs', 'declarativeNetRequest', 'permissions', 'scripting'].filter((n) => !!chrome[n]) };

    case 'frameReady': // the home iframe loaded; the content script may not hear its postMessage (Orion)
      if (tabId != null && chrome.tabs.sendMessage) chrome.tabs.sendMessage(tabId, { type: 'frameReady' }, () => { void chrome.runtime.lastError; });
      return { ok: true };

    case 'state': // a KidTube screen opened: fetch the newest list if the last sync is a few minutes old
      syncIfStale(2);
      return withState((s) => viewState(s, tabId));

    case 'open':
      return withState(async (s) => {
        const { config, queue } = await effective(s);
        if (lockNow(s, config)) return { ok: false };
        if (s.session && s.session.videoId !== msg.videoId && !sessionUnlocked(s, config)) return { ok: false };
        if (!isOpenable(msg.videoId, queue, config, s)) return { ok: false };
        if (config.presenter?.intro) {
          s.pendingTalk = { mode: 'intro', videoId: msg.videoId, host };
          if (await openTalk(tabId, 'intro', msg.videoId)) return { ok: true };
          s.pendingTalk = null;
        }
        await chrome.tabs.update(tabId, { url: watchUrl(host, msg.videoId) });
        return { ok: true };
      });

    case 'talk': // what the talking friend says and asks
      return withState(async (s) => {
        const { config, queue } = await effective(s);
        const t = s.pendingTalk?.videoId === msg.videoId ? s.pendingTalk : null;
        const p = config.presenter ?? {};
        const v = videoInfo(s, queue, msg.videoId);
        const name = p.name || 'Zippy';
        const lines = [];
        const hasQuiz = !!config.quiz?.enabled;
        // A Russian video gets a Russian intro and a Russian voice (queue `lang`).
        const lang = fullLang(v.lang) ?? p.voice?.lang ?? 'en-US';
        const ru = lang.startsWith('ru');
        if (msg.mode === 'intro') {
          if (p.catchphrase) lines.push({ text: p.catchphrase, ...(p.catchphraseAudioRef ? { audioRef: p.catchphraseAudioRef } : {}) });
          lines.push(v.intro ?? { text: ru
            ? `Привет! Я ${name}! Сейчас мы посмотрим: ${v.title}. ${hasQuiz ? 'Смотри внимательно, в конце я задам тебе вопрос!' : 'Давай узнаем что-то новое!'}`
            : `Hi! I'm ${name}! Now we're going to watch: ${v.title}. ${hasQuiz ? 'Watch carefully, because at the end I will ask you a question!' : 'Let’s find out something new!'}` });
        } else if (p.outro) {
          lines.push(v.outro ?? { text: ru ? `Это было: ${v.title}. Молодец, что досмотрел до конца!` : `That was: ${v.title}. Well done for watching it all!` });
        }
        const items = msg.mode === 'outro' ? (t?.quizIds ?? []).map((quizId) => ({ quizId, ...config.quiz.items[quizId] })).filter((i) => i.prompt) : [];
        const { quizTypes } = await loadBundled();
        const ch = s.character && p.imageUrl === `repo:${s.character.path}` ? s.character : null;
        return {
          name, imageUrl: ch?.src ?? (p.imageUrl?.startsWith('https://') ? p.imageUrl : ''), svg: ch?.svg ?? '',
          catchphrase: p.catchphrase ?? '', catchphraseAudioRef: p.catchphraseAudioRef ?? null, phrases: p.phrases ?? {},
          recorded: p.voice?.recorded !== false, listen: p.voice?.listen ?? { provider: 'device' },
          voice: { ...(p.voice ?? {}), lang }, lang, title: v.title, lines,
          items: items.map((i) => ({ ...i, lang: fullLang(i.lang) ?? lang, supported: quizTypes.includes(i.type) })),
          maxAttempts: config.quiz?.maxAttempts ?? 3, onFail: config.quiz?.onFail ?? 'continue',
        };
      });

    case 'quizResults':
      syncSoon();
      return withState(async (s) => {
        const { config } = await effective(s);
        todayPlayed(s, config);
        const t = s.pendingTalk;
        if (!t || t.mode !== 'outro' || t.videoId !== msg.videoId) return { next: 'home' };
        let failed = false;
        for (const r of [].concat(msg.results ?? []).slice(0, 10)) {
          if (!t.quizIds.includes(r.quizId) || !['passed', 'failed', 'skippedByParent', 'unsupported'].includes(r.result)) continue;
          failed ||= r.result === 'failed';
          s.outbox.push(newEvent('quiz', {
            videoId: t.videoId, quizId: r.quizId, result: r.result, attempts: Math.max(0, Math.min(10, r.attempts | 0)),
            answers: [].concat(r.answers ?? []).slice(0, 10).map((a) => String(a).slice(0, 200)),
            ...(['typed', 'tapped', 'spoken'].includes(r.answeredBy) ? { answeredBy: r.answeredBy } : {}),
          }));
        }
        const h = (s.history ?? []).findLast((x) => x.videoId === t.videoId);
        if (h) h.quiz = [].concat(msg.results ?? []).filter((r) => t.quizIds.includes(r.quizId)).slice(0, 10).map((r) => ({ quizId: r.quizId, result: String(r.result), attempts: r.attempts | 0 }));
        const onFail = config.quiz?.onFail ?? 'continue';
        t.next = !failed ? 'home'
          : onFail === 'rewatch' && !(s.today.rewatched ?? []).includes(t.videoId) ? 'rewatch'
          : onFail === 'stopForToday' ? 'stopForToday' : 'home';
        return { next: t.next };
      });

    case 'talkDone':
      return withState(async (s) => {
        const t = s.pendingTalk;
        s.pendingTalk = null;
        if (!t || t.videoId !== msg.videoId) return chrome.tabs.update(tabId, { url: homeUrl() });
        let url = homeUrl(t.host);
        if (t.mode === 'intro') url = watchUrl(t.host, t.videoId);
        else if (t.next === 'rewatch') {
          s.today.rewatched = [...(s.today.rewatched ?? []), t.videoId];
          delete s.watched[t.videoId];
          url = watchUrl(t.host, t.videoId);
        } else if (t.next === 'stopForToday') s.today.stopped = true;
        await chrome.tabs.update(tabId, { url });
      });

    case 'parentWatch': // from the parent page: watch any listed or watched video, skipping allowed
      if (!/^[A-Za-z0-9_-]{11}$/.test(msg.videoId ?? '')) return { ok: false };
      await withState((s) => { s.parentPass = { videoId: msg.videoId, tabId: null, until: Date.now() + 60 * 60 * 1000 }; });
      {
        const tab = await chrome.tabs.create({ url: watchUrl('m.youtube.com', msg.videoId) });
        await withState((s) => { if (s.parentPass?.videoId === msg.videoId) s.parentPass.tabId ??= tab.id; });
      }
      return { ok: true };

    case 'goHome':
      return withState(async (s) => {
        const { config } = await effective(s);
        if (!sessionUnlocked(s, config)) return { ok: false };
        await chrome.tabs.update(tabId, { url: homeUrl(host) });
        return { ok: true };
      });

    case 'tick':
      return withState(async (s) => {
        if (parentTab(s, tabId) || parentMode(s)) return { action: 'none' }; // a parent watching doesn't count
        const { config } = await effective(s);
        const ses = s.session;
        const seconds = Math.min(Math.max(Number(msg.seconds) || 0, 0), 15);
        todayPlayed(s, config);
        s.today.playedSeconds += seconds;
        if (ses && ses.videoId === msg.videoId && ses.tabId === tabId) {
          ses.playedSeconds += seconds;
          markWatchedIfCounts(s, config);
        }
        const reason = lockReason(config, new Date(), s.today.playedSeconds);
        if (reason) {
          s.outbox.push(newEvent('timeUp', { reason, playedMinutes: Math.round(s.today.playedSeconds / 60) }));
          if (ses) endSession(s, 'timeUp');
          return { action: 'lock' };
        }
        const close = config.closeAfterSeconds ?? 0;
        if (ses && close > 0 && ses.playedSeconds >= close) {
          markWatchedIfCounts(s, config);
          endSession(s, 'closeAfter');
          await chrome.tabs.update(tabId, { url: homeUrl(host) });
          return { action: 'home' };
        }
        return { action: 'none' };
      });

    case 'ended':
      syncSoon();
      return withState(async (s) => {
        const ses = s.session;
        if (!ses || ses.videoId !== msg.videoId) return;
        ses.ended = true;
        const { config } = await effective(s);
        markWatchedIfCounts(s, config);
        endSession(s, 'ended');
        // The talking friend says what we learned and asks the questions, if they are on.
        const quizIds = config.quiz?.enabled ? pickQuiz(s, config, (await effective(s)).queue, msg.videoId) : [];
        if (config.presenter?.outro || quizIds.length) {
          s.pendingTalk = { mode: 'outro', videoId: msg.videoId, host, quizIds };
          if (await openTalk(tabId, 'outro', msg.videoId)) return;
          s.pendingTalk = null;
        }
        await chrome.tabs.update(tabId, { url: homeUrl(host) });
      });

    case 'details': // the real channel/length from YouTube's own player data (PLAN.md C19)
      return withState(async (s) => {
        const { config } = await effective(s);
        const ses = s.session;
        if (!ses || ses.videoId !== msg.videoId) return;
        if (msg.lengthSeconds > 0) ses.durationSeconds = msg.lengthSeconds;
        const bad = (config.blockedChannelIds ?? []).includes(msg.channelId) ? 'channel'
          : (config.blockLive && msg.isLive) ? 'video'
          : (msg.lengthSeconds > 0 && msg.lengthSeconds < (config.minVideoDurationSeconds ?? 0)) ? 'shorts'
          : null;
        if (!bad) return;
        s.outbox.push(newEvent('blocked', { target: bad, videoId: ses.videoId, url: watchUrl(host, ses.videoId) }));
        s.watched[ses.videoId] ??= new Date().toISOString();
        endSession(s, 'blockedOnLoad');
        await chrome.tabs.update(tabId, { url: homeUrl(host) });
      });

    case 'note': // 👍 / 👎 / a note for the AI about one video
      return withState((s) => {
        if (!/^[A-Za-z0-9_-]{11}$/.test(msg.videoId ?? '')) return { ok: false };
        const ev = newEvent('parentNote', { videoId: msg.videoId });
        if (typeof msg.liked === 'boolean') ev.liked = msg.liked;
        if (msg.comment) ev.comment = String(msg.comment).trim().slice(0, 2000);
        if (ev.liked === undefined && !ev.comment) return { ok: false };
        s.outbox.push(ev);
        s.notes ??= {};
        if (ev.comment) addNote(((s.notes.videos ??= {})[msg.videoId] ??= []), ev);
        if (typeof ev.liked === 'boolean') (s.notes.liked ??= {})[msg.videoId] = ev.liked;
        return { ok: true };
      }).then(async (r) => { if (r.ok) sync(); return r; });

    case 'wish': // "message to the helper", or a note for the AI about a whole list (list: today | planned | history)
      return withState((s) => {
        const text = String(msg.text ?? '').trim().slice(0, 2000);
        if (!text) return { ok: false };
        const list = ['today', 'planned', 'history'].includes(msg.list) ? msg.list : null;
        const ev = newEvent('wish', { text, ...(list ? { list } : {}) });
        s.outbox.push(ev);
        if (list) addNote((((s.notes ??= {}).lists ??= {})[list] ??= []), ev);
        return { ok: true };
      }).then(async (r) => { if (r.ok) await sync(); return r; });

    case 'account': // from the YouTube page: who is signed in
      if (!msg.loggedIn) return { ok: false };  // signed out: stay with the last account
      return useAccount({ ...(accountFromSwitcher(msg.switcher ?? '') ?? {}), datasyncId: msg.datasyncId });

    case 'setMode': // settings page or parent screens, after the PIN
      if (!fromExtensionPage(sender) || !['kid', 'parent'].includes(msg.mode)) return { ok: false };
      return withState((s) => {
        const minutes = s.settings.parentMinutes ?? 60;
        Object.assign(s.settings, { mode: msg.mode, parentUntil: msg.mode === 'parent' && minutes > 0 ? Date.now() + minutes * 60000 : 0 });
        return { ok: true, until: s.settings.parentUntil };
      });

    case 'openParent': // a YouTube home tab in parent mode becomes the parent's screens
      return withState(async (s) => {
        if (!parentMode(s) || tabId == null) return { ok: false };
        await chrome.tabs.update(tabId, { url: chrome.runtime.getURL(PARENT_PAGE) });
        return { ok: true };
      });

    case 'recheck': // parent mode just ended on this page: the kid's rules apply to it again
      return withState((s) => guard(s, tabId, msg.url ?? sender.tab?.url ?? '')).then((target) => {
        if (target && tabId != null && target !== msg.url) chrome.tabs.update(tabId, { url: target });
        return { ok: true };
      });

    case 'watchHere': // parent screens: open the video in this tab, no rules (parent mode)
      if (!fromExtensionPage(sender) || !/^[A-Za-z0-9_-]{11}$/.test(msg.videoId ?? '')) return { ok: false };
      return withState(async (s) => {
        if (!parentMode(s)) return { ok: false };
        await chrome.tabs.update(tabId, { url: watchUrl(lastHost, msg.videoId) });
        return { ok: true };
      });

    case 'kidHome': // parent screens → kid mode: back to his list
      if (!fromExtensionPage(sender)) return { ok: false };
      await withState((s) => { Object.assign(s.settings, { mode: 'kid', parentUntil: 0 }); });
      if (tabId != null) await chrome.tabs.update(tabId, { url: homeUrl(lastHost) });
      return { ok: true };

    case 'parentData':
      if (!fromExtensionPage(sender)) return { ok: false };
      return withState((s) => parentData(s));

    case 'videoDetail':
      if (!fromExtensionPage(sender)) return { ok: false };
      return withState((s) => videoDetail(s, msg.videoId));

    case 'helperData': // parent mode → Prompt: how the helper works, its prompt, your changes to it
      if (!fromExtensionPage(sender)) return { ok: false };
      return withState((s) => helperData(s));

    case 'promptNote': // add a standing instruction for the helper, or remove one
      if (!fromExtensionPage(sender)) return { ok: false };
      return withState((s) => {
        if (!parentMode(s)) return { ok: false };
        const text = String(msg.text ?? '').trim().slice(0, 2000);
        if (msg.action === 'add' && !text) return { ok: false };
        if (msg.action === 'remove' && !/^[A-Za-z0-9-]{8,64}$/.test(msg.noteId ?? '')) return { ok: false };
        if (!['add', 'remove'].includes(msg.action)) return { ok: false };
        const ev = newEvent('prompt', { action: msg.action });
        Object.assign(ev, msg.action === 'add' ? { noteId: ev.eventId, text } : { noteId: msg.noteId });
        s.outbox.push(ev);
        ((s.notes ??= {}).promptOps ??= []).push(ev);
        return { ok: true, noteId: ev.noteId };
      }).then(async (r) => { if (r.ok) sync(); return r; });

    case 'runHelper': // parent mode → Update: send everything, then ask the server to run the helper now
      if (!fromExtensionPage(sender)) return { ok: false };
      return requestRun();
    case 'runStatus':
      if (!fromExtensionPage(sender)) return { ok: false };
      return withState((s) => ({ ok: true, ...runView(s) }));

    case 'contextData': // parent mode → Context: the documents and your notes the helper hasn't read yet
      if (!fromExtensionPage(sender)) return { ok: false };
      return withState(async (s) => {
        const { contextDocs = {} } = await chrome.storage.local.get('contextDocs');
        const since = s.data.memoryMeta?.processedThrough ?? null;
        return { ok: true, docs: contextDocs, notes: (s.notes?.contextNotes ?? []).filter((n) => !since || n.at > since) };
      });
    case 'contextNote':
      if (!fromExtensionPage(sender)) return { ok: false };
      return withState((s) => {
        if (!parentMode(s)) return { ok: false };
        const text = String(msg.text ?? '').trim().slice(0, 2000);
        if (!text || !CONTEXT_DOCS.includes(msg.doc)) return { ok: false };
        const ev = newEvent('context', { doc: msg.doc, text });
        s.outbox.push(ev);
        ((s.notes ??= {}).contextNotes ??= []).push(ev);
        s.notes.contextNotes = s.notes.contextNotes.slice(-100);
        return { ok: true };
      }).then((r) => { if (r.ok) sync(); return r; });

    case 'plan':
      if (!fromExtensionPage(sender)) return { ok: false };
      return withState((s) => planChange(s, msg)).then((r) => { if (r?.ok) sync(); return r; });

    case 'getRules':
      return withState(async (s) => ({ config: (await effective(s)).config, pending: !!s.localConfig }));

    case 'saveRules':
      return saveRules(msg.patch);

    case 'resetToday':
      return withState((s) => { s.today = null; });

    case 'openSettings': // the gear on the kid's screens; the page itself asks for the PIN
      try { await chrome.runtime.openOptionsPage(); } catch { await chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') }); }
      return { ok: true };

    case 'settingsBackup': // content/backup.js on the install page: take the copy back, or refresh it
      return settingsBackup(sender, msg.saved);

    case 'sync':
      return sync();

    case 'checkUpdate':
      return checkUpdate();
    case 'version':
      return appVersion();

    case 'status':
      return withState(async (s) => {
        const { config, queue } = await effective(s);
        return {
          version: chrome.runtime.getManifest().version,
          repo: s.settings.repo || DEFAULT_REPO,
          hasToken: !!s.settings.token,
          sync: s.syncStatus,
          configUpdatedAt: config.updatedAt,
          queueUpdatedAt: queue.updatedAt,
          queueSource: s.data.queue ? 'GitHub' : 'built-in starter list',
          visible: visibleVideos(queue, config, s.watched).length,
          playedMinutesToday: Math.round(todayPlayed(s, config) / 60),
          maxMinutesPerDay: config.time?.maxMinutesPerDay,
          outbox: s.outbox.length,
          transcripts: {
            total: queue.videos.length,
            uploaded: queue.videos.filter((v) => s.transcripts?.[v.videoId]?.status === 'uploaded').length,
            missing: queue.videos.filter((v) => s.transcripts?.[v.videoId]?.available === false).length,
          },
          recent: Object.entries(s.watched).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 10).map(([videoId, at]) => {
            const v = videoInfo(s, queue, videoId);
            return {
              videoId, at, title: v.title, channelTitle: v.channelTitle ?? '', durationSeconds: v.durationSeconds ?? null,
              thumbnailUrl: v.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
            };
          }),
        };
      });
  }
}

// The video's own questions, else the next ones from quiz.defaultIds in turn.
function pickQuiz(s, config, queue, videoId) {
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

// --- parent mode: Today, Planned, History and one video's details --------------------------

function addNote(list, ev) {
  list.push({ at: ev.at, text: ev.comment ?? ev.text });
  list.splice(0, Math.max(0, list.length - 20));
}

const getMemory = async () => (await chrome.storage.local.get('memory')).memory ?? null;
const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

// The helper's records (memory.json) with the parent's changes from this tablet on top.
function records(memory, planLog, queue) {
  const recs = structuredClone(memory?.helper?.videos ?? {});
  for (const v of queue.videos) recs[v.videoId] ??= { title: v.title, channelTitle: v.channelTitle, durationSeconds: v.durationSeconds, lang: v.lang, status: 'today', approved: true, required: v.required ? 'yes' : null, why: v.note };
  for (const u of queue.upcoming ?? []) recs[u.videoId] ??= { title: u.title, status: 'planned', approved: false, required: null };
  for (const e of [...(planLog?.events ?? [])].sort((a, b) => a.at.localeCompare(b.at))) {
    const entry = planLog.entries?.[e.videoId];
    recs[e.videoId] ??= { title: entry?.title ?? '', channelTitle: entry?.channelTitle, durationSeconds: entry?.durationSeconds, status: 'planned', approved: false, required: null };
    applyPlanEvent(recs[e.videoId], e);
  }
  return recs;
}

function cardOf(id, v = {}, r = {}, s) {
  return {
    videoId: id, title: v.title || r.title || s.seen?.[id]?.title || 'Video', channelTitle: v.channelTitle ?? r.channelTitle ?? '',
    durationSeconds: v.durationSeconds || r.durationSeconds || null, thumbnailUrl: thumb(id), lang: v.lang ?? r.lang ?? 'en',
    status: r.status ?? null, approved: !!r.approved, required: v.required !== undefined ? !!v.required : !!r.required, day: r.day ?? null,
    why: r.why ?? v.note ?? '', tooHard: r.content?.tooHard ?? null, hasWords: !!(r.content || v.intro),
    quizCount: (v.quizIds ?? r.content?.quizIds ?? []).length, notes: (s.notes?.videos?.[id] ?? []).length,
    liked: s.notes?.liked?.[id] ?? r.liked ?? null, watchedAt: s.watched[id] ?? r.watchedAt ?? null,
  };
}

async function parentData(s) {
  const { config, queue } = await effective(s);
  const memory = await getMemory();
  const recs = records(memory, s.planLog, queue);
  // Today = what he sees now (the first queueSize unwatched) plus what he watched; the helper's spares
  // further down the queue wait in Planned until one of these is watched or removed.
  const visible = new Set(visibleVideos(queue, config, s.watched).map((v) => v.videoId));
  const shown = queue.videos.filter((v) => visible.has(v.videoId) || s.watched[v.videoId]);
  const todayIds = new Set(shown.map((v) => v.videoId));
  const today = shown.map((v) => ({ ...cardOf(v.videoId, v, recs[v.videoId], s), required: !!v.required }));
  // Planned: the helper's order (queue.upcoming) first, then its other open videos, newest first.
  const order = [...(queue.upcoming ?? []).map((u) => u.videoId),
    ...Object.entries(recs).sort((a, b) => (b[1].addedAt ?? '').localeCompare(a[1].addedAt ?? '')).map(([id]) => id)];
  const planned = [...new Set(order)].filter((id) => !todayIds.has(id) && ['idea', 'planned', 'today'].includes(recs[id]?.status) && !s.watched[id])
    .map((id) => cardOf(id, {}, recs[id], s));
  return {
    account: (await chrome.storage.local.get('account')).account ?? null,
    parentUntil: s.settings.parentUntil || 0, parentMode: parentMode(s),
    today, planned, history: historyDays(s, recs, config), lists: s.notes?.lists ?? {},
    hasMemory: !!memory, memoryAt: memory?.updatedAt ?? null, queueUpdatedAt: queue.updatedAt ?? null,
    hasToken: !!s.settings.token, waiting: s.outbox.length, sync: s.syncStatus,
  };
}

// What he watched, by day: this tablet's own log, plus what the helper knows from the other devices and earlier.
function historyDays(s, recs, config) {
  const rows = [...(s.history ?? [])].map((h) => ({ ...h }));
  const has = (id, at) => rows.some((h) => h.videoId === id && h.at.slice(0, 10) === at.slice(0, 10));
  for (const [id, at] of Object.entries(s.watched)) if (!has(id, at)) rows.push({ videoId: id, at });
  for (const [id, r] of Object.entries(recs)) if (r.watchedAt && !rows.some((h) => h.videoId === id)) rows.push({ videoId: id, at: r.watchedAt });
  const days = {};
  for (const h of rows) {
    const r = recs[h.videoId] ?? {};
    const quiz = (h.quiz ?? []).map((q) => ({ ...q, prompt: config.quiz?.items?.[q.quizId]?.prompt ?? r.content?.items?.[q.quizId]?.prompt ?? '' }));
    const item = { ...cardOf(h.videoId, { title: h.title || undefined, durationSeconds: h.durationSeconds }, r, s), at: h.at,
      watchedSeconds: h.watchedSeconds ?? null, endReason: h.endReason ?? null, quiz };
    (days[localParts(new Date(h.at), config.timezone).date] ??= []).push(item);
  }
  return Object.entries(days).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 60).map(([date, items]) => ({
    date, minutes: Math.round(items.reduce((n, i) => n + (i.watchedSeconds ?? 0), 0) / 60),
    items: items.sort((a, b) => b.at.localeCompare(a.at)),
  }));
}

async function videoDetail(s, id) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id ?? '')) return { ok: false };
  const { config, queue } = await effective(s);
  const memory = await getMemory();
  const recs = records(memory, s.planLog, queue);
  const r = recs[id] ?? {};
  const v = queue.videos.find((x) => x.videoId === id);
  const c = r.content ?? {};
  const where = v ? 'today' : r.status === 'no' ? 'removed' : (s.watched[id] || r.status === 'watched') ? 'watched' : ['idea', 'planned', 'today'].includes(r.status) ? 'planned' : 'other';
  const quizIds = v?.quizIds ?? c.quizIds ?? [];
  const items = quizIds.map((q) => ({ quizId: q, ...(config.quiz?.items?.[q] ?? c.items?.[q] ?? {}) })).filter((i) => i.prompt);
  const p = config.presenter ?? {};
  const lang = fullLang(v?.lang ?? r.lang) ?? p.voice?.lang ?? 'en-US';
  return {
    ok: true, ...cardOf(id, v ?? {}, r, s), where, summary: c.summary ?? '', learned: c.learned ?? [], talkAbout: c.talkAbout ?? [],
    madeFrom: c.source ?? null, intro: v?.intro ?? (c.intro ? { text: c.intro } : null), outro: v?.outro ?? (c.outro ? { text: c.outro } : null),
    items: items.map((i) => ({ ...i, lang: fullLang(i.lang) ?? lang })), notes: s.notes?.videos?.[id] ?? [],
    helperNotes: [r.comment, r.parentComment].filter(Boolean), history: (s.history ?? []).filter((h) => h.videoId === id),
    friend: { name: p.name || 'Zippy', voice: { ...(p.voice ?? {}), lang }, recorded: p.voice?.recorded !== false },
  };
}

// The Prompt tab: what the helper is (helper.json), what it did lately (memory.json), the tablet rules it reads.
async function helperData(s) {
  const { config } = await effective(s);
  const memory = await getMemory();
  const { helperInfo } = await chrome.storage.local.get('helperInfo');
  const since = s.data.memoryMeta?.processedThrough ?? null;
  const ops = (s.notes?.promptOps ?? []).filter((o) => !since || o.at > since).sort((a, b) => a.at.localeCompare(b.at));
  const helperNotes = memory?.helper?.promptNotes ?? [];
  const known = new Set(helperNotes.map((n) => n.id));
  const p = config.presenter ?? {};
  return {
    ok: true, info: helperInfo ?? null, hasToken: !!s.settings.token, waiting: s.outbox.length,
    lastRunAt: memory?.helper?.lastRunAt ?? null, processedThrough: since, runs: (s.data.runs ?? []).slice().reverse(),
    journal: (memory?.journal ?? []).slice(-7).reverse(),
    noticed: memory?.helper?.noticed ?? '', studyPlan: memory?.helper?.plan ?? '', studyPlanAt: memory?.helper?.planAt ?? null,
    messages: (memory?.helper?.wishes ?? []).slice(-15).reverse(),
    notes: applyPromptNotes(helperNotes, ops).map((n) => ({ ...n, pending: !known.has(n.id) })),
    removing: ops.filter((o) => o.action === 'remove').map((o) => o.noteId),
    rules: {
      maxMinutesPerDay: config.time?.maxMinutesPerDay ?? 0, hours: config.time?.allowed ?? [], queueSize: config.queueSize,
      requiredFirst: config.requiredFirst ?? 'off', minSecondsBeforeLeave: config.minSecondsBeforeLeave ?? 0, allowSkip: !!config.allowSkip,
      minVideoMinutes: Math.round((config.minVideoDurationSeconds ?? 0) / 60), maxVideoMinutes: Math.round((config.maxVideoDurationSeconds ?? 0) / 60),
      quiz: { enabled: !!config.quiz?.enabled, maxAttempts: config.quiz?.maxAttempts ?? 3, onFail: config.quiz?.onFail ?? 'continue' },
      friend: { name: p.name || 'Zippy', intro: !!p.intro, outro: !!p.outro, recorded: p.voice?.recorded !== false, listen: p.voice?.listen?.provider ?? 'device' },
      blockSites: !!config.blockOutboundLinks,
    },
  };
}

// One change from the parent's screens. Taking an unwatched video off today's list brings the next planned one in.
async function planChange(s, msg) {
  const id = msg.videoId;
  if (!parentMode(s) || !PLAN_ACTIONS.includes(msg.action) || !/^[A-Za-z0-9_-]{11}$/.test(id ?? '')) return { ok: false };
  const memory = await getMemory();
  const log = (s.planLog ??= { events: [], entries: {}, items: {} });
  log.entries ??= {}; log.items ??= {};
  const before = (await effective(s)).queue;
  const recs = records(memory, log, before);
  const remember = (vid) => {
    const inQueue = before.videos.find((v) => v.videoId === vid);
    const rec = memory?.helper?.videos?.[vid];
    log.entries[vid] ??= inQueue ?? (rec ? entryFromRecord(vid, rec) : { videoId: vid, title: recs[vid]?.title || 'Video' });
    for (const q of log.entries[vid].quizIds ?? []) if (rec?.content?.items?.[q]) log.items[q] = rec.content.items[q];
  };
  const add = (action, vid, value) => {
    const ev = newEvent('plan', { videoId: vid, action, ...(typeof value === 'boolean' ? { value } : {}) });
    remember(vid);
    log.events.push(ev);
    s.outbox.push(ev);
  };
  add(msg.action, id, msg.value);
  let added = null;
  const wasToday = before.videos.some((v) => v.videoId === id);
  if (msg.refill !== false && wasToday && !s.watched[id] && ['notToday', 'drop'].includes(msg.action)) {
    const after = applyPlan(before, log);
    const inToday = new Set(after.videos.map((v) => v.videoId));
    const open = (vid) => vid !== id && !inToday.has(vid) && !s.watched[vid] && ['idea', 'planned'].includes(recs[vid]?.status ?? 'planned');
    added = (after.upcoming ?? []).map((u) => u.videoId).find(open)
      ?? Object.entries(recs).filter(([vid, r]) => open(vid) && r.approved).map(([vid]) => vid)[0] ?? null;
    if (added) add('today', added);
  }
  return { ok: true, added };
}

// The talking friend has its own page; the tab goes there and comes back when it is done.
async function openTalk(tabId, mode, videoId) {
  try {
    await chrome.tabs.update(tabId, { url: chrome.runtime.getURL(`ui/talk.html?mode=${mode}&v=${videoId}`) });
    return true;
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender).then(reply, (e) => reply({ error: String(e) }));
  return true;
});

// --- GitHub sync ---------------------------------------------------------------------------

function ghHeaders(token, accept = 'application/vnd.github.raw+json') {
  const h = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function fetchDataFile(repo, token, path, etag) {
  const headers = ghHeaders(token);
  if (etag) headers['If-None-Match'] = etag;
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers, cache: 'no-store' });
  if (r.status === 304) return { notModified: true };
  if (!r.ok) throw new Error(await explainHttp(r.status, repo, token, path));
  return { json: await r.json(), etag: r.headers.get('etag') };
}

// Context documents (parent mode → Context): Markdown in kidtube-data context/, written by the helper.
const CONTEXT_DOCS = ['kid', 'strategy', 'math', 'letters', 'world'];
async function pullContext(repo, token, etags) {
  const { contextDocs = {} } = await chrome.storage.local.get('contextDocs');
  let changed = false;
  for (const d of CONTEXT_DOCS) {
    const path = `context/${d}.md`;
    const headers = ghHeaders(token);
    if (contextDocs[d] && etags[path]) headers['If-None-Match'] = etags[path];
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers, cache: 'no-store' });
    if (r.status === 304 || r.status === 404) continue;
    if (!r.ok) throw new Error(await explainHttp(r.status, repo, token, path));
    contextDocs[d] = { text: await r.text(), at: new Date().toISOString() };
    etags[path] = r.headers.get('etag');
    changed = true;
  }
  if (changed) await chrome.storage.local.set({ contextDocs });
}

// GitHub says 404 both for "no such file" and "this token can't see the repo". Tell them apart.
async function explainHttp(status, repo, token, path) {
  if (status === 401) return 'GitHub says the token is wrong or expired. Make a new one and paste it again.';
  if (status === 403) return `GitHub refused the token for ${repo}. Check the token's Contents permission.`;
  if (status !== 404) return `${path}: GitHub answered ${status}.`;
  if (!token) return `${repo} is private and there is no token yet. Using the built-in list.`;
  const who = await fetch('https://api.github.com/user', { headers: ghHeaders(token, 'application/vnd.github+json') });
  if (who.status === 401) return 'GitHub says the token is wrong or expired. Make a new one and paste it again.';
  const login = who.ok ? (await who.json()).login : null;
  const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers: ghHeaders(token, 'application/vnd.github+json') });
  if (repoRes.status === 404) {
    return `The token${login ? ` (${login})` : ''} works but can't see ${repo}. On GitHub, edit the token: Repository access → Only select repositories → ${repo.split('/')[1]}.`;
  }
  return `${path} is missing in ${repo}.`;
}

const okConfig =(c) => c && c.schemaVersion === 1 && typeof c === 'object' && !Array.isArray(c);
const okQueue = (q) => q && q.schemaVersion === 1 && Array.isArray(q.videos) && q.videos.every((v) => /^[A-Za-z0-9_-]{11}$/.test(v.videoId) && Number.isFinite(v.durationSeconds));

// Syncs run one after another, so a sync asked for after Save always uses the new token.
let syncChain = Promise.resolve();
// After he finishes a video or answers: one sync a little later, so what he did reaches the helper soon.
let syncTimer = null;
function syncSoon(ms = 20000) { clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(), ms); }
async function syncIfStale(minutes) {
  const at = await withState((s) => s.syncStatus?.at ?? null);   // per account, like everything in the state
  if (!at || Date.now() - Date.parse(at) > minutes * 60000) sync();
}

function sync() {
  const run = syncChain.then(doSync);
  syncChain = run.catch(() => {});
  return run;
}

async function doSync() {
  const { settings = {}, data = {}, account } = await chrome.storage.local.get(['settings', 'data', 'account']);
  const acct = account?.key ?? null;   // a switch to another account during this sync drops what it fetched
  const repo = settings.repo || DEFAULT_REPO;
  const token = settings.token || '';
  const etags = data.etags ?? {};
  const status = { at: new Date().toISOString(), errors: [] };
  const update = {};
  for (const [key, path, ok] of [['config', 'parent-config.json', okConfig], ['queue', 'queue.json', okQueue]]) {
    try {
      const r = await fetchDataFile(repo, token, path, data[key] ? etags[path] : null);
      if (r.notModified) continue;
      if (!ok(r.json)) throw new Error(`${path}: not a valid schemaVersion 1 file, keeping the last good copy`);
      update[key] = r.json;
      etags[path] = r.etag;
    } catch (e) {
      status.errors.push(String(e.message ?? e));
    }
  }
  // memory.json: the helper's notes on every video (parent mode: planned videos, summaries, questions).
  let memory = null;
  if (token) {
    try {
      const r = await fetchDataFile(repo, token, 'memory.json', data.memoryMeta ? etags['memory.json'] : null);
      if (!r.notModified && r.json?.schemaVersion === 1) {
        memory = r.json;
        etags['memory.json'] = r.etag;
        update.memoryMeta = { updatedAt: memory.updatedAt ?? null, processedThrough: memory.helper?.processedThrough ?? memory.processedThrough ?? null };
      }
    } catch {}   // an older data repo may have none: parent mode then shows only today's list
  }
  // helper.json: how the helper works and its prompt (parent mode → Prompt). Written by the helper each run.
  let helperInfo = null;
  if (token) {
    try {
      const r = await fetchDataFile(repo, token, 'helper.json', data.helperMeta ? etags['helper.json'] : null);
      if (!r.notModified && r.json?.schemaVersion === 1 && typeof r.json.prompt === 'string') {
        helperInfo = r.json;
        etags['helper.json'] = r.etag;
        update.helperMeta = { updatedAt: helperInfo.updatedAt ?? null };
      }
    } catch {}
  }
  // run-status.json: a run asked for from parent mode (agent/poll.sh on the server writes it).
  if (token) {
    try {
      const r = await fetchDataFile(repo, token, 'run-status.json', data.runStatus ? etags['run-status.json'] : null);
      if (!r.notModified && r.json?.schemaVersion === 1) { update.runStatus = r.json; etags['run-status.json'] = r.etag; }
    } catch {}
    try {   // runs.json: time, turns and cost of the latest runs (agent/runlog.mjs)
      const r = await fetchDataFile(repo, token, 'runs.json', data.runs ? etags['runs.json'] : null);
      if (!r.notModified && Array.isArray(r.json?.runs)) { update.runs = r.json.runs.slice(-10); etags['runs.json'] = r.etag; }
    } catch {}
  }
  if (token) { try { await pullContext(repo, token, etags); } catch (e) { status.errors.push('Context documents: ' + String(e.message ?? e)); } }
  const done = await withState((s) => {
    Object.assign(s.data, update, { etags });
    s.syncStatus = status;
    return true;
  }, { account: acct });
  if (!done) return status;
  if (memory) await chrome.storage.local.set({ memory });
  if (helperInfo) await chrome.storage.local.set({ helperInfo });
  await applySiteRules();
  // One cause (usually the token) should show once, not once per file.
  const report = (prefix, msg) => { if (!status.errors.some((x) => msg.includes(x) || x.includes(msg))) status.errors.push(prefix + msg); };
  const rules = await uploadLocalConfig();
  if (rules.saved === 'tablet' && token) report('Rules: ', rules.error.replace(/^Saved on this tablet\. GitHub: /, ''));
  try { await flushOutbox(repo, token); } catch (e) { if (token) report('Saving what he watched: ', String(e.message ?? e)); }
  if (token) {
    try { await pullPlan(repo, token, acct); } catch (e) { report('Changes from other devices: ', String(e.message ?? e)); }
    try { await uploadTranscripts(repo, token); } catch (e) { report('Transcripts: ', String(e.message ?? e)); }
    try { await loadCharacter(repo, token); } catch (e) { report('Talking friend picture: ', String(e.message ?? e)); }
    try { await syncAudio(repo, token); } catch (e) { report('Talking friend recordings: ', String(e.message ?? e)); }
  }
  status.errors = [...new Set(status.errors)];
  await withState((s) => { s.syncStatus = status; }, { account: acct });
  return status;
}

// The parent's plan changes made on another device (activity files since the helper last read them),
// so every tablet shows the same lists. Changes the helper has read are already in its files: dropped here.
async function pullPlan(repo, token, acct) {
  const { data = {} } = await chrome.storage.local.get('data');
  const since = data.memoryMeta?.processedThrough ?? null;
  const tz = (await effective({ data })).config.timezone;
  const today = localParts(new Date(), tz).date;
  const from = since ? localParts(new Date(since), tz).date : today;
  const dates = [];
  for (let d = new Date(); dates.length < 4; d = new Date(d - 86400000)) {
    const day = localParts(d, tz).date;
    if (day < from) break;
    dates.push(day);
  }
  const found = [];
  for (const date of dates) {
    const f = await getRepoFile(repo, token, `activity/${date}.json`);
    for (const e of f?.json?.events ?? []) if (['plan', 'prompt'].includes(e.type) && (!since || e.at > since)) found.push(e);
  }
  const memory = await getMemory();
  await withState((s) => {
    const log = (s.planLog ??= { events: [], entries: {}, items: {} });
    const have = new Set((log.events ?? []).map((e) => e.eventId));
    const ops = ((s.notes ??= {}).promptOps ??= []);
    for (const e of found.filter((x) => x.type === 'prompt')) if (!ops.some((o) => o.eventId === e.eventId)) ops.push(e);
    s.notes.promptOps = ops.filter((o) => !since || o.at > since).slice(-100);
    for (const e of found.filter((x) => x.type === 'plan' && PLAN_ACTIONS.includes(x.action))) {
      if (have.has(e.eventId)) continue;
      log.events.push(e);
      const rec = memory?.helper?.videos?.[e.videoId];
      if (e.action === 'today' && rec && !log.entries?.[e.videoId]) {
        (log.entries ??= {})[e.videoId] = entryFromRecord(e.videoId, rec);
        for (const q of rec.content?.quizIds ?? []) if (rec.content.items?.[q]) (log.items ??= {})[q] = rec.content.items[q];
      }
    }
    s.planLog = pendingPlan(log, since);
    if (!s.planLog.events.length) s.planLog = null;
  }, { account: acct });
}

// Parent mode → Update. Sends what is waiting (notes, what he watched), then writes requests/run.json;
// the server checks every minute and runs the helper (agent/poll.sh), at most a few times a day.
async function requestRun() {
  const ok = await withState((s) => parentMode(s));
  if (!ok) return { ok: false, error: 'Parent mode is off.' };
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (!settings.token) return { ok: false, error: 'Needs the GitHub token (Settings → Connection).' };
  const repo = settings.repo || DEFAULT_REPO;
  await sync();
  const left = await withState((s) => s.outbox.length);
  if (left) return { ok: false, error: 'Could not send your notes to GitHub yet. Check the connection and try again.' };
  const req = { schemaVersion: 1, id: crypto.randomUUID(), at: new Date().toISOString() };
  try {
    for (let i = 0; i < 3; i++) {
      const old = await getRepoFile(repo, settings.token, 'requests/run.json');
      if (await putRepoFile(repo, settings.token, 'requests/run.json', req, old?.sha, 'tablet: run the helper now')) {
        await withState((s) => { s.data.runRequest = { id: req.id, at: req.at }; });
        return { ok: true, ...(await withState((s) => runView(s))) };
      }
    }
    return { ok: false, error: 'GitHub was busy. Try again.' };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  }
}

// What parent mode shows about the latest run asked for: waiting for the server, running, done, failed.
function runView(s) {
  const req = s.data.runRequest ?? null;
  const st = s.data.runStatus ?? null;
  if (req && st?.requestId !== req.id) return { state: 'queued', at: req.at, message: 'Asked. The server starts it within a minute or two.' };
  if (!st) return { state: 'none' };
  return { state: st.state, at: st.finishedAt ?? st.startedAt, message: st.message ?? '' };
}

// Reads a JSON file with its sha (null when it doesn't exist yet).
async function getRepoFile(repo, token, path) {
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers: ghHeaders(token, 'application/vnd.github+json'), cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(await explainHttp(r.status, repo, token, path));
  const j = await r.json();
  const text = new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
  return { json: JSON.parse(text), sha: j.sha };
}

// Returns true when written, false on a sha conflict (someone else wrote first).
async function putRepoFile(repo, token, path, json, sha, message) {
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { ...ghHeaders(token, 'application/vnd.github+json'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: toBase64(JSON.stringify(json, null, 2) + '\n'), ...(sha ? { sha } : {}) }),
  });
  if (r.ok) return true;
  if (r.status === 409 || r.status === 422) return false;
  throw new Error(await explainHttp(r.status, repo, token, path));
}

// Rules from the parent page: used on the tablet at once, then written into parent-config.json
// so the agent sees them. Until GitHub accepts them they stay in localConfig.
async function saveRules(patch) {
  await withState((s) => { s.localConfig = mergeConfig(s.localConfig ?? {}, patch); });
  await applySiteRules();
  return uploadLocalConfig();
}

async function uploadLocalConfig() {
  const { settings = {}, localConfig, account } = await chrome.storage.local.get(['settings', 'localConfig', 'account']);
  if (!localConfig) return { saved: 'github' };
  const repo = settings.repo || DEFAULT_REPO, token = settings.token || '';
  if (!token) return { saved: 'tablet', error: 'No GitHub token yet, so the rules are saved on this tablet only.' };
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await getRepoFile(repo, token, 'parent-config.json');
      const next = { ...mergeConfig(cur?.json ?? { schemaVersion: 1 }, localConfig), schemaVersion: 1, updatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
      if (await putRepoFile(repo, token, 'parent-config.json', next, cur?.sha, 'Rules changed on the tablet')) {
        await withState((s) => {
          s.data.config = next;
          if (s.data.etags) delete s.data.etags['parent-config.json'];
          s.localConfig = null;
        }, { account: account?.key ?? null });
        return { saved: 'github' };
      }
    }
    return { saved: 'tablet', error: 'GitHub was busy; will retry on the next sync.' };
  } catch (e) {
    return { saved: 'tablet', error: `Saved on this tablet. GitHub: ${e.message ?? e}` };
  }
}

// Writes queued events into activity/YYYY-MM-DD.json, de-duplicated by eventId (PLAN.md §3.3).
async function flushOutbox(repo, token) {
  const { outbox = [], settings = {}, data = {}, localConfig } = await chrome.storage.local.get(['outbox', 'settings', 'data', 'localConfig']);
  if (!outbox.length) return;
  if (!token) throw new Error('no token; events kept on the tablet');
  const { config, queue } = await effective({ data, settings, localConfig });
  const byDate = {};
  for (const ev of outbox) (byDate[localParts(new Date(ev.at), config.timezone).date] ??= []).push(ev);
  if (!settings.deviceId) await withState((s) => { s.settings.deviceId ??= `tab-${crypto.randomUUID().slice(0, 8)}`; });
  const deviceId = (await chrome.storage.local.get('settings')).settings.deviceId;

  const sent = new Set();
  for (const [date, events] of Object.entries(byDate)) {
    const path = `activity/${date}.json`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await getRepoFile(repo, token, path);
      const file = cur?.json ?? { schemaVersion: 1, date, events: [] };
      const have = new Set(file.events.map((e) => e.eventId));
      file.events.push(...events.filter((e) => !have.has(e.eventId)));
      file.events.sort((a, b) => a.at.localeCompare(b.at));
      file.device = {
        deviceId, extensionVersion: chrome.runtime.getManifest().version, target: TARGET, quizTypes: (await loadBundled()).quizTypes,
        ...(config.updatedAt ? { configUpdatedAt: config.updatedAt } : {}),
        ...(queue.updatedAt ? { queueUpdatedAt: queue.updatedAt } : {}),
        lastSyncAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      };
      if (await putRepoFile(repo, token, path, file, cur?.sha, `activity ${date}`)) { events.forEach((e) => sent.add(e.eventId)); break; }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  await withState((s) => { s.outbox = s.outbox.filter((e) => !sent.has(e.eventId)); });
}

// --- transcripts --------------------------------------------------------------------------
// YouTube refuses transcripts to cloud servers, so the tablet (on the home internet) fetches them
// and puts them in the data repo as transcripts/<videoId>.json. The agent writes the talking
// friend's intro, summary and questions from them.

const TRANSCRIPTS_PER_SYNC = 12;
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

export async function fetchTranscript(videoId) {
  const page = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, { credentials: 'include' });
  const html = await page.text();
  const key = html.match(/"INNERTUBE_API_KEY":\s*"([A-Za-z0-9_-]+)"/)?.[1];
  if (!key) throw new Error('YouTube page without player data');
  const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', hl: 'en' } }, videoId }),
  });
  const pr = await res.json();
  const d = pr?.videoDetails ?? {};
  const file = {
    schemaVersion: 1, videoId, title: d.title ?? '', channelTitle: d.author ?? '',
    durationSeconds: Number(d.lengthSeconds) || 0, description: (d.shortDescription ?? '').slice(0, 5000),
    fetchedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), available: false, lang: null, kind: null, text: '',
  };
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const en = (t) => t.languageCode?.startsWith('en');
  const track = tracks.find((t) => en(t) && t.kind !== 'asr') ?? tracks.find(en) ?? tracks.find((t) => t.kind !== 'asr') ?? tracks[0];
  if (track) {
    const xml = await (await fetch(track.baseUrl.replace('&fmt=srv3', ''), { credentials: 'include' })).text();
    const text = captionsToText(parseCaptions(xml));
    if (text) Object.assign(file, { available: true, lang: track.languageCode, kind: track.kind === 'asr' ? 'auto' : 'manual', text: text.slice(0, 60000) });
  }
  return file;
}

async function uploadTranscripts(repo, token) {
  const { transcripts = {}, data = {}, account } = await chrome.storage.local.get(['transcripts', 'data', 'account']);
  const { queue } = await effective({ data, planLog: (await chrome.storage.local.get('planLog')).planLog });
  // Today's videos first, then the planned ones (`upcoming`) so the helper can prepare them.
  const ids = [...new Set([...queue.videos, ...(queue.upcoming ?? [])].map((v) => v.videoId))];
  const due = ids.filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id)).filter((id) => {
    const t = transcripts[id];
    return !t || (t.status === 'error' && Date.now() - t.at > RETRY_AFTER_MS);
  }).slice(0, TRANSCRIPTS_PER_SYNC);
  const done = {};
  for (const id of due) {
    const path = `transcripts/${id}.json`;
    try {
      if (await getRepoFile(repo, token, path)) { done[id] = { status: 'uploaded', at: Date.now() }; continue; }
      const file = await fetchTranscript(id);
      await putRepoFile(repo, token, path, file, null, `transcript ${id}`);
      done[id] = { status: 'uploaded', at: Date.now(), available: file.available };
    } catch (e) {
      done[id] = { status: 'error', at: Date.now(), error: String(e.message ?? e).slice(0, 200) };
    }
  }
  if (due.length) await withState((s) => { s.transcripts = { ...(s.transcripts ?? {}), ...done }; }, { account: account?.key ?? null });
  const failed = Object.values(done).filter((d) => d.status === 'error');
  if (failed.length) throw new Error(`${failed.length} of ${due.length} could not be fetched (${failed[0].error}); will retry tomorrow.`);
}

// --- the talking friend's recorded voice: audio/*.mp3 from the data repo, kept in Cache Storage ---

const AUDIO_CACHE = 'kidtube-audio';
const audioKey = (path) => `https://kidtube.invalid/${path}`;

export function audioRefs(queue, config) {
  const refs = new Set();
  const walk = (x) => {
    if (typeof x === 'string') { if (/^repo:audio\/[A-Za-z0-9_-]+\.(mp3|wav|ogg)$/.test(x)) refs.add(x.slice(5)); }
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(queue?.videos);
  walk(config?.quiz?.items);
  walk(config?.presenter);
  return refs;
}

async function syncAudio(repo, token) {
  if (!self.caches) return;
  const { data = {}, localConfig } = await chrome.storage.local.get(['data', 'localConfig']);
  const { config, queue } = await effective({ data, localConfig });
  const want = audioRefs(queue, config);
  const cache = await caches.open(AUDIO_CACHE);
  for (const req of await cache.keys()) if (!want.has(req.url.replace('https://kidtube.invalid/', ''))) await cache.delete(req);
  let failed = 0;
  for (const path of want) {
    if (await cache.match(audioKey(path))) continue;
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers: { ...ghHeaders(token), Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' });
    if (!r.ok) { failed++; continue; }
    await cache.put(audioKey(path), new Response(await r.blob(), { headers: { 'Content-Type': path.endsWith('.mp3') ? 'audio/mpeg' : path.endsWith('.ogg') ? 'audio/ogg' : 'audio/wav' } }));
  }
  if (failed) throw new Error(`${failed} of ${want.size} could not be downloaded; the tablet's own voice is used for those.`);
}

// --- the talking friend's picture from the private data repo ("repo:characters/x.svg") --------

async function loadCharacter(repo, token) {
  const { data = {}, localConfig, character, account } = await chrome.storage.local.get(['data', 'localConfig', 'character', 'account']);
  const only = { account: account?.key ?? null };
  const { config } = await effective({ data, localConfig });
  const ref = config.presenter?.imageUrl ?? '';
  if (!ref.startsWith('repo:')) { if (character) await withState((s) => { s.character = null; }, only); return; }
  const path = ref.slice(5);
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: { ...ghHeaders(token), ...(character?.path === path && character.etag ? { 'If-None-Match': character.etag } : {}) }, cache: 'no-store',
  });
  if (r.status === 304) return;
  if (!r.ok) throw new Error(await explainHttp(r.status, repo, token, path));
  const etag = r.headers.get('etag');
  if (path.endsWith('.svg')) {
    const svg = await r.text();
    return withState((s) => { s.character = { path, etag, svg: svg.slice(0, 300000) }; }, only);
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  const type = path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : path.endsWith('.gif') ? 'image/gif' : 'image/jpeg';
  return withState((s) => { s.character = { path, etag, src: `data:${type};base64,${bytesToBase64(bytes.subarray(0, 2_000_000))}` }; }, only);
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Every top-level page outside allowedSiteDomains is blocked (PLAN.md C16).
const allowedDomains = (config) => [...new Set([...(config.allowedSiteDomains ?? []), 'youtube.com', 'andyvauliln.github.io'])];
async function applySiteRules() {
  const s = await chrome.storage.local.get(['data', 'localConfig']);
  const { config } = await effective({ data: s.data ?? {}, localConfig: s.localConfig });
  // Orion has no blocking rules (its build drops the permission): externalGuard does the job there.
  if (TARGET === 'orion') { dnrWorks = false; return; }
  // YouTube and the install page always stay reachable, whatever the list says.
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [SITE_RULE_ID],
      addRules: config.blockOutboundLinks ? [{
        id: SITE_RULE_ID, priority: 1, action: { type: 'block' },
        condition: { resourceTypes: ['main_frame'], excludedRequestDomains: allowedDomains(config) },
      }] : [],
    });
    dnrWorks = true;
  } catch {
    dnrWorks = false;   // Orion (WebKit) has no dynamic rules: the navigation guard sends other sites home instead
  }
  await chrome.storage.local.set({ dnrWorks });
}

// Browsers without dynamic blocking rules (Orion): a page outside the allowed sites goes back to his list.
let dnrWorks;
async function externalGuard(host) {
  if (TARGET !== 'orion') {
    dnrWorks ??= (await chrome.storage.local.get('dnrWorks')).dnrWorks ?? !!chrome.declarativeNetRequest?.updateDynamicRules;
    if (dnrWorks) return null;
  }
  const s = await chrome.storage.local.get(['data', 'localConfig']);
  const { config } = await effective({ data: s.data ?? {}, localConfig: s.localConfig });
  if (!config.blockOutboundLinks) return null;
  const allowed = allowedDomains(config).some((d) => host === d || host.endsWith(`.${d}`));
  return allowed ? null : homeUrl('www.youtube.com');
}

// --- updates -------------------------------------------------------------------------------

const sync_ = () => sync();
async function checkUpdate() {
  const installed = chrome.runtime.getManifest().version;
  // Orion installs from a .zip and has no update_url: the parent installs the new .zip by hand.
  const check = TARGET === 'orion' ? { status: 'manual' }
    : await new Promise((resolve) => chrome.runtime.requestUpdateCheck((status, details) => resolve({ status, details })))
      .catch((e) => ({ status: 'error', error: String(e) }));
  let latest = null;
  try { latest = await (await fetch(LATEST_URL, { cache: 'no-store' })).json(); } catch {}
  const newer = latest && cmpVersion(latest.version, installed) > 0;
  const sync = await sync_();
  return { installed, check, latest: latest?.version ?? null, installPage: newer ? INSTALL_PAGE : null, download: newer ? latest.zipUrl ?? null : null, sync };
}

// The installed version and the newest release, with a direct download link (parent mode header).
async function appVersion() {
  const installed = chrome.runtime.getManifest().version;
  let latest = null;
  try { latest = await (await fetch(LATEST_URL, { cache: 'no-store' })).json(); } catch {}
  const newer = !!latest && cmpVersion(latest.version, installed) > 0;
  return { ok: true, installed, target: TARGET, latest: latest?.version ?? null, newer,
    download: latest?.zipUrl ?? null, installPage: INSTALL_PAGE };
}

function cmpVersion(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

chrome.runtime.onUpdateAvailable?.addListener(() => chrome.runtime.reload());

// The copy of the connection kept on the install page (content/backup.js). Only that page may ask.
const BACKUP_KEYS = ['repo', 'token', 'pinSalt', 'pinHash'];
async function settingsBackup(sender, saved) {
  if (!String(sender?.url ?? '').startsWith('https://andyvauliln.github.io/kidtube/')) return { ok: false };
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (!settings.token && saved?.kidtubeSettings === 1 && typeof saved.token === 'string' && saved.token) {
    const back = Object.fromEntries(BACKUP_KEYS.filter((k) => typeof saved[k] === 'string').map((k) => [k, saved[k]]));
    await chrome.storage.local.set({ settings: { ...settings, ...back } });
    sync();
    return { ok: true, restored: true };
  }
  if (!settings.token) return { ok: true };
  return { ok: true, backup: { kidtubeSettings: 1, savedAt: new Date().toISOString(), ...Object.fromEntries(BACKUP_KEYS.filter((k) => settings[k]).map((k) => [k, settings[k]])) } };
}

// --- lifecycle -----------------------------------------------------------------------------

async function start() {
  chrome.alarms.create('poll', { periodInMinutes: POLL_MINUTES });
  await applySiteRules();
  sync();
}
chrome.runtime.onInstalled.addListener(async ({ reason } = {}) => {
  await chrome.storage.local.remove('report'); // left over from the M0 spike
  await start();
  // A fresh install without a connection: open the install page, where content/backup.js gives it back.
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (reason === 'install' && !settings.token) chrome.tabs.create({ url: INSTALL_PAGE }).catch(() => {});
});
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'poll') sync(); });
