// The apps header of Custom Apps (the extension: KidTube and Instagram are its apps, none is the center): the bar above
// YouTube (core/content/shell.js), above an app's own pages (parent screens) and above Instagram's screen on
// instagram.com (apps/instagram/content/app.js). The same for every app.
// One bar: the logo with the version (a newer one above it, in blue: a tap gets it), the App | site switch (the app,
// or its site without the app: YouTube, Instagram), the connected profile (its menu: GitHub, the settings file), and
// Connect on a site's own page (YouTube, Instagram): the account signed in there becomes the profile
// (core/background/profiles.js connect). Signing in and switching accounts happen with the site's own buttons. Below:
// the GitHub connection (first time), or the apps row: each app (KidTube, Instagram), dimmed while its site's account
// has no profile in it; and the notifications (the 🔔: notes, the AI run, problems, a new version; inboxList); a tap on one opens its Details
// (detailView: its sections, and the AI run's report with every step, core/background/inbox.js readReport).
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
    input, select { font: inherit; font-size: 15px; height: 40px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--line);
      background: var(--bg); color: var(--ink); width: 100%; margin: 0; }
    .side { display: flex; flex-direction: column; gap: 8px; min-width: 150px; }
    .status { grid-column: 1 / -1; margin: 0; font-size: 13px; color: var(--muted); }
    .err { color: var(--bad) !important; }
    .dev { height: 26px; padding: 0 9px; border-radius: 13px; background: var(--blue-soft); color: var(--blue); font-size: 11px; font-weight: 700; letter-spacing: .5px; flex: none; }
    .dev.off { background: var(--soft); color: var(--muted); }
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
      border-top: 1px solid var(--line); background: var(--bg); touch-action: pan-y; user-select: none; -webkit-user-select: none; }
    .nrow.back { transition: transform .15s, opacity .15s; }
    .nhint { padding: 6px 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
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
    .msg span.pvers { font-size: 11px; }
    .msg span.answer { font-size: 14px; color: var(--ink); white-space: pre-wrap; padding: 2px 0; }
    .msg textarea { font: inherit; font-size: 14px; width: 100%; min-height: 60px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--line);
      background: var(--bg); color: var(--ink); resize: none; overflow: hidden; box-sizing: border-box; }
    .msg span.nwhen { font-size: 11px; font-variant-numeric: tabular-nums; }
    .acts { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
    .acts button { height: 28px; padding: 0 10px; border-radius: 14px; background: var(--soft); font-size: 13px; font-weight: 500; white-space: nowrap; }
    .acts button:not(:disabled):hover { background: var(--hover); }
    .acts button.go { background: var(--ink); color: var(--bg); }
    .acts button.sure { background: var(--bad); color: #fff; }
    .count { min-width: 28px; text-align: right; font-size: 13px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
    .nmore { display: block; width: 100%; padding: 8px 12px; border-top: 1px solid var(--line); color: var(--blue); font-size: 13px; font-weight: 500; text-align: left; }
    .nnone { padding: 10px 12px; color: var(--muted); font-size: 13px; }
    .nchecks { display: flex; flex-wrap: wrap; gap: 4px 12px; padding-top: 2px; }
    .nchecks label { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500; color: var(--muted); cursor: pointer; }
    .nchecks label.on { color: var(--ink); }
    .nchecks input { width: 16px; height: 16px; margin: 0; padding: 0; accent-color: var(--blue); }
    .nrow { cursor: pointer; }
    .nrow:hover { background: var(--hover); }
    .nrow .msg::after { content: 'Details ›'; font-size: 12px; color: var(--blue); }
    .dview { padding: 10px 14px 14px; border-top: 1px solid var(--line); max-height: 72vh; overflow: auto; overscroll-behavior: contain; display: grid; gap: 12px; }
    .dview .dhead { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
    .dview .dhead b { flex-basis: 100%; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
    .dview .back { height: 30px; padding: 0 12px; border-radius: 15px; background: var(--soft); font-weight: 500; }
    .dview .dclose { margin-left: auto; width: 34px; height: 34px; border-radius: 50%; background: var(--soft); font-size: 16px; font-weight: 600; }
    .dview h4 { margin: 0 0 4px; font-size: 13px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; }
    .dview .dtext { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.45; }
    .dview dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 12px; margin: 0; font-size: 13px; }
    .dview dt { color: var(--muted); } .dview dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
    .dview ol, .dview ul { margin: 0; padding-left: 20px; display: grid; gap: 3px; font-size: 13px; line-height: 1.4; }
    .dview .acts { justify-content: flex-start; }
    .dview .say { list-style: none; margin-left: -20px; display: grid; gap: 4px; }
    .dview .say li { padding: 6px 10px; border-radius: 8px; background: var(--soft); }
    .dview .say li.bad { background: color-mix(in srgb, var(--bad) 12%, var(--bg)); color: var(--bad); }
    .dview .say li.do { background: var(--blue-soft); color: var(--blue); font-weight: 600; }
    .dview .say li.ok { background: color-mix(in srgb, var(--ok) 12%, var(--bg)); color: var(--ok); }
    .dview .steps { list-style: none; padding: 0; gap: 2px; }
    .dview .steps li { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 2px 6px; padding: 4px 6px; border-radius: 6px; }
    .dview .steps li.words { background: var(--soft); }
    .dview .dsec { display: grid; gap: 4px; }
    .dview .dsec .dsec { gap: 4px; margin-top: 8px; }
    .dview .sub { font-size: 12px; font-weight: 600; color: var(--muted); margin-top: 4px; }
    .dview .steps li.failed { background: color-mix(in srgb, var(--bad) 10%, var(--bg)); }
    .dview .steps li.open, .dview .steps li[data-more] { cursor: pointer; }
    .dview .steps .n { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; text-align: right; padding-top: 1px; }
    .dview .steps .w { overflow-wrap: anywhere; white-space: pre-wrap; }
    .dview .steps li[data-more] .w::after { content: ' ▸'; color: var(--muted); }
    .dview .steps li.open .w::after { content: ' ▾'; }
    .dview .steps pre { grid-column: 2; margin: 2px 0 4px; padding: 6px 8px; border-radius: 6px; background: var(--soft); font: 12px/1.4 ui-monospace, Menlo, monospace;
      white-space: pre-wrap; overflow-wrap: anywhere; max-height: 260px; overflow: auto; }
    .dview .files li { font: 12px/1.4 ui-monospace, Menlo, monospace; }
    .dview .files .add { color: var(--ok); } .dview .files .del { color: var(--bad); }
    .dview .muted { color: var(--muted); font-size: 13px; }
    .msg .ndet span.k { color: var(--muted); font-size: 12px; font-weight: 600; }
    .nfoot { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-top: 1px solid var(--line); }
    .nfoot .nhint { flex: 1; padding: 0; border: 0; }
    .nfoot button { height: 28px; padding: 0 12px; border-radius: 14px; background: var(--ink); color: var(--bg); font-size: 13px; font-weight: 500; white-space: nowrap; }
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
    code: 'M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z',
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
    globalThis.KidTubeWatch?.shadow?.(root);   // dev mode reads and taps inside it (core/ui/bridge.js)
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
      inbox: true, all: false, edit: null, sure: null, dev: false, devLife: 'never', devUrl: null,
      detail: null, rep: null, repAll: false, stepOpen: new Set() };
    // The notifications list starts open; the bell closes it, and it stays closed on every page (storage headerUi).
    // A new problem report opens it again (instead of core/ui/watch.js's banner on a page without the header).
    globalThis.KidTubeHeaderShown = true;
    // Rows swiped away (storage inboxHidden: row id → its status when swiped). The same row with a new status (a new
    // try, an answer, fixed) comes back.
    let hidden = {};
    chrome.storage.local.get('inboxHidden').then((g) => { hidden = g.inboxHidden ?? {}; if (alive) draw(); }).catch(() => {});
    chrome.storage.local.get('headerUi').then((g) => { if (g.headerUi?.inboxClosed && alive) { ui.inbox = false; draw(); } }).catch(() => {});
    async function newReport() {
      const r = await ask({ type: 'checkAlert' });
      if (r?.alert && alive && !ui.inbox) { ui.inbox = true; draw(); }
    }
    // The round apps button shows or hides the apps row. It starts closed on every page and every reload.
    // A message that needs nothing (kind ok) goes by itself after 30 s; an error stays until ✕ or a swipe.
    let sayTimer = null;
    const say = (text, kind = '') => {
      ui.note = text; ui.noteKind = kind; draw();
      clearTimeout(sayTimer);
      if (kind === 'ok') sayTimer = setTimeout(() => { if (ui.note === text) { ui.note = ''; draw(); } }, 30000);
    };

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
      const save = item(PATH.download, 'Save settings to a file', exportFile);
      const load = item(PATH.upload, 'Load settings from a file', () => { ui.menu = false; draw(); picker.click(); });
      save.dataset.bridge = load.dataset.bridge = 'no';   // dev mode never taps them (core/ui/bridge.js)
      m.append(
        item(PATH.cloud, 'GitHub connection', () => { ui.menu = false; ui.github = true; draw(); }, data.github.connected ? data.github.repo : 'not connected'),
        save, load,
        item(PATH.code, 'Dev mode', () => { ui.menu = false; ui.dev = true; ui.note = ''; draw(); }, data.dev?.on ? 'on: the AI can test' : 'off'));
      return m;
    }

    function githubCard(first) {
      const card = el('div', 'card');
      card.dataset.bridge = 'no';   // dev mode never taps or types here (core/ui/bridge.js)
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

    // Dev mode (core/background/bridge.js): the server's AI may test this tablet. Dev mode itself never taps in here.
    const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };
    const timeOf = (at) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    let devTimer = null;
    async function devTurn(on) {
      const r = await act(on ? 'Turning on…' : 'Turning off…', { type: 'devMode', on, life: ui.devLife, url: ui.devUrl ?? '' });
      if (!r?.ok) return;
      data.dev = r.dev;
      if (r.warning) say(`Off on this tablet. ${r.warning}`, 'err'); else draw();
      // The socket opens in a moment: show whether it did.
      clearTimeout(devTimer);
      if (on) devTimer = setTimeout(() => refresh(), 3000);
    }
    function devCard() {
      const d = data.dev ?? {};
      const card = el('div', 'card');
      card.dataset.bridge = 'no';
      card.append(el('h2', '', 'Dev mode'), el('p', 'lead', 'The server’s AI can test this tablet while it fixes a problem or works on your note: '
        + 'it reads what the app shows, taps the app’s buttons, opens its pages and runs the checks. It never sees or types the PIN, '
        + 'and never changes the rules, the minutes, the GitHub connection or this setting. “AI is testing” shows on the page while it works.'));
      const fields = el('div', 'fields');
      const side = el('div', 'side');
      if (d.on) {
        fields.append(el('p', `status ${d.connected ? 'ok' : d.error ? 'err' : ''}`, d.connected ? `On · connected to ${hostOf(d.url)}` : d.error ?? `On · connecting to ${hostOf(d.url)}…`),
          el('p', 'status', d.until ? `Turns off by itself: ${timeOf(d.until)}` : 'Stays on until you turn it off.'),
          el('p', 'status', d.actions?.n ? `The AI did ${d.actions.n} action${d.actions.n === 1 ? '' : 's'}, the last at ${timeOf(d.actions.at)} (${d.actions.cmd}).` : 'The AI did nothing on this tablet yet.'),
          el('p', 'status', d.pictures ? 'The AI may take pictures of the screen.' : 'No pictures of the screen: the AI reads it as text.'),
          el('p', 'status', `This tablet: ${d.device}`));
        const off = button('btn primary', busy || 'Turn off', () => devTurn(false));
        off.disabled = !!busy;
        side.append(off);
        // Pictures of the screen: the browser asks the parent (only an app's own page can ask: not on YouTube).
        if (!d.pictures && chrome.permissions?.request) {
          side.append(button('btn', 'Allow screen pictures', async () => {
            const ok = await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
            if (!ok) say('Pictures stay off: the AI reads the screen as text only.', 'err');
            refresh();
          }));
        }
      } else {
        const life = el('select');
        for (const [v, label] of [['hour', 'For 1 hour'], ['day', 'For 1 day'], ['never', 'Until I turn it off']]) {
          const o = el('option', '', label);
          o.value = v;
          o.selected = v === ui.devLife;
          life.append(o);
        }
        life.addEventListener('change', () => { ui.devLife = life.value; });
        const url = Object.assign(el('input'), { placeholder: d.defaultUrl ?? '', value: ui.devUrl ?? (d.url && d.url !== d.defaultUrl ? d.url : ''), autocomplete: 'off', spellcheck: false });
        url.setAttribute('autocapitalize', 'off');
        url.addEventListener('input', () => { ui.devUrl = url.value; });
        const l1 = el('label', '', 'Stays on'), l2 = el('label', '', 'Bridge server (empty: this app’s server)');
        l1.append(life); l2.append(url);
        fields.append(l1, l2);
        const on = button('btn primary', busy || 'Turn on', () => devTurn(true));
        on.disabled = !!busy || !data.github.connected;
        side.append(on);
      }
      side.append(button('btn', 'Close', () => { ui.dev = false; ui.note = ''; draw(); }));
      card.append(fields, side);
      if (!data.github.connected) card.append(el('p', 'status err', 'Connect GitHub first: the server finds this tablet’s key in the data repo.'));
      if (ui.note) card.append(el('p', `status ${ui.noteKind}`, ui.note));
      return card;
    }

    // The notifications (core/background/inbox.js, only where the parent is), one row each:
    // [type] [status] the message [its buttons] [how many times]. The header adds two kinds of its own: a newer
    // version (App update) and what its last action said (System, with ✕).
    const TYPE = { error: 'Error', validation: 'Validation', data: 'Data update', note: 'My note', question: 'Question', update: 'App update', system: 'System' };
    const SHOWN = 5;
    // Every row, the swiped ones too; rowsNow: the ones shown.
    function allRows(h) {
      const rows = [...(h.inbox ?? [])];
      if (ver?.newer) rows.unshift(updateRow(ver));
      const note = ui.github ? '' : ui.note || h.error;
      if (note) {
        const tone = ui.note ? ui.noteKind : 'err';
        rows.unshift({ id: 'system', type: 'system', status: { text: tone === 'err' ? 'Failed' : tone === 'ok' ? 'Done' : 'Info', tone: tone === 'err' ? 'bad' : tone === 'ok' ? 'ok' : '' },
          title: note, detail: ui.note ? '' : 'The apps list could not be read from GitHub.', actions: ui.note ? [{ do: 'dismiss', label: '✕' }] : [],
          view: { sections: [{ title: 'Message', text: note }, { title: 'What it is', text: ui.note ? 'What the header’s last action said. ✕ or a swipe hides it.'
            : 'The header could not read the apps list from GitHub. Check the internet and the GitHub connection in the account menu.' }] } });
      }
      return rows;
    }
    const rowsNow = (h) => allRows(h).filter((r) => hidden[r.id] !== sigOf(r));
    const sigOf = (r) => `${r.status?.text ?? ''}|${r.tries ?? ''}`;
    // A row swiped to the right: a note asks once more (its Delete); an answered question closes (Got it); the header's
    // message goes; any other row is hidden until its status changes (its Remove button does the same: hide).
    function swiped(r) {
      if (r.actions?.some((a) => a.do === 'note.drop')) { ui.sure = r.id; return draw(); }
      const close = r.actions?.find((a) => a.do === 'question.dismiss');
      if (close) return tapRow(r, close);
      if (r.id === 'system') { ui.note = ''; return draw(); }
      hide(r);
    }
    function hide(r) {
      // Forget only rows that are gone for good (not the ones swiped before: they would come back).
      const ids = new Set(allRows(data ?? {}).map((x) => x.id));
      hidden = { ...Object.fromEntries(Object.entries(hidden).filter(([k]) => ids.has(k))), [r.id]: sigOf(r) };
      chrome.storage.local.set({ inboxHidden: hidden }).catch(() => {});
      if (ui.detail === r.id) closeDetail();
      draw();
    }
    // Every row can go (the parent's note, 2026-10-14): a row with no Delete, ✕ or Got it of its own gets Remove (hides it).
    const GOES = ['note.drop', 'question.dismiss', 'dismiss'];
    const actionsOf = (r) => (r.actions ?? []).some((a) => GOES.includes(a.do)) ? (r.actions ?? []) : [...(r.actions ?? []), { do: 'hide', label: 'Remove' }];
    // The date and the version a row came from (the parent's note, 2026-10-14); no version of its own: this tablet's.
    const versionOf = (r) => r.version || ver?.installed || chrome.runtime.getManifest?.().version || '';
    const whenLine = (r) => [when(r.at), versionOf(r) && `v${versionOf(r)}`].filter(Boolean).join(' · ');
    // An edit field as tall as its words: no scroll inside it (the parent's note, 2026-10-14).
    const fit = (ta) => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
    function closeDetail() {
      ui.detail = null; ui.detailRow = null; ui.rep = null;
      W?.check({ id: 'header.detailCloses', area: 'header', expect: 'A notification’s Details closes on ✕, ‹ Back, or a button that makes the row go',
        code: ['core/ui/header.js closeDetail', 'core/ui/header.js tapRow'] }, (t) => {
        t.eq('the Details on the screen', 0, root.querySelectorAll('.dview').length);
      }, 1000);
    }
    // Swipe to the right (a finger or the mouse): past a third of the row it goes; less, it slides back.
    function swipeable(row, r) {
      let x0 = null, y0 = 0, dx = 0, pid = null, side = false;
      const back = () => { row.classList.add('back'); row.style.transform = ''; row.style.opacity = ''; };
      row.addEventListener('pointerdown', (e) => {
        if (e.target?.closest?.('button, textarea, label')) return;
        x0 = e.clientX; y0 = e.clientY; dx = 0; pid = e.pointerId; side = false; row.classList.remove('back'); delete row.dataset.moved;
      });
      row.addEventListener('pointermove', (e) => {
        if (x0 == null || e.pointerId !== pid) return;
        const mx = e.clientX - x0, my = e.clientY - y0;
        if (!side) {
          if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { x0 = null; return; }   // the list scrolls
          if (mx < 10) return;
          side = true;
          row.dataset.moved = '1';   // a swipe, not a tap: no Details
          try { row.setPointerCapture(pid); } catch {}
        }
        dx = Math.max(0, mx);
        row.style.transform = `translateX(${dx}px)`;
        row.style.opacity = String(1 - Math.min(0.7, dx / (row.offsetWidth || 300)));
      });
      const end = () => {
        if (x0 == null) return;
        x0 = null;
        if (side && dx > (row.offsetWidth || 300) / 3) {
          row.classList.add('back');
          row.style.transform = `translateX(${row.offsetWidth || 300}px)`;
          setTimeout(() => swiped(r), 150);
        } else back();
      };
      row.addEventListener('pointerup', end);
      row.addEventListener('pointercancel', end);
    }
    // The App update row: where the new version is, in plain words, and what to do.
    function updateRow(v) {
      const how = v.kind === 'quetta' ? ['Tap Install now. The browser downloads it and Custom Apps restarts by itself.', 'Not installed in a few minutes: tap By hand and install the .crx from the install page. Your settings stay.']
        : [NEWER[v.kind]?.(v.latest) ?? 'Install it from the install page.'];
      const base = { id: 'update', type: 'update', title: `Custom Apps ${v.latest} is out. This browser has ${v.installed}.`,
        view: { sections: [{ title: 'Versions', rows: [['This browser', v.installed], ['New', v.latest], ['Installed as', v.kind ?? ''], ['Asked the browser', v.askedAt ?? '', 'time'],
          ['The browser said', v.status ?? '']] }, { title: 'How to get it', steps: [...how, 'Then check what the new version changed: open the run report of the note or problem it was for.'] }] } };
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
      // From a row's Details: a button that makes the row go (✕, Got it, Delete, Remove) closes the Details too, and Edit
      // goes back to the list, where the row's field is (the parent's note, 2026-10-14: the ✕ there did not close it).
      if (ui.detail === r.id && (GOES.includes(a.do) || a.do === 'hide' || a.do === 'note.edit') && !(a.do === 'note.drop' && ui.sure !== r.id)) closeDetail();
      if (a.do === 'hide') return hide(r);
      if (a.do === 'dismiss') { ui.note = ''; return draw(); }
      if (a.do === 'update') return getUpdate();
      if (a.do === 'update.manual') return getUpdate(true);
      if (a.do === 'open') {
        const o = await ask({ type: 'openAiPage', page: a.page });
        if (!o?.ok) say(o?.error ?? 'That didn’t work. Try again.', 'err');
        return;
      }
      if (a.do === 'note.edit') {
        ui.edit = { id: r.note, text: r.editText ?? r.title }; ui.sure = null; draw();
        const ta = root.querySelector?.('.msg textarea');
        ta?.focus();
        checkEdit(ta);
        return;
      }
      // Delete asks once more on the same button: a dictated note can be long.
      if (a.do === 'note.drop' && ui.sure !== r.id) { ui.sure = r.id; return draw(); }
      ui.sure = null;
      const busyText = { 'question.dismiss': 'Closing…', 'note.drop': 'Deleting…', 'note.send': 'Sending…', 'note.attach': 'Saving…', run: 'Asking…', 'problems.send': 'Sending…', sync: 'Saving…' }[a.do] ?? 'Working…';
      const res = await act(busyText, { type: 'inbox', do: a.do, id: r.note, ...(a.what ? { what: a.what, on: a.on } : {}) });
      if (res?.ok && res.message) say(res.message, 'ok');
      await refresh(true);
      if (a.do === 'note.attach' && res?.ok) {
        W?.check({ id: 'header.noteAttach', area: 'notes', expect: 'A note’s checkbox in the notifications (This screen, App data, Question) stays as tapped',
          code: ['core/ui/header.js inboxRow', 'core/background/inbox.js checksOf', 'apps/kidtube/background/parent.js attachHeld'] }, (t) => {
          const row = (data?.inbox ?? []).find((x) => x.id === r.id);
          if (!row) return t.skip('the note was sent or deleted meanwhile');
          t.eq(`${a.what} ticked`, a.on, !!row.checks?.find((c) => c.key === a.what)?.on);
        }, 5000);
      }
      if (a.do === 'run' && r.id === 'all' && res?.ok) {
        W?.check({ id: 'header.sendAll', area: 'notes', expect: 'Send all sends every note that can go: none is left with a Send button',
          code: ['core/ui/header.js inboxList', 'apps/kidtube/background/sync.js requestRun'] }, (t) => {
          t.eq('notes still waiting to be sent', 0, (data?.inbox ?? []).filter((x) => x.actions?.some((b) => b.do === 'note.send')).length);
        }, 5000);
      }
    }
    // The Edit field shows all its words (no scroll inside it).
    function checkEdit(ta) {
      W?.check({ id: 'header.editFits', area: 'notes', expect: 'A note’s Edit field is as tall as its words: no scroll inside it',
        code: ['core/ui/header.js inboxRow (fit)'] }, (t) => {
        if (!ta?.isConnected) return t.skip('the field closed');
        t.ok('all the words show', ta.scrollHeight <= ta.clientHeight + 4, `${ta.scrollHeight} px of words in ${ta.clientHeight} px`, 'no scroll');
      }, 1000);
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
        box.addEventListener('input', () => { ui.edit.text = box.value; save.disabled = !box.value.trim() || !!busy; fit(box); });
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
        if (r.versions) msg.append(el('span', 'pvers', r.versions));   // a problem: where it came from, where it is fixed
        if (whenLine(r)) msg.append(el('span', 'nwhen', whenLine(r)));
        // A note not sent yet: what goes with it (core/background/inbox.js checksOf).
        if (r.checks?.length) {
          const box = el('div', 'nchecks');
          for (const c of r.checks) {
            const l = el('label', c.on ? 'on' : '');
            const cb = Object.assign(el('input'), { type: 'checkbox', checked: !!c.on, disabled: !!busy || !c.can });
            l.title = c.can ? c.title : 'This note was saved without it';
            cb.addEventListener('change', () => tapRow(r, { do: 'note.attach', what: c.key, on: cb.checked }));
            l.append(cb, c.label);
            box.append(l);
          }
          msg.append(box);
        }
        for (const a of actionsOf(r)) {
          const sure = a.do === 'note.drop' && ui.sure === r.id;
          const b = button(sure ? 'sure' : a.do === 'note.send' ? 'go' : '', sure ? 'Sure? Delete' : a.label, () => tapRow(r, a));
          b.disabled = !!busy;
          if (a.do === 'note.send') b.title = 'Send this note to the AI now (the other notes keep waiting)';
          if (a.do === 'dismiss') b.title = 'Hide this message';
          if (a.do === 'hide') b.title = 'Remove this row from the list (it comes back only if it changes)';
          acts.append(b);
        }
      }
      if (r.more) row.title = r.more;   // the check's id and versions, for when the parent asks the AI about it
      const count = el('span', 'count', r.count != null ? `×${r.count}` : '');
      if (r.count != null) count.title = `It happened ${r.count} time${r.count === 1 ? '' : 's'}. The same problem again only counts up: it is not sent again.`;
      row.append(el('span', `chip ${r.type}`, TYPE[r.type] ?? r.type), st, msg, acts, count);
      if (!editing) {
        swipeable(row, r);
        // A tap on the row (not on its buttons): its Details.
        row.addEventListener('click', (e) => {
          if (e.target?.closest?.('button, textarea, label, input') || row.dataset.moved) return;
          openDetail(r);
        });
      }
      return row;
    }

    // --- a notification's Details: its sections (core/background/inbox.js view), and an AI run's report ---------------
    function openDetail(r) {
      ui.detail = r.id; ui.detailRow = r; ui.rep = null; ui.repAll = false; ui.stepOpen = new Set();
      draw();
      root.querySelector?.('.dview')?.scrollTo?.(0, 0);
      const rp = r.view?.report;
      if (rp) loadReport(rp);
    }
    async function loadReport(rp) {
      const key = `${rp.root ? '/' : ''}${rp.path}`;
      ui.rep = { key, state: 'loading' };
      draw();
      const res = await ask({ type: 'runReport', path: rp.path, root: !!rp.root });
      if (ui.rep?.key !== key) return;
      ui.rep = res?.ok ? { key, state: 'ok', report: res.report } : { key, state: 'err', error: res?.error ?? 'The report could not be read.' };
      draw();
    }
    const when = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; };
    function section(title, ...body) {
      const d = el('div', 'dsec');
      d.append(el('h4', '', title), ...body);
      return d;
    }
    function rowsOf(rows) {
      const dl = el('dl');
      let n = 0;
      for (const [k, v, fmt] of rows) {
        const shown = fmt === 'time' ? when(v) : v;
        if (shown === '' || shown == null) continue;
        dl.append(el('dt', '', k), el('dd', '', String(shown)));
        n++;
      }
      return n ? dl : null;
    }
    function listOf(items, ordered, cls = '') {
      const l = el(ordered ? 'ol' : 'ul', cls);
      for (const t of items) l.append(el('li', '', t));
      return l;
    }
    function sectionOf(sec) {
      if (sec.text != null) return sec.text ? section(sec.title, el('div', 'dtext', sec.text)) : null;
      if (sec.rows) { const dl = rowsOf(sec.rows); return dl ? section(sec.title, dl) : null; }
      if (sec.steps?.length) return section(sec.title, listOf(sec.steps, true));
      if (sec.list?.length) return section(sec.title, listOf(sec.list, false));
      return null;
    }
    const ICON = { say: '💬', think: '💭', read: '📖', search: '🔎', edit: '✏️', run: '▶️', test: '🧪', release: '🚀', commit: '📦', agent: '🤖',
      skill: '🧩', plan: '📋', device: '📱', lab: '🖥️', other: '•' };
    const SHOWN_STEPS = 40;
    // The run report (agent/report.mjs): For you first, then what it got, what it said, what changed, every step.
    function reportView(rp) {
      const out = [];
      const head = [rp.title, rp.ok ? 'finished' : 'stopped', when(rp.at), rp.minutes != null ? `${rp.minutes} min` : '', rp.turns != null ? `${rp.turns} turns` : '',
        rp.costUsd != null ? `$${rp.costUsd}` : '', rp.model ?? ''].filter(Boolean).join(' · ');
      out.push(el('div', 'muted', head));
      if (rp.forYou?.length) {
        const l = el('ul', 'say');
        for (const x of rp.forYou) l.append(el('li', x.tone ?? '', x.text));
        out.push(section('For you', l));
      }
      if (rp.input?.length) {
        const l = el('ol');
        for (const i of rp.input) {
          const li = el('li', '', i.title);
          if (i.detail) li.append(el('div', 'muted', i.detail));
          l.append(li);
        }
        out.push(section('What it got', l));
      }
      if (rp.said) out.push(section('What it said', el('div', 'dtext', rp.said)));
      if (rp.answers?.length) out.push(section('Its answers', listOf(rp.answers.map((a) => a.answer), false)));
      const changed = [];
      const facts = rowsOf([['New version', rp.released ?? ''], ['Tests', rp.tests ? `${rp.tests.pass} passed, ${rp.tests.fail} failed` : '']]);
      if (facts) changed.push(facts);
      if (rp.commits?.length) changed.push(el('div', 'sub', `Commits (${rp.commits.length})`), listOf(rp.commits.map((c) => `${c.sha} ${c.subject}`), false, 'files'));
      if (rp.files?.length) {
        changed.push(el('div', 'sub', `Files (${rp.files.length})`));
        const l = el('ul', 'files');
        for (const f of rp.files) { const li = el('li', '', `${f.path} `); li.append(el('span', 'add', `+${f.add}`), ' ', el('span', 'del', `−${f.del}`)); l.append(li); }
        changed.push(l);
      }
      out.push(section('What changed', ...(changed.length ? changed : [el('div', 'muted', 'Nothing in the code: no commit in this run.')])));
      const steps = rp.steps ?? [];
      if (steps.length) {
        const l = el('ol', 'steps');
        const shown = ui.repAll ? steps : steps.slice(0, SHOWN_STEPS);
        shown.forEach((st, i) => {
          const li = el('li', `${st.kind === 'say' || st.kind === 'think' ? 'words' : ''}${st.failed ? ' failed' : ''}${ui.stepOpen.has(i) ? ' open' : ''}`);
          li.append(el('span', 'n', `${i + 1} ${ICON[st.kind] ?? '•'}`), el('span', 'w', st.what));
          const more = [st.detail, st.out].filter(Boolean).join('\n— output —\n');
          if (more) {
            li.dataset.more = '1';
            if (ui.stepOpen.has(i)) li.append(el('pre', '', more));
            li.addEventListener('click', () => { if (ui.stepOpen.has(i)) ui.stepOpen.delete(i); else ui.stepOpen.add(i); draw(); });
          }
          l.append(li);
        });
        const body = [l];
        if (steps.length > SHOWN_STEPS) body.push(button('nmore', ui.repAll ? 'Show fewer steps' : `Show all ${steps.length} steps`, () => { ui.repAll = !ui.repAll; draw(); }));
        if (rp.more) body.push(el('div', 'muted', `${rp.more} more steps are not in the report.`));
        if (rp.helpers) body.push(el('div', 'muted', `Its helper agents made ${rp.helpers} more steps of their own (not listed).`));
        out.push(section(`Step by step (${steps.length}) · tap a step for its output`, ...body));
      }
      return out;
    }
    function detailView(r) {
      const v = el('div', 'dview');
      const head = el('div', 'dhead');
      const close = button('dclose', '✕', () => { closeDetail(); draw(); });
      close.title = 'Close the Details';
      close.setAttribute('aria-label', close.title);
      head.append(button('back', '‹ Back', () => { closeDetail(); draw(); }), el('span', `chip ${r.type}`, TYPE[r.type] ?? r.type),
        el('span', `st ${r.status?.tone ?? ''}`, r.status?.text ?? ''), close, el('b', '', r.title));
      v.append(head);
      // Every notification: its date and version (the parent's note, 2026-10-14).
      const stamp = rowsOf([['Date', r.at ?? '', 'time'], ['Version', versionOf(r)]]);
      if (stamp) v.append(section('When', stamp));
      if (r.answer) v.append(section('Answer', el('div', 'dtext', r.answer)));
      const secs = (r.view?.sections ?? []).map(sectionOf).filter(Boolean);
      if (!secs.length && r.details?.length) secs.push(section('Details', rowsOf(r.details)));
      else if (!secs.length && r.detail) secs.push(section('Details', el('div', 'dtext', [r.detail, r.state].filter(Boolean).join('\n'))));
      v.append(...secs);
      const acts = el('div', 'acts');
      for (const a of actionsOf(r)) {
        const sure = a.do === 'note.drop' && ui.sure === r.id;
        const b = button(sure ? 'sure' : a.do === 'note.send' ? 'go' : '', sure ? 'Sure? Delete' : a.label, () => tapRow(r, a));
        b.disabled = !!busy;
        acts.append(b);
      }
      v.append(acts);
      if (r.view?.report) {
        const rp = ui.rep;
        const sec = el('div', 'dsec');
        sec.append(el('h4', '', 'The AI run'));
        if (!rp || rp.state === 'loading') sec.append(el('div', 'muted', 'Loading the run’s report from GitHub…'));
        else if (rp.state === 'err') sec.append(el('div', 'muted', rp.error), button('back', 'Try again', () => loadReport(r.view.report)));
        else sec.append(...reportView(rp.report));
        v.append(sec);
      } else if (['note', 'question', 'data', 'error', 'validation'].includes(r.type)) {
        v.append(el('div', 'muted', 'No AI run report yet: it comes with the AI’s answer.'));
      }
      return v;
    }
    function inboxList(rows) {
      const box = el('div', 'inbox');
      box.setAttribute('role', 'list');
      box.setAttribute('aria-label', 'Notifications');
      if (!rows.length) { box.append(el('div', 'nnone', 'No notifications: nothing waits for you or for the AI.')); return box; }
      const shown = ui.all ? rows : rows.slice(0, SHOWN);
      for (const r of shown) box.append(inboxRow(r));
      if (rows.length > SHOWN) box.append(button('nmore', ui.all ? 'Show fewer' : `Show all ${rows.length}`, () => { ui.all = !ui.all; draw(); }));
      const foot = el('div', 'nfoot');
      foot.append(el('div', 'nhint', 'Swipe a row to the right to remove it. Done problems and runs go by themselves after 3 minutes.'));
      // Send all: every note that can go now (a recording the server still writes down waits).
      const ready = rows.filter((r) => r.actions?.some((a) => a.do === 'note.send')).length;
      if (ready > 1) {
        const all = button('', `Send all (${ready})`, () => tapRow({ id: 'all' }, { do: 'run' }));
        all.title = 'Send every note waiting here to the AI now';
        all.disabled = !!busy;
        foot.append(all);
      }
      box.append(foot);
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
        // Dev mode on: a mark that opens its card (core/background/bridge.js).
        if (h.dev?.on) {
          const mark = button(`dev${h.dev.connected ? '' : ' off'}`, 'DEV', () => { ui.dev = !ui.dev; ui.note = ''; draw(); });
          mark.title = h.dev.connected ? 'Dev mode: the AI can test this tablet' : 'Dev mode is on, not connected to the bridge server';
          bar.append(mark);
        }
        bar.append(who);
        // Connect only on a site's own page (an extension page has no signed-in account to take).
        if (h.site && h.open) {
          const go = button('btn primary', busy === 'Connecting…' ? busy : 'Connect', connectHere, PATH.link);
          go.title = `Connect the ${h.here.label} account signed in here${h.here.name ? ` (${h.here.name})` : ''}`;
          go.disabled = !!busy;
          bar.append(go);
        }

        if (!h.github.connected || ui.github) kids.push(githubCard(!h.github.connected));
        else if (ui.dev) kids.push(devCard());
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
        // A row's Details: the row as it is now, or as it was when it went (a done row goes after 3 minutes).
        if (ui.detail) { const now = allRows(h).find((x) => x.id === ui.detail); if (now) ui.detailRow = now; else if (ui.detailRow?.id !== ui.detail) ui.detail = null; }
        if (shownInbox && ui.inbox && h.github.connected && !ui.github && !ui.dev) kids.push(ui.detail && ui.detailRow ? detailView(ui.detailRow) : inboxList(rows));
        else if (!h.github.connected || ui.github || ui.dev) { /* the card shows its own message */ }
        else if (ui.note || h.error) kids.push(el('p', `note ${ui.note ? ui.noteKind : 'err'}`, ui.note || h.error));
        if (ui.menu) kids.push(accountMenu());
      }
      if (ui.menu) {
        const scrim = el('div', 'scrim');
        scrim.addEventListener('click', () => { ui.menu = false; draw(); });
        kids.unshift(scrim);
      }
      box.replaceChildren(...kids);
      for (const ta of box.querySelectorAll?.('.msg textarea') ?? []) fit(ta);
    }

    // The notifications' sources change often (the checks after every message): at most one refresh a second for them.
    let aiTimer = null;
    const onStorage = (ch) => {
      if (ch.checkAlert?.newValue && !ch.checkAlert.newValue.shown) newReport();
      if (ch.updateState) readVersion(true);
      if (ch.inboxHidden) { hidden = ch.inboxHidden.newValue ?? {}; draw(); }
      if (ch.ytAccount || ch.igAccount || ch.settings || ch.accounts || ch.repoProfiles || ch.account || ch.shell) refresh();
      else if (ch.outbox || ch.data || ch.ig || ch.checks || ch.notes || ch.syncStatus || ch.bridgeLog) { clearTimeout(aiTimer); aiTimer = setTimeout(() => refresh(), 1000); }
    };
    chrome.storage.onChanged.addListener(onStorage);
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (ui.menu) { ui.menu = false; draw(); } else if (ui.detail) { closeDetail(); draw(); }
    };
    root.addEventListener('keydown', onKey);
    draw();
    refresh();
    newReport();
    return {
      refresh,
      setDark(on) { host.classList.toggle('dark', on); },
      destroy() { alive = false; clearTimeout(aiTimer); clearTimeout(devTimer); clearTimeout(verTimer); clearTimeout(sayTimer); chrome.storage.onChanged.removeListener(onStorage); },
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
    globalThis.KidTubeWatch?.shadow?.(root);
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
