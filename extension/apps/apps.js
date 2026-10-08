// The one PIN page. ?for= says what the PIN opens:
//   parent   — parent mode (the kid's 🔒 Parent, an app page's Parent switch), then the app's home
//   unlock   — YouTube locked after an account change: back to the apps header
//   kid      — the first PIN, chosen before kid mode, then kid mode
//   settings — the extension's options page: parent mode, then the Settings tab
// No PIN yet: it asks to choose one first, so the kid can't leave his app.
import { ask } from '../lib/ask.js';
import { hashPin, checkPin } from '../lib/pin.js';

const $ = (id) => document.getElementById(id);
const purpose = new URLSearchParams(location.search).get('for') ?? 'parent';
const TEXT = {
  parent: ['Parent mode', 'Enter the parent PIN.'],
  unlock: ['Unlock YouTube', 'Enter the parent PIN to open the apps header.'],
  kid: ['Kid mode', 'Choose a parent PIN first: it is the way back to parent mode.'],
  settings: ['Settings', 'Enter the parent PIN.'],
};
const getSettings = async () => (await chrome.storage.local.get('settings')).settings ?? {};

let choosing = false;
async function start() {
  const s = await getSettings();
  const a = await ask({ type: 'apps' });
  // Already open: parent mode on, or the header not locked.
  if (s.pinHash && a?.ok && ((purpose === 'parent' || purpose === 'settings') ? a.parentMode : purpose === 'unlock' ? !a.shell.locked : false)) return done();
  if (s.pinHash && purpose === 'kid') return done();
  choosing = !s.pinHash;
  const [title, lead] = TEXT[purpose] ?? TEXT.parent;
  $('title').textContent = choosing && purpose !== 'kid' ? 'Choose a parent PIN' : title;
  $('lead').textContent = choosing ? (purpose === 'kid' ? lead : '4 to 8 digits. The same PIN works for every account and app on this tablet.') : lead;
  $('pin').placeholder = choosing ? '4–8 digits' : '';
  $('pin2').hidden = !choosing;
  $('form').hidden = false;
  $('pin').focus();
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = $('pin').value.trim();
  const err = $('err');
  err.textContent = '';
  $('go').disabled = true;
  try {
    if (choosing) {
      if (!/^\d{4,8}$/.test(pin)) { err.textContent = 'Use 4 to 8 digits.'; return; }
      if (pin !== $('pin2').value.trim()) { err.textContent = 'The two PINs are different.'; return; }
      const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
      await chrome.storage.local.set({ settings: { ...(await getSettings()), pinSalt: salt, pinHash: await hashPin(pin, salt), pinFails: 0 } });
    } else {
      const r = await checkPin(pin);
      $('pin').value = '';
      if (!r.ok) { err.textContent = r.error; return; }
    }
    await done();
  } catch (x) {
    err.textContent = `It didn’t work: ${x?.message ?? x}`;
  } finally {
    $('go').disabled = false;
  }
});

// The PIN is right (or not needed): do what this page was opened for.
async function done() {
  const err = $('err');
  if (purpose === 'kid') return ask({ type: 'kidHome' });
  if (purpose === 'unlock') {
    const r = await ask({ type: 'leaveApp' });
    if (r?.ok) location.href = r.open;
    else err.textContent = 'KidTube’s background did not answer. Close this page and open it again.';
    return;
  }
  const r = await ask({ type: 'setMode', mode: 'parent' });
  if (!r?.ok) { err.textContent = `It could not turn on parent mode: ${r?.error ?? 'KidTube’s background did not answer'}`; return; }
  if (purpose === 'settings') { location.href = '../parent/parent.html#settings'; return; }
  location.href = (await ask({ type: 'apps' }))?.home ?? 'https://m.youtube.com/';
}

start();
window.kidtubeParentReady = true;   // boot.js: the script ran
