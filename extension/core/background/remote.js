// site/remote.json on GitHub Pages: values that change outside KidTube (an app's rules for a site), read without a
// new version. Only data, never code: each app checks its own part and keeps its defaults for anything wrong
// (Instagram: apps/instagram/lib/rules.js). Kept in storage "remote"; read again when it is 30 minutes old.
import { PAGES_URL } from './constants.js';

const REMOTE_URL = `${PAGES_URL}remote.json`;
const MAX_AGE = 30 * 60000;
let reading = null;

// The file's JSON ({} when it was never read). fresh: read it now.
export async function remoteData({ fresh = false } = {}) {
  const { remote } = await chrome.storage.local.get('remote');
  if (!fresh && remote?.at && Date.now() - Date.parse(remote.at) < MAX_AGE) return remote.data ?? {};
  reading ??= (async () => {
    const at = new Date().toISOString();
    try {
      const r = await fetch(REMOTE_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error(`remote.json: ${r.status}`);
      const j = await r.json();
      if (j?.schemaVersion !== 1) throw new Error('remote.json: not schemaVersion 1');
      await chrome.storage.local.set({ remote: { at, data: j } });
      return j;
    } catch (e) {
      // Kept as it was (or nothing); asked again in 30 minutes.
      await chrome.storage.local.set({ remote: { at, data: remote?.data ?? {}, error: String(e.message ?? e).slice(0, 200) } });
      return remote?.data ?? {};
    }
  })().finally(() => { reading = null; });
  return reading;
}
