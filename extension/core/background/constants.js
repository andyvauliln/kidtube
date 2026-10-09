// Names and numbers the service worker's modules share.
import { TARGET } from '../lib/target.js';

export const SITE_RULE_ID = 100;          // the one dynamic blocking rule (sites.js)
export const POLL_MINUTES = 15;           // GitHub sync and update check
export const DEFAULT_REPO = 'andyvauliln/kidtube-data';
export const PAGES_URL = 'https://andyvauliln.github.io/kidtube/';
// Each build has its own release: Orion's lives under orion/ and is updated only when asked (build/build-orion.mjs).
export const LATEST_URL = TARGET === 'orion' ? `${PAGES_URL}orion/latest.json` : `${PAGES_URL}latest.json`;
export const INSTALL_PAGE = TARGET === 'orion' ? `${PAGES_URL}#orion` : PAGES_URL;

export const PIN_PAGE = 'core/pages/pin.html';

// Settings that belong to the tablet, not to a profile: they move along with every profile switch.
export const DEVICE_SETTINGS = ['pinHash', 'pinSalt', 'pinFails', 'pinLockedUntil', 'deviceId', 'mode', 'parentUntil', 'repo', 'token'];
// The settings file (the header's Save / Load) and the copy on the install page: the connection and the PIN.
export const BACKUP_KEYS = ['repo', 'token', 'pinSalt', 'pinHash'];
