// M0 probe: every check records into chrome.storage.local "report". Read it on the options page.
const ALLOWLIST_RULE_ID = 100;
const ALLOWED_DOMAINS = ['youtube.com', 'google.com', 'gstatic.com', 'github.com', 'github.io', 'githubusercontent.com'];

async function record(key, value) {
  const { report = {} } = await chrome.storage.local.get('report');
  report[key] = { value, at: new Date().toISOString() };
  await chrome.storage.local.set({ report });
}

async function bump(key, extra) {
  const { report = {} } = await chrome.storage.local.get('report');
  const prev = report[key]?.value?.count ?? 0;
  report[key] = { value: { count: prev + 1, ...extra }, at: new Date().toISOString() };
  await chrome.storage.local.set({ report });
}

chrome.runtime.onInstalled.addListener(async (d) => {
  await record('installed', { reason: d.reason, version: chrome.runtime.getManifest().version, id: chrome.runtime.id });
  chrome.alarms.create('poll', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'poll') return;
  await bump('alarmFires');
  await fetchGithub('alarm');
});

async function fetchGithub(source) {
  try {
    const r = await fetch('https://api.github.com/zen', { cache: 'no-store' });
    await record('githubFetch', { source, status: r.status, date: r.headers.get('date'), body: (await r.text()).slice(0, 80) });
  } catch (e) {
    await record('githubFetch', { source, error: String(e) });
  }
}

// C18 layer 3: tab URL guard. A channel page is sent back to home.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  await bump('tabsOnUpdated', { lastUrl: info.url });
  const u = new URL(info.url);
  if (/(^|\.)youtube\.com$/.test(u.hostname) && (u.pathname.startsWith('/@') || u.pathname.startsWith('/channel/'))) {
    await chrome.tabs.update(tabId, { url: `https://${u.hostname}/` });
    await bump('guardRedirects', { from: info.url });
  }
});

chrome.runtime.onUpdateAvailable.addListener(async (d) => {
  await record('onUpdateAvailable', d);
  chrome.runtime.reload();
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    switch (msg.type) {
      case 'content': await bump(`content_${msg.world}_${new URL(sender.url).hostname}`, { url: sender.url }); break;
      case 'pushState': await bump('mainWorldPushState', { url: msg.url }); break;
      case 'fullscreen': await record('fullscreen', { on: msg.on, frameVisible: msg.frameVisible }); break;
      case 'updateCheck': {
        const res = await new Promise((r) => chrome.runtime.requestUpdateCheck((status, details) => r({ status, details, lastError: chrome.runtime.lastError?.message })))
          .catch((e) => ({ error: String(e) }));
        await record('requestUpdateCheck', res);
        break;
      }
      case 'fetchGithub': await fetchGithub('button'); break;
      case 'allowlist': {
        // C16: block every top-level page outside the allowlist.
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [ALLOWLIST_RULE_ID],
          addRules: msg.on ? [{ id: ALLOWLIST_RULE_ID, priority: 1, action: { type: 'block' },
            condition: { resourceTypes: ['main_frame'], excludedRequestDomains: ALLOWED_DOMAINS } }] : [],
        });
        await record('siteAllowlist', { on: msg.on });
        break;
      }
      case 'incognito': await record('incognitoAllowed', await chrome.extension.isAllowedIncognitoAccess()); break;
    }
    reply(true);
  })();
  return true;
});
