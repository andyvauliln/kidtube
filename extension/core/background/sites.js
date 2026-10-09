// Other websites: blocked before they load (declarativeNetRequest), or sent back to his list where the
// browser has no blocking rules (Orion).
import { TARGET } from '../lib/target.js';
import { homeUrl } from '../lib/youtube.js';
import { SITE_RULE_ID } from './constants.js';
import { effective, parentMode } from './store.js';

let dnrWorks;

// Every top-level page outside allowedSiteDomains is blocked (PLAN.md C16).
// Where the header shows (the unlocked apps header, parent mode), all of google.com stays open: its Switch and Sign in
// can pass through www.google.com or gds.google.com ("make sure you can sign in"), and a blocked step is a dead page.
export const allowedDomains = (config, signingIn = false) =>
  [...new Set([...(config.allowedSiteDomains ?? []), 'youtube.com', 'andyvauliln.github.io', ...(signingIn ? ['google.com'] : [])])];
const signingIn = (s) => (s.shell?.on ? !s.shell.locked : parentMode(s));

async function rulesInput() {
  const s = await chrome.storage.local.get(['data', 'localConfig', 'shell', 'settings']);
  const { config } = await effective({ data: s.data ?? {}, localConfig: s.localConfig });
  return { config, signingIn: signingIn(s) };
}

export async function applySiteRules() {
  // Orion has no blocking rules (its build drops the permission): externalGuard does the job there.
  if (TARGET === 'orion') { dnrWorks = false; return; }
  const { config, signingIn } = await rulesInput();
  // YouTube and the install page always stay reachable, whatever the list says.
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [SITE_RULE_ID],
      addRules: config.blockOutboundLinks ? [{
        id: SITE_RULE_ID, priority: 1, action: { type: 'block' },
        condition: { resourceTypes: ['main_frame'], excludedRequestDomains: allowedDomains(config, signingIn) },
      }] : [],
    });
    dnrWorks = true;
  } catch {
    dnrWorks = false;   // Orion (WebKit) has no dynamic rules: the navigation guard sends other sites home instead
  }
  await chrome.storage.local.set({ dnrWorks });
}

// Browsers without dynamic blocking rules (Orion): a page outside the allowed sites goes back to his list.
// Returns the URL to send the tab to, or null to let it be.
export async function externalGuard(host) {
  if (TARGET !== 'orion') {
    dnrWorks ??= (await chrome.storage.local.get('dnrWorks')).dnrWorks ?? !!chrome.declarativeNetRequest?.updateDynamicRules;
    if (dnrWorks) return null;
  }
  const { config, signingIn } = await rulesInput();
  if (!config.blockOutboundLinks) return null;
  const allowed = allowedDomains(config, signingIn).some((d) => host === d || host.endsWith(`.${d}`));
  return allowed ? null : homeUrl('www.youtube.com');
}
