// What each of the core's messages must have done, checked right after its answer (runner.js observe).
// A check: { area, expect, code, snap (storage keys read before and after), skip(c), check(t, c), later: { ms, check } }.
// c: { msg, answer, before, after, tabId, host, sender, ms, tabUrl(tabId) }. later runs once the tab had time to move.
import { accountFromSwitcher } from '../lib/account.js';
import { Expect, shapeOf } from './kit.js';
import { probe } from './runner.js';

const ext = (p) => chrome.runtime.getURL(p);
const fresh = (iso, since) => !!iso && Date.parse(iso) >= since - 1000;
const youtube = (u) => { try { return /(^|\.)youtube\.com$/.test(new URL(u).hostname); } catch { return false; } };
const refused = (t, answer) => { t.has('answer.error (why it was refused)', answer?.error); };

// The tab went where the answer said (the background moves it; Orion sometimes doesn't, then the page does).
async function tabWent(t, c, want, what = 'the tab’s address') {
  if (c.tabId == null || !want) return;
  const now = await c.tabUrl(c.tabId);
  if (now == null) return t.note('tab', 'the browser did not say where the tab is');
  t.ok(what, typeof want === 'function' ? want(now) : now.startsWith(want), now, typeof want === 'function' ? 'the expected page' : want);
}

export const CORE_ACTIONS = {
  setMode: {
    area: 'mode', expect: 'Parent | Kid: the mode is the one asked for',
    code: ['core/background/messages.js setMode', 'core/ui/header.js modeSwitch'],
    snap: ['settings'],
    check(t, { msg, answer, after }) {
      if (!['kid', 'parent'].includes(msg.mode)) return t.eq('answer.ok', false, answer?.ok);
      t.eq('answer.ok', true, answer?.ok);
      t.eq('settings.mode', msg.mode, after.settings?.mode);
    },
  },

  kidHome: {
    area: 'mode', expect: 'Kid: kid mode is on and the tab goes to the app’s home (KidTube: his list on YouTube)',
    code: ['core/background/messages.js kidHome', 'core/ui/header.js modeSwitch toKid'],
    snap: ['settings'],
    check(t, { answer, after }) {
      t.eq('answer.ok', true, answer?.ok);
      t.eq('settings.mode', 'kid', after.settings?.mode);
      t.has('answer.url', answer?.url);
    },
    later: { ms: 4000, check: (t, c) => tabWent(t, c, c.answer?.url) },
  },

  openApp: {
    area: 'header', expect: 'An app tile: that app runs for the signed-in account, in the mode asked for, and its page opens',
    code: ['core/background/profiles.js openApp', 'core/background/profiles.js useProfile', 'core/ui/header.js openApp'],
    snap: ['shell', 'account', 'ytAccount', 'settings'],
    check(t, { msg, answer, after }) {
      if (!answer?.ok) return refused(t, answer);
      t.eq('shell.on (the apps header)', false, after.shell?.on);
      t.eq('account.app', msg.app, after.account?.app);
      t.ok('the profile is the signed-in account', !!after.account?.email && after.account.email === after.ytAccount?.email,
        { profile: !!after.account?.email, youtube: !!after.ytAccount?.email, same: after.account?.email === after.ytAccount?.email }, 'the same email');
      t.eq('settings.mode', msg.create || msg.mode !== 'kid' ? 'parent' : 'kid', after.settings?.mode);
    },
    later: { ms: 4000, check: (t, c) => tabWent(t, c, c.answer?.navigated ? c.answer.url : null) },
  },

  plainYouTube: {
    area: 'header', expect: 'The YouTube tile: no app runs and the tab shows YouTube with the apps header',
    code: ['core/background/profiles.js plainYouTube'],
    snap: ['shell'],
    check(t, { answer, after }) {
      if (!answer?.ok) return refused(t, answer);
      t.eq('shell', { on: true, locked: false }, { on: after.shell?.on, locked: !!after.shell?.locked });
    },
    later: { ms: 4000, check: (t, c) => tabWent(t, c, c.answer?.navigated ? youtube : null, 'the tab is on YouTube') },
  },

  leaveApp: {
    area: 'header', expect: 'Back to the apps header: no app runs, nothing locked',
    code: ['core/background/profiles.js leaveApp'],
    snap: ['shell'],
    check(t, { answer, after }) {
      t.eq('answer.ok', true, answer?.ok);
      t.eq('shell', { on: true, locked: false }, { on: after.shell?.on, locked: !!after.shell?.locked });
    },
  },

  openParent: {
    area: 'mode', expect: 'Parent mode on YouTube’s home: the tab becomes the app’s parent screens',
    code: ['core/background/messages.js openParent', 'apps/kidtube/content/youtube.js openParent'],
    skip: ({ answer }) => !answer?.ok,
    check(t, { answer }) { t.eq('answer.ok', true, answer?.ok); },
    later: { ms: 4000, check: (t, c) => tabWent(t, c, ext('')) },
  },

  connectGitHub: {
    area: 'github', net: true, expect: 'Connect / Load from GitHub: the repo and token are saved and everything loads again; a refusal keeps the old ones and says why',
    code: ['core/background/profiles.js connectGitHub', 'core/ui/header.js connect'],
    snap: ['settings', 'syncStatus', 'account'],
    check(t, { msg, answer, before, after, ms }) {
      const sameToken = (before.settings?.token ?? null) === (after.settings?.token ?? null);
      if (!answer?.ok) {
        refused(t, answer);
        t.eq('data repo kept', before.settings?.repo ?? null, after.settings?.repo ?? null);
        t.ok('token kept', sameToken, 'changed', 'the one saved before');
        return;
      }
      t.eq('settings.repo', answer.repo, after.settings?.repo);
      t.has('a saved token', after.settings?.token ? 'saved' : null);
      if (msg.token) t.ok('the typed token is saved', after.settings?.token === String(msg.token).trim(), 'another one', 'the typed one');
      if (answer.synced) t.ok('syncStatus.at (a sync ran)', fresh(after.syncStatus?.at, Date.now() - ms - 2000), after.syncStatus?.at ?? null, 'a time after the tap');
      if (after.syncStatus?.errors?.length) t.note('sync errors', after.syncStatus.errors);
    },
  },

  importSettings: {
    area: 'github', expect: 'Load settings from a file: the repo, the token and the PIN from the file are saved, and a sync runs',
    code: ['core/background/profiles.js importSettings', 'core/ui/header.js picker'],
    snap: ['settings', 'syncStatus'],
    check(t, { msg, answer, after, ms }) {
      if (!answer?.ok) return refused(t, answer);
      const f = msg.file ?? {};
      if (typeof f.repo === 'string' && f.repo) t.eq('settings.repo', f.repo, after.settings?.repo);
      if (typeof f.token === 'string' && f.token) t.ok('the file’s token is saved', after.settings?.token === f.token, 'another one', 'the file’s token');
      if (typeof f.pinHash === 'string' && f.pinHash) t.ok('the file’s PIN is set', after.settings?.pinHash === f.pinHash, 'another one', 'the file’s PIN');
      t.ok('syncStatus.at (a sync ran)', fresh(after.syncStatus?.at, Date.now() - ms - 2000), after.syncStatus?.at ?? null, 'a time after the load');
    },
  },

  exportSettings: {
    area: 'github', expect: 'Save settings to a file: the file has the connection and the PIN',
    code: ['core/background/profiles.js exportSettings'],
    snap: ['settings'],
    check(t, { answer, after }) {
      if (!answer?.ok) return refused(t, answer);
      t.eq('file.kidtubeSettings', 1, answer.file?.kidtubeSettings);
      t.eq('the file has the token', !!after.settings?.token, !!answer.file?.token);
      t.eq('the file has the PIN', !!after.settings?.pinHash, !!answer.file?.pinHash);
    },
  },

  // YouTube said who is signed in. Another account than the running profile's stops the app (the header shows).
  account: {
    area: 'profiles', expect: 'YouTube’s account reaches KidTube; another account than the profile’s stops the app',
    code: ['core/background/profiles.js youtubeAccount', 'core/content/shell.js reportAccount', 'core/lib/account.js accountFromSwitcher'],
    snap: ['shell', 'account', 'ytAccount'],
    check(t, { msg, before, after, ms }) {
      const info = msg.switcher ? accountFromSwitcher(msg.switcher) : null;
      switcherProbe(msg, info);
      t.ok('ytAccount.at (when YouTube was last checked)', (after.ytAccount?.at ?? 0) >= Date.now() - ms - 5000, after.ytAccount?.at ?? null, 'just now');
      const was = before.account, running = was?.email && before.shell && !before.shell.on;
      if (!running || !info?.email) return;
      if (info.email !== was.email) {
        t.eq('shell.on (the app stopped)', true, after.shell?.on);
        t.has('shell.why', after.shell?.why);
      } else t.eq('shell.on (the same account: the app keeps running)', false, after.shell?.on ?? false);
    },
  },

  sync: {
    area: 'sync', expect: 'Update now: a sync runs and says what went wrong',
    code: ['core/background/sync.js doSync'],
    check(t, { answer }) {
      t.has('answer.at', answer?.at);
      t.ok('answer.errors', Array.isArray(answer?.errors), answer?.errors, 'a list (maybe empty)');
    },
  },

  updateApp: {
    area: 'updates', expect: 'Update with a newer app: the browser is asked for it',
    code: ['core/background/updates.js updateApp'],
    skip: ({ answer }) => answer?.ok === false,
    check(t, { answer }) {
      t.ok('the browser’s answer', ['update_available', 'throttled', 'no_update'].includes(answer?.status), answer?.status, 'update_available, throttled or no_update');
    },
  },
};

// YouTube's account switcher: signed in, yet no email in its answer, means YouTube changed it (or the request failed).
function switcherProbe(msg, info) {
  if (!msg.loggedIn) return;
  const t = new Expect();
  if (!msg.switcher) t.mismatch.push({ what: 'getAccountSwitcherEndpoint', expected: 'an answer', actual: 'nothing (the request failed or was empty)' });
  else if (!info?.email) {
    t.mismatch.push({ what: 'the email in getAccountSwitcherEndpoint', expected: 'the selected account’s email', actual: info ? 'an account without email' : 'not JSON' });
    try { t.note('shape', shapeOf(JSON.parse(msg.switcher.replace(/^\)\]\}'\s*/, '')))); } catch { t.note('start', String(msg.switcher).slice(0, 12)); }
    t.note('length', msg.switcher.length);
  }
  probe('yt.switcher', { area: 'youtube', expect: 'YouTube’s account switcher names the signed-in email',
    code: ['core/content/shell.js reportAccount', 'core/lib/account.js accountFromSwitcher'] }, t);
}
