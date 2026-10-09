// The apps header: KidTube's bar above YouTube (content.js) and above an app's own pages (parent screens, blank).
// One bar for every state: signed out → Sign in; signed in → the account, Switch, and either the GitHub connection
// (first time) or this account's apps with + Add app. Hidden in kid mode (content.js and the pages decide).
// A plain script, not a module, so the YouTube content script can use it too: it sets globalThis.KidTubeHeader.
// No innerHTML anywhere: YouTube's Trusted Types policy refuses it.
(() => {
  if (globalThis.KidTubeHeader) return;
  // Same as lib/ask.js. Orion only returns sendMessage answers to the callback.
  const ask = (msg) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 15000);
    try {
      chrome.runtime.sendMessage(msg, (value) => { clearTimeout(timer); void chrome.runtime.lastError; resolve(value); });
    } catch { clearTimeout(timer); resolve(undefined); }
  });

  const CSS = `
    :host { all: initial; display: block; color-scheme: light;
      --bg: #fff; --ink: #0f0f0f; --muted: #606060; --line: #e5e5e5; --soft: #f2f2f2; --hover: #e5e5e5;
      --accent: #ff3b30; --blue: #065fd4; --blue-soft: #e8f1fd; --ok: #1e8e3e; --bad: #c5221f;
      --shadow: 0 8px 32px rgba(0,0,0,.14), 0 1px 4px rgba(0,0,0,.08);
      font: 400 14px/1.4 Roboto, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); }
    :host(.dark) { color-scheme: dark; --bg: #0f0f0f; --ink: #f1f1f1; --muted: #aaa; --line: #303030; --soft: #272727; --hover: #3a3a3a;
      --blue: #3ea6ff; --blue-soft: #263850; --ok: #6dd58c; --bad: #ff8a80; --shadow: 0 8px 32px rgba(0,0,0,.6); }
    * { box-sizing: border-box; }
    .kt { position: relative; background: var(--bg); border-bottom: 1px solid var(--line); -webkit-tap-highlight-color: transparent; }
    button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; margin: 0; }
    button:disabled { opacity: .5; cursor: default; }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
    svg { display: block; flex: none; }
    .bar { height: 56px; display: flex; align-items: center; gap: 8px; padding: 0 12px 0 16px; }
    .brand { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 18px; letter-spacing: -.4px; user-select: none; -webkit-user-select: none; }
    .grow { flex: 1 1 auto; min-width: 0; }
    .muted { color: var(--muted); }
    .btn { height: 36px; padding: 0 16px; border-radius: 18px; background: var(--soft); font-weight: 500; white-space: nowrap;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
    .btn:not(:disabled):hover { background: var(--hover); }
    .btn.primary { background: var(--ink); color: var(--bg); }
    .btn.primary:not(:disabled):hover { opacity: .85; background: var(--ink); }
    .btn.signin { background: transparent; border: 1px solid var(--line); color: var(--blue); padding: 0 14px 0 10px; }
    .btn.signin:hover { background: var(--blue-soft); border-color: transparent; }
    .who { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 10px 0 4px; border-radius: 20px; min-width: 0; }
    .who:hover, .who[aria-expanded=true] { background: var(--soft); }
    .who .email { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
    .avatar { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 600; font-size: 15px;
      flex: none; text-transform: uppercase; }
    .avatar.big { width: 40px; height: 40px; font-size: 18px; }
    .apps { display: flex; align-items: center; gap: 4px; padding: 0 12px 8px; }
    .tiles { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; min-width: 0; }
    .tiles::-webkit-scrollbar { display: none; }
    .app { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 76px; padding: 6px 0 4px; border-radius: 12px; flex: none; }
    .app:not(:disabled):hover { background: var(--soft); }
    .icon { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; flex: none;
      box-shadow: 0 0 0 2px var(--bg), 0 0 0 2px transparent; transition: box-shadow .15s; }
    .app.on .icon { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent); }
    .app .name { font-size: 12px; color: var(--muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .app.on .name { color: var(--ink); font-weight: 600; }
    .empty { color: var(--muted); padding: 0 4px; }
    .card { margin: 0 16px 12px; padding: 16px; border: 1px solid var(--line); border-radius: 12px;
      display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px 16px; align-items: start; }
    .card h2 { grid-column: 1 / -1; margin: 0; font-size: 16px; font-weight: 600; }
    .card .lead { grid-column: 1 / -1; margin: -6px 0 0; color: var(--muted); }
    .card .lead a { color: var(--blue); }
    .fields { display: grid; gap: 10px; }
    label { display: grid; gap: 4px; font-size: 12px; color: var(--muted); font-weight: 500; }
    input { font: inherit; font-size: 15px; height: 40px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--line);
      background: var(--bg); color: var(--ink); width: 100%; margin: 0; }
    .side { display: flex; flex-direction: column; gap: 8px; min-width: 150px; }
    .status { grid-column: 1 / -1; margin: 0; font-size: 13px; color: var(--muted); }
    .err { color: var(--bad) !important; }
    .ok { color: var(--ok) !important; }
    .note { margin: 0; padding: 0 16px 10px; font-size: 13px; }
    .scrim { position: fixed; inset: 0; z-index: 1; }
    .pop { position: absolute; right: 12px; z-index: 2; width: min(340px, calc(100vw - 24px)); background: var(--bg); color: var(--ink);
      border-radius: 12px; box-shadow: var(--shadow); padding: 8px 0; }
    .menu { top: 52px; }
    .head { display: flex; gap: 12px; align-items: center; padding: 8px 16px 12px; border-bottom: 1px solid var(--line); margin-bottom: 8px; min-width: 0; }
    .head div { min-width: 0; }
    .head b { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .item { display: flex; align-items: center; gap: 14px; width: 100%; text-align: left; padding: 0 16px; min-height: 40px; }
    .item:hover { background: var(--soft); }
    .item svg { fill: var(--muted); }
    .item > span:first-of-type { white-space: nowrap; }
    .item .sub { margin-left: auto; color: var(--muted); font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sep { height: 1px; background: var(--line); margin: 8px 0; }
    .add { top: calc(100% - 4px); padding: 16px; }
    .add h2 { margin: 0; font-size: 16px; font-weight: 600; }
    .add p { margin: 4px 0 8px; color: var(--muted); font-size: 13px; }
    .choice { display: flex; gap: 12px; align-items: center; width: 100%; padding: 10px; border-radius: 10px; border: 1px solid var(--line);
      text-align: left; margin-top: 8px; }
    .choice.on { border-color: var(--blue); background: var(--blue-soft); }
    .choice .icon { width: 36px; height: 36px; }
    .choice b { display: block; font-weight: 500; }
    .choice span { color: var(--muted); font-size: 12px; }
    .add .row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    @media (max-width: 600px) {
      .who .email { display: none; }
      .card { grid-template-columns: 1fr; }
      .side { flex-direction: row; flex-wrap: wrap; min-width: 0; }
      .side .btn { flex: 1 1 auto; }
    }
  `;

  // --- small builders ---------------------------------------------------------------------------------------
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const NS = 'http://www.w3.org/2000/svg';
  function icon(d, size = 24, fill) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size); s.setAttribute('height', size);
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('fill', 'currentColor');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    if (fill) p.setAttribute('fill', fill);
    s.append(p);
    return s;
  }
  const PATH = {
    play: 'M9 6.8v10.4c0 .6.7 1 1.2.7l8.2-5.2c.5-.3.5-1 0-1.3L10.2 6.1C9.7 5.8 9 6.2 9 6.8z',
    square: 'M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
    person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5z',
    swap: 'M6.99 11 3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z',
    logout: 'M10.09 15.59 11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5a2 2 0 0 0-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z',
    cloud: 'M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A6 6 0 0 0 6 20h13a5 5 0 0 0 .35-9.96z',
    download: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
    upload: 'M5 20h14v-2H5v2zm4-4h6v-6h4l-7-7-7 7h4v6z',
    plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    caret: 'M7 10l5 5 5-5z',
  };
  function logo() {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 30 21'); s.setAttribute('width', '30'); s.setAttribute('height', '21'); s.setAttribute('aria-hidden', 'true');
    const r = document.createElementNS(NS, 'rect');
    for (const [k, v] of Object.entries({ width: 30, height: 21, rx: 6, fill: '#ff3b30' })) r.setAttribute(k, v);
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M12 6.2v8.6c0 .5.6.8 1 .5l6.9-4.3c.4-.3.4-.8 0-1.1L13 5.7c-.4-.3-1 0-1 .5z');
    p.setAttribute('fill', '#fff');
    s.append(r, p);
    const b = el('div', 'brand');
    b.append(s, el('span', '', 'KidTube'));
    return b;
  }
  function avatar(email, big = false) {
    let h = 0;
    for (const c of email ?? '') h = (h * 31 + c.charCodeAt(0)) % 360;
    const a = el('span', `avatar${big ? ' big' : ''}`, (email ?? '?')[0]);
    a.style.background = `hsl(${h} 45% 45%)`;
    return a;
  }
  function appIcon(app) {
    const i = el('span', 'icon');
    i.style.background = `linear-gradient(145deg, ${app.color ?? '#888'}, color-mix(in srgb, ${app.color ?? '#888'} 70%, #000))`;
    i.append(icon(PATH[app.glyph] ?? PATH.square, 22, '#fff'));
    return i;
  }
  function button(cls, label, onTap, path) {
    const b = el('button', cls);
    b.type = 'button';
    if (path) b.append(icon(path, 20));
    if (label) b.append(el('span', '', label));
    b.addEventListener('click', onTap);
    return b;
  }

  // The settings file (Save / Load): the GitHub connection and the PIN (sw.js exportSettings).
  function saveFile(root, file) {
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'kidtube-settings.json' });
    root.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // --- the header -------------------------------------------------------------------------------------------
  // host: an element to draw into (its shadow root). dark: YouTube's own theme (content.js); on KidTube's pages, the system's.
  // Returns { refresh(force), setDark(on), destroy() }.
  function mount(host, { dark = !!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches } = {}) {
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'closed' });
    host.classList.toggle('dark', dark);
    // The account menu and Add app drop down over the page below, its sticky toolbar too (the parent tabs):
    // lift the bar above the page's own layers. On YouTube content.js already pins it on top.
    if (!host.style.position) { host.style.position = 'relative'; host.style.zIndex = '100'; }
    const style = el('style', '', CSS);
    const box = el('div', 'kt');
    root.replaceChildren(style, box);
    const picker = Object.assign(el('input'), { type: 'file', accept: '.json,application/json', hidden: true });
    root.append(picker);

    let data = null, alive = true, busy = '', loading = false, again = null;
    const ui = { menu: false, add: false, pick: null, github: false, repo: null, token: '', note: '', noteKind: '' };
    const say = (text, kind = '') => { ui.note = text; ui.noteKind = kind; draw(); };

    // A refresh asked for while one is running is not dropped: it runs right after (the storage can change twice).
    async function refresh(force = false) {
      if (!alive) return;
      if (loading) { again = again || force; return; }
      loading = true;
      try {
        const h = await ask({ type: 'header', refresh: force });
        if (!alive || !h?.ok) return;
        data = h;
        // Typing in the GitHub form: don't redraw under the cursor.
        if (!root.activeElement || root.activeElement.tagName !== 'INPUT') draw();
      } finally {
        loading = false;
        if (again !== null) { const f = again; again = null; refresh(f); }
      }
    }

    async function act(label, msg) {
      busy = label;
      ui.note = '';
      draw();
      const r = await ask(msg);
      busy = '';
      if (!r?.ok) say(r?.error ?? 'That didn’t work. Try again.', 'err');
      else draw();
      return r;
    }
    const openApp = (id, create = false) => act(create ? 'Creating…' : 'Opening…', { type: 'openApp', app: id, create }).then((r) => {
      if (r?.ok) { ui.add = false; ui.pick = null; }
      if (r?.ok && r.url && !r.navigated) location.href = r.url;
    });

    async function connect() {
      const repo = (ui.repo ?? data.github.repo ?? '').trim();
      busy = 'Connecting…'; ui.note = ''; draw();
      const r = await ask({ type: 'connectGitHub', repo, token: ui.token.trim() });
      busy = '';
      if (r?.ok) {
        ui.github = false; ui.token = ''; ui.repo = null;
        say(`Connected to ${r.repo} ✓`, 'ok');
        refresh(true);
      } else say(r?.error ?? 'Could not connect. Check the repo and the token.', 'err');
    }
    async function exportFile() {
      ui.menu = false;
      const r = await ask({ type: 'exportSettings' });
      if (!r?.ok) return say(r?.error ?? 'Could not make the file.', 'err');
      saveFile(root, r.file);
      say('Saved as kidtube-settings.json (Downloads / Files). It holds your GitHub token: keep it on this device.', 'ok');
    }
    picker.addEventListener('change', async () => {
      const f = picker.files?.[0];
      picker.value = '';
      if (!f) return;
      let file;
      try { file = JSON.parse(await f.text()); } catch { return say('That file is not a KidTube settings file.', 'err'); }
      const r = await act('Loading…', { type: 'importSettings', file });
      if (r?.ok) { ui.github = false; say('Settings loaded ✓ (the PIN is the one from the file)', 'ok'); refresh(true); }
    });

    function accountMenu() {
      const m = el('div', 'pop menu');
      m.setAttribute('role', 'menu');
      const head = el('div', 'head');
      const t = el('div');
      t.append(el('b', '', data.email ?? 'Signed in'), el('span', 'muted', 'YouTube account'));
      head.append(avatar(data.email, true), t);
      const item = (path, label, onTap, sub) => {
        const b = button('item', label, onTap, path);
        b.setAttribute('role', 'menuitem');
        if (sub) b.append(el('span', 'sub', sub));
        return b;
      };
      m.append(head,
        item(PATH.cloud, 'GitHub connection', () => { ui.menu = false; ui.github = true; draw(); }, data.github.connected ? data.github.repo : 'not connected'),
        item(PATH.download, 'Save settings to a file', exportFile),
        item(PATH.upload, 'Load settings from a file', () => { ui.menu = false; draw(); picker.click(); }),
        el('div', 'sep'),
        item(PATH.logout, 'Sign out of YouTube', () => { location.href = data.signOut; }));
      return m;
    }

    function githubCard(first) {
      const card = el('div', 'card');
      const lead = el('p', 'lead');
      lead.append(first ? 'Every app keeps its lists and rules in one private GitHub repo. Connect it once for this tablet, or load a saved settings file. '
        : 'One repo and token for every account and app on this tablet. ',
      Object.assign(el('a', '', 'Make a token'), { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }),
      ' (fine-grained, only this repo, Contents: read and write).');
      const repo = Object.assign(el('input'), { placeholder: 'owner/repo', value: ui.repo ?? data.github.repo ?? '', autocomplete: 'off', spellcheck: false });
      repo.setAttribute('autocapitalize', 'off');
      repo.addEventListener('input', () => { ui.repo = repo.value; });
      const token = Object.assign(el('input'), { type: 'password', autocomplete: 'off', value: ui.token,
        placeholder: data.github.connected ? 'saved · type a new one to change it' : 'github_pat_…' });
      token.addEventListener('input', () => { ui.token = token.value; go.disabled = !!busy || (!token.value.trim() && !data.github.connected); });
      token.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !go.disabled) connect(); });
      const l1 = el('label', '', 'Data repo'), l2 = el('label', '', 'GitHub token');
      l1.append(repo); l2.append(token);
      const fields = el('div', 'fields');
      fields.append(l1, l2);
      const go = button('btn primary', busy === 'Connecting…' ? busy : 'Connect', connect);
      go.disabled = !!busy || (!ui.token.trim() && !data.github.connected);
      const side = el('div', 'side');
      side.append(go, button('btn', 'Load from file', () => picker.click(), PATH.upload), button('btn', 'Save to file', exportFile, PATH.download));
      if (!first) side.append(button('btn', 'Cancel', () => { ui.github = false; ui.token = ''; ui.repo = null; ui.note = ''; draw(); }));
      card.append(el('h2', '', first ? 'Connect your data on GitHub' : 'GitHub connection'), lead, fields, side);
      if (ui.note) card.append(el('p', `status ${ui.noteKind}`, ui.note));
      return card;
    }

    function addPopover(missing) {
      const p = el('div', 'pop add');
      p.append(el('h2', '', 'Add an app'), el('p', '', `For ${data.email}. It starts empty, in parent mode; its settings go to GitHub.`));
      for (const a of missing) {
        const c = el('button', `choice${ui.pick === a.id ? ' on' : ''}`);
        c.type = 'button';
        const t = el('div');
        t.append(el('b', '', a.label), el('span', '', a.about ?? ''));
        c.append(appIcon(a), t);
        c.addEventListener('click', () => { ui.pick = a.id; draw(); });
        p.append(c);
      }
      const row = el('div', 'row');
      const create = button('btn primary', busy === 'Creating…' ? busy : 'Add app', () => openApp(ui.pick, true));
      create.disabled = !ui.pick || !!busy;
      row.append(button('btn', 'Cancel', () => { ui.add = false; ui.pick = null; draw(); }), create);
      p.append(row);
      return p;
    }

    function draw() {
      if (!alive) return;
      const h = data;
      const kids = [];
      const bar = el('div', 'bar');
      bar.append(logo(), el('div', 'grow'));
      kids.push(bar);
      if (!h) {
        bar.append(el('span', 'muted', 'Loading…'));
      } else if (!h.signedIn) {
        bar.append(h.seen
          ? button('btn signin', 'Sign in', () => { location.href = h.switchAccount; }, PATH.person)
          : el('span', 'muted', 'Checking the YouTube account…'));
      } else {
        const who = button('who', '', () => { ui.menu = !ui.menu; ui.add = false; draw(); });
        who.setAttribute('aria-haspopup', 'menu');
        who.setAttribute('aria-expanded', String(ui.menu));
        who.title = h.email ?? '';
        who.append(avatar(h.email), el('span', 'email', h.email ?? 'Reading the email…'), icon(PATH.caret, 20));
        bar.append(who, button('btn', 'Switch', () => { location.href = h.switchAccount; }, PATH.swap));

        if (!h.github.connected || ui.github) kids.push(githubCard(!h.github.connected));
        else if (h.email) {
          const row = el('div', 'apps');
          const tiles = el('div', 'tiles');
          const mine = h.apps.filter((a) => a.has), missing = h.apps.filter((a) => !a.has);
          for (const a of mine) {
            const t = el('button', `app${a.active ? ' on' : ''}`);
            t.type = 'button';
            t.title = a.active ? `${a.label}: its home` : `Open ${a.label}`;
            t.append(appIcon(a), el('span', 'name', a.label));
            t.disabled = !!busy;
            t.addEventListener('click', () => openApp(a.id));
            tiles.append(t);
          }
          if (!mine.length) tiles.append(el('span', 'empty', 'No apps for this account yet.'));
          row.append(tiles, el('div', 'grow'));
          if (busy) row.append(el('span', 'muted', busy));
          if (missing.length) {
            const add = button('btn', 'Add app', () => { ui.add = !ui.add; ui.menu = false; ui.pick ??= missing[0].id; draw(); }, PATH.plus);
            add.disabled = !!busy && busy !== 'Creating…';
            row.append(add);
          }
          kids.push(row);
          if (ui.add && missing.length) kids.push(addPopover(missing));
          const note = ui.note || h.error;
          if (note) kids.push(el('p', `note ${ui.note ? ui.noteKind : 'err'}`, note));
        }
        if (ui.menu) kids.push(accountMenu());
      }
      if (ui.menu || ui.add) {
        const scrim = el('div', 'scrim');
        scrim.addEventListener('click', () => { ui.menu = false; ui.add = false; draw(); });
        kids.unshift(scrim);
      }
      box.replaceChildren(...kids);
    }

    const onStorage = (ch) => {
      if (ch.ytAccount || ch.settings || ch.accounts || ch.repoProfiles || ch.account || ch.shell) refresh();
    };
    chrome.storage.onChanged.addListener(onStorage);
    const onKey = (e) => { if (e.key === 'Escape' && (ui.menu || ui.add)) { ui.menu = ui.add = false; draw(); } };
    root.addEventListener('keydown', onKey);
    draw();
    refresh();
    return {
      refresh,
      setDark(on) { host.classList.toggle('dark', on); },
      destroy() { alive = false; chrome.storage.onChanged.removeListener(onStorage); },
    };
  }

  // The Parent | Kid switch of an app's own page (the parent screens, the blank app). Kid mode needs a PIN first;
  // parent mode always goes through the PIN page.
  const SWITCH_CSS = `
    :host { all: initial; display: inline-block; font: 500 14px/1 Roboto, system-ui, -apple-system, "Segoe UI", sans-serif; }
    .seg { display: inline-flex; padding: 3px; border-radius: 18px; background: #f2f2f2; gap: 2px; }
    button { font: inherit; border: 0; cursor: pointer; height: 30px; padding: 0 14px; border-radius: 15px; background: transparent; color: #606060; }
    button.on { background: #fff; color: #0f0f0f; box-shadow: 0 1px 3px rgba(0,0,0,.15); cursor: default; }
    button:focus-visible { outline: 2px solid #065fd4; outline-offset: 1px; }
    @media (prefers-color-scheme: dark) {
      .seg { background: #272727; }
      button { color: #aaa; }
      button.on { background: #3a3a3a; color: #f1f1f1; }
    }
  `;
  function modeSwitch(mode) {
    const host = document.createElement('span');
    const root = host.attachShadow({ mode: 'closed' });
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Mode');
    const toKid = async () => {
      const { settings = {} } = await chrome.storage.local.get('settings');
      if (!settings.pinHash) { location.href = chrome.runtime.getURL('core/pages/pin.html?for=kid'); return; }
      ask({ type: 'kidHome' });
    };
    for (const [m, label, go] of [['parent', 'Parent', () => ask({ type: 'parentGate' })], ['kid', 'Kid', toKid]]) {
      const b = el('button', m === mode ? 'on' : '', label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(m === mode));
      if (m !== mode) b.addEventListener('click', go);
      seg.append(b);
    }
    root.append(el('style', '', SWITCH_CSS), seg);
    return host;
  }

  globalThis.KidTubeHeader = { mount, modeSwitch };
})();
