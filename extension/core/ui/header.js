// The apps header of Custom Apps (the extension: KidTube and Instagram are its apps, none is the center): the bar above
// YouTube (core/content/shell.js), above an app's own pages (parent screens) and above Instagram's screen on
// instagram.com (apps/instagram/content/app.js). The same for every app.
// One bar: the logo with the version (a newer one above it, in blue: a tap gets it), the App | site switch (the app,
// or its site without the app: YouTube, Instagram), the connected profile (its menu: GitHub, the settings file), and
// Connect on a site's own page (YouTube, Instagram): the account signed in there becomes the profile
// (core/background/profiles.js connect). Signing in and switching accounts happen with the site's own buttons. Below:
// the GitHub connection (first time), or the apps row: each app (KidTube, Instagram), dimmed while its site's account
// has no profile in it; and the notifications (the 🔔: notes, the AI run, problems, a new version; inboxList).
// Hidden in kid mode (shell.js and the pages decide).
// A plain script, not a module, so the YouTube content script can use it too: it sets globalThis.KidTubeHeader.
// No innerHTML anywhere: YouTube's Trusted Types policy refuses it.
(() => {
  if (globalThis.KidTubeHeader) return;
  // Same as lib/ask.js. Orion only returns sendMessage answers to the callback. 15 s; a note's Send (inbox) 60 s, as
  // ↻ Update (lib/ask.js WAIT: a whole sync and the run request, 8–9 s on a slow tablet).
  const LONG = { inbox: 60000 };
  const ask = (msg, ms = LONG[msg?.type] ?? 15000) => new Promise((resolve) => {
    const timer = setTimeout(() => { globalThis.KidTubeWatch?.noAnswer(msg, ms); resolve(undefined); }, ms);
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
    .vers { display: flex; flex-direction: column; justify-content: center; gap: 1px; white-space: nowrap; font-size: 11px; font-weight: 500; letter-spacing: 0; line-height: 1.15; }
    .ver { color: var(--muted); }
    .newver { color: var(--blue); font-weight: 700; font-size: 11px; text-decoration: underline; text-underline-offset: 2px; text-align: left; }
    .seg { display: inline-flex; padding: 3px; gap: 2px; border-radius: 18px; background: var(--soft); flex: none; }
    .seg button { height: 30px; padding: 0 12px; border-radius: 15px; color: var(--muted); font-weight: 500; white-space: nowrap; }
    .seg button:not(.on):hover { color: var(--ink); }
    .seg .on { background: var(--bg); color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,.15); cursor: default; }
    .grow { flex: 1 1 auto; min-width: 0; }
    .muted { color: var(--muted); }
    .btn { height: 36px; padding: 0 16px; border-radius: 18px; background: var(--soft); font-weight: 500; white-space: nowrap;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
    .btn:not(:disabled):hover { background: var(--hover); }
    .btn.primary { background: var(--ink); color: var(--bg); }
    .btn.primary:not(:disabled):hover { opacity: .85; background: var(--ink); }
    .round { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; flex: none; color: var(--muted); }
    .round:hover, .round[aria-pressed=true] { background: var(--soft); color: var(--ink); }
    .who { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 10px 0 4px; border-radius: 20px; min-width: 0; }
    .who:hover, .who[aria-expanded=true] { background: var(--soft); }
    .who .email { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
    .who .email b { color: var(--ink); font-weight: 500; }
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
    .empty { color: var(--muted); padding: 0 4px; align-self: center; }
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
    .app.none .icon { opacity: .45; }
    .here { font-size: 12px; color: var(--muted); padding: 0 16px 8px; margin-top: -4px; }
    .bell { position: relative; }
    .badge { position: absolute; top: 2px; right: 0; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--accent);
      color: #fff; font-size: 11px; font-weight: 700; line-height: 18px; text-align: center; box-shadow: 0 0 0 2px var(--bg); }
    .badge.calm { background: var(--blue); }
    .inbox { margin: 0 12px 10px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
    .nrow { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto auto; gap: 4px 10px; align-items: center; padding: 8px 12px;
      border-top: 1px solid var(--line); }
    .nrow:first-child { border-top: 0; }
    .nrow.done { opacity: .7; }
    .chip { display: inline-block; height: 22px; line-height: 22px; padding: 0 8px; border-radius: 11px; font-size: 12px; font-weight: 600;
      white-space: nowrap; background: var(--soft); color: var(--muted); }
    .chip.error { background: color-mix(in srgb, var(--bad) 14%, var(--bg)); color: var(--bad); }
    .chip.validation { background: color-mix(in srgb, #e37400 16%, var(--bg)); color: #b06000; }
    .chip.data, .chip.update { background: var(--blue-soft); color: var(--blue); }
    .chip.note { background: color-mix(in srgb, #8430ce 14%, var(--bg)); color: #8430ce; }
    .chip.question { background: color-mix(in srgb, #007b83 15%, var(--bg)); color: #007b83; } :host(.dark) .chip.question { color: #78d9ec; }
    :host(.dark) .chip.validation { color: #fdd663; } :host(.dark) .chip.note { color: #d7aefb; }
    .st { font-size: 12px; font-weight: 600; white-space: nowrap; }
    .st::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: 0; background: var(--muted); }
    .st.bad { color: var(--bad); } .st.bad::before { background: var(--bad); }
    .st.wait { color: var(--blue); } .st.wait::before { background: var(--blue); }
    .st.ok { color: var(--ok); } .st.ok::before { background: var(--ok); }
    .msg { min-width: 0; display: grid; gap: 1px; }
    .msg b { font-weight: 500; overflow-wrap: anywhere; }
    .msg span { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
    .msg span.answer { font-size: 14px; color: var(--ink); white-space: pre-wrap; padding: 2px 0; }
    .msg textarea { font: inherit; font-size: 14px; width: 100%; min-height: 60px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--line);
      background: var(--bg); color: var(--ink); resize: vertical; }
    .acts { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
    .acts button { height: 28px; padding: 0 10px; border-radius: 14px; background: var(--soft); font-size: 13px; font-weight: 500; white-space: nowrap; }
    .acts button:not(:disabled):hover { background: var(--hover); }
    .acts button.go { background: var(--ink); color: var(--bg); }
    .acts button.sure { background: var(--bad); color: #fff; }
    .count { min-width: 28px; text-align: right; font-size: 13px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
    .nmore { display: block; width: 100%; padding: 8px 12px; border-top: 1px solid var(--line); color: var(--blue); font-size: 13px; font-weight: 500; text-align: left; }
    .nnone { padding: 10px 12px; color: var(--muted); font-size: 13px; }
    @media (max-width: 600px) {
      .who .email, .brand .name, .who > svg, .bar > .btn.primary span { display: none; }
      .bar { gap: 6px; padding: 0 8px 0 12px; }
      .bar > .btn.primary { padding: 0 10px; }
      .seg button { padding: 0 10px; }
      .card { grid-template-columns: 1fr; }
      .nrow { grid-template-columns: auto minmax(0, 1fr) auto; }
      .nrow .msg { grid-column: 1 / -1; grid-row: 2; }
      .nrow .acts { grid-column: 1 / -1; grid-row: 3; justify-content: flex-start; }
      .nrow .count { grid-column: 3; grid-row: 1; }
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
    camera: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3.17L15 2H9zm3 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10z',
    link: 'M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12zM8 13h8v-2H8v2zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z',
    cloud: 'M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A6 6 0 0 0 6 20h13a5 5 0 0 0 .35-9.96z',
    download: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
    upload: 'M5 20h14v-2H5v2zm4-4h6v-6h4l-7-7-7 7h4v6z',
    caret: 'M7 10l5 5 5-5z',
    grid: 'M4 4h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 10h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 16h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4z',
    bell: 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  };
  // The logo: four tiles, one per app and more to come.
  function logo() {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 22 22'); s.setAttribute('width', '24'); s.setAttribute('height', '24'); s.setAttribute('aria-hidden', 'true');
    for (const [x, y, fill] of [[0, 0, '#ff3b30'], [12, 0, '#d62976'], [0, 12, '#065fd4'], [12, 12, '#1e8e3e']]) {
      const r = document.createElementNS(NS, 'rect');
      for (const [k, v] of Object.entries({ x, y, width: 10, height: 10, rx: 3, fill })) r.setAttribute(k, v);
      s.append(r);
    }
    return s;
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

  // The settings file (Save / Load): the GitHub connection and the PIN (background/profiles.js exportSettings).
  function saveFile(root, file) {
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'custom-apps-settings.json' });
    root.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // The new version's tap (core/background/updates.js openUpdate): what happens next, by how this copy was installed.
  // Quetta: what the browser said when it was asked (core/background/updates.js askNow).
  const UPDATING = {
    update_available: (v) => `The browser is downloading ${v}. Custom Apps restarts by itself in about a minute; then only ${v} shows next to the logo.`,
    throttled: (v) => `The browser says it checked a short time ago and wants to wait, so ${v} is not installed yet. If it is still not installed in 10 minutes, tap the version again: it opens the install page to install it by hand.`,
    asking: (v) => `The browser is checking for ${v}. The label next to the logo shows what it found in a minute.`,
    no_update: (v) => `The browser does not see ${v} yet (the site can be up to 10 minutes behind). Try again in a few minutes.`,
    error: (v) => `The browser could not check for ${v}. Try again in a few minutes, or install it by hand from the install page.`,
  };
  const BY_HAND = (v) => `The install page opened. Tap Download .crx, then open Quetta’s ⋮ → Extensions and install the file (choose the .crx in Downloads). Your settings and lists stay. After that only ${v} shows next to the logo.`;
  // The new version above the current one: what it is doing now (Quetta's phase), and what a tap does.
  const NEWER = {
    quetta: (v, p) => (p === 'installing' ? `${v} is downloading: Custom Apps restarts by itself`
      : p === 'manual' ? `${v} is not installed yet: tap to install it by hand from the install page` : `${v} is ready: tap to install it now`),
    orion: (v) => `Version ${v} is ready: tap to download it from the install page`,
    dev: (v) => `Version ${v} is on GitHub: tap, then git pull and Reload`,
  };
  const NEW_LABEL = { installing: (v) => `↓ ${v} installing…`, manual: (v) => `↑ ${v} · by hand` };

  // --- the header -------------------------------------------------------------------------------------------
  // host: an element to draw into (its shadow root). dark: YouTube's own theme (shell.js); on the extension's pages, the system's.
  // siteView: the switch's site button on a page that is both (Instagram's Saved page: the app's view and Instagram's
  // own); without it, the site button opens the plain site (no app runs).
  // Returns { refresh(force), setDark(on), destroy() }.
  function mount(host, { dark = !!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches, siteView = null } = {}) {
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'closed' });
    host.classList.toggle('dark', dark);
    // The account menu drops down over the page below, its sticky toolbar too (the parent tabs):
    // lift the bar above the page's own layers. On YouTube shell.js already pins it on top.
    if (!host.style.position) { host.style.position = 'relative'; host.style.zIndex = '100'; }
    const style = el('style', '', CSS);
    const box = el('div', 'kt');
    root.replaceChildren(style, box);
    const picker = Object.assign(el('input'), { type: 'file', accept: '.json,application/json', hidden: true });
    root.append(picker);
    const W = globalThis.KidTubeWatch;   // the checks (core/ui/watch.js)
    W?.watchTaps(root, 'header');

    let data = null, alive = true, busy = '', loading = false, again = null, ver = null;
    const ui = { menu: false, github: false, repo: null, token: '', note: '', noteKind: '', apps: false,
      inbox: true, all: false, edit: null, sure: null };
    // The notifications list starts open; the bell closes it, and it stays closed on every page (storage headerUi).
    // A new problem report opens it again (instead of core/ui/watch.js's banner on a page without the header).
    globalThis.KidTubeHeaderShown = true;
    chrome.storage.local.get('headerUi').then((g) => { if (g.headerUi?.inboxClosed && alive) { ui.inbox = false; draw(); } }).catch(() => {});
    async function newReport() {
      const r = await ask({ type: 'checkAlert' });
      if (r?.alert && alive && !ui.inbox) { ui.inbox = true; draw(); }
    }
    // The round apps button shows or hides the apps row. It starts closed on every page and every reload.
    const say = (text, kind = '') => { ui.note = text; ui.noteKind = kind; draw(); };

    // A refresh asked for while one is running is not dropped: it runs right after (the storage can change twice).
    let first = true;
    async function refresh(force = false) {
      if (!alive) return;
      if (loading) { again = again || force; return; }
      loading = true;
      try {
        const h = await ask({ type: 'header', refresh: force });
        if (first && alive) {
          first = false;
          W?.check({ id: 'header.loads', area: 'header', expect: 'The apps header gets what to show from the background',
            code: ['core/ui/header.js refresh', 'core/background/profiles.js headerView'] }, (t) => { t.ok('answer to "header"', !!h?.ok, h ?? 'no answer in 15 s', '{ ok: true, … }'); });
        }
        readVersion();
        if (!alive || !h?.ok) return;
        data = { github: {}, apps: [], ...h };
        // Typing in the GitHub form or in a note: don't redraw under the cursor.
        if (!root.activeElement || !['INPUT', 'TEXTAREA'].includes(root.activeElement.tagName)) draw();
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
    const openApp = (id) => act('Opening…', { type: 'openApp', app: id }).then((r) => {
      if (r?.ok && r.url && !r.navigated) location.href = r.url;
    });

    // The version next to the logo, and a newer one above it: read with the header's refreshes, at most every
    // 10 minutes (the background keeps its answer 5 minutes).
    let verAt = 0, verTimer = null;
    // While a newer one waits: every minute, so the label follows the browser (installing → installed: one version).
    async function readVersion(force = false) {
      if (!force && Date.now() - verAt < (ver?.newer ? 60000 : 10 * 60000)) return;
      verAt = Date.now();
      const v = await ask({ type: 'version', fresh: force });
      if (!alive || !v?.ok) return;
      const changed = !ver || ver.installed !== v.installed || ver.latest !== v.latest || ver.newer !== v.newer || ver.phase !== v.phase;
      ver = v;
      if (changed) draw();
      // A newer one waits: look again in a minute, so the label follows it (installing, then one version).
      clearTimeout(verTimer);
      if (v.newer && alive) verTimer = setTimeout(() => readVersion(true), 60000);
    }
    async function getUpdate(manual = false) {
      const r = await act('Updating…', { type: 'openUpdate', manual });
      if (!r?.ok) return;
      readVersion(true);
      const v = r.latest ?? ver?.latest ?? 'the new version';
      if (r.kind === 'quetta' && r.manual) say(BY_HAND(v), 'ok');
      else if (r.kind === 'quetta') say((UPDATING[r.status] ?? UPDATING.error)(v), r.status === 'update_available' ? 'ok' : '');
      else if (r.kind === 'dev') say('Run git pull in the extension’s folder, then press ⟳ Reload on Custom Apps in the tab that opened.', 'ok');
      else say('Download the new .zip on the install page that opened, then install it in Orion the same way as the first time.', 'ok');
    }
    function brand() {
      const b = el('div', 'brand');
      const vers = el('span', 'vers');
      if (ver?.newer) {
        const n = button('newver', NEW_LABEL[ver.phase]?.(ver.latest) ?? `↑ ${ver.latest}`, () => getUpdate());
        n.title = NEWER[ver.kind]?.(ver.latest, ver.phase) ?? `Version ${ver.latest} is ready`;
        n.disabled = !!busy;
        vers.append(n);
      }
      // The version on every page: which build this browser runs (an unpacked copy from git too).
      vers.append(el('span', 'ver', ver?.installed ?? chrome.runtime.getManifest?.().version ?? ''));
      b.append(logo(), el('span', 'name', 'Custom Apps'), vers);
      return b;
    }

    // The App | site switch, the same for every app (core/background/profiles.js switchOf).
    function siteSwitch(sw) {
      const seg = el('div', 'seg');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', `App or ${sw.siteLabel}`);
      const toSite = () => (siteView ? siteView() : plainSite(sw.site));
      for (const [side, label, title, go] of [
        ['app', 'App', sw.on === 'app' ? `${sw.label}: you are here` : `Open ${sw.label}`, () => openApp(sw.app)],
        ['site', sw.siteLabel, `${sw.siteLabel} itself, without the app`, toSite]]) {
        const b = button(sw.on === side ? 'on' : '', label, () => { if (sw.on !== side) go(); });
        b.title = title;
        b.setAttribute('aria-pressed', String(sw.on === side));
        b.disabled = !!busy && sw.on !== side;
        seg.append(b);
      }
      return seg;
    }

    // Connect: the site's page reads its account again (shell.js on YouTube, apps/instagram/content/app.js on
    // Instagram), then that account's profile runs: loaded, or made new. The same profile: only the message.
    async function connectHere() {
      busy = 'Connecting…'; ui.note = ''; ui.menu = false; draw();
      await globalThis.KidTubeAccount?.read?.();
      const r = await ask({ type: 'connect' });
      busy = '';
      if (!r?.ok) return say(r?.error ?? 'Could not connect. Try again.', 'err');
      say(r.message, 'ok');
      if (r.url && !r.navigated) location.href = r.url;
    }

    // The switch's site side: the plain site, no app running (YouTube with this header above it, Instagram with its Connect bar).
    const plainSite = (site) => act('Opening…', { type: 'plainSite', site }).then((r) => { if (r?.ok && r.url && !r.navigated) location.href = r.url; });

    async function connect() {
      const repo = (ui.repo ?? data.github.repo ?? '').trim();
      busy = 'Connecting…'; ui.note = ''; draw();
      const r = await ask({ type: 'connectGitHub', repo, token: ui.token.trim() });
      busy = '';
      if (r?.ok) {
        ui.github = false; ui.token = ''; ui.repo = null;
        say(`Connected to ${r.repo} ✓ ${r.synced ? 'Your lists and rules are loaded.' : 'Open an app to load its lists and rules.'}`, 'ok');
        refresh(true);
      } else say(r?.error ?? 'Could not connect. Check the repo and the token.', 'err');
    }
    async function exportFile() {
      ui.menu = false;
      const r = await ask({ type: 'exportSettings' });
      if (!r?.ok) return say(r?.error ?? 'Could not make the file.', 'err');
      saveFile(root, r.file);
      say('Saved as custom-apps-settings.json (Downloads / Files). It holds your GitHub token: keep it on this device.', 'ok');
    }
    picker.addEventListener('change', async () => {
      const f = picker.files?.[0];
      picker.value = '';
      if (!f) return;
      let file;
      try { file = JSON.parse(await f.text()); } catch { return say('That file is not a Custom Apps settings file.', 'err'); }
      const r = await act('Loading…', { type: 'importSettings', file });
      if (r?.ok) { ui.github = false; say(`Settings loaded ✓ The token, the repo and the PIN are the ones from the file.${r.errors?.length ? '' : ' The data is loaded from GitHub.'}`, 'ok'); refresh(true); }
    });

    function accountMenu() {
      const m = el('div', 'pop menu');
      m.setAttribute('role', 'menu');
      const head = el('div', 'head');
      const t = el('div');
      const c = data.connected;
      t.append(el('b', '', c?.who ?? 'Not connected'), el('span', 'muted', c ? `${c.label} · ${c.site} account` : 'Press Connect on YouTube or Instagram'));
      head.append(avatar(c?.who?.replace(/^@/, ''), true), t);
      const item = (path, label, onTap, sub) => {
        const b = button('item', label, onTap, path);
        b.setAttribute('role', 'menuitem');
        if (sub) b.append(el('span', 'sub', sub));
        return b;
      };
      m.append(head);
      // What this page's site said last: after the site's own account switch, Connect takes this one.
      const here = data.here;
      if (here) {
        const at = here.checkedAt ? ` · checked ${new Date(here.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '';
        m.append(el('p', 'here', `${here.label} here: ${here.name ?? (here.signedIn ? 'an account it did not name' : here.seen ? 'nobody signed in' : 'not read yet')}${at}`));
      }
      m.append(
        item(PATH.cloud, 'GitHub connection', () => { ui.menu = false; ui.github = true; draw(); }, data.github.connected ? data.github.repo : 'not connected'),
        item(PATH.download, 'Save settings to a file', exportFile),
        item(PATH.upload, 'Load settings from a file', () => { ui.menu = false; draw(); picker.click(); }));
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
        placeholder: data.github.connected ? `saved: ${data.github.tokenHint ?? '…'}` : 'github_pat_…' });
      token.addEventListener('input', () => {
        ui.token = token.value;
        go.disabled = !!busy || (!token.value.trim() && !data.github.connected);
        go.lastChild.textContent = goLabel();
      });
      token.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !go.disabled) connect(); });
      const l1 = el('label', '', 'Data repo'), l2 = el('label', '', 'GitHub token');
      l1.append(repo); l2.append(token);
      const fields = el('div', 'fields');
      fields.append(l1, l2);
      // Connected and no new token typed: the same button loads everything from GitHub again with the saved one.
      const goLabel = () => (busy === 'Connecting…' ? busy : data.github.connected && !ui.token.trim() ? 'Load from GitHub' : 'Connect');
      const go = button('btn primary', goLabel(), connect);
      go.disabled = !!busy || (!ui.token.trim() && !data.github.connected);
      const side = el('div', 'side');
      const load = button('btn', 'Load from file', () => picker.click(), PATH.upload);
      load.dataset.check = 'none';   // opens the file picker: nothing on the page changes until a file is picked
      side.append(go, load, button('btn', 'Save to file', exportFile, PATH.download));
      if (!first) side.append(button('btn', 'Cancel', () => { ui.github = false; ui.token = ''; ui.repo = null; ui.note = ''; draw(); }));
      card.append(el('h2', '', first ? 'Connect your data on GitHub' : 'GitHub connection'), lead, fields);
      if (data.github.connected) card.append(el('p', 'status ok', `Token saved on this tablet: ${data.github.tokenHint ?? '…'}. Type a new one only to change it.`));
      card.append(side);
      if (ui.note) card.append(el('p', `status ${ui.noteKind}`, ui.note));
      return card;
    }

    // The notifications (core/background/inbox.js, only where the parent is), one row each:
    // [type] [status] the message [its buttons] [how many times]. The header adds two kinds of its own: a newer
    // version (App update) and what its last action said (System, with ✕).
    const TYPE = { error: 'Error', validation: 'Validation', data: 'Data update', note: 'My note', question: 'Question', update: 'App update', system: 'System' };
    const SHOWN = 5;
    function rowsNow(h) {
      const rows = [...(h.inbox ?? [])];
      if (ver?.newer) rows.unshift(updateRow(ver));
      const note = ui.github ? '' : ui.note || h.error;
      if (note) {
        const tone = ui.note ? ui.noteKind : 'err';
        rows.unshift({ id: 'system', type: 'system', status: { text: tone === 'err' ? 'Failed' : tone === 'ok' ? 'Done' : 'Info', tone: tone === 'err' ? 'bad' : tone === 'ok' ? 'ok' : '' },
          title: note, detail: ui.note ? '' : 'The apps list could not be read from GitHub.', actions: ui.note ? [{ do: 'dismiss', label: '✕' }] : [] });
      }
      return rows;
    }
    // The App update row: where the new version is, in plain words, and what to do.
    function updateRow(v) {
      const base = { id: 'update', type: 'update', title: `Custom Apps ${v.latest} is out. This browser has ${v.installed}.` };
      if (v.kind !== 'quetta') return { ...base, status: { text: 'New', tone: 'wait' }, detail: NEWER[v.kind]?.(v.latest) ?? '', actions: [{ do: 'update', label: 'Get it' }] };
      const asked = v.askedAt ? ` (asked at ${new Date(v.askedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : '';
      const said = { throttled: 'it wants to wait', no_update: 'it does not see the new version yet', error: 'it could not check' }[v.status];
      if (v.phase === 'installing') return { ...base, status: { text: 'Installing', tone: 'wait' }, actions: [],
        detail: `The browser is downloading it${asked}. Custom Apps restarts by itself; then this row goes away.` };
      if (v.phase === 'manual') return { ...base, status: { text: 'By hand', tone: 'bad' }, actions: [{ do: 'update.manual', label: 'Install by hand' }],
        detail: v.why === 'zip' ? 'This copy was installed from a .zip, so the browser cannot update it. Install the .crx from the install page once: after that the browser updates it by itself.'
          : `The browser did not install it${said ? ` (${said})` : ''}${asked}. Install it from the install page: download the .crx and open it in Quetta’s Extensions. Your settings stay.` };
      return { ...base, status: { text: 'Waiting', tone: 'wait' }, actions: [{ do: 'update', label: 'Install now' }, { do: 'update.manual', label: 'By hand' }],
        detail: `${said ? `The browser was asked${asked}: ${said}. It looks again by itself.` : 'Tap Install now: the browser downloads it and Custom Apps restarts.'}` };
    }
    const waiting = (rows) => rows.filter((r) => !r.done && r.type !== 'system').length;

    async function tapRow(r, a) {
      if (a.do === 'dismiss') { ui.note = ''; return draw(); }
      if (a.do === 'update') return getUpdate();
      if (a.do === 'update.manual') return getUpdate(true);
      if (a.do === 'open') {
        const o = await ask({ type: 'openAiPage', page: a.page });
        if (!o?.ok) say(o?.error ?? 'That didn’t work. Try again.', 'err');
        return;
      }
      if (a.do === 'note.edit') { ui.edit = { id: r.note, text: r.title }; ui.sure = null; draw(); root.querySelector('textarea')?.focus(); return; }
      // Delete asks once more on the same button: a dictated note can be long.
      if (a.do === 'note.drop' && ui.sure !== r.id) { ui.sure = r.id; return draw(); }
      ui.sure = null;
      const busyText = { 'question.dismiss': 'Closing…', 'note.drop': 'Deleting…', 'note.send': 'Sending…', run: 'Asking…', 'problems.send': 'Sending…', sync: 'Saving…' }[a.do] ?? 'Working…';
      const res = await act(busyText, { type: 'inbox', do: a.do, id: r.note });
      if (res?.ok && res.message) say(res.message, 'ok');
      refresh(true);
    }
    async function saveEdit() {
      const e = ui.edit;
      if (!e) return;
      const res = await act('Saving…', { type: 'inbox', do: 'note.edit', id: e.id, text: e.text });
      if (res?.ok) { ui.edit = null; refresh(true); }
    }

    function inboxRow(r) {
      const row = el('div', `nrow${r.done ? ' done' : ''}`);
      row.dataset.id = r.id;
      const st = el('span', `st ${r.status?.tone ?? ''}`, `${r.status?.text ?? ''}${r.tries > 1 ? ` · try ${r.tries}` : ''}`);
      if (r.tries > 1) st.title = `Sent to the AI ${r.tries} times: once for each version that still had it`;
      const msg = el('div', 'msg');
      const editing = !!r.note && ui.edit?.id === r.note && r.actions?.some((a) => a.do === 'note.edit');
      const acts = el('div', 'acts');
      if (editing) {
        const box = Object.assign(el('textarea'), { value: ui.edit.text, maxLength: 2000 });
        box.addEventListener('input', () => { ui.edit.text = box.value; save.disabled = !box.value.trim() || !!busy; });
        box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); ui.edit = null; draw(); } });
        msg.append(box);
        const save = button('go', 'Save', saveEdit);
        save.disabled = !ui.edit.text.trim() || !!busy;
        acts.append(save, button('', 'Cancel', () => { ui.edit = null; draw(); }));
      } else {
        msg.append(el('b', '', r.title));
        if (r.answer) msg.append(el('span', 'answer', `Answer: ${r.answer}`));   // the AI's answer to a question
        if (r.detail) msg.append(el('span', '', r.detail));
        if (r.state) msg.append(el('span', '', r.state));
        for (const a of r.actions ?? []) {
          const sure = a.do === 'note.drop' && ui.sure === r.id;
          const b = button(sure ? 'sure' : a.do === 'note.send' ? 'go' : '', sure ? 'Sure? Delete' : a.label, () => tapRow(r, a));
          b.disabled = !!busy;
          if (a.do === 'note.send') b.title = 'Send this note to the AI now (the other notes keep waiting)';
          if (a.do === 'dismiss') b.title = 'Hide this message';
          acts.append(b);
        }
      }
      if (r.more) row.title = r.more;   // the check's id and versions, for when the parent asks the AI about it
      const count = el('span', 'count', r.count != null ? `×${r.count}` : '');
      if (r.count != null) count.title = `It happened ${r.count} time${r.count === 1 ? '' : 's'}. The same problem again only counts up: it is not sent again.`;
      row.append(el('span', `chip ${r.type}`, TYPE[r.type] ?? r.type), st, msg, acts, count);
      return row;
    }
    function inboxList(rows) {
      const box = el('div', 'inbox');
      box.setAttribute('role', 'list');
      box.setAttribute('aria-label', 'Notifications');
      if (!rows.length) { box.append(el('div', 'nnone', 'No notifications: nothing waits for you or for the AI.')); return box; }
      const shown = ui.all ? rows : rows.slice(0, SHOWN);
      for (const r of shown) box.append(inboxRow(r));
      if (rows.length > SHOWN) box.append(button('nmore', ui.all ? 'Show fewer' : `Show all ${rows.length}`, () => { ui.all = !ui.all; draw(); }));
      return box;
    }

    function draw() {
      if (!alive) return;
      const h = data;
      const kids = [];
      const bar = el('div', 'bar');
      bar.append(brand(), el('div', 'grow'));
      kids.push(bar);
      if (!h) {
        bar.append(el('span', 'muted', 'Loading…'));
      } else {
        const c = h.connected;
        const who = button('who', '', () => { ui.menu = !ui.menu; draw(); });
        who.setAttribute('aria-haspopup', 'menu');
        who.setAttribute('aria-expanded', String(ui.menu));
        who.title = c ? `${c.label}: ${c.who}` : 'No account connected';
        const name = el('span', 'email');
        if (c) name.append(el('b', '', c.who)); else name.append('Not connected');
        who.append(avatar(c?.who?.replace(/^@/, '')), name, icon(PATH.caret, 20));
        const grid = button('round', '', () => {
          ui.apps = !ui.apps;
          draw();
          const want = ui.apps;
          W?.check({ id: 'header.appsToggle', area: 'header', expect: 'The round apps button shows or hides the apps row',
            code: ['core/ui/header.js draw (grid)'] }, (t) => {
            if (ui.github || ui.menu) return t.skip('a card or the menu is open');
            t.eq('the apps row shown', want, !!box.querySelector('.apps'));
          }, 1000);
        }, PATH.grid);
        grid.title = ui.apps ? 'Hide the apps' : 'Show the apps';
        grid.setAttribute('aria-label', grid.title);
        grid.setAttribute('aria-pressed', String(ui.apps));
        if (h.switch) bar.append(siteSwitch(h.switch));
        // The bell: shows or hides the notifications; its number is what still waits (red: something needs you).
        const rows = rowsNow(h);
        const shownInbox = h.inbox != null || rows.length > 0;
        if (shownInbox) {
          const n = waiting(rows);
          const bell = button('round bell', '', () => {
            ui.inbox = !ui.inbox;
            chrome.storage.local.set({ headerUi: { inboxClosed: !ui.inbox } }).catch(() => {});
            draw();
          }, PATH.bell);
          bell.title = `${ui.inbox ? 'Hide' : 'Show'} the notifications${n ? ` (${n} waiting)` : ''}`;
          bell.setAttribute('aria-label', bell.title);
          bell.setAttribute('aria-pressed', String(ui.inbox));
          if (n) bell.append(el('span', `badge${rows.some((r) => !r.done && r.status?.tone === 'bad') ? '' : ' calm'}`, n > 99 ? '99+' : String(n)));
          bar.append(bell);
        }
        if (h.github.connected) bar.append(grid);
        bar.append(who);
        // Connect only on a site's own page (an extension page has no signed-in account to take).
        if (h.site && h.open) {
          const go = button('btn primary', busy === 'Connecting…' ? busy : 'Connect', connectHere, PATH.link);
          go.title = `Connect the ${h.here.label} account signed in here${h.here.name ? ` (${h.here.name})` : ''}`;
          go.disabled = !!busy;
          bar.append(go);
        }

        if (!h.github.connected || ui.github) kids.push(githubCard(!h.github.connected));
        else if (ui.apps) {
          const row = el('div', 'apps');
          const tiles = el('div', 'tiles');
          // Each app (ringed: the one that runs; dimmed: no profile yet for the account its site has signed in).
          for (const a of h.apps) {
            const t = el('button', `app${a.active ? ' on' : ''}${a.has ? '' : ' none'}`);
            t.type = 'button';
            t.title = a.active ? `${a.label}: its home` : a.has ? `Open ${a.label} for ${a.who}`
              : a.who ? `${a.label}: no profile for ${a.who} yet. Press Connect on ${a.site}.` : `${a.label}: sign in on ${a.site}, then press Connect there.`;
            t.append(appIcon(a), el('span', 'name', a.label));
            t.disabled = !!busy;
            t.addEventListener('click', () => openApp(a.id));
            tiles.append(t);
          }
          row.append(tiles, el('div', 'grow'));
          if (busy) row.append(el('span', 'muted', busy));
          kids.push(row);
          const missing = h.apps.filter((a) => !a.has);
          if (missing.length) {
            kids.push(el('p', 'note muted', missing.map((a) => (a.who ? `${a.label}: no profile for ${a.who} yet. Press Connect on ${a.site}.`
              : `${a.label}: sign in on ${a.site}, then press Connect there.`)).join(' ')));
          }
        }
        if (shownInbox && ui.inbox && h.github.connected && !ui.github) kids.push(inboxList(rows));
        else if (!h.github.connected || ui.github) { /* the GitHub card shows its own message */ }
        else if (ui.note || h.error) kids.push(el('p', `note ${ui.note ? ui.noteKind : 'err'}`, ui.note || h.error));
        if (ui.menu) kids.push(accountMenu());
      }
      if (ui.menu) {
        const scrim = el('div', 'scrim');
        scrim.addEventListener('click', () => { ui.menu = false; draw(); });
        kids.unshift(scrim);
      }
      box.replaceChildren(...kids);
    }

    // The notifications' sources change often (the checks after every message): at most one refresh a second for them.
    let aiTimer = null;
    const onStorage = (ch) => {
      if (ch.checkAlert?.newValue && !ch.checkAlert.newValue.shown) newReport();
      if (ch.updateState) readVersion(true);
      if (ch.ytAccount || ch.igAccount || ch.settings || ch.accounts || ch.repoProfiles || ch.account || ch.shell) refresh();
      else if (ch.outbox || ch.data || ch.ig || ch.checks || ch.notes || ch.syncStatus) { clearTimeout(aiTimer); aiTimer = setTimeout(() => refresh(), 1000); }
    };
    chrome.storage.onChanged.addListener(onStorage);
    const onKey = (e) => { if (e.key === 'Escape' && ui.menu) { ui.menu = false; draw(); } };
    root.addEventListener('keydown', onKey);
    draw();
    refresh();
    newReport();
    return {
      refresh,
      setDark(on) { host.classList.toggle('dark', on); },
      destroy() { alive = false; clearTimeout(aiTimer); clearTimeout(verTimer); chrome.storage.onChanged.removeListener(onStorage); },
    };
  }

  // The Parent | Kid switch of an app's own page (the parent screens). Kid mode needs a PIN first;
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
      // The page sees parent mode end before the background moves the tab: it must not go to the PIN page then.
      globalThis.kidtubeLeaving = true;
      const r = await ask({ type: 'kidHome' });
      // A browser that didn't move the tab (or a reply that came before it did): go there from here.
      if (r?.url) setTimeout(() => { if (location.href !== r.url) location.href = r.url; }, 1500);
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
