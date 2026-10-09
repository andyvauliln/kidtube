// Parent PIN: PBKDF2 hash with a salt, 5 wrong tries = 1 minute wait (PLAN.md C22).
export async function hashPin(pin, saltB64) {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function getSettings() {
  return (await chrome.storage.local.get('settings')).settings ?? {};
}
async function patchSettings(patch) {
  await chrome.storage.local.set({ settings: { ...(await getSettings()), ...patch } });
}

// Returns { ok } or { ok:false, error } in plain words.
export async function checkPin(pin) {
  const s = await getSettings();
  if (!s.pinHash) return { ok: false, error: 'No parent PIN is set yet.' };
  if (s.pinLockedUntil && Date.now() < s.pinLockedUntil) {
    return { ok: false, error: `Too many tries. Wait ${Math.ceil((s.pinLockedUntil - Date.now()) / 1000)} s.` };
  }
  if ((await hashPin(pin, s.pinSalt)) === s.pinHash) {
    await patchSettings({ pinFails: 0, pinLockedUntil: 0 });
    return { ok: true };
  }
  const fails = (s.pinFails ?? 0) + 1;
  await patchSettings({ pinFails: fails, pinLockedUntil: fails >= 5 ? Date.now() + 60000 : 0 });
  return { ok: false, error: fails >= 5 ? 'Too many tries. Wait 1 minute.' : 'Wrong PIN.' };
}
