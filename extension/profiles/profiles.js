// Profiles & apps: the one switcher above all apps (KidTube, the Blank test app, later others). Reached from
// the 👤 in KidTube's parent screens, from Settings and from an app's own page. Parent mode or the PIN opens it.
// A profile is one email in one app (the same email can be in several apps). A switch goes on at once, then
// YouTube opens with KidTube out of the way until it is signed in to the profile's email; then the app takes over.
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

// Where the profile's app is: YouTube (KidTube decides there what it shows, or steps aside to sign in), or the app's own page.
const openApp = (r) => { location.href = r.open ?? 'https://m.youtube.com/'; };

async function show() {
  const p = await ask({ type: 'profiles' });
  if (!p?.ok) { list.replaceChildren(el('p', 'err', 'KidTube’s background did not answer. Close this page and open it again.')); return; }
  const appLabel = (id) => p.apps.find((a) => a.id === id)?.label ?? id;
  const go = async (msg, out) => {
    out.textContent = '';
    const r = await ask(msg);
    if (!r?.ok) { out.textContent = r?.error ?? 'That didn’t work. Try again.'; return; }
    if (r.open) {
      if (r.existed && msg.type === 'addProfile') { toast('That profile was already here: switching to it.'); await new Promise((ok) => setTimeout(ok, 1200)); }
      return openApp(r);
    }
    toast('Switched.');
    show();
  };

  const rows = p.profiles.map((pr) => {
    const me = pr.key === p.current;
    const row = el('div', `box profile${me ? ' current' : ''}`);
    const out = el('p', 'err');
    row.append(el('h3', '', `${me ? '✓ ' : ''}${pr.email || pr.name || pr.key} · ${appLabel(pr.app).replace(/ \(.*/, '')}`),
      el('p', 'muted', `App: ${appLabel(pr.app)} · data folder ${pr.app}/${pr.folder ?? '(given on the first sync)'}${pr.lastSeen ? ` · last used ${new Date(pr.lastSeen).toLocaleDateString()}` : ''}`));
    const actions = el('div', 'actions');
    if (me) {
      const has = p.youtubeHas === undefined ? 'YouTube hasn’t been opened yet.' : p.youtubeHas ? `YouTube now: ${p.youtubeHas}.` : 'YouTube is not signed in.';
      if (p.waitingFor === pr.key) {
        row.append(el('p', 'wait', `Waiting for YouTube to sign in to ${pr.email}.`),
          el('p', 'muted', `${has} On YouTube, KidTube steps aside until then: use YouTube’s own Sign in or account switch, or the “Sign in as …” button at the bottom. The app comes back by itself.`));
        actions.append(btn('Open YouTube to sign in', () => openApp({ open: p.youtube }), 'primary'));
      } else if (p.needsSignIn) {
        row.append(el('p', 'wait', `${has} This profile is ${pr.email}.`));
        actions.append(btn(`Sign in to YouTube as ${pr.email}`, () => go({ type: 'startSignIn' }, out), 'primary'));
      } else row.append(el('p', 'muted', 'Current profile.'));
      actions.append(btn(`Open ${appLabel(pr.app).replace(/ \(.*/, '')}`, () => openApp({ open: p.currentPage })));
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
    el('p', 'muted', 'A new profile starts empty. The same email can have a profile in each app. After a switch YouTube opens without KidTube until it is signed in to this email; then the app starts.'),
    label('Email (the Google account)', 'newEmail'), email, label('App', 'newApp'), app, actions, out);
  list.replaceChildren(...(rows.length ? rows : [el('p', 'muted', 'No profile yet: add one below, or open YouTube once signed in.')]), add);
}

start();
window.kidtubeParentReady = true;   // boot.js: the script ran
