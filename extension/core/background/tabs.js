// One tab for YouTube and KidTube's pages: two tabs would show two screens of one state (two lists, two timers,
// a parent page next to his list). A tab that opens one of them wins: the other such tabs are closed.
// Left alone: Google's sign-in, other websites, and the extension's tools (the browser check, the avatar lab).
const TOOLS = ['core/pages/check.html', 'apps/kidtube/kid/avatar-lab.html'];

export function isAppTab(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const base = chrome.runtime.getURL('');
  if (url.startsWith(base)) return !TOOLS.some((p) => url.startsWith(base + p));
  return /^https?:$/.test(u.protocol) && /(^|\.)youtube\.com$/.test(u.hostname)
    && !['accounts.youtube.com', 'consent.youtube.com'].includes(u.hostname);
}

// tabId just showed url: close the other app tabs.
export async function keepOneTab(tabId, url) {
  if (!isAppTab(url)) return;
  try {
    const tabs = (await chrome.tabs.query({})) ?? [];
    const others = tabs.filter((t) => t.id !== tabId && isAppTab(t.url ?? t.pendingUrl ?? '')).map((t) => t.id);
    if (others.length) await chrome.tabs.remove(others);
  } catch {}   // a tab closed meanwhile, or a browser without these: two tabs stay, as before
}
