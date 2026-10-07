// Profiles & apps: the one switcher above all apps (KidTube, the Blank test app, later others). Reached from
// the 👤 in KidTube's parent screens, from Settings and from an app's own page. Parent mode or the PIN opens it.
// A switch goes on at once: to Google's sign-in for the profile's email (an app on YouTube), or to the app's page.
import { ask } from '../lib/ask.js';
import { checkPin } from '../lib/pin.js';
import { el, btn, toast } from '../parent/kit.js';

const $ = (id) => document.getElementById(id);
const list = $('list');

async function start() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (settings.mode === 'parent' || !settings.pinHash) return show();   // no PIN yet: nothing to guard (Settings asks to choose one)
  $('gate').hidden = false;
  $('pin').focus();
}
$('pinGo').addEventListener('click', async () => {
  const r = await checkPin($('pin').value.trim());
  $('pin').value = '';
  if (!r.ok) { $('pinErr').textContent = r.error; return; }
  $('gate').hidden = true;
  show();
});
$('pin').addEventListener('keydown', (e) => e.key === 'Enter' && $('pinGo').click());

// Where the profile's app is: YouTube (KidTube decides there what it shows), or the app's own page.
const openApp = (r) => { location.href = r.open ?? r.chooser ?? 'https://m.youtube.com/'; };

async function show() {
  const p = await ask({ type: 'profiles' });
  if (!p?.ok) { list.replaceChildren(el('p', 'err', 'KidTube’s background did not answer. Close this page and open it again.')); return; }
  const appLabel = (id) => p.apps.find((a) => a.id === id)?.label ?? id;
  const go = async (msg, out) => {
    out.textContent = '';
    const r = await ask(msg);
    if (!r?.ok) { out.textContent = r?.error ?? 'That didn’t work. Try again.'; return; }
    if (r.chooser || r.open) return openApp(r);
    toast('Switched.');
    show();
  };

  const rows = p.profiles.map((pr) => {
    const me = pr.key === p.current;
    const row = el('div', `box profile${me ? ' current' : ''}`);
    const out = el('p', 'err');
    row.append(el('h3', '', `${me ? '✓ ' : ''}${pr.email || pr.name || pr.key}`),
      el('p', 'muted', `App: ${appLabel(pr.app)} · data folder ${pr.app}/${pr.folder ?? '(given on the first sync)'}${pr.lastSeen ? ` · last used ${new Date(pr.lastSeen).toLocaleDateString()}` : ''}`));
    const actions = el('div', 'actions');
    if (me) {
      if (p.waitingFor === pr.key) {
        row.append(el('p', 'wait', `Waiting for YouTube to sign in to ${pr.email}.`),
          el('p', 'muted', p.youtubeHas ? `YouTube still shows ${p.youtubeHas}. Sign in again and pick ${pr.email}; if Google doesn’t offer it, choose “Use another account”.` : 'Pick this email when Google asks. If YouTube still shows another account, sign in again.'));
        if (p.signIn) actions.append(btn('Sign in to YouTube again', () => { location.href = p.signIn; }, 'primary'));
      } else row.append(el('p', 'muted', 'Current profile.'));
      actions.append(btn(`Open ${appLabel(pr.app)}`, () => openApp({ open: p.currentPage })));
    } else {
      actions.append(btn('Switch to this profile', () => go({ type: 'switchProfile', key: pr.key }, out), 'primary'), btn('Remove from this tablet', async () => {
        if (!confirm(`Remove ${pr.email || pr.key} from this tablet? Its lists and settings here are deleted. Its folder in the data repo stays.`)) return;
        const r = await ask({ type: 'removeProfile', key: pr.key });
        if (!r?.ok) { out.textContent = r?.error ?? 'Could not remove it.'; return; }
        show();
      }, 'ghost'));
    }
    row.append(actions, out);
    return row;
  });

  const add = el('div', 'box');
  const email = el('input');
  Object.assign(email, { type: 'email', id: 'newEmail', placeholder: 'child@gmail.com', autocomplete: 'off', autocapitalize: 'off' });
  const app = el('select');
  app.id = 'newApp';
  for (const a of p.apps) { const o = el('option', '', a.label); o.value = a.id; app.append(o); }
  const label = (text, forId) => { const l = el('label', '', text); l.htmlFor = forId; return l; };
  const out = el('p', 'err');
  const actions = el('div', 'actions');
  actions.append(btn('Add and switch', () => go({ type: 'addProfile', email: email.value, app: app.value }, out), 'primary'));
  add.append(el('h3', '', 'Add a profile'),
    el('p', 'muted', 'A new profile starts empty. For an app on YouTube, Google then signs in this email, so YouTube uses that account.'),
    label('Email (the Google account)', 'newEmail'), email, label('App', 'newApp'), app, actions, out);
  list.replaceChildren(...(rows.length ? rows : [el('p', 'muted', 'No profile yet: add one below, or open YouTube once signed in.')]), add);
}

start();
window.kidtubeParentReady = true;   // boot.js: the script ran
