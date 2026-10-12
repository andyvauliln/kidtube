// The Instagram app's screen. YouTube sends the tab to www.instagram.com/robots.txt?kidtube=app (registry.js home):
// a plain text page of Instagram's, so none of Instagram's own scripts run, but the page reads Instagram's API with
// the signed-in account (content/api.js). This script draws the app there: the apps header, the tabs, and the
// post sheet with the voice notes. On Instagram's own pages it only adds the Connect bar: App | Instagram and Connect.
// On every page it tells the background which Instagram account is signed in (the profile is that account's).
// The background keeps everything (apps/instagram/background/); this page only reads Instagram and shows.
// No innerHTML anywhere (the header's rule too).
(() => {
  if (globalThis.KidTubeInstagram) return;
  globalThis.KidTubeInstagram = true;
  const HOME = '/robots.txt?kidtube=app';
  const isApp = location.pathname === '/robots.txt' && new URLSearchParams(location.search).get('kidtube') === 'app';

  // Same as core/lib/ask.js (Orion returns answers only to the callback). Long: a note is written down in the background.
  const ask = (msg, ms = 15000) => new Promise((resolve) => {
    const timer = setTimeout(() => { globalThis.KidTubeWatch?.noAnswer(msg, ms); resolve(undefined); }, ms);
    try { chrome.runtime.sendMessage(msg, (v) => { clearTimeout(timer); void chrome.runtime.lastError; resolve(v); }); }
    catch { clearTimeout(timer); resolve(undefined); }
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- elements -----------------------------------------------------------------------------------------------
  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    const later = {};
    for (const [k, v] of Object.entries(props ?? {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'muted') later[k] = v;
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    n.append(...kids.flat(Infinity).filter((x) => x != null && x !== false));
    Object.assign(n, later);
    return n;
  }
  const NS = 'http://www.w3.org/2000/svg';
  const ICON = {
    grid: 'M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z',
    list: 'M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z',
    reel: 'M8 5.5v13c0 .8.9 1.3 1.6.8l10-6.5c.6-.4.6-1.2 0-1.6l-10-6.5C8.9 4.2 8 4.7 8 5.5z',
    carousel: 'M7 3h12a2 2 0 0 1 2 2v12h-2V5H7zM3 7h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z',
    mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11z',
    stop: 'M6 6h12v12H6z',
    star: 'M12 17.3 18.2 21l-1.6-7L22 9.2l-7.2-.6L12 2 9.2 8.6 2 9.2 7.4 14l-1.6 7z',
    starOff: 'M22 9.2l-7.2-.6L12 2 9.2 8.6 2 9.2 7.4 14l-1.6 7L12 17.3 18.2 21l-1.6-7zM12 15.4l-3.8 2.3 1-4.3-3.3-2.9 4.4-.4L12 6.1l1.7 4 4.4.4-3.3 2.9 1 4.3z',
    sync: 'M12 4V1L8 5l4 4V6a6 6 0 0 1 5.7 7.9l1.5 1.5A8 8 0 0 0 12 4zm-5.7 4.1L4.8 6.6A8 8 0 0 0 12 20v3l4-4-4-4v3a6 6 0 0 1-5.7-7.9z',
    back: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
    open: 'M14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3zm5 16H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2z',
    x: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
    saved: 'M6 2h12a1 1 0 0 1 1 1v19l-7-5-7 5V3a1 1 0 0 1 1-1z',
  };
  function icon(name, size = 22) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
    s.setAttribute('aria-hidden', 'true'); s.setAttribute('fill', 'currentColor');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', ICON[name]);
    s.append(p);
    return s;
  }
  const ago = (iso) => {
    if (!iso) return 'never';
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
    return new Date(iso).toLocaleDateString();
  };
  const STATUS = { new: 'Not handled', queued: 'In the list', handled: 'Handled', failed: 'Failed' };

  // --- who is signed in to Instagram, and Connect --------------------------------------------------------------------
  // Told to the background on every page: the header's Instagram tile opens that account's profile.
  async function reportMe() {
    const api = globalThis.KidTubeIgApi;
    let me = null, loggedIn = true, detail = '';
    try { me = await api.me(); } catch (e) { loggedIn = !(e instanceof api.LoginNeeded); detail = e.detail || String(e.message ?? e); }
    await ask({ type: 'siteAccount', loggedIn, username: me?.username ?? null, id: me?.id ?? null });
    return { loggedIn, username: me?.username ?? null, detail };
  }
  // Connect: Instagram's account is read again now, then that account's Instagram profile runs: loaded, or made new
  // (core/background/profiles.js connect). say(text, err): where the page shows what happened.
  async function connectHere(say) {
    say('Connecting…');
    await reportMe();
    const r = await ask({ type: 'connect' });
    if (!r?.ok) return say(r?.error ?? 'Could not connect. Try again.', true);
    say(r.message);
    if (r.url && !r.navigated) location.href = r.url;
  }
  if (window.top === window) globalThis.KidTubeAccount = { read: reportMe };   // the header's Connect asks it first

  // --- the switch: the app, or Instagram's own site (no app on it; the app stays one tap away) ----------------------
  const SITE = 'https://www.instagram.com/';
  const SWITCH_CSS = `:host { all: initial; display: inline-block; }
    .seg { display: inline-flex; padding: 3px; gap: 2px; border-radius: 18px; background: #efefef; font: 600 13px system-ui, -apple-system, sans-serif; }
    a, button { display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 15px; color: #737373; text-decoration: none;
      font: inherit; border: 0; background: none; cursor: pointer; }
    .on { background: #fff; color: #262626; box-shadow: 0 1px 3px rgba(0,0,0,.15); pointer-events: none; }
    @media (prefers-color-scheme: dark) { .seg { background: #262626; } a, button { color: #a8a8a8; } .on { background: #000; color: #f5f5f5; } }`;
  // The app's screen: App (here) | Instagram (its own site).
  function siteSwitch() {
    const host = h('span');
    const root = host.attachShadow({ mode: 'closed' });
    root.append(h('style', { text: SWITCH_CSS }), h('span', { class: 'seg', role: 'group', 'aria-label': 'App or Instagram' },
      h('a', { class: 'on', href: HOME, 'aria-current': 'page', title: 'Your saved posts, notes and the list' }, 'App'),
      h('a', { href: SITE, title: 'Instagram’s own site, without the app' }, 'Instagram')));
    return host;
  }

  // --- Instagram's own pages: the Connect bar, bottom left -----------------------------------------------------------
  // App: the app for the account signed in here (its profile must exist: Connect makes it). Connect: as the header's.
  const BAR_CSS = `
    .bar { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; font: 600 13px system-ui, -apple-system, sans-serif; }
    .row { display: flex; gap: 8px; align-items: center; }
    .seg { background: #262626; box-shadow: 0 4px 16px rgba(0,0,0,.3); } .seg button, .seg a { color: #bbb; } .seg .on { background: #fff; color: #262626; }
    .connect { height: 36px; padding: 0 16px; border-radius: 18px; background: #0095f6; color: #fff; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
    .connect:disabled { opacity: .6; cursor: default; }
    .msg { max-width: min(320px, calc(100vw - 24px)); background: #262626; color: #fff; padding: 10px 12px; border-radius: 10px; font-weight: 400;
      line-height: 1.35; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
    .msg.err { background: #b3261e; }
    .msg[hidden] { display: none; }`;
  function connectBar() {
    const host = h('span');
    host.style.cssText = 'position:fixed;left:12px;bottom:72px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' });
    const msg = h('div', { class: 'msg', role: 'status', hidden: true });
    let timer;
    const say = (text, err = false) => {
      msg.textContent = text; msg.className = `msg${err ? ' err' : ''}`; msg.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(() => { msg.hidden = true; }, 10000);
    };
    const openIt = async () => {
      say('Opening…');
      const r = await ask({ type: 'openApp', app: 'instagram' });
      if (!r?.ok) return say(r?.error ?? 'Could not open the app.', true);
      if (r.url && !r.navigated) location.href = r.url;
    };
    const go = h('button', { class: 'connect', type: 'button', title: 'Connect the Instagram account signed in here',
      onclick: async () => { go.disabled = true; await connectHere(say); go.disabled = false; } }, 'Connect');
    root.append(h('style', { text: SWITCH_CSS + BAR_CSS }), h('div', { class: 'bar' }, msg, h('div', { class: 'row' },
      h('span', { class: 'seg', role: 'group', 'aria-label': 'App or Instagram' },
        h('button', { type: 'button', title: 'Your saved posts, notes and the list', onclick: openIt }, 'App'),
        h('a', { class: 'on', 'aria-current': 'page' }, 'Instagram')),
      go)));
    return host;
  }
  if (!isApp) {
    if (window.top !== window) return;
    reportMe();
    // Only where the header could act (not in kid mode, not at a locked header).
    ask({ type: 'igSite' }).then((r) => {
      if (!r?.open) return;
      const add = () => document.documentElement.append(connectBar());
      if (document.documentElement) add(); else addEventListener('DOMContentLoaded', add, { once: true });
    });
    return;
  }

  // --- the app's screen ---------------------------------------------------------------------------------------------
  const CSS = `
    :root { color-scheme: light; --bg: #fff; --ink: #262626; --muted: #737373; --line: #dbdbdb; --soft: #efefef; --blue: #0095f6;
      --ok: #1e8e3e; --bad: #ed4956; --queued: #0095f6; --sheet: #fff; }
    @media (prefers-color-scheme: dark) { :root { color-scheme: dark; --bg: #000; --ink: #f5f5f5; --muted: #a8a8a8; --line: #363636;
      --soft: #262626; --sheet: #121212; --ok: #58c322; } }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      -webkit-tap-highlight-color: transparent; }
    body > pre { display: none; }
    button, select, textarea { font: inherit; color: inherit; }
    button { cursor: pointer; border: 0; background: none; padding: 0; }
    button:disabled { opacity: .5; cursor: default; }
    svg { display: block; flex: none; }
    #app { min-height: 100vh; padding-bottom: calc(56px + env(safe-area-inset-bottom)); }
    .top { position: sticky; top: 0; z-index: 3; background: var(--bg); border-bottom: 1px solid var(--line); }
    .bar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
    .bar h1 { font-size: 20px; margin: 0 4px 0 0; font-weight: 700; }
    .grow { flex: 1 1 auto; min-width: 0; }
    select { height: 36px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); padding: 0 8px; flex: 1 1 auto; min-width: 0; max-width: 480px; }
    .bar.pick { padding-top: 0; }
    .ibtn { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: var(--ink); flex: none; }
    .ibtn:hover { background: var(--soft); }
    .ibtn.on { color: #f5b301; }
    .spin svg { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .chips { display: flex; gap: 6px; padding: 0 12px 10px; overflow-x: auto; scrollbar-width: none; }
    .chips::-webkit-scrollbar { display: none; }
    .chip { height: 30px; padding: 0 12px; border-radius: 15px; background: var(--soft); white-space: nowrap; font-weight: 500; font-size: 13px; }
    .chip.on { background: var(--ink); color: var(--bg); }
    .line { padding: 6px 12px; font-size: 12px; color: var(--muted); display: flex; gap: 8px; flex-wrap: wrap; }
    .line .err { color: var(--bad); }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; }
    @media (min-width: 900px) { .grid { grid-template-columns: repeat(5, 1fr); } }
    .tile { position: relative; aspect-ratio: 1; background: var(--soft); overflow: hidden; display: block; width: 100%; }
    .tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tile .kind { position: absolute; top: 6px; right: 6px; color: #fff; filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
    .tile .nocap { position: absolute; inset: 8px; display: grid; place-items: center; color: var(--muted); font-size: 12px; text-align: center; }
    .dot { position: absolute; left: 6px; bottom: 6px; height: 20px; padding: 0 7px; border-radius: 10px; font-size: 11px; font-weight: 600;
      display: inline-flex; align-items: center; gap: 4px; color: #fff; background: rgba(0,0,0,.55); }
    .dot.queued { background: var(--queued); } .dot.handled { background: var(--ok); } .dot.failed { background: var(--bad); }
    .notes-n { position: absolute; right: 6px; bottom: 6px; height: 20px; padding: 0 6px; border-radius: 10px; font-size: 11px; font-weight: 600;
      display: inline-flex; align-items: center; gap: 2px; color: #fff; background: rgba(0,0,0,.55); }
    .empty { padding: 48px 24px; text-align: center; color: var(--muted); }
    .card { margin: 16px 12px; padding: 16px; border: 1px solid var(--line); border-radius: 12px; }
    .card h2 { margin: 0 0 6px; font-size: 16px; }
    .card p { margin: 0 0 12px; color: var(--muted); }
    .btn { height: 34px; padding: 0 16px; border-radius: 8px; background: var(--soft); font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
    .btn.primary { background: var(--blue); color: #fff; }
    .btn.small { height: 30px; padding: 0 12px; font-size: 13px; }
    .tabs { position: fixed; left: 0; right: 0; bottom: 0; z-index: 4; display: flex; background: var(--bg); border-top: 1px solid var(--line);
      padding-bottom: env(safe-area-inset-bottom); }
    .tabs[hidden] { display: none; }
    .tabs button { flex: 1; height: 52px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
      font-size: 11px; color: var(--muted); }
    .tabs button.on { color: var(--ink); font-weight: 600; }
    .rows { list-style: none; margin: 0; padding: 0; }
    .row { display: flex; gap: 12px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--line); width: 100%; text-align: left; }
    .row img, .row .ph { width: 56px; height: 56px; object-fit: cover; border-radius: 6px; flex: none; background: var(--soft); }
    .row .txt { min-width: 0; flex: 1; }
    .row .txt b { display: block; }
    .row .txt span { display: block; color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pill { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: var(--soft); white-space: nowrap; }
    .pill.queued { background: var(--queued); color: #fff; } .pill.handled { background: var(--ok); color: #fff; } .pill.failed { background: var(--bad); color: #fff; }
    h3.sec { margin: 16px 12px 4px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: .4px; }
    .sheet { position: fixed; inset: 0; z-index: 200; background: var(--sheet); overflow-y: auto; -webkit-overflow-scrolling: touch; }
    .sheet .bar { position: sticky; top: 0; background: var(--sheet); z-index: 2; border-bottom: 1px solid var(--line); }
    .sheet .bar b { font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .media { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; background: #000; }
    .media > * { flex: none; width: 100%; max-height: 70vh; object-fit: contain; scroll-snap-align: center; background: #000; }
    .count { padding: 4px 12px 0; font-size: 12px; color: var(--muted); }
    .caption { padding: 10px 12px; white-space: pre-wrap; word-break: break-word; }
    .caption.clamp { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; cursor: pointer; }
    .block { margin: 8px 12px 16px; padding: 12px; border-radius: 12px; background: var(--soft); }
    .block h4 { margin: 0 0 8px; font-size: 14px; display: flex; align-items: center; gap: 8px; }
    .block p { margin: 0 0 10px; color: var(--muted); }
    .block .acts { display: flex; gap: 8px; flex-wrap: wrap; }
    .block .btn:not(.primary) { background: var(--bg); border: 1px solid var(--line); }
    .transcript { white-space: pre-wrap; word-break: break-word; margin: 0; max-height: 40vh; overflow-y: auto; }
    .nlist { list-style: none; margin: 0 0 10px; padding: 0; }
    .nlist li { display: flex; gap: 8px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid var(--line); }
    .nlist li div { flex: 1; min-width: 0; white-space: pre-wrap; word-break: break-word; }
    .nlist time { display: block; font-size: 11px; color: var(--muted); }
    .nlist .wait { color: var(--muted); font-style: italic; }
    .nrow { display: flex; gap: 8px; align-items: flex-end; }
    .nrow textarea { flex: 1; min-height: 38px; max-height: 160px; resize: vertical; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); padding: 8px; }
    .rec { width: 44px; height: 44px; border-radius: 50%; background: var(--blue); color: #fff; display: grid; place-items: center; flex: none; }
    .rec.on { background: var(--bad); animation: pulse 1.2s ease-in-out infinite; }
    @keyframes pulse { 50% { box-shadow: 0 0 0 8px rgba(237,73,86,.25); } }
    .notice { margin: 8px 0 0; font-size: 13px; color: var(--muted); }
    .notice.err { color: var(--bad); }
    .toast { position: fixed; left: 50%; bottom: calc(68px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 300; background: #262626; color: #fff;
      padding: 10px 16px; border-radius: 8px; max-width: calc(100vw - 32px); box-shadow: 0 4px 16px rgba(0,0,0,.3); }
  `;

  // What the page knows: the background's view (igState) and what is shown.
  const ui = {
    tab: 'saved', collection: null, filter: 'all', open: null,
    data: null, reading: '', readError: '', login: false, me: null, notHere: false, other: null, connectNote: '', connectErr: false,
    loadedCollections: new Set(), results: {}, rec: null, writing: false, notice: '', noticeErr: false, expanded: false,
  };
  let root, main, tabsBar, sheet, headerBox;

  async function refresh() {
    const r = await ask({ type: 'igState' });
    if (r?.notHere) { ui.notHere = true; draw(); return; }
    if (!r?.ok) return;
    ui.data = r;
    ui.collection ??= r.defaultCollection ?? 'all';
    if (ui.collection !== 'all' && !r.collections.some((c) => c.id === ui.collection)) ui.collection = r.collections.length ? ui.collection : 'all';
    draw();
  }

  let toastTimer;
  function toast(text) {
    document.querySelector('.toast')?.remove();
    const t = h('div', { class: 'toast', role: 'status', text });
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 4000);
  }

  // --- reading Instagram ---------------------------------------------------------------------------------------------
  const API = () => globalThis.KidTubeIgApi;
  let reading = false;
  // The newest saved posts until a page with nothing new, then (once) the rest of the list; the collections; the
  // collection on screen.
  async function readInstagram() {
    if (reading) return;
    reading = true;
    ui.readError = '';
    ui.login = false;
    try {
      ui.reading = 'Reading your collections…';
      draw();
      await ask({ type: 'igCollections', list: await API().collections() });
      await refresh();
      const d = ui.data;
      let count = 0;
      const show = (n) => { count += n; ui.reading = `Reading your saved posts… ${count}`; draw(); };
      if (d.posts.length && d.complete) {
        let next = null;
        for (let page = 0; page < 50; page++) {
          const r = await API().saved(next);
          const a = await ask({ type: 'igSaved', media: r.media, at: 'top', page });
          show(r.media.length);
          if (!a?.ok || !r.next || a.known === r.media.length) break;
          next = r.next;
          await wait(400);
        }
      } else {
        let next = d.cursor;
        for (let page = 0; page < 1000; page++) {
          const r = await API().saved(next);
          const a = await ask({ type: 'igSaved', media: r.media, at: 'end', page, cursor: r.next });
          show(r.media.length);
          if (!a?.ok || !r.next) break;
          next = r.next;
          if (page % 5 === 4) await refresh();
          await wait(500);
        }
      }
      await ask({ type: 'igSaved', media: [], at: 'none', finished: true });
      if (ui.collection && ui.collection !== 'all') await readCollection(ui.collection);
    } catch (e) {
      readFailed(e);
    } finally {
      reading = false;
      ui.reading = '';
      await refresh();
    }
  }

  // A read that failed. "Signed out" only when nobody is signed in: Instagram also asks for a sign-in when it limits a
  // signed-in account (too many requests), and then the screen shows its own words.
  function readFailed(e) {
    const login = e instanceof API().LoginNeeded;
    ui.login = login && !ui.me?.username;
    ui.readError = login && !ui.login
      ? `Instagram did not give the saved posts of @${ui.me.username} (${e.detail || e.message}). Wait a few minutes, then tap ↻.`
      : login ? e.detail ?? '' : String(e.message ?? e);
  }

  async function readCollection(id) {
    if (ui.loadedCollections.has(id)) return;
    ui.loadedCollections.add(id);
    const ids = [];
    let next = null;
    try {
      for (let page = 0; page < 200; page++) {
        const r = await API().collection(id, next);
        ids.push(...r.media.map((m) => String(m.pk ?? m.id).split('_')[0]));
        await ask({ type: 'igCollection', id, media: r.media });
        ui.reading = `Reading the collection… ${ids.length}`;
        draw();
        if (!r.next) break;
        next = r.next;
        await wait(400);
      }
      await ask({ type: 'igCollection', id, media: [], done: true, ids });
    } catch (e) {
      ui.loadedCollections.delete(id);
      readFailed(e);
    }
    ui.reading = '';
    await refresh();
  }

  // Pictures expire after some days: a broken one asks Instagram for the post again (a few at a time).
  const stale = new Set();
  let fixing = false;
  async function fixPictures() {
    if (fixing) return;
    fixing = true;
    let n = 0;
    while (stale.size && n < 40) {
      const id = stale.values().next().value;
      stale.delete(id);
      try { const m = await API().media(id); if (m) await ask({ type: 'igPosts', media: [m] }); } catch { break; }
      n++;
      await wait(600);
    }
    fixing = false;
    await refresh();
  }
  const brokenPicture = (id) => { stale.add(id); setTimeout(fixPictures, 1500); };

  // --- the tabs -------------------------------------------------------------------------------------------------------
  const posts = () => ui.data?.posts ?? [];
  const inCollection = () => (ui.collection && ui.collection !== 'all' ? posts().filter((p) => p.collections.includes(ui.collection)) : posts());

  function savedTab() {
    const d = ui.data;
    const sel = h('select', { 'aria-label': 'Collection', value: ui.collection ?? 'all', onchange: (e) => {
      ui.collection = e.target.value;
      ui.filter = 'all';
      draw();
      if (ui.collection !== 'all') readCollection(ui.collection);
    } },
    h('option', { value: 'all', text: `All saved (${posts().length})` }),
    d.collections.map((c) => h('option', { value: c.id, text: `${c.name} (${c.count})` })));
    const isDefault = (d.defaultCollection ?? 'all') === ui.collection;
    const star = h('button', { class: `ibtn${isDefault ? ' on' : ''}`, type: 'button',
      title: isDefault ? 'The Saved tab opens with this one' : 'Open the Saved tab with this one (make it the default)',
      'aria-pressed': String(isDefault),
      onclick: async () => {
        if (isDefault) return toast('Already the default.');
        const r = await ask({ type: 'igDefault', collection: ui.collection });
        toast(r?.ok ? 'The Saved tab now opens with this one.' : r?.error ?? 'Could not save it.');
        await refresh();
      } }, icon(isDefault ? 'star' : 'starOff'));
    const syncBtn = h('button', { class: `ibtn${reading ? ' spin' : ''}`, type: 'button', title: 'Read Instagram again', disabled: reading,
      onclick: () => { ui.loadedCollections.clear(); readInstagram(); ask({ type: 'sync' }); } }, icon('sync'));
    const list = inCollection();
    const counts = { all: list.length, new: 0, queued: 0, handled: 0, failed: 0 };
    for (const p of list) counts[p.status]++;
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Status' },
      [['all', 'All'], ['new', STATUS.new], ['queued', STATUS.queued], ['handled', STATUS.handled], ['failed', STATUS.failed]]
        .filter(([k]) => k !== 'failed' || counts.failed)
        .map(([k, label]) => h('button', { class: `chip${ui.filter === k ? ' on' : ''}`, type: 'button', 'aria-pressed': String(ui.filter === k),
          text: `${label} ${counts[k]}`, onclick: () => { ui.filter = k; draw(); } })));
    const shown = ui.filter === 'all' ? list : list.filter((p) => p.status === ui.filter);
    const top = h('div', { class: 'top' }, h('div', { class: 'bar' }, h('h1', { text: 'Saved' }), h('div', { class: 'grow' }), syncBtn, siteSwitch()),
      h('div', { class: 'bar pick' }, sel, star), chips, statusLine());
    let body;
    if (ui.login) body = loginCard();
    else if (!shown.length) body = h('div', { class: 'empty', text: ui.reading ? 'Loading…' : posts().length ? 'Nothing here.' : 'No saved posts yet. Save posts on Instagram, then tap ↻.' });
    else body = h('div', { class: 'grid' }, shown.map(tile));
    return [top, body];
  }

  function statusLine() {
    const d = ui.data;
    const bits = [];
    if (ui.reading) bits.push(h('span', { text: ui.reading }));
    else bits.push(h('span', { text: `Read from Instagram ${ago(d.loadedAt)}${d.complete ? '' : ' · not all read yet'}` }));
    if (ui.readError && !ui.login) bits.push(h('span', { class: 'err', text: ui.readError }));
    if (!d.github) bits.push(h('span', { class: 'err', text: 'GitHub is not connected: the notes stay on this device (header → account menu).' }));
    else if (d.unsent) bits.push(h('span', { text: 'Changes wait to go to GitHub…' }));
    for (const e of d.sync?.errors ?? []) bits.push(h('span', { class: 'err', text: e }));
    return h('div', { class: 'line' }, bits);
  }

  function tile(p) {
    const b = h('button', { class: 'tile', type: 'button', title: `${p.author}: ${p.caption.slice(0, 80)}`, onclick: () => openPost(p.id) });
    if (p.thumb) {
      const img = h('img', { src: p.thumb, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => { img.remove(); brokenPicture(p.id); }, { once: true });
      b.append(img);
    } else b.append(h('span', { class: 'nocap', text: p.caption.slice(0, 60) || `@${p.author}` }));
    if (p.kind !== 'image') b.append(h('span', { class: 'kind' }, icon(p.kind === 'carousel' ? 'carousel' : 'reel', 18)));
    if (p.status !== 'new') b.append(h('span', { class: `dot ${p.status}`, text: STATUS[p.status] }));
    if (p.notes.length) b.append(h('span', { class: 'notes-n' }, icon('mic', 12), String(p.notes.length)));
    return b;
  }

  function loginCard() {
    return h('div', { class: 'card' }, h('h2', { text: 'Instagram is signed out' }),
      h('p', { text: 'The app reads the saved posts of the connected account. Sign in on Instagram itself (the Instagram side of the switch), then come back with App.' }),
      ui.readError ? h('p', { class: 'notice err', text: `Instagram answered: ${ui.readError}` }) : null);
  }

  // Connect from the screen's own cards (the header above has it too).
  function connectCard(title, text) {
    const say = (t, err) => { ui.connectNote = t; ui.connectErr = !!err; draw(); };
    return h('div', { class: 'card' }, h('h2', { text: title }), h('p', { text }),
      h('button', { class: 'btn primary', type: 'button', onclick: () => connectHere(say) }, 'Connect'),
      ui.connectNote ? h('p', { class: `notice${ui.connectErr ? ' err' : ''}`, text: ui.connectNote }) : null);
  }

  // The list the agent handles: waiting first (oldest request first), then the failed, then the latest handled.
  function queueTab() {
    const all = posts();
    const waiting = all.filter((p) => p.status === 'queued').sort((a, b) => a.handle.at.localeCompare(b.handle.at));
    const failed = all.filter((p) => p.status === 'failed');
    const done = all.filter((p) => p.status === 'handled').sort((a, b) => String(b.handledAt).localeCompare(String(a.handledAt))).slice(0, 30);
    const row = (p) => h('li', null, h('button', { class: 'row', type: 'button', onclick: () => openPost(p.id) },
      p.thumb ? h('img', { src: p.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'ph' }),
      h('span', { class: 'txt' }, h('b', { text: `@${p.author}` }), h('span', { text: p.error ?? (p.caption.split('\n')[0] || ' ') }),
        h('span', { text: `${p.notes.length ? `${p.notes.length} note${p.notes.length === 1 ? '' : 's'} · ` : ''}${p.status === 'handled' ? `handled ${ago(p.handledAt)}` : p.handle ? `asked ${ago(p.handle.at)}` : ''}` })),
      h('span', { class: `pill ${p.status}`, text: STATUS[p.status] })));
    const top = h('div', { class: 'top' }, h('div', { class: 'bar' }, h('h1', { text: 'To handle' }), h('div', { class: 'grow' }), siteSwitch()),
      h('div', { class: 'line' }, h('span', { text: 'The agent writes down what each video says. A note puts the post here by itself.' })), statusLine());
    if (!waiting.length && !failed.length && !done.length) return [top, h('div', { class: 'empty', text: 'The list is empty. Open a saved post and tap “Add to the list”, or record a note about it.' })];
    return [top,
      waiting.length ? [h('h3', { class: 'sec', text: `Waiting · ${waiting.length}` }), h('ul', { class: 'rows' }, waiting.map(row))] : null,
      failed.length ? [h('h3', { class: 'sec', text: `Failed · ${failed.length}` }), h('ul', { class: 'rows' }, failed.map(row))] : null,
      done.length ? [h('h3', { class: 'sec', text: 'Handled lately' }), h('ul', { class: 'rows' }, done.map(row))] : null];
  }

  // --- one post ---------------------------------------------------------------------------------------------------------
  async function openPost(id) {
    ui.open = id;
    ui.notice = '';
    ui.expanded = false;
    history.pushState({ post: id }, '', `${HOME}#${id}`);
    draw();
    const p = posts().find((x) => x.id === id);
    // Fresh addresses when the old ones may have expired (a day), so the video plays.
    if (p && (!p.mediaAt || Date.now() - Date.parse(p.mediaAt) > 12 * 3600e3 || !p.items.length)) {
      try { const m = await API().media(id); if (m) { await ask({ type: 'igPosts', media: [m] }); await refresh(); } } catch {}
    }
    if (p && (p.status === 'handled' || p.status === 'failed')) loadResult(id);
  }
  // The sheet's ← and the browser's Back close it.
  addEventListener('popstate', () => { if (ui.open) { ui.rec?.stop(); ui.open = null; draw(); } });

  async function loadResult(id) {
    ui.results[id] = { loading: true };
    draw();
    const r = await ask({ type: 'igResult', id }, 20000);
    ui.results[id] = r?.ok ? { result: r.result } : { error: r?.error ?? 'No answer.' };
    draw();
  }

  async function setHandle(p, off) {
    let media = null;
    // The agent fetches the video: send fresh addresses with the request.
    if (!off && p.kind !== 'image') { try { media = await API().media(p.id); } catch {} }
    const r = await ask({ type: 'igHandle', id: p.id, off, media });
    toast(r?.ok ? (off ? 'Taken out of the list.' : 'In the list: the agent handles it within a few minutes.') : r?.error ?? 'Could not change it.');
    await refresh();
  }

  function postSheet(p) {
    const media = h('div', { class: 'media' }, p.items.map((i) => (i.video
      ? h('video', { src: i.video, poster: i.src ?? undefined, controls: true, playsinline: true, preload: 'metadata' })
      : h('img', { src: i.src ?? p.thumb ?? '', alt: '', referrerpolicy: 'no-referrer' }))));
    const cap = h('div', { class: `caption${ui.expanded ? '' : ' clamp'}`, text: p.caption || '(no caption)', onclick: () => { ui.expanded = !ui.expanded; draw(); } });
    const unsent = ui.data.unsent;
    const statusText = {
      new: 'Not handled yet. Add it to the list, and the agent writes down what the video says.',
      queued: `In the list since ${ago(p.handle?.at)}. ${unsent ? 'It goes to GitHub in a few seconds; ' : ''}the agent handles it within a few minutes.`,
      handled: `Handled ${ago(p.handledAt)}.`,
      failed: `The agent could not handle it: ${p.error}`,
    }[p.status];
    const acts = h('div', { class: 'acts' },
      p.status === 'new' ? h('button', { class: 'btn primary small', type: 'button', onclick: () => setHandle(p, false) }, 'Add to the list') : null,
      p.status === 'queued' ? h('button', { class: 'btn small', type: 'button', onclick: () => setHandle(p, true) }, 'Take out of the list') : null,
      p.status === 'handled' ? h('button', { class: 'btn small', type: 'button', onclick: () => setHandle(p, false) }, 'Handle again') : null,
      p.status === 'failed' ? h('button', { class: 'btn primary small', type: 'button', onclick: () => setHandle(p, false) }, 'Try again') : null);
    const res = ui.results[p.id];
    let resultBlock = null;
    if (p.status === 'handled' || p.status === 'failed' || res) {
      const t = res?.result?.transcript;
      resultBlock = h('div', { class: 'block' }, h('h4', { text: 'What the video says' }),
        res?.loading ? h('p', { text: 'Loading…' })
          : res?.error ? h('p', { text: res.error })
            : t?.text ? h('p', { class: 'transcript', text: t.text })
              : res?.result ? h('p', { text: res.result.skipped ?? 'No words in it.' })
                : h('button', { class: 'btn small', type: 'button', onclick: () => loadResult(p.id) }, 'Show'));
    }
    return h('div', { class: 'sheet', role: 'dialog', 'aria-label': `Post by ${p.author}` },
      h('div', { class: 'bar' }, h('button', { class: 'ibtn', type: 'button', title: 'Back', onclick: () => history.back() }, icon('back')),
        h('b', { class: 'grow', text: `@${p.author}` }),
        h('a', { class: 'ibtn', href: `https://www.instagram.com/${p.reel ? 'reel' : 'p'}/${p.code}/`, title: 'Open on Instagram' }, icon('open'))),
      media, p.items.length > 1 ? h('div', { class: 'count', text: `${p.items.length} items · swipe` }) : null,
      cap,
      h('div', { class: 'block' }, h('h4', null, 'Status ', h('span', { class: `pill ${p.status}`, text: STATUS[p.status] })), h('p', { text: statusText }), acts),
      resultBlock,
      notesBlock(p));
  }

  // --- notes: 🎤 records until ⏹ (written down in the background), or typed ---------------------------------------------
  function notesBlock(p) {
    const list = h('ul', { class: 'nlist' }, p.notes.map((n) => h('li', null,
      h('div', null, h('time', { text: new Date(n.at).toLocaleString() }), n.text != null ? n.text : h('span', { class: 'wait', text: '🎙 Recording: the agent writes it down.' })),
      h('button', { class: 'ibtn', type: 'button', title: 'Delete this note', onclick: async () => {
        if (!confirm('Delete this note?')) return;
        await ask({ type: 'igDropNote', id: p.id, noteId: n.id });
        await refresh();
      } }, icon('x', 18)))));
    const typed = h('textarea', { rows: 1, maxlength: 4000, placeholder: 'Type a note…', 'aria-label': 'Note' });
    const rec = ui.rec ? Math.round((Date.now() - ui.rec.started) / 1000) : 0;
    const mic = h('button', { class: `rec${ui.rec ? ' on' : ''}`, type: 'button', disabled: ui.writing,
      title: ui.rec ? 'Stop and save the note' : 'Record a voice note', onclick: () => (ui.rec ? ui.rec.stop() : record(p.id)) }, icon(ui.rec ? 'stop' : 'mic'));
    const add = h('button', { class: 'btn small', type: 'button', onclick: async () => {
      const text = typed.value.trim();
      if (!text) return;
      const r = await ask({ type: 'igNote', id: p.id, text });
      if (!r?.ok) return toast(r?.error ?? 'Could not save the note.');
      typed.value = '';
      toast('Saved. The post is in the list to handle.');
      await refresh();
    } }, 'Add');
    return h('div', { class: 'block' }, h('h4', { text: `Notes${p.notes.length ? ` · ${p.notes.length}` : ''}` }),
      h('p', { text: 'A note puts the post in the list: the agent handles it with your notes.' }),
      p.notes.length ? list : null,
      h('div', { class: 'nrow' }, mic, typed, add),
      ui.rec ? h('p', { class: 'notice', text: `● Recording ${Math.floor(rec / 60)}:${String(rec % 60).padStart(2, '0')} · tap ⏹ to stop (at most 3 min)` }) : null,
      ui.writing ? h('p', { class: 'notice', text: 'Writing it down…' }) : null,
      ui.notice ? h('p', { class: `notice${ui.noticeErr ? ' err' : ''}`, text: ui.notice }) : null);
  }

  const NOTE_SECONDS = 180;
  // The microphone as 16 kHz mono WAV, until stop() or NOTE_SECONDS. null: the browser gave no microphone.
  async function recordWav(signal) {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { return null; }
    const ctx = new AudioContext({ sampleRate: 16000 });
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    let peak = 0;
    await new Promise((resolve) => {
      const stop = () => { node.onaudioprocess = null; resolve(); };
      const timer = setTimeout(stop, NOTE_SECONDS * 1000);
      signal.addEventListener('abort', () => { clearTimeout(timer); stop(); });
      node.onaudioprocess = (e) => { const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d)); for (const x of d) peak = Math.max(peak, Math.abs(x)); };
      src.connect(node);
      node.connect(ctx.destination);
    });
    src.disconnect(); node.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    const gain = peak > 0 && peak < 0.3 ? Math.min(10, 0.5 / peak) : 1;   // a quiet microphone still holds words
    const n = chunks.reduce((a, c) => a + c.length, 0);
    const buf = new DataView(new ArrayBuffer(44 + n * 2));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) buf.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); buf.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
    buf.setUint32(24, 16000, true); buf.setUint32(28, 32000, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true); str(36, 'data'); buf.setUint32(40, n * 2, true);
    let o = 44;
    for (const c of chunks) for (const x of c) { buf.setInt16(o, Math.max(-1, Math.min(1, x * gain)) * 0x7fff, true); o += 2; }
    return { bytes: new Uint8Array(buf.buffer), seconds: n / 16000, peak };
  }
  const toB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

  async function record(id) {
    const ctl = new AbortController();
    ui.rec = { started: Date.now(), stop: () => ctl.abort() };
    ui.notice = '';
    const clock = setInterval(draw, 1000);
    draw();
    const audio = await recordWav(ctl.signal);
    clearInterval(clock);
    ui.rec = null;
    if (!audio) { ui.notice = 'The browser did not give the microphone. Allow it for instagram.com, or type the note.'; ui.noticeErr = true; draw(); return; }
    if (audio.seconds < 1 || audio.peak < 0.002) { ui.notice = 'Heard nothing. Try again closer to the microphone.'; ui.noticeErr = true; draw(); return; }
    ui.writing = true;
    draw();
    const r = await ask({ type: 'igNote', id, audio: toB64(audio.bytes), lang: navigator.language || 'en-US' }, 120000);
    ui.writing = false;
    ui.noticeErr = !r?.ok;
    ui.notice = r?.ok ? (r.notice ?? 'Saved. The post is in the list to handle.') : r?.error ?? 'Could not save the note.';
    await refresh();
  }

  // --- drawing ----------------------------------------------------------------------------------------------------------
  function draw() {
    if (!main) return;
    // No Instagram profile runs, or Instagram has another account signed in than the profile's: nothing is read.
    if (ui.notHere || ui.other) {
      main.replaceChildren(ui.notHere
        ? connectCard('No Instagram account is connected', 'Press Connect: the Instagram account signed in here becomes the app’s profile (a new one starts empty).')
        : connectCard(`Instagram is signed in to @${ui.other}`, `This app shows ${ui.data?.who ?? 'another account'}. Press Connect to use @${ui.other}, or sign in to ${ui.data?.who ?? 'that account'} again on Instagram.`));
      tabsBar.hidden = true;
      return;
    }
    if (!ui.data) { main.replaceChildren(h('div', { class: 'empty', text: 'Loading…' })); return; }
    // Under an open post the tab is not drawn again (its pictures would load again for nothing).
    if (!ui.open || !main.childElementCount) {
      const y = scrollY;
      main.replaceChildren(...[ui.tab === 'saved' ? savedTab() : queueTab()].flat(Infinity).filter(Boolean));
      scrollTo(0, y);
    }
    const waiting = posts().filter((p) => p.status === 'queued').length;
    tabsBar.replaceChildren(
      h('button', { class: ui.tab === 'saved' ? 'on' : '', type: 'button', onclick: () => { ui.tab = 'saved'; draw(); scrollTo(0, 0); } }, icon('saved'), 'Saved'),
      h('button', { class: ui.tab === 'queue' ? 'on' : '', type: 'button', onclick: () => { ui.tab = 'queue'; draw(); scrollTo(0, 0); } }, icon('list'), `To handle${waiting ? ` (${waiting})` : ''}`));
    const p = ui.open && posts().find((x) => x.id === ui.open);
    // Keep what is typed in a note while the sheet draws again.
    const typing = sheet.querySelector('textarea')?.value ?? '';
    const sheetScroll = sheet.firstChild?.scrollTop ?? 0;
    sheet.replaceChildren(...(p ? [postSheet(p)] : []));
    if (p) {
      const ta = sheet.querySelector('textarea');
      if (ta && typing) ta.value = typing;
      sheet.firstChild.scrollTop = sheetScroll;
    }
    document.body.style.overflow = p ? 'hidden' : '';
  }

  async function start() {
    document.title = 'Instagram · Saved';
    const head = document.head ?? document.documentElement.insertBefore(document.createElement('head'), document.body);
    head.replaceChildren(h('meta', { charset: 'utf-8' }), h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }),
      h('title', { text: 'Instagram · Saved' }), h('style', { text: CSS }));
    headerBox = h('div');
    main = h('main');
    tabsBar = h('nav', { class: 'tabs', 'aria-label': 'Tabs' });
    sheet = h('div');
    root = h('div', { id: 'app' }, headerBox, main, tabsBar, sheet);
    document.body.replaceChildren(root);
    globalThis.KidTubeHeader?.mount(headerBox);
    draw();
    await refresh();
    const me = ui.me = await reportMe();
    if (ui.notHere) return;
    // Only the profile's own account is read: another one's saved posts must not join its list.
    if (!me.loggedIn) { ui.login = true; ui.readError = me.detail; draw(); return; }
    if (me.username && ui.data?.who && `@${me.username}` !== ui.data.who) { ui.other = me.username; draw(); return; }
    const id = location.hash.slice(1);
    if (/^\d+$/.test(id) && posts().some((p) => p.id === id)) { history.replaceState(null, '', HOME); openPost(id); }
    ask({ type: 'sync' });   // the agent's latest results
    readInstagram();
    // While posts wait for the agent: its results every minute; the screen every 20 s (the background's syncs).
    setInterval(() => { if (document.visibilityState === 'visible' && posts().some((p) => p.status === 'queued')) ask({ type: 'sync' }); }, 60000);
    setInterval(() => { if (document.visibilityState === 'visible' && !ui.rec) refresh(); }, 20000);
    chrome.storage.onChanged.addListener((ch) => { if ((ch.account || ch.shell) && !ui.rec) refresh(); });
  }

  document.documentElement?.classList.add('ktig');
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
