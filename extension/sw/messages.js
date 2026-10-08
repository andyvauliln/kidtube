// Messages from the content scripts, the screens and the parent pages: one handler per message type.
// Content scripts and the kid's screens only ask and show; the handlers decide.
import { TARGET } from '../lib/target.js';
import { homeUrl, watchUrl, isVideoId, thumbUrl } from '../lib/url.js';
import { lockReason, nowIso } from '../lib/time.js';
import { visibleVideos } from '../lib/queue.js';
import { appOf } from '../lib/apps.js';
import { PARENT_PAGE, PIN_PAGE, DEFAULT_REPO } from './constants.js';
import { withState, loadBundled, effective, parentMode, shellOf, fromExtensionPage, folderShown, contextDocsOf, live } from './store.js';
import { applySiteRules } from './sites.js';
import { todayPlayed, lockNow, parentTab, videoInfo, fullLang, newEvent, sessionUnlocked, endSession, markWatchedIfCounts,
  viewState, isOpenable, guard, pickQuiz, openTalk } from './session.js';
import { youtubeAccount, headerView, openApp, connectGitHub, exportSettings, importSettings, leaveApp, pinPageView } from './profiles.js';
import { heldNotes, dropHeld, noteVideo, wish, contextNote, promptNote, parentData, videoDetail, helperData, contextData, planChange, runView } from './parent.js';
import { sync, syncSoon, syncIfStale, releaseNotes, requestRun, saveRules, settingsBackup } from './sync.js';
import { checkUpdate, appVersion, updateApp } from './updates.js';

const pinPage = (purpose) => chrome.runtime.getURL(`${PIN_PAGE}?for=${purpose}`);
const DEFAULT_LINES = {
  intro: (ru, name, title, quiz) => (ru
    ? `Привет! Я ${name}! Сейчас мы посмотрим: ${title}. ${quiz ? 'Смотри внимательно, в конце я задам тебе вопрос!' : 'Давай узнаем что-то новое!'}`
    : `Hi! I'm ${name}! Now we're going to watch: ${title}. ${quiz ? 'Watch carefully, because at the end I will ask you a question!' : 'Let’s find out something new!'}`),
  outro: (ru, name, title) => (ru ? `Это было: ${title}. Молодец, что досмотрел до конца!` : `That was: ${title}. Well done for watching it all!`),
};

// ctx: { tabId, host, sender } of the message.
const HANDLERS = {
  // "Check this browser" and the screens' fallbacks: is the background alive, and what does it have?
  ping: () => ({ ok: true, version: chrome.runtime.getManifest().version, target: TARGET, at: new Date().toISOString(),
    apis: ['alarms', 'storage', 'tabs', 'declarativeNetRequest', 'permissions', 'scripting'].filter((n) => !!chrome[n]) }),

  // The home iframe loaded; the content script may not hear its postMessage (Orion).
  frameReady: (msg, { tabId }) => {
    if (tabId != null && chrome.tabs.sendMessage) chrome.tabs.sendMessage(tabId, { type: 'frameReady' }, () => { void chrome.runtime.lastError; });
    return { ok: true };
  },

  // A KidTube screen opened: fetch the newest list if the last sync is a few minutes old.
  state: (msg, { tabId }) => {
    syncIfStale(2);
    return withState((s) => viewState(s, tabId));
  },

  open: (msg, { tabId, host }) => withState(async (s) => {
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
  }),

  // What the talking friend says and asks.
  talk: (msg) => withState(async (s) => {
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
      lines.push(v.intro ?? { text: DEFAULT_LINES.intro(ru, name, v.title, hasQuiz) });
    } else if (p.outro) {
      lines.push(v.outro ?? { text: DEFAULT_LINES.outro(ru, name, v.title) });
    }
    const quizItems = config.quiz?.items ?? {};
    const items = msg.mode === 'outro' ? (t?.quizIds ?? []).map((quizId) => ({ quizId, ...quizItems[quizId] })).filter((i) => i.prompt) : [];
    const { quizTypes } = await loadBundled();
    const ch = s.character && p.imageUrl === `repo:${s.character.path}` ? s.character : null;
    return {
      name, imageUrl: ch?.src ?? (p.imageUrl?.startsWith('https://') ? p.imageUrl : ''), svg: ch?.svg ?? '',
      catchphrase: p.catchphrase ?? '', catchphraseAudioRef: p.catchphraseAudioRef ?? null, phrases: p.phrases ?? {},
      recorded: p.voice?.recorded !== false, listen: p.voice?.listen ?? { provider: 'cloud' },
      voice: { ...(p.voice ?? {}), lang }, lang, title: v.title, lines,
      items: items.map((i) => ({ ...i, lang: fullLang(i.lang) ?? lang, supported: quizTypes.includes(i.type) })),
      maxAttempts: config.quiz?.maxAttempts ?? 3, onFail: config.quiz?.onFail ?? 'continue',
    };
  }),

  quizResults: (msg) => {
    syncSoon();
    return withState(async (s) => {
      const { config } = await effective(s);
      todayPlayed(s, config);
      const t = s.pendingTalk;
      if (!t || t.mode !== 'outro' || t.videoId !== msg.videoId) return { next: 'home' };
      const results = [].concat(msg.results ?? []).filter((r) => t.quizIds.includes(r.quizId)).slice(0, 10);
      let failed = false;
      for (const r of results) {
        if (!['passed', 'failed', 'skippedByParent', 'unsupported'].includes(r.result)) continue;
        failed ||= r.result === 'failed';
        s.outbox.push(newEvent('quiz', {
          videoId: t.videoId, quizId: r.quizId, result: r.result, attempts: Math.max(0, Math.min(10, r.attempts | 0)),
          answers: [].concat(r.answers ?? []).slice(0, 10).map((a) => String(a).slice(0, 200)),
          ...(['typed', 'tapped', 'spoken'].includes(r.answeredBy) ? { answeredBy: r.answeredBy } : {}),
        }));
      }
      const h = (s.history ?? []).findLast((x) => x.videoId === t.videoId);
      if (h) h.quiz = results.map((r) => ({ quizId: r.quizId, result: String(r.result), attempts: r.attempts | 0 }));
      const onFail = config.quiz?.onFail ?? 'continue';
      t.next = !failed ? 'home'
        : onFail === 'rewatch' && !(s.today.rewatched ?? []).includes(t.videoId) ? 'rewatch'
        : onFail === 'stopForToday' ? 'stopForToday' : 'home';
      return { next: t.next };
    });
  },

  talkDone: (msg, { tabId }) => withState(async (s) => {
    const t = s.pendingTalk;
    s.pendingTalk = null;
    if (!t || t.videoId !== msg.videoId) return chrome.tabs.update(tabId, { url: homeUrl() });
    todayPlayed(s, (await effective(s)).config);   // "Reset today" may have cleared s.today meanwhile
    let url = homeUrl(t.host);
    if (t.mode === 'intro') url = watchUrl(t.host, t.videoId);
    else if (t.next === 'rewatch') {
      s.today.rewatched = [...(s.today.rewatched ?? []), t.videoId];
      delete s.watched[t.videoId];
      url = watchUrl(t.host, t.videoId);
    } else if (t.next === 'stopForToday') s.today.stopped = true;
    await chrome.tabs.update(tabId, { url });
  }),

  // From the parent page: watch any listed or watched video in a new tab, skipping allowed.
  parentWatch: async (msg) => {
    if (!isVideoId(msg.videoId)) return { ok: false };
    await withState((s) => { s.parentPass = { videoId: msg.videoId, tabId: null, until: Date.now() + 60 * 60 * 1000 }; });
    const tab = await chrome.tabs.create({ url: watchUrl('m.youtube.com', msg.videoId) });
    await withState((s) => { if (s.parentPass?.videoId === msg.videoId) s.parentPass.tabId ??= tab.id; });
    return { ok: true };
  },

  goHome: (msg, { tabId, host }) => withState(async (s) => {
    const { config } = await effective(s);
    if (!sessionUnlocked(s, config)) return { ok: false };
    await chrome.tabs.update(tabId, { url: homeUrl(host) });
    return { ok: true };
  }),

  // Playback time from the content script (at most 15 s at a time).
  tick: (msg, { tabId, host }) => withState(async (s) => {
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
    // Only the hours and the daily cap end a video here ("stopped" after a quiz is decided by talkDone).
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
  }),

  ended: (msg, { tabId, host }) => {
    syncSoon();
    return withState(async (s) => {
      const ses = s.session;
      if (!ses || ses.videoId !== msg.videoId) return;
      ses.ended = true;
      const { config, queue } = await effective(s);
      markWatchedIfCounts(s, config);
      endSession(s, 'ended');
      // The talking friend says what we learned and asks the questions, if they are on.
      const quizIds = config.quiz?.enabled ? pickQuiz(s, config, queue, msg.videoId) : [];
      if (config.presenter?.outro || quizIds.length) {
        s.pendingTalk = { mode: 'outro', videoId: msg.videoId, host, quizIds };
        if (await openTalk(tabId, 'outro', msg.videoId)) return;
        s.pendingTalk = null;
      }
      await chrome.tabs.update(tabId, { url: homeUrl(host) });
    });
  },

  // The real channel/length from YouTube's own player data (PLAN.md C19).
  details: (msg, { tabId, host }) => withState(async (s) => {
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
    s.watched[ses.videoId] ??= nowIso();
    endSession(s, 'blockedOnLoad');
    await chrome.tabs.update(tabId, { url: homeUrl(host) });
  }),

  // 👍 / 👎 / a note for the AI about one video (the 👍 goes to GitHub now; a note waits for ↻ Update data).
  note: (msg) => withState((s) => noteVideo(s, msg)).then((r) => { if (r.ok) sync(); return r; }),
  // "message to the helper", or a note for the AI about a whole list.
  wish: (msg) => withState((s) => wish(s, msg)),

  // From the YouTube page: who is signed in.
  account: (msg) => youtubeAccount(msg),
  // The apps header (ui/header.js) on YouTube and on an app's pages.
  header: (msg) => headerView(!!msg.refresh),
  openApp: (msg, { tabId, host }) => openApp(msg, tabId, host),
  connectGitHub: (msg) => connectGitHub(msg),
  exportSettings: () => exportSettings(),
  importSettings: (msg) => importSettings(msg.file),

  // The lock's Unlock: the PIN page, then back to the header.
  openApps: async (msg, { tabId }) => {
    if (tabId != null) await chrome.tabs.update(tabId, { url: pinPage('unlock') });
    return { ok: true };
  },
  // The kid's 🔒 Parent button, an app page's Parent switch: the PIN page, then parent mode.
  parentGate: async (msg, { tabId }) => {
    if (tabId != null) await chrome.tabs.update(tabId, { url: pinPage('parent') });
    else await chrome.tabs.create({ url: pinPage('parent') });
    return { ok: true };
  },
  // The PIN page (a locked header): back to the header.
  leaveApp: () => leaveApp(),
  // The PIN page: what runs now, whether it may skip the PIN, and where YouTube is.
  apps: () => withState((s) => pinPageView(s)),

  // Settings page or parent screens, after the PIN. Parent mode stays on until the parent switches back (no timer since 0.8.9).
  setMode: (msg) => {
    if (!['kid', 'parent'].includes(msg.mode)) return { ok: false, error: 'Unknown mode.' };
    return withState((s) => {
      Object.assign(s.settings, { mode: msg.mode, parentUntil: 0 });
      return { ok: true, until: 0, parentMode: parentMode(s) };
    }).then(async (r) => { await applySiteRules(); return r; });
  },

  // A YouTube home tab in parent mode becomes the parent's screens (another app: its own page, as guard).
  openParent: (msg, { tabId }) => withState(async (s) => {
    if (!parentMode(s) || tabId == null || (await shellOf()).on) return { ok: false };
    const app = appOf((await chrome.storage.local.get('account')).account);
    await chrome.tabs.update(tabId, { url: chrome.runtime.getURL(app.page ?? PARENT_PAGE) });
    return { ok: true };
  }),

  // Parent mode just ended on this page: the kid's rules apply to it again.
  recheck: (msg, { tabId, sender }) => withState((s) => guard(s, tabId, msg.url ?? sender.tab?.url ?? '')).then((target) => {
    if (target && tabId != null && target !== msg.url) chrome.tabs.update(tabId, { url: target });
    return { ok: true };
  }),

  // Parent screens: open the video in this tab, no rules (parent mode).
  watchHere: (msg, { tabId }) => {
    if (!isVideoId(msg.videoId)) return { ok: false };
    return withState(async (s) => {
      if (!parentMode(s)) return { ok: false };
      await chrome.tabs.update(tabId, { url: watchUrl(live.host, msg.videoId) });
      return { ok: true };
    });
  },

  // Parent screens → kid mode: back to his list.
  kidHome: async (msg, { tabId }) => {
    await withState((s) => { Object.assign(s.settings, { mode: 'kid', parentUntil: 0 }); });
    await applySiteRules();
    if (tabId != null) await chrome.tabs.update(tabId, { url: homeUrl(live.host) });
    return { ok: true };
  },

  parentData: () => withState((s) => parentData(s)),
  videoDetail: (msg) => withState((s) => videoDetail(s, msg.videoId)),
  // Parent mode → Prompt: how the helper works, its prompt, your changes to it.
  helperData: () => withState((s) => helperData(s)),
  // Add a standing instruction for the helper, or remove one (the Prompt tab).
  promptNote: (msg) => withState((s) => promptNote(s, msg)).then((r) => { if (r.ok) sync(); return r; }),
  // Parent mode → Update: send everything, then ask the server to run the helper now.
  runHelper: () => requestRun(),
  runStatus: () => withState((s) => ({ ok: true, ...runView(s) })),
  // Parent mode → Context: the documents and your notes the helper hasn't read yet.
  contextData: () => withState((s) => contextData(s)),
  contextNote: async (msg) => {
    const docs = await contextDocsOf();
    return withState((s) => contextNote(s, msg, docs)).then((r) => { if (r.ok) sync(); return r; });
  },
  // The notes card: every note for the AI still on this tablet (Apply notes sends them).
  heldNotes: () => withState((s) => heldNotes(s)),
  // The notes card: ✕ on one note (id), or Clear all (all: true); only notes not sent yet.
  dropNote: (msg) => withState((s) => dropHeld(s, msg.all ? null : String(msg.id ?? ''))),
  plan: (msg) => withState((s) => planChange(s, msg)).then((r) => { if (r?.ok) sync(); return r; }),

  getRules: () => withState(async (s) => ({ config: (await effective(s)).config, pending: !!s.localConfig })),
  saveRules: (msg) => saveRules(msg.patch),
  resetToday: () => withState((s) => { s.today = null; return { ok: true }; }),
  // content/backup.js on the install page: take the copy back, or refresh it.
  settingsBackup: (msg, { sender }) => settingsBackup(sender, msg.saved),

  // notes: true = Settings → Update now, which also sends the notes waiting for it.
  sync: async (msg, { sender }) => {
    if (msg.notes && fromExtensionPage(sender)) await releaseNotes();
    return sync();
  },
  checkUpdate: () => checkUpdate(),
  version: () => appVersion(),
  updateApp: () => updateApp(),

  status: () => withState(async (s) => {
    const { config, queue } = await effective(s);
    return {
      version: chrome.runtime.getManifest().version,
      repo: s.settings.repo || DEFAULT_REPO,
      folder: await folderShown(),
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
        return { videoId, at, title: v.title, channelTitle: v.channelTitle ?? '', durationSeconds: v.durationSeconds ?? null,
          thumbnailUrl: v.thumbnailUrl || thumbUrl(videoId) };
      }),
    };
  }),
};

// Messages that change the plan, the mode or the notes come only from the extension's own pages.
const PAGE_ONLY = new Set(['leaveApp', 'apps', 'setMode', 'watchHere', 'kidHome', 'parentData', 'videoDetail', 'helperData', 'promptNote',
  'runHelper', 'runStatus', 'contextData', 'contextNote', 'heldNotes', 'dropNote', 'plan']);

export async function handle(msg, sender) {
  const fn = HANDLERS[msg?.type];
  if (!fn) return undefined;
  if (PAGE_ONLY.has(msg.type) && !fromExtensionPage(sender)) {
    return { ok: false, error: `Refused: the request did not come from a KidTube page (${sender.url ?? sender.tab?.url ?? 'no address'}).` };
  }
  const tabId = sender.tab?.id;
  const host = sender.tab?.url ? new URL(sender.tab.url).hostname : 'm.youtube.com';
  return fn(msg, { tabId, host, sender });
}
