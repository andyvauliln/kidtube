// The settings page outside the parent screens (the extension's options, the ⚙️ on his screens):
// asks for the PIN (or to choose one), then shows the settings view (settings/settings.js).
import { hashPin, checkPin } from '../lib/pin.js';
import { mountSettings } from '../settings/settings.js';

const $ = (id) => document.getElementById(id);

async function getSettings() {
  return (await chrome.storage.local.get('settings')).settings ?? {};
}
async function patchSettings(patch) {
  const settings = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings });
}

let settingPin = false;

async function initGate() {
  const s = await getSettings();
  settingPin = !s.pinHash;
  $('gateTitle').textContent = settingPin ? 'Choose a parent PIN (4–8 digits)' : 'Enter PIN';
  $('pin2').hidden = !settingPin;
  $('pin').focus();
}

$('pinGo').addEventListener('click', async () => {
  const pin = $('pin').value.trim();
  $('pinErr').textContent = '';
  if (settingPin) {
    if (!/^\d{4,8}$/.test(pin)) return ($('pinErr').textContent = 'Use 4 to 8 digits.');
    if (pin !== $('pin2').value.trim()) return ($('pinErr').textContent = 'The two PINs are different.');
    const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    await patchSettings({ pinSalt: salt, pinHash: await hashPin(pin, salt), pinFails: 0 });
    return unlock();
  }
  const r = await checkPin(pin);
  if (r.ok) return unlock();
  $('pin').value = '';
  $('pinErr').textContent = r.error;
});
$('pin').addEventListener('keydown', (e) => e.key === 'Enter' && !settingPin && $('pinGo').click());

function unlock() {
  $('gate').hidden = true;
  $('app').hidden = false;
  mountSettings($('app'));
}

initGate();
