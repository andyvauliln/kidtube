import { hashPin, checkPin } from '../lib/pin.js';
import { say, listen, recordAnswer, transcribeAnswer } from '../ui/voice.js';
import { ask as send } from '../lib/ask.js';

const $ = (id) => document.getElementById(id);

async function getSettings() {
  return (await chrome.storage.local.get('settings')).settings ?? {};
}
async function patchSettings(patch) {
  const settings = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings });
}

let settingPin = false;

// Inside the parent screens (Settings tab): parent mode already asked for the PIN.
const embedded = new URLSearchParams(location.search).has('embedded');
if (embedded) {
  document.body.classList.add('embedded');
  const report = () => parent.postMessage({ kidtube: 'options-size', height: document.documentElement.scrollHeight }, '*');
  new ResizeObserver(report).observe(document.body);
  addEventListener('load', report);
}

async function initGate() {
  const s = await getSettings();
  if (embedded && s.mode === 'parent' && (!s.parentUntil || s.parentUntil > Date.now()) && s.pinHash) return unlock();
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

async function unlock() {
  $('gate').hidden = true;
  $('app').hidden = false;
  const s = await getSettings();
  $('repo').value = s.repo ?? '';
  $('token').value = s.token ?? '';
  await Promise.all([renderStatus(), renderRules(), renderMode()]);
}

// --- mode and account ------------------------------------------------------------------------

async function renderMode() {
  const { settings: s = {}, account } = await chrome.storage.local.get(['settings', 'account']);
  const on = s.mode === 'parent' && (!s.parentUntil || s.parentUntil > Date.now());
  for (const r of document.querySelectorAll('input[name=mode]')) r.checked = r.value === (on ? 'parent' : 'kid');
  $('parentMinutes').value = s.parentMinutes ?? 60;
  $('account').textContent = account
    ? `YouTube account: ${account.email || account.name || account.key}. Every setting on this page, the lists and the history belong to this account; another account has its own. The PIN is the same for all.`
    : 'No YouTube account seen yet: open YouTube once. Settings are kept per YouTube account.';
  $('modeOut').textContent = on && s.parentUntil ? `Parent mode is on until ${new Date(s.parentUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : '';
}

async function saveMode() {
  const n = Number($('parentMinutes').value);
  if (!Number.isFinite(n) || n < 0 || n > 1440) { $('modeOut').textContent = 'Minutes: use a number from 0 to 1440.'; return null; }
  await patchSettings({ parentMinutes: Math.round(n) });
  const mode = document.querySelector('input[name=mode]:checked')?.value ?? 'kid';
  await send({ type: 'setMode', mode });
  await renderMode();
  return mode;
}
$('saveMode').addEventListener('click', async () => {
  const mode = await saveMode();
  if (mode) $('modeOut').textContent = mode === 'parent' ? `${$('modeOut').textContent} Open YouTube to see your screens.` : 'Kid mode: YouTube shows his list.';
});
$('openParent').addEventListener('click', async () => {
  document.querySelector('input[name=mode][value=parent]').checked = true;
  if (await saveMode()) location.href = '../parent/parent.html';
});

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
    ['Transcripts on GitHub', `${st.transcripts.uploaded} of ${st.transcripts.total} videos${st.transcripts.missing ? ` (${st.transcripts.missing} without captions)` : ''}`],
  ];
  $('status').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', k), el('dd', v)]));
  for (const e of st.sync?.errors ?? []) $('status').append(el('dt', 'Problem'), el('dd', e, 'err'));
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
    if (r.check?.status === 'manual' && r.installPage) parts.push('install the new .zip by hand (link below)');
    parts.push(r.sync?.errors?.length ? `sync problem: ${r.sync.errors.join('; ')}` : 'video list and rules are up to date');
    $('updateOut').textContent = parts.join(' · ');
    $('install').hidden = !r.installPage;
    if (r.installPage) $('install').href = r.download ?? r.installPage;
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

// --- Rules (parent-config.json) -------------------------------------------------------------

const DAY_NAMES = [['mon', 'Mo'], ['tue', 'Tu'], ['wed', 'We'], ['thu', 'Th'], ['fri', 'Fr'], ['sat', 'Sa'], ['sun', 'Su']];

function windowEditor(w = { days: DAY_NAMES.map(([d]) => d), from: '16:00', to: '18:30' }) {
  const box = el('div', '', 'win');
  const days = el('div', '', 'days');
  for (const [d, label] of DAY_NAMES) {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = d; cb.checked = w.days.includes(d);
    l.append(cb, label);
    days.append(l);
  }
  const times = el('div', '', 'two');
  const from = Object.assign(document.createElement('input'), { type: 'time', value: w.from, className: 'from' });
  const to = Object.assign(document.createElement('input'), { type: 'time', value: w.to, className: 'to' });
  times.append(from, to);
  const del = el('button', 'Remove');
  del.onclick = () => box.remove();
  box.append(days, times, del);
  return box;
}

async function renderRules() {
  const { config: c, pending } = await send({ type: 'getRules' });
  $('windows').replaceChildren(...(c.time?.allowed ?? []).map(windowEditor));
  $('maxMinutes').value = c.time?.maxMinutesPerDay ?? 0;
  $('queueSize').value = c.queueSize ?? 10;
  $('minLeave').value = c.minSecondsBeforeLeave ?? 0;
  $('closeAfter').value = c.closeAfterSeconds ?? 0;
  $('minLen').value = (c.minVideoDurationSeconds ?? 0) / 60;
  $('maxLen').value = (c.maxVideoDurationSeconds ?? 0) / 60;
  $('requiredFirst').value = c.requiredFirst ?? 'first';
  $('allowSkip').checked = !!c.allowSkip;
  $('blockSites').checked = !!c.blockOutboundLinks;
  $('sites').value = (c.allowedSiteDomains ?? []).join('\n');
  $('channels').value = (c.blockedChannelIds ?? []).join('\n');
  const p = c.presenter ?? {};
  $('intro').checked = !!p.intro;
  $('outro').checked = !!p.outro;
  $('quizOn').checked = !!c.quiz?.enabled;
  $('onFail').value = c.quiz?.onFail ?? 'continue';
  $('maxAttempts').value = c.quiz?.maxAttempts ?? 3;
  $('attemptsLabel').textContent = $('maxAttempts').value;
  $('friendName').value = p.name ?? 'Zippy';
  $('pitch').value = p.voice?.pitch ?? 1.9;
  $('friendImage').value = p.imageUrl ?? '';
  $('catchphrase').value = p.catchphrase ?? '';
  $('recorded').checked = p.voice?.recorded !== false;
  $('listenProvider').value = p.voice?.listen?.provider ?? 'device';
  $('listenModels').value = (p.voice?.listen?.models ?? ['openai/gpt-audio-mini']).join('\n');
  $('cloudListen').hidden = $('listenProvider').value !== 'openrouter';
  chrome.storage.local.get('voiceKey').then(({ voiceKey }) => { $('voiceKey').value = voiceKey ?? ''; });
  voiceLang = p.voice?.lang || 'en-US';
  $('rulesOut').textContent = pending ? 'Some rules are saved on this tablet only and will go to GitHub on the next sync.' : '';
}

$('addWindow').addEventListener('click', () => $('windows').append(windowEditor()));

function readRules() {
  const errors = [];
  const allowed = [...$('windows').querySelectorAll('.win')].map((w, i) => {
    const days = [...w.querySelectorAll('.days input:checked')].map((x) => x.value);
    const from = w.querySelector('.from').value, to = w.querySelector('.to').value;
    if (!days.length) errors.push(`Hours #${i + 1}: pick at least one day.`);
    if (!from || !to || from >= to) errors.push(`Hours #${i + 1}: the start must be before the end (no hours past midnight).`);
    return { days, from, to };
  });
  if (!allowed.length) errors.push('Add at least one block of watching hours, or he can never watch.');
  const int = (id, min, max) => {
    const n = Number($(id).value);
    if (!Number.isFinite(n) || n < min || n > max) errors.push(`${$(id).labels[0].textContent}: use a number from ${min} to ${max}.`);
    return Math.round(n);
  };
  const domain = (line) => line.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '');
  const sites = [...new Set($('sites').value.split(/[\s,]+/).map(domain).filter(Boolean))];
  for (const d of sites) if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) errors.push(`Website “${d}” doesn't look like a site name (example: wikipedia.org).`);
  const channels = [...new Set($('channels').value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];
  for (const ch of channels) if (!/^UC[A-Za-z0-9_-]{22}$/.test(ch)) errors.push(`Channel “${ch}” is not a channel id (24 characters starting with UC).`);
  const patch = {
    time: { allowed, maxMinutesPerDay: int('maxMinutes', 0, 1440) },
    queueSize: int('queueSize', 1, 30),
    minSecondsBeforeLeave: int('minLeave', 0, 3600),
    closeAfterSeconds: int('closeAfter', 0, 86400),
    minVideoDurationSeconds: Math.round(Number($('minLen').value) * 60) || 0,
    maxVideoDurationSeconds: Math.round(Number($('maxLen').value) * 60) || 0,
    requiredFirst: $('requiredFirst').value,
    allowSkip: $('allowSkip').checked,
    blockOutboundLinks: $('blockSites').checked,
    allowedSiteDomains: sites.length ? sites : ['youtube.com'],
    blockedChannelIds: channels,
    presenter: {
      intro: $('intro').checked, outro: $('outro').checked,
      name: $('friendName').value.trim() || 'Zippy',
      imageUrl: $('friendImage').value.trim(),
      catchphrase: $('catchphrase').value.trim(),
      voice: { pitch: Number($('pitch').value), recorded: $('recorded').checked,
        listen: { provider: $('listenProvider').value, models: listenModels() } },
    },
    quiz: { enabled: $('quizOn').checked, onFail: $('onFail').value, maxAttempts: int('maxAttempts', 1, 10) },
  };
  if (patch.presenter.imageUrl && !/^(https:\/\/\S+|repo:[A-Za-z0-9_./-]+\.(svg|png|jpg|jpeg|webp|gif))$/.test(patch.presenter.imageUrl)) {
    errors.push('The picture must be a link starting with https:// or a repo file like repo:characters/friend.svg');
  }
  if (patch.maxVideoDurationSeconds && patch.minVideoDurationSeconds > patch.maxVideoDurationSeconds) errors.push('The shortest video is longer than the longest.');
  return { patch, errors };
}

$('saveRules').addEventListener('click', async () => {
  const { patch, errors } = readRules();
  if (errors.length) { $('rulesOut').className = 'err'; $('rulesOut').textContent = errors.join(' '); return; }
  $('saveRules').disabled = true;
  $('rulesOut').className = 'muted';
  $('rulesOut').textContent = 'Saving…';
  try {
    const r = await send({ type: 'saveRules', patch });
    $('rulesOut').className = r.saved === 'github' ? 'ok' : 'muted';
    $('rulesOut').textContent = r.saved === 'github' ? 'Saved on the tablet and on GitHub ✓' : `Working on this tablet now. ${r.error ?? ''}`;
  } finally {
    $('saveRules').disabled = false;
    renderStatus();
  }
});

// --- Talking friend: try the voice and the microphone ------------------------------------------

let voiceLang = 'en-US';
$('maxAttempts').addEventListener('input', () => { $('attemptsLabel').textContent = $('maxAttempts').value || '3'; });

const listenModels = () => [...new Set($('listenModels').value.split(/[\s,]+/).map((x) => x.trim()).filter((x) => /^[a-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(x)))].slice(0, 6);
$('listenProvider').addEventListener('change', async () => {
  const cloud = $('listenProvider').value === 'openrouter';
  $('cloudListen').hidden = !cloud;
  // Asked only when chosen, so the extension doesn't need this permission for everyone.
  if (cloud) await chrome.permissions.request({ origins: ['https://openrouter.ai/*'] }).catch(() => false);
});
// The key is stored on this tablet only: never in the rules, never on GitHub.
$('voiceKey').addEventListener('change', () => chrome.storage.local.set({ voiceKey: $('voiceKey').value.trim() }));
$('tryCloud').addEventListener('click', async () => {
  await chrome.storage.local.set({ voiceKey: $('voiceKey').value.trim() });
  $('cloudOut').textContent = 'Listening… say a word now.';
  const audio = await recordAnswer({ seconds: 4 });
  if (audio === null) { $('cloudOut').textContent = 'The microphone is not allowed here. Press “Try the microphone” first.'; return; }
  $('cloudOut').textContent = 'Sending…';
  const heard = await transcribeAnswer(audio, { key: $('voiceKey').value.trim(), models: listenModels().length ? listenModels() : ['openai/gpt-audio-mini'], lang: voiceLang });
  $('cloudOut').textContent = heard === null ? 'It didn’t work: check the key, the models and the internet.' : heard.length ? `Heard: “${heard[0]}”` : 'Nothing was heard. Try again a bit louder.';
});

$('sendWish').addEventListener('click', async () => {
  const text = $('wish').value.trim();
  if (!text) return;
  $('sendWish').disabled = true;
  const r = await send({ type: 'wish', text });
  $('sendWish').disabled = false;
  if (r?.ok) { $('wish').value = ''; $('wishOut').textContent = `Sent. The helper will read it on its next run.`; }
  else $('wishOut').textContent = 'Could not send it. Check the GitHub settings above and try again.';
});

$('tryVoice').addEventListener('click', () => {
  const name = $('friendName').value.trim() || 'Zippy';
  say({ text: `Hi! I'm ${name}. Let's watch a video and learn something new!` }, { lang: voiceLang, pitch: Number($('pitch').value), rate: 1.05 });
});

// Allowing the microphone here also allows it on the friend's screen (same extension).
$('tryMic').addEventListener('click', async () => {
  $('micOut').className = 'hint';
  $('micOut').textContent = 'Say something…';
  try {
    const stream = await navigator.mediaDevices?.getUserMedia({ audio: true });
    stream?.getTracks().forEach((t) => t.stop());
  } catch (e) {
    $('micOut').className = 'err';
    $('micOut').textContent = `The microphone is blocked (${e.name}). Allow it for KidTube in the browser's site settings. Until then he answers by typing.`;
    return;
  }
  const heard = await listen(voiceLang);
  if (heard === null) {
    $('micOut').className = 'err';
    $('micOut').textContent = 'The microphone works, but this browser has no speech recognition. He will answer by typing.';
  } else if (!heard.length) {
    $('micOut').textContent = 'Didn’t hear anything. Try again a bit louder.';
  } else {
    $('micOut').className = 'ok';
    $('micOut').textContent = `Works ✓ I heard: “${heard[0]}”`;
  }
});
