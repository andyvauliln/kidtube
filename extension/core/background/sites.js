// Other websites: blocked before they load (declarativeNetRequest), or sent back to YouTube where the
// browser has no blocking rules (Orion). The current app says whether they are closed and which stay open.
import { TARGET } from '../lib/target.js';
import { homeUrl } from '../lib/youtube.js';
import { SITE_RULE_ID, AD_RULE_ID } from './constants.js';
import { parentMode } from './store.js';
import { partOf } from './apps.js';

let dnrWorks;

// Every top-level page outside the app's allowed domains is blocked (PLAN.md C16).
// Where the header shows (the unlocked apps header, parent mode), all of google.com stays open: its Switch and Sign in
// can pass through www.google.com or gds.google.com ("make sure you can sign in"), and a blocked step is a dead page.
// accounts.google.com always: YouTube's own sign-in passes through it, whatever the app.
export const allowedDomains = (allowed, signingIn = false) =>
  [...new Set([...allowed, 'youtube.com', 'accounts.google.com', 'andyvauliln.github.io', ...(signingIn ? ['google.com'] : [])])];
const signingIn = (s) => (s.shell?.on ? !s.shell.locked : parentMode(s));

// Ad servers, blocked inside every page when the app asks (KidTube's blockAds). Only other companies' servers:
// blocking YouTube's own ad requests makes YouTube warn about ad blockers. YouTube's own ads are skipped in the page
// (apps/kidtube/content/youtube.js skipAds).
export const AD_DOMAINS = ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'googletagservices.com', 'adservice.google.com'];

// { block, allowed, ads, signingIn }: the profile's app decides (an app without rules: everything else closed).
export async function rulesInput() {
  const s = await chrome.storage.local.get(['data', 'localConfig', 'shell', 'settings', 'account']);
  const app = partOf(s.account);
  const rules = (await app.siteRules?.({ data: s.data ?? {}, localConfig: s.localConfig })) ?? { block: true, allowed: [] };
  return { ...rules, signingIn: signingIn(s) };
}

export async function applySiteRules() {
  // Orion has no blocking rules (its build drops the permission): externalGuard does the job there.
  if (TARGET === 'orion') { dnrWorks = false; return; }
  const { block, allowed, ads, signingIn } = await rulesInput();
  // YouTube and the install page always stay reachable, whatever the list says.
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [SITE_RULE_ID, AD_RULE_ID],
      addRules: [
        ...(block ? [{
          id: SITE_RULE_ID, priority: 1, action: { type: 'block' },
          condition: { resourceTypes: ['main_frame'], excludedRequestDomains: allowedDomains(allowed, signingIn) },
        }] : []),
        // no resourceTypes: everything a page loads (not the page itself)
        ...(ads ? [{ id: AD_RULE_ID, priority: 1, action: { type: 'block' }, condition: { requestDomains: AD_DOMAINS } }] : []),
      ],
    });
    dnrWorks = true;
  } catch {
    dnrWorks = false;   // Orion (WebKit) has no dynamic rules: the navigation guard sends other sites home instead
  }
  await chrome.storage.local.set({ dnrWorks });
}

// Browsers without dynamic blocking rules (Orion): a page outside the allowed sites goes back to YouTube.
// Returns the URL to send the tab to, or null to let it be.
export async function externalGuard(host) {
  if (TARGET !== 'orion') {
    dnrWorks ??= (await chrome.storage.local.get('dnrWorks')).dnrWorks ?? !!chrome.declarativeNetRequest?.updateDynamicRules;
    if (dnrWorks) return null;
  }
  const { block, allowed, signingIn } = await rulesInput();
  if (!block) return null;
  const open = allowedDomains(allowed, signingIn).some((d) => host === d || host.endsWith(`.${d}`));
  return open ? null : homeUrl('www.youtube.com');
}
