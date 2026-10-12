// The core's start checks: after an install, an update or a browser start, is everything KidTube needs in place?
// Each one says what it expects; run(t, ctx) fills the Expect. ctx: { reason ('install' | 'update' | 'startup' |
// 'asked'), previous (what the last run saw: version and what was set), startedAt }.
import { TARGET } from '../lib/target.js';
import { cmpVersion } from '../lib/version.js';
import { ghHeaders, explainHttp } from '../lib/github.js';
import { POLL_MINUTES, LATEST_URL, SITE_RULE_ID, AD_RULE_ID, DEFAULT_REPO } from '../background/constants.js';
import { rulesInput, allowedDomains, AD_DOMAINS } from '../background/sites.js';
import { heardFrom } from './runner.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const CORE_START = [
  {
    id: 'start.storage', area: 'core', expect: 'The storage keeps what KidTube writes',
    code: ['core/background/store.js'],
    async run(t) {
      const echo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await chrome.storage.local.set({ checkEcho: echo });
      const back = (await chrome.storage.local.get('checkEcho')).checkEcho;
      t.eq('the value read back', echo, back);
      await chrome.storage.local.remove('checkEcho');
    },
  },
  {
    id: 'start.files', area: 'core', expect: 'The extension reads its own files, and they are this version',
    code: ['manifest.json'],
    async run(t) {
      const r = await fetch(chrome.runtime.getURL('manifest.json'));
      t.eq('status of manifest.json', 200, r.status);
      const m = await r.json().catch(() => null);
      t.eq('version in manifest.json', chrome.runtime.getManifest().version, m?.version);
    },
  },
  {
    id: 'start.alarm', area: 'sync', expect: `The ${POLL_MINUTES}-minute timer (sync and update check) is set`,
    code: ['core/background/main.js start'],
    async run(t) {
      if (!chrome.alarms?.get) return t.skip('this browser has no alarms.get');
      const a = await chrome.alarms.get('poll');
      if (t.has('the "poll" alarm', a, `an alarm every ${POLL_MINUTES} min`)) t.eq('poll.periodInMinutes', POLL_MINUTES, a.periodInMinutes);
    },
  },
  {
    id: 'start.rules', area: 'blocking', expect: 'The blocking rules for other websites and for ad servers match the app and the mode',
    code: ['core/background/sites.js applySiteRules'],
    async run(t) {
      // Orion has no blocking rules: core/background/sites.js externalGuard sends other sites home instead.
      if (TARGET === 'orion' || !chrome.declarativeNetRequest?.getDynamicRules) return t.skip('no blocking rules in this browser (the guard does it)');
      const want = await rulesInput();
      const rules = await chrome.declarativeNetRequest.getDynamicRules();
      const rule = rules.find((r) => r.id === SITE_RULE_ID) ?? null;
      t.note('wanted', { block: want.block, allowedSites: want.allowed, ads: !!want.ads, signingIn: want.signingIn });
      t.eq('blocking rule present', !!want.block, !!rule);
      const ads = rules.find((r) => r.id === AD_RULE_ID) ?? null;
      t.eq('ad server rule present', !!want.ads, !!ads);
      if (ads && want.ads) t.eq('ad servers blocked', AD_DOMAINS, ads.condition?.requestDomains ?? null);
      if (rule && want.block) {
        const open = rule.condition?.excludedRequestDomains ?? [];
        for (const d of allowedDomains(want.allowed, want.signingIn)) t.ok(`"${d}" stays open`, open.includes(d), open, `listed in excludedRequestDomains`);
      }
    },
  },
  {
    id: 'start.profile', area: 'profiles', expect: 'The profile, the mode and the apps header have valid values',
    code: ['core/background/profiles.js', 'core/background/store.js shellOf'],
    async run(t) {
      const g = await chrome.storage.local.get(['account', 'accounts', 'settings', 'shell']);
      if (g.shell != null) {
        t.ok('shell.on', typeof g.shell.on === 'boolean', g.shell, 'true or false');
        t.ok('shell.locked', typeof (g.shell.locked ?? false) === 'boolean', g.shell, 'true or false');
      }
      if (g.settings?.mode != null) t.ok('settings.mode', ['kid', 'parent'].includes(g.settings.mode), g.settings.mode, '"kid" or "parent"');
      if (!g.account) return;
      t.has('account.key', g.account.key);
      t.has('account.app', g.account.app);
      t.ok('the profile is in the list of profiles (accounts)', !!g.accounts?.[g.account.key], Object.keys(g.accounts ?? {}).length + ' profiles', 'listed');
    },
  },
  {
    id: 'start.kept', area: 'core', expect: 'An update keeps the GitHub connection, the PIN and the profile (unless it is one that cannot stay: an Instagram profile named by an email, an app that is gone)',
    code: ['core/background/main.js onInstalled', 'core/background/constants.js DEVICE_SETTINGS', 'core/background/profiles.js migrateProfileKeys'],
    async run(t, { reason, previous }) {
      if (reason !== 'update' || !previous?.had) return t.skip('not an update');
      const g = await chrome.storage.local.get(['settings', 'account', 'profileDropped']);
      t.note('from', previous.version);
      if (previous.had.token) t.ok('GitHub token', !!g.settings?.token, 'missing', 'still saved');
      if (previous.had.pin) t.ok('PIN', !!g.settings?.pinHash, 'missing', 'still set');
      if (previous.had.repo) t.eq('data repo', previous.had.repo, g.settings?.repo || null);
      // migrateProfileKeys drops a profile that cannot stay on purpose, after the last run saw it.
      const dropped = g.profileDropped && g.profileDropped.at >= previous.at ? g.profileDropped : null;
      if (dropped) t.note('profile dropped on purpose', dropped);
      if (previous.had.profile && !dropped) t.ok('profile', !!g.account?.key, 'missing', 'still there');
    },
  },
  {
    id: 'start.latest', area: 'updates', net: true, expect: 'The release file (latest.json) answers with a version and a download',
    code: ['core/background/updates.js latestRelease', 'core/background/constants.js LATEST_URL'],
    async run(t) {
      const r = await fetch(LATEST_URL, { cache: 'no-store' });
      t.eq(`status of ${LATEST_URL}`, 200, r.status);
      if (!r.ok) return;
      const j = await r.json().catch(() => null);
      if (!t.has('latest.version', j?.version)) return;
      t.has('a download address (latest.zipUrl or crxUrl)', j.zipUrl ?? j.crxUrl);
      t.note('installed', chrome.runtime.getManifest().version).note('latest', j.version);
      // Installed newer than the release: a build that isn't out yet (fine). Older: the update check says so.
      t.note('newer release', cmpVersion(j.version, chrome.runtime.getManifest().version) > 0);
    },
  },
  {
    id: 'start.github', area: 'github', net: true, expect: 'GitHub accepts the saved token for the data repo',
    code: ['core/lib/github.js', 'core/background/profiles.js connectGitHub'],
    async run(t) {
      const { settings = {} } = await chrome.storage.local.get('settings');
      if (!settings.token) return t.skip('no GitHub token yet');
      const repo = settings.repo || DEFAULT_REPO;
      const r = await fetch(`https://api.github.com/repos/${repo}`, { headers: ghHeaders(settings.token, 'application/vnd.github+json'), cache: 'no-store' });
      if (!t.eq(`status of api.github.com/repos/${repo}`, 200, r.status).passed) t.note('why', await explainHttp(r.status, { repo, base: '' }, settings.token, ''));
    },
  },
  {
    id: 'start.content', area: 'youtube', expect: 'The open YouTube tab runs KidTube (it asks the background)',
    code: ['manifest.json content_scripts', 'core/content/shell.js', 'core/background/main.js onInstalled (reload)'],
    async run(t, { startedAt }) {
      const tabs = ((await chrome.tabs.query?.({ active: true, url: ['*://www.youtube.com/*', '*://m.youtube.com/*'] }).catch(() => [])) ?? [])
        .filter((x) => !x.discarded && x.status !== 'unloaded');
      if (!tabs.length) return t.skip('no YouTube tab on screen');
      // A tab that loaded after the start asks within a few seconds; one that was already open was reloaded on update.
      for (let i = 0; i < 20 && !tabs.some((x) => (heardFrom.get(x.id) ?? 0) >= startedAt - 60000); i++) await wait(1000);
      const heard = tabs.filter((x) => (heardFrom.get(x.id) ?? 0) >= startedAt - 60000);
      t.ok('a YouTube tab asked the background', heard.length > 0, `${tabs.length} tab(s) on screen, none asked in 20 s`, 'within 20 s');
      t.note('tabs', tabs.map((x) => ({ id: x.id, url: x.url, status: x.status })));
    },
  },
];
