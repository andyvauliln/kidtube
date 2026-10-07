// The apps page: the way back to the apps header on YouTube (from an app, or when YouTube is locked) and the one
// GitHub connection for every account and app. The PIN opens it, except in parent mode or at the unlocked header.
// The header itself (content.js) signs in, and opens or creates the signed-in account's apps.
import { ask } from '../lib/ask.js';
import { hashPin, checkPin } from '../lib/pin.js';

const $ = (id) => document.getElementById(id);
const getSettings = async () => (await chrome.storage.local.get('settings')).settings ?? {};
const patchSettings = async (patch) => chrome.storage.local.set({ settings: { ...(await getSettings()), ...patch } });

let choosing = false;
async function start() {
  const [settings, a] = [await getSettings(), await ask({ type: 'apps' })];
  if (a?.ok && (a.parentMode || (a.shell.on && !a.shell.locked)) && settings.pinHash) return show(a);
  choosing = !settings.pinHash;   // no PIN yet: choose one first, so the kid can't leave his app
  $('gateTitle').textContent = choosing ? 'Choose a parent PIN (4–8 digits)' : 'Enter PIN';
  $('pin2').hidden = !choosing;
  $('gate').hidden = false;
  $('pin').focus();
}
$('pinGo').addEventListener('click', async () => {
  const pin = $('pin').value.trim();
  $('pinErr').textContent = '';
  if (choosing) {
    if (!/^\d{4,8}$/.test(pin)) return ($('pinErr').textContent = 'Use 4 to 8 digits.');
    if (pin !== $('pin2').value.trim()) return ($('pinErr').textContent = 'The two PINs are different.');
    const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    await patchSettings({ pinSalt: salt, pinHash: await hashPin(pin, salt), pinFails: 0 });
  } else {
    const r = await checkPin(pin);
    $('pin').value = '';
    if (!r.ok) return ($('pinErr').textContent = r.error);
  }
  $('gate').hidden = true;
  show(await ask({ type: 'apps' }));
});
$('pin').addEventListener('keydown', (e) => e.key === 'Enter' && !choosing && $('pinGo').click());

async function show(a) {
  if (!a?.ok) { $('now').textContent = 'KidTube’s background did not answer. Close this page and open it again.'; }
  else $('now').textContent = a.running ? `Running: ${a.running.app}${a.running.email ? ` for ${a.running.email}` : ''}. The header stops it; YouTube is then open until you open an app again.`
    : a.shell.locked ? `Locked: ${a.shell.why ?? ''}` : 'No app is running: YouTube shows the apps header.';
  const s = await getSettings();
  $('repo').value = s.repo ?? '';
  $('token').placeholder = s.token ? 'saved (type a new one to change it)' : 'github_pat_…';
  $('main').hidden = false;
  if (location.hash === '#github') $(s.token ? 'repo' : 'token').focus();
}

$('leave').addEventListener('click', async () => {
  const r = await ask({ type: 'leaveApp' });
  if (r?.ok) location.href = r.open;
});

$('save').addEventListener('click', async () => {
  const token = $('token').value.trim();
  await patchSettings({ repo: $('repo').value.trim(), ...(token ? { token } : {}) });
  $('token').value = '';
  $('saveOut').className = 'muted';
  $('saveOut').textContent = 'Checking…';
  const r = await ask({ type: 'checkRepo' });
  $('saveOut').className = r?.ok ? 'ok' : 'err';
  $('saveOut').textContent = r?.ok ? `Connected ✓ (${r.profiles} account folder${r.profiles === 1 ? '' : 's'} with a profile.json). Now: ⬆ Show the apps header.` : r?.error ?? 'Could not check it.';
  show(await ask({ type: 'apps' }));
});

start();
window.kidtubeParentReady = true;   // boot.js: the script ran
