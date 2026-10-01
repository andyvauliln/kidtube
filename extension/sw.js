// KidTube service worker: the rules live here. Content scripts and the iframes only ask and show.
import { mergeConfig } from './lib/merge.js';
import { lockReason, nextOpening, localParts } from './lib/time.js';
import { visibleVideos } from './lib/queue.js';
import { classifyUrl, homeUrl, watchUrl } from './lib/url.js';

const SITE_RULE_ID = 100;
const POLL_MINUTES = 15;
const DEFAULT_REPO = 'andyvauliln/kidtube-data';
const LATEST_URL = 'https://andyvauliln.github.io/kidtube/latest.json';
const INSTALL_PAGE = 'https://andyvauliln.github.io/kidtube/';

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
const KEYS = ['settings', 'data', 'watched', 'today', 'session', 'outbox', 'syncStatus', 'localConfig', 'seen', 'parentPass', 'pendingTalk', 'quizTurn'];
let chain = Promise.resolve();
function withState(fn) {
  const run = chain.then(async () => {
    const s = await chrome.storage.local.get(KEYS);
    s.settings ??= {}; s.data ??= {}; s.watched ??= {}; s.outbox ??= []; s.syncStatus ??= {}; s.seen ??= {};
    const before = Object.fromEntries(KEYS.map((k) => [k, JSON.stringify(s[k] ?? null)]));
    const result = await fn(s);
    // Only write what changed: the options page writes settings on its own.
    const changed = KEYS.filter((k) => JSON.stringify(s[k] ?? null) !== before[k]);
    if (changed.length) await chrome.storage.local.set(Object.fromEntries(changed.map((k) => [k, s[k] ?? null])));
    return result;
  });
  chain = run.catch(() => {});
  return run;
}

async function effective(s) {
  const b = await loadBundled();
  const config = mergeConfig(mergeConfig(b.config, s.data?.config), s.localConfig);
  const queue = s.data.queue ?? b.queue;
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
  s.outbox.push(newEvent('watch', {
    videoId: ses.videoId, watchedSeconds: Math.round(ses.playedSeconds),
    ...(ses.durationSeconds ? { durationSeconds: ses.durationSeconds } : {}), endReason,
  }));
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
  const parent = parentTab(s, tabId);
  const ses = s.session;
  const min = config.minSecondsBeforeLeave ?? 0;
  return {
    videos: visibleVideos(queue, config, s.watched).filter((v) => v.videoId !== ses?.videoId),
    lock: reason ? { reason, opens: nextOpening(config, now) } : null,
    minutesLeft: config.time?.maxMinutesPerDay ? Math.max(0, Math.ceil(config.time.maxMinutesPerDay - played / 60)) : null,
    session: ses ? { videoId: ses.videoId, secondsUntilUnlock: ses.ended ? 0 : Math.max(0, Math.ceil(min - ses.playedSeconds)) } : null,
    rules: { allowSkip: parent || !!config.allowSkip },
    parent,
  };
}

// --- navigation guard ----------------------------------------------------------------------

function isOpenable(videoId, queue, cfg, s) {
  if (s.session?.videoId === videoId) return true;
  return visibleVideos(queue, cfg, s.watched).some((v) => v.videoId === videoId);
}

const BLOCK_TARGET = { shorts: 'shorts', search: 'search', channel: 'channel', other: 'video', watch: 'video' };

// Returns the URL to send the tab to, or null to let it be.
async function guard(s, tabId, href) {
  const c = classifyUrl(href);
  if (c.kind === 'internal' || c.kind === 'external') return null; // external sites: DNR allowlist
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
    case 'state':
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
        if (msg.mode === 'intro') lines.push(v.intro ?? { text: `Hi! I'm ${name}. Let's watch: ${v.title}!` });
        else if (p.outro) lines.push(v.outro ?? { text: `That was: ${v.title}. Well done for watching!` });
        const items = msg.mode === 'outro' ? (t?.quizIds ?? []).map((quizId) => ({ quizId, ...config.quiz.items[quizId] })).filter((i) => i.prompt) : [];
        const { quizTypes } = await loadBundled();
        return {
          name, imageUrl: p.imageUrl || '', voice: p.voice ?? {}, title: v.title, lines,
          items: items.map((i) => ({ ...i, supported: quizTypes.includes(i.type) })),
          maxAttempts: config.quiz?.maxAttempts ?? 3, onFail: config.quiz?.onFail ?? 'continue',
        };
      });

    case 'quizResults':
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
        if (parentTab(s, tabId)) return { action: 'none' }; // a parent watching doesn't count
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
      return withState(async (s) => {
        const ses = s.session;
        if (!ses || ses.videoId !== msg.videoId) return;
        ses.ended = true;
        const { config } = await effective(s);
        markWatchedIfCounts(s, config);
        endSession(s, 'ended');
        // The talking friend says what we learned and asks the questions, if they are on.
        const quizIds = config.quiz?.enabled ? pickQuiz(s, config, msg.videoId) : [];
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

    case 'note':
      return withState((s) => {
        const ev = newEvent('parentNote', { videoId: msg.videoId });
        if (typeof msg.liked === 'boolean') ev.liked = msg.liked;
        if (msg.comment) ev.comment = String(msg.comment).slice(0, 2000);
        s.outbox.push(ev);
      }).then(() => sync());

    case 'getRules':
      return withState(async (s) => ({ config: (await effective(s)).config, pending: !!s.localConfig }));

    case 'saveRules':
      return saveRules(msg.patch);

    case 'resetToday':
      return withState((s) => { s.today = null; });

    case 'openSettings': // the gear on the kid's screens; the page itself asks for the PIN
      try { await chrome.runtime.openOptionsPage(); } catch { await chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') }); }
      return { ok: true };

    case 'sync':
      return sync();

    case 'checkUpdate':
      return checkUpdate();

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
function pickQuiz(s, config, videoId) {
  const items = config.quiz?.items ?? {};
  const queue = s.data.queue ?? bundled.queue;
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
function sync() {
  const run = syncChain.then(doSync);
  syncChain = run.catch(() => {});
  return run;
}

async function doSync() {
  const { settings = {}, data = {} } = await chrome.storage.local.get(['settings', 'data']);
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
  await withState((s) => {
    Object.assign(s.data, update, { etags });
    s.syncStatus = status;
  });
  await applySiteRules();
  // One cause (usually the token) should show once, not once per file.
  const report = (prefix, msg) => { if (!status.errors.some((x) => msg.includes(x) || x.includes(msg))) status.errors.push(prefix + msg); };
  const rules = await uploadLocalConfig();
  if (rules.saved === 'tablet' && token) report('Rules: ', rules.error.replace(/^Saved on this tablet\. GitHub: /, ''));
  try { await flushOutbox(repo, token); } catch (e) { if (token) report('Saving what he watched: ', String(e.message ?? e)); }
  status.errors = [...new Set(status.errors)];
  await withState((s) => { s.syncStatus = status; });
  return status;
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
  const { settings = {}, localConfig } = await chrome.storage.local.get(['settings', 'localConfig']);
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
        });
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
        deviceId, extensionVersion: chrome.runtime.getManifest().version, quizTypes: (await loadBundled()).quizTypes,
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

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Every top-level page outside allowedSiteDomains is blocked (PLAN.md C16).
async function applySiteRules() {
  const s = await chrome.storage.local.get(['data', 'localConfig']);
  const { config } = await effective({ data: s.data ?? {}, localConfig: s.localConfig });
  // YouTube and the install page always stay reachable, whatever the list says.
  const domains = [...new Set([...(config.allowedSiteDomains ?? []), 'youtube.com', 'andyvauliln.github.io'])];
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [SITE_RULE_ID],
    addRules: config.blockOutboundLinks ? [{
      id: SITE_RULE_ID, priority: 1, action: { type: 'block' },
      condition: { resourceTypes: ['main_frame'], excludedRequestDomains: domains },
    }] : [],
  });
}

// --- updates -------------------------------------------------------------------------------

const sync_ = () => sync();
async function checkUpdate() {
  const installed = chrome.runtime.getManifest().version;
  const check = await new Promise((resolve) => chrome.runtime.requestUpdateCheck((status, details) => resolve({ status, details })))
    .catch((e) => ({ status: 'error', error: String(e) }));
  let latest = null;
  try { latest = await (await fetch(LATEST_URL, { cache: 'no-store' })).json(); } catch {}
  const newer = latest && cmpVersion(latest.version, installed) > 0;
  const sync = await sync_();
  return { installed, check, latest: latest?.version ?? null, installPage: newer ? INSTALL_PAGE : null, sync };
}

function cmpVersion(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

chrome.runtime.onUpdateAvailable.addListener(() => chrome.runtime.reload());

// --- lifecycle -----------------------------------------------------------------------------

async function start() {
  chrome.alarms.create('poll', { periodInMinutes: POLL_MINUTES });
  await applySiteRules();
  sync();
}
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.remove('report'); // left over from the M0 spike
  await start();
});
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'poll') sync(); });
