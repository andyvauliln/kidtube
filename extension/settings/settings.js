// The settings view: mode, update, status, rules, the talking friend, your notes for the helper (AI),
// the connection and the PIN. Shown in the parent screens (Settings tab) and on the options page (after its PIN).
import { hashPin } from '../lib/pin.js';
import { say, listen, recordAnswer, transcribeAnswer, FREE_LISTEN_MODELS, PAID_LISTEN_MODELS } from '../ui/voice.js';
import { ask as send } from '../lib/ask.js';
import { el as make, noteInput, noteBox, promptNotesBox } from '../parent/kit.js';

const MARKUP = `
  <section class="ainote">
    <h2>Settings</h2>
    <p class="muted">Ask the AI for any change: to the app, the rules or how the helper plans. Your notes wait here; ↻ Update sends them, and the AI on the server starts on them within a minute (a change to the app comes as a new version).</p>
    <div id="aiNote"></div>
  </section>

  <section>
    <h2>Mode</h2>
    <p class="muted" id="account"></p>
    <label class="check rules-like"><input type="radio" name="mode" value="kid"> <span><b>Kid mode</b>: his list, with all the rules</span></label>
    <label class="check rules-like"><input type="radio" name="mode" value="parent"> <span><b>Parent mode</b>: YouTube opens your screens (Today, Planned, History, Prompt, Settings); nothing is blocked or counted</span></label>
    <p class="hint">Parent mode stays on until you switch back to kid mode (the “Kid mode” button at the top of your screens). Until then the tablet is open for him too.</p>
    <button class="primary" id="saveMode">Save mode</button>
    <button id="openParent">Open parent screens</button>
    <p id="modeOut" class="muted"></p>
  </section>

  <section>
    <h2>Your changes to the helper’s prompt</h2>
    <div id="promptNotes"><p class="muted">Loading…</p></div>
  </section>

  <section>
    <h2>Message to the helper</h2>
    <p class="muted">The daily helper reads this on its next run (every night) and keeps it in mind until a newer message says otherwise. For example: “This week: plus and minus up to 10”, “Today something about friendship”, “At least 3 videos in Russian”.</p>
    <div id="wishBox"></div>
    <div id="wishes"></div>
  </section>

  <section>
    <h2>Update</h2>
    <p class="muted">Gets the newest video list, rules and app version.</p>
    <button class="primary" id="update">Update now</button>
    <p id="updateOut" class="muted"></p>
    <a class="install" id="install" hidden>Get the new version (install page)</a>
  </section>

  <section>
    <h2>Status</h2>
    <dl id="status"></dl>
    <button id="resetToday">Reset today’s minutes</button>
  </section>

  <section class="rules">
    <h2>Rules</h2>
    <p class="muted">Changes work on this tablet right away and are saved to GitHub, where the agent sees them.</p>

    <label>Watching hours</label>
    <div id="windows"></div>
    <button id="addWindow">+ Add hours</button>

    <div class="two">
      <div><label for="maxMinutes">Minutes per day</label><input id="maxMinutes" type="number" min="0" max="1440" inputmode="numeric">
        <p class="hint">0 = no limit. Paused time doesn't count.</p></div>
      <div><label for="queueSize">Videos on the home screen</label><input id="queueSize" type="number" min="1" max="30" inputmode="numeric"></div>
    </div>

    <div class="two">
      <div><label for="minLeave">Must watch before switching (seconds)</label><input id="minLeave" type="number" min="0" max="3600" inputmode="numeric"></div>
      <div><label for="closeAfter">Back to the list after (seconds)</label><input id="closeAfter" type="number" min="0" inputmode="numeric">
        <p class="hint">0 = off, the video plays to the end.</p></div>
    </div>

    <div class="two">
      <div><label for="minLen">Shortest video (minutes)</label><input id="minLen" type="number" min="0" step="0.5" inputmode="decimal"></div>
      <div><label for="maxLen">Longest video (minutes)</label><input id="maxLen" type="number" min="0" step="0.5" inputmode="decimal">
        <p class="hint">0 = no limit.</p></div>
    </div>

    <label for="requiredFirst">Must-watch videos (⭐, chosen by you or the helper)</label>
    <select id="requiredFirst">
      <option value="first">⭐ videos first, the others wait</option>
      <option value="mix">one ⭐ video, then one he picks, and so on</option>
      <option value="off">⭐ is only a mark, he picks freely</option>
    </select>

    <label class="check"><input type="checkbox" id="allowSkip"> Allow skipping inside a video</label>
    <p class="hint">Off: he can't jump forward or speed it up. Going back is always allowed.</p>

    <label class="check"><input type="checkbox" id="blockSites"> Block other websites in this browser</label>
    <label for="sites">Websites that stay open (one per line)</label>
    <textarea id="sites" placeholder="youtube.com"></textarea>
    <p class="hint">youtube.com always stays open. A site also allows its subdomains.</p>

    <label for="channels">Blocked channels (channel ids starting with UC, one per line)</label>
    <textarea id="channels" placeholder="UC…"></textarea>

    <h2 style="margin-top:20px">Talking friend</h2>
    <label class="check"><input type="checkbox" id="intro"> Says hello before each video</label>
    <label class="check"><input type="checkbox" id="outro"> Says what we learned after each video</label>
    <label class="check"><input type="checkbox" id="quizOn"> Asks questions after the video</label>
    <p class="hint">The agent writes the words and the questions for each video. Without them the friend says a short hello and “well done”.</p>
    <div class="two">
      <div><label for="onFail">After <span id="attemptsLabel">3</span> wrong answers</label>
        <select id="onFail">
          <option value="continue">he goes on to the next video</option>
          <option value="rewatch">he watches the same video again (once a day)</option>
          <option value="stopForToday">no more videos today</option>
        </select></div>
      <div><label for="maxAttempts">Tries per question</label><input id="maxAttempts" type="number" min="1" max="10" inputmode="numeric"></div>
    </div>
    <p class="hint">“No more videos today” can be undone with Reset today’s minutes.</p>
    <div class="two">
      <div><label for="friendName">Name</label><input id="friendName" maxlength="30"></div>
      <div><label for="pitch">Voice: low ↔ squeaky</label><input id="pitch" type="range" min="0.5" max="2" step="0.1"></div>
    </div>
    <label for="catchphrase">Catchphrase (said at the start and the end)</label>
    <input id="catchphrase" maxlength="60" placeholder="Pika pika!">
    <label for="friendImage">Picture: a link (https://…) or a file in the data repo (repo:characters/name.svg)</label>
    <input id="friendImage" placeholder="empty = the built-in cloud friend">
    <label class="check"><input type="checkbox" id="recorded"> Use the helper’s recorded voice when there is one</label>
    <p class="hint">The daily helper can record the friend’s lines (Gemini or OpenRouter, set on the server). Off: the tablet’s own voice says everything.</p>

    <label for="listenProvider">Hearing his answers</label>
    <select id="listenProvider">
      <option value="cloud">Record and send: free Gemini first, then paid OpenRouter (more accurate)</option>
      <option value="device">The tablet’s own speech recognition</option>
    </select>
    <div id="cloudListen" hidden>
      <p class="hint">His answer is recorded and sent to the first model that works: the free Gemini models, then the paid OpenRouter ones. A model that hits its limit rests a minute and the next one answers. If none work, the tablet’s own recognition is used. Both keys stay on this tablet only.</p>
      <label for="geminiKey">Gemini API key (free tier, from aistudio.google.com)</label>
      <input id="geminiKey" type="password" autocomplete="off" placeholder="AIza…">
      <label for="freeModels">Free Gemini models, tried first, in order (one per line)</label>
      <textarea id="freeModels" placeholder="gemini-3.5-flash-lite"></textarea>
      <label for="voiceKey">OpenRouter key (paid, when the free ones fail)</label>
      <input id="voiceKey" type="password" autocomplete="off" placeholder="sk-or-v1-…">
      <label for="listenModels">Paid OpenRouter models, tried next, in order (one per line)</label>
      <textarea id="listenModels" placeholder="openai/gpt-audio-mini"></textarea>
      <p class="hint">OpenRouter: make a separate key with a small monthly limit (for example $1); about $0.0001 per answer. On Gemini’s free tier Google may use what is sent to improve its products.</p>
      <button id="tryCloud">🎤 Try it: say a word</button>
      <p id="cloudOut" class="hint"></p>
    </div>
    <button id="tryVoice">🔊 Try the voice</button>
    <button id="tryMic">🎤 Try the microphone</button>
    <p id="micOut" class="hint">Press “Try the microphone” once and allow it, so the questions can hear him.</p>

    <button class="primary" id="saveRules">Save rules</button>
    <p id="rulesOut" class="muted"></p>
  </section>

  <section id="watched">
    <h2>What he watched</h2>
    <p class="muted">History by day, today’s list and the planned videos are in the parent screens: <b>Open parent screens</b> above, or switch to parent mode.</p>
  </section>

  <section>
    <h2>Connection</h2>
    <label for="repo">Data repo (owner/name)</label>
    <input id="repo" placeholder="andyvauliln/kidtube-data">
    <label for="token">GitHub token (fine-grained, this repo only, Contents: read and write)</label>
    <input id="token" type="password" autocomplete="off" placeholder="github_pat_…">
    <button class="primary" id="save">Save</button>
    <span id="saveOut" class="muted"></span>
    <p class="muted">One repo and token for every profile on this tablet; each profile has its own folder in it.</p>
    <p class="muted">Reinstalling KidTube (a new version on Orion) erases these settings. KidTube keeps a copy on its install page and takes it back by itself after a reinstall (it opens that page). If that fails, use a file: save it once; after a reinstall, set a PIN and load the file.
      The file holds your GitHub token: keep it on this device only.</p>
    <button id="backup">Save settings to a file</button>
    <label class="filebtn"><input id="restore" type="file" accept=".json,application/json" hidden><span>Load settings from a file</span></label>
    <span id="backupOut" class="muted"></span>
  </section>

  <section>
    <h2>PIN</h2>
    <p class="muted">The same PIN for every YouTube account on this tablet.</p>
    <button id="changePin">Change PIN</button>
    <div id="pinForm" hidden>
      <label for="newPin">New PIN (4–8 digits)</label>
      <input id="newPin" class="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8">
      <label for="newPin2">The same PIN again</label>
      <input id="newPin2" class="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8">
      <button class="primary" id="savePin">Save PIN</button>
    </div>
    <p id="pinOut" class="muted"></p>
  </section>
`;

async function getSettings() {
  return (await chrome.storage.local.get('settings')).settings ?? {};
}
async function patchSettings(patch) {
  const settings = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings });
}
const el = (tag, text, cls) => make(tag, cls, text);

// inParent: inside the parent screens (no "Open parent screens", no pointer to them).
// onMode(mode): called after the mode is saved, so the page can follow it.
export function mountSettings(root, { inParent = false, onMode = () => {} } = {}) {
  root.classList.add('settings');
  root.innerHTML = MARKUP;
  const $ = (id) => root.querySelector(`#${id}`);
  $('openParent').hidden = inParent;
  $('watched').hidden = inParent;
  let voiceLang = 'en-US';

  // --- mode and account ------------------------------------------------------------------------

  async function renderMode() {
    const { settings: s = {}, account } = await chrome.storage.local.get(['settings', 'account']);
    const on = s.mode === 'parent' && (!s.parentUntil || s.parentUntil > Date.now());
    for (const r of root.querySelectorAll('input[name=mode]')) r.checked = r.value === (on ? 'parent' : 'kid');
    $('account').textContent = account
      ? `Profile: ${account.email || account.name || account.key}. Every setting here, the lists and the history belong to this profile; another email has its own (parent screens → tap the account at the top → Profiles). The PIN and the GitHub connection are the same for all.`
      : 'No YouTube account seen yet: open YouTube once. Settings are kept per profile (YouTube account).';
    $('modeOut').textContent = on && s.parentUntil ? `Parent mode is on until ${new Date(s.parentUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : '';
  }

  async function saveMode() {
    const mode = root.querySelector('input[name=mode]:checked')?.value ?? 'kid';
    const r = await send({ type: 'setMode', mode });
    if (!r?.ok) { $('modeOut').textContent = `Could not change the mode: ${r?.error ?? 'KidTube’s background did not answer'}`; return null; }
    await renderMode();
    return mode;
  }
  $('saveMode').addEventListener('click', async () => {
    const mode = await saveMode();
    if (!mode) return;
    if (!inParent) $('modeOut').textContent = mode === 'parent' ? `${$('modeOut').textContent} Open YouTube to see your screens.` : 'Kid mode: YouTube shows his list.';
    onMode(mode);
  });
  $('openParent').addEventListener('click', async () => {
    root.querySelector('input[name=mode][value=parent]').checked = true;
    if (await saveMode()) location.href = '../parent/parent.html';
  });

  // --- update, status, connection --------------------------------------------------------------

  async function renderStatus() {
    const st = await send({ type: 'status' });
    if (!st) return;
    const rows = [
      ['Version', st.version],
      ['Videos he can open', `${st.visible} (${st.queueSource})`],
      ['Watched today', `${st.playedMinutesToday} of ${st.maxMinutesPerDay || '∞'} min`],
      ['Data repo', `${st.repo}${st.hasToken ? '' : ' · no token yet'}`],
      ['This profile’s folder', st.folder ?? 'given on the first sync (open YouTube once)'],
      ['Last sync', st.sync?.at ? new Date(st.sync.at).toLocaleString() : 'never'],
      ['List updated', st.queueUpdatedAt ? new Date(st.queueUpdatedAt).toLocaleString() : '—'],
      ['Waiting to upload', `${st.outbox} events`],
      ['Transcripts on GitHub', `${st.transcripts.uploaded} of ${st.transcripts.total} videos${st.transcripts.missing ? ` (${st.transcripts.missing} without captions)` : ''}`],
    ];
    $('status').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', k), el('dd', v)]));
    for (const e of st.sync?.errors ?? []) $('status').append(el('dt', 'Problem'), el('dd', e, 'err'));
  }

  $('update').addEventListener('click', async () => {
    $('update').disabled = true;
    $('updateOut').textContent = 'Checking…';
    try {
      await send({ type: 'sync', notes: true });   // your notes for the AI go too
      const r = await send({ type: 'checkUpdate' });
      const parts = [`Installed ${r.installed}`];
      if (r.latest) parts.push(`newest ${r.latest}`);
      if (r.check?.status === 'update_available') parts.push('downloading the new version, the app will restart');
      if (r.check?.status === 'manual' && r.installPage) parts.push('install the new .zip by hand (link below)');
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
    renderHelperNotes();
  });

  // Backup of the connection and PIN: chrome.storage is erased when the extension is removed (Orion updates).
  const BACKUP_KEYS = ['repo', 'token', 'pinSalt', 'pinHash'];
  $('backup').addEventListener('click', async () => {
    const s = await getSettings();
    const keep = Object.fromEntries(BACKUP_KEYS.filter((k) => s[k]).map((k) => [k, s[k]]));
    const { voiceKey, geminiKey } = await chrome.storage.local.get(['voiceKey', 'geminiKey']);
    Object.assign(keep, voiceKey ? { voiceKey } : {}, geminiKey ? { geminiKey } : {});   // the listening keys, also only on this tablet
    const blob = new Blob([JSON.stringify({ kidtubeSettings: 1, savedAt: new Date().toISOString(), ...keep }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'kidtube-settings.json' });
    document.body.append(a); a.click(); a.remove();
    $('backupOut').textContent = 'Saved as kidtube-settings.json (Downloads / Files).';
  });
  $('restore').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.kidtubeSettings !== 1) throw new Error('not a KidTube settings file');
      await patchSettings(Object.fromEntries(BACKUP_KEYS.filter((k) => typeof j[k] === 'string').map((k) => [k, j[k]])));
      const voice = Object.fromEntries(['voiceKey', 'geminiKey'].filter((k) => typeof j[k] === 'string' && j[k]).map((k) => [k, j[k]]));
      if (Object.keys(voice).length) { await chrome.storage.local.set(voice); $('voiceKey').value = voice.voiceKey ?? $('voiceKey').value; $('geminiKey').value = voice.geminiKey ?? $('geminiKey').value; }
      const s = await getSettings();
      $('repo').value = s.repo ?? ''; $('token').value = s.token ?? '';
      $('backupOut').textContent = 'Loaded. Syncing…';
      const r = await send({ type: 'sync' });
      $('backupOut').textContent = r?.errors?.length ? `Loaded, but: ${r.errors.join('; ')}` : 'Loaded and synced ✓ (the PIN is the one from the file)';
      renderStatus();
    } catch (err) {
      $('backupOut').textContent = `Could not load it: ${err.message}`;
    }
    e.target.value = '';
  });

  $('resetToday').addEventListener('click', async () => { await send({ type: 'resetToday' }); renderStatus(); });

  // The old PIN stays until the new one is saved.
  $('changePin').addEventListener('click', () => {
    $('pinForm').hidden = !$('pinForm').hidden;
    $('pinOut').textContent = '';
    if (!$('pinForm').hidden) $('newPin').focus();
  });
  $('savePin').addEventListener('click', async () => {
    const pin = $('newPin').value.trim();
    $('pinOut').className = 'err';
    if (!/^\d{4,8}$/.test(pin)) return ($('pinOut').textContent = 'Use 4 to 8 digits.');
    if (pin !== $('newPin2').value.trim()) return ($('pinOut').textContent = 'The two PINs are different.');
    const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    await patchSettings({ pinSalt: salt, pinHash: await hashPin(pin, salt), pinFails: 0 });
    $('newPin').value = $('newPin2').value = '';
    $('pinForm').hidden = true;
    $('pinOut').className = 'ok';
    $('pinOut').textContent = 'New PIN saved ✓';
  });

  // --- your notes for the helper (AI): standing changes to its prompt, and a message ----------------

  async function renderHelperNotes() {
    const h = await send({ type: 'helperData' });
    if (!root.isConnected) return;
    if (!h?.ok) { $('promptNotes').replaceChildren(el('p', 'Could not load your changes to the prompt.', 'err')); return; }
    $('promptNotes').replaceChildren(...promptNotesBox(h.notes, renderHelperNotes));
    if (h.messages?.length) {
      const ul = el('ul', null, 'notes');
      ul.append(...h.messages.slice(0, 5).map((m) => el('li', `${m.at.slice(0, 10)}: ${m.aboutList ? `(${m.aboutList}) ` : ''}${m.text}`)));
      $('wishes').replaceChildren(el('h3', 'Messages it keeps in mind'), ul);
    } else $('wishes').replaceChildren();
  }
  // The note for the AI at the top, like on every tab (list "settings": anything about the app and the rules).
  send({ type: 'parentData' }).then((d) => {
    if (root.isConnected) $('aiNote').replaceChildren(noteBox({ list: 'settings' }, d?.lists?.settings ?? [], 'Note for the AI about the app and settings'));
  });

  const wish = noteInput({
    placeholder: 'What should he watch or learn?', saveLabel: 'Send to the helper',
    failText: 'Could not send it. Check the connection (GitHub) below and try again.',
    save: async (text) => (await send({ type: 'wish', text }))?.ok,
  });
  $('wishBox').replaceChildren(...wish.nodes);

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
    // "openrouter" is the older name of "cloud".
    $('listenProvider').value = p.voice?.listen?.provider === 'device' ? 'device' : 'cloud';
    $('freeModels').value = (p.voice?.listen?.freeModels ?? FREE_LISTEN_MODELS).join('\n');
    $('listenModels').value = (p.voice?.listen?.models ?? PAID_LISTEN_MODELS).join('\n');
    $('cloudListen').hidden = $('listenProvider').value !== 'cloud';
    chrome.storage.local.get(['voiceKey', 'geminiKey']).then(({ voiceKey, geminiKey }) => { $('voiceKey').value = voiceKey ?? ''; $('geminiKey').value = geminiKey ?? ''; });
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
          listen: { provider: $('listenProvider').value, freeModels: freeModels(), models: listenModels() } },
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

  $('maxAttempts').addEventListener('input', () => { $('attemptsLabel').textContent = $('maxAttempts').value || '3'; });

  const modelList = (id, re) => [...new Set($(id).value.split(/[\s,]+/).map((x) => x.trim()).filter((x) => re.test(x)))].slice(0, 6);
  const listenModels = () => modelList('listenModels', /^[a-z0-9._-]+\/[A-Za-z0-9._:-]+$/);
  const freeModels = () => modelList('freeModels', /^[a-z0-9][a-z0-9._-]*$/);
  // Asked when chosen, so the extension doesn't need these permissions for everyone. Never waited for: both
  // services allow these calls anyway (CORS), and the prompt may never answer (Orion, a dismissed dialog).
  const askCloudAccess = () => chrome.permissions?.request?.({ origins: ['https://generativelanguage.googleapis.com/*', 'https://openrouter.ai/*'] }).catch(() => false);
  $('listenProvider').addEventListener('change', async () => {
    const cloud = $('listenProvider').value === 'cloud';
    $('cloudListen').hidden = !cloud;
    if (cloud) askCloudAccess();
  });
  // The keys are stored on this tablet only: never in the rules, never on GitHub.
  const saveKeys = () => chrome.storage.local.set({ voiceKey: $('voiceKey').value.trim(), geminiKey: $('geminiKey').value.trim() });
  $('voiceKey').addEventListener('change', saveKeys);
  $('geminiKey').addEventListener('change', saveKeys);
  $('tryCloud').addEventListener('click', async () => {
    askCloudAccess();
    await saveKeys();
    const keys = { gemini: $('geminiKey').value.trim(), openrouter: $('voiceKey').value.trim() };
    if (!keys.gemini && !keys.openrouter) { $('cloudOut').textContent = 'Enter a Gemini key, an OpenRouter key, or both.'; return; }
    $('cloudOut').textContent = 'Listening… say a word now.';
    const audio = await recordAnswer({ seconds: 4 });
    if (audio === null) { $('cloudOut').textContent = 'The microphone is not allowed here. Press “Try the microphone” first.'; return; }
    $('cloudOut').textContent = 'Sending…';
    let used = null;
    const heard = await transcribeAnswer(audio, { keys, freeModels: freeModels(), models: listenModels(), lang: voiceLang, onUsed: (u) => { used = u; } });
    const by = used ? ` — ${used.model} (${used.free ? 'free' : 'paid'}, ${(used.ms / 1000).toFixed(1)} s)` : '';
    $('cloudOut').textContent = heard === null ? 'It didn’t work: check the keys, the models and the internet.' : heard.length ? `Heard: “${heard[0]}”${by}` : `Nothing was heard. Try again a bit louder.${by}`;
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

  // --- first draw ---------------------------------------------------------------------------------
  getSettings().then((s) => { $('repo').value = s.repo ?? ''; $('token').value = s.token ?? ''; });
  return Promise.all([renderStatus(), renderRules(), renderMode(), renderHelperNotes()]);
}
