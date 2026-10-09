// The guard on every URL change of a tab: the core's part. Extension pages, Google's sign-in and the apps header
// are left alone, other websites go through the site rules, and every other YouTube page is the app's to decide.
import { classifyUrl } from '../lib/youtube.js';
import { shellOf, live } from './store.js';
import { externalGuard } from './sites.js';
import { partOf } from './apps.js';

// Returns the URL to send the tab to, or null to let it be.
export async function guard(s, tabId, href) {
  const c = classifyUrl(href);
  if (c.kind === 'internal') return null;
  if (c.kind === 'external') return externalGuard(c.host);         // normally DNR blocks them; this is the fallback
  if (c.kind === 'signin') return null;                             // Google signing in an account: let it finish
  live.host = c.host || live.host;
  const g = await chrome.storage.local.get(['shell', 'account']);
  // The apps header: plain YouTube, so the parent can sign in or switch the account (locked: shell.js covers it).
  if ((await shellOf(g)).on) return null;
  return (await partOf(g.account).guard?.(s, tabId, c, href)) ?? null;
}
