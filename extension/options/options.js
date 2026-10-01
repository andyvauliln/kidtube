const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

// --- PIN: PBKDF2 hash with a salt, 5 wrong tries = 1 minute wait (PLAN.md C22) -------------

async function hashPin(pin, saltB64) {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

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
  const s = await getSettings();
  if (s.pinLockedUntil && Date.now() < s.pinLockedUntil) {
    return ($('pinErr').textContent = `Too many tries. Wait ${Math.ceil((s.pinLockedUntil - Date.now()) / 1000)} s.`);
  }
  if ((await hashPin(pin, s.pinSalt)) === s.pinHash) {
    await patchSettings({ pinFails: 0, pinLockedUntil: 0 });
    return unlock();
  }
  const fails = (s.pinFails ?? 0) + 1;
  await patchSettings({ pinFails: fails, pinLockedUntil: fails >= 5 ? Date.now() + 60000 : 0 });
  $('pin').value = '';
  $('pinErr').textContent = fails >= 5 ? 'Too many tries. Wait 1 minute.' : 'Wrong PIN.';
});
$('pin').addEventListener('keydown', (e) => e.key === 'Enter' && !settingPin && $('pinGo').click());

async function unlock() {
  $('gate').hidden = true;
  $('app').hidden = false;
  const s = await getSettings();
  $('repo').value = s.repo ?? '';
  $('token').value = s.token ?? '';
  await renderStatus();
}

// --- app ----------------------------------------------------------------------------------

async function renderStatus() {
  const st = await send({ type: 'status' });
  const rows = [
    ['Version', st.version],
    ['Videos he can open', `${st.visible} (${st.queueSource})`],
    ['Watched today', `${st.playedMinutesToday} of ${st.maxMinutesPerDay || '∞'} min`],
    ['Data repo', `${st.repo}${st.hasToken ? '' : ' · no token yet'}`],
    ['Last sync', st.sync?.at ? new Date(st.sync.at).toLocaleString() : 'never'],
    ['List updated', st.queueUpdatedAt ? new Date(st.queueUpdatedAt).toLocaleString() : '—'],
    ['Waiting to upload', `${st.outbox} events`],
  ];
  $('status').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', k), el('dd', v)]));
  for (const e of st.sync?.errors ?? []) $('status').append(el('dt', 'Problem'), el('dd', e, 'err'));

  $('recent').replaceChildren(...(st.recent.length ? st.recent.map(row) : [el('p', 'Nothing yet.', 'muted')]));
}

function row(r) {
  const d = el('div', '', 'row');
  d.append(el('div', r.title), el('div', new Date(r.at).toLocaleString(), 'muted'));
  const up = el('button', '👍'), down = el('button', '👎'), say = el('button', 'Comment');
  up.onclick = () => note(r.videoId, { liked: true }, d);
  down.onclick = () => note(r.videoId, { liked: false }, d);
  say.onclick = () => {
    const text = prompt(`Comment for the agent about “${r.title}”`);
    if (text) note(r.videoId, { comment: text }, d);
  };
  d.append(up, down, say);
  return d;
}

async function note(videoId, fields, rowEl) {
  await send({ type: 'note', videoId, ...fields });
  rowEl.append(el('div', 'Saved ✓', 'ok'));
}

function el(tag, text, cls) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

$('update').addEventListener('click', async () => {
  $('update').disabled = true;
  $('updateOut').textContent = 'Checking…';
  try {
    const r = await send({ type: 'checkUpdate' });
    const parts = [`Installed ${r.installed}`];
    if (r.latest) parts.push(`newest ${r.latest}`);
    if (r.check?.status === 'update_available') parts.push('downloading the new version, the app will restart');
    parts.push(r.sync?.errors?.length ? `sync problem: ${r.sync.errors.join('; ')}` : 'video list and rules are up to date');
    $('updateOut').textContent = parts.join(' · ');
    $('install').hidden = !r.installPage;
    if (r.installPage) $('install').href = r.installPage;
  } finally {
    $('update').disabled = false;
    renderStatus();
  }
});

$('save').addEventListener('click', async () => {
  await patchSettings({ repo: $('repo').value.trim(), token: $('token').value.trim() });
  $('saveOut').textContent = 'Saved. Syncing…';
  const r = await send({ type: 'sync' });
  $('saveOut').textContent = r?.errors?.length ? `Saved, but: ${r.errors.join('; ')}` : 'Saved and synced ✓';
  renderStatus();
});

$('resetToday').addEventListener('click', async () => { await send({ type: 'resetToday' }); renderStatus(); });

$('changePin').addEventListener('click', async () => {
  await patchSettings({ pinHash: null });
  $('app').hidden = true;
  $('gate').hidden = false;
  $('pin').value = $('pin2').value = '';
  initGate();
});

initGate();
