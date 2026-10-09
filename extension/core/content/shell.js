// Runs on youtube.com and m.youtube.com before the apps' content scripts: the core's part of the page.
// It shows the apps header above YouTube (at the apps header, and in parent mode), covers YouTube with a lock
// until a grown-up's PIN (an app stopped because YouTube's account changed), and tells the background who is
// signed in. It asks the background for the state and hands it to the app's script: globalThis.KidTubeShell.
// It never decides what is allowed: the service worker does, and also guards every URL change.
(() => {
  if (globalThis.KidTubeShell) return;
  const Z = '2147483647';
  // Same as core/lib/ask.js. Content scripts are not modules, and Orion only returns sendMessage answers to the callback.
  const ask = (msg) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 8000);
    try {
      chrome.runtime.sendMessage(msg, (value) => { clearTimeout(timer); void chrome.runtime.lastError; resolve(value); });
    } catch { clearTimeout(timer); resolve(undefined); }
  });
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // The header sits above YouTube: YouTube's page and its fixed top bar move down by its height.
  const style = document.createElement('style');
  style.textContent = `
    html.kidtube-shell body { margin-top: var(--kidtube-h, 0px) !important; }
    html.kidtube-shell #masthead-container, html.kidtube-shell ytm-mobile-topbar-renderer { top: var(--kidtube-h, 0px) !important; }
    html.kidtube-shell ytd-mini-guide-renderer { top: calc(56px + var(--kidtube-h, 0px)) !important; }`;
  (document.head || document.documentElement).append(style);

  // --- the apps header (core/ui/header.js) --------------------------------------------------------------------
  let headerHost = null, header = null, headerSize = null;
  const isDark = () => document.documentElement.hasAttribute('dark') || document.documentElement.hasAttribute('darker-dark-theme');
  function showHeader() {
    if (!headerHost) {
      headerHost = document.createElement('div');
      headerHost.id = 'kidtube-header';
      headerHost.style.cssText = `position:fixed!important;top:0!important;left:0!important;right:0!important;z-index:${Z}!important;display:block!important;margin:0!important`;
      header = globalThis.KidTubeHeader.mount(headerHost, { dark: isDark() });
      headerSize = new ResizeObserver(() => document.documentElement.style.setProperty('--kidtube-h', `${headerHost?.offsetHeight ?? 0}px`));
      headerSize.observe(headerHost);
    }
    if (!headerHost.isConnected) document.documentElement.appendChild(headerHost);
    document.documentElement.classList.add('kidtube-shell');
  }
  function hideHeader() {
    if (!headerHost) return;
    header.destroy(); headerSize.disconnect(); headerHost.remove();
    header = headerHost = headerSize = null;
    document.documentElement.classList.remove('kidtube-shell');
    document.documentElement.style.removeProperty('--kidtube-h');
  }
  new MutationObserver(() => header?.setDark(isDark())).observe(document.documentElement, { attributes: true, attributeFilter: ['dark', 'darker-dark-theme'] });

  // --- the lock: YouTube covered until the PIN, in a closed shadow root that YouTube's CSS can't reach ----------
  const LOCK_CSS = `
    .lockcover { position: fixed; inset: 0; display: grid; place-items: center; text-align: center; padding: 24px; pointer-events: auto;
      background: radial-gradient(circle at 50% 15%, #3d4b8f, #242c58 70%); color: #fff;
      font: 700 16px/1.3 "Nunito", ui-rounded, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
    .lockcard { background: #fff; color: #1f2a44; border-radius: 28px; padding: 36px 28px 28px; max-width: 440px; box-shadow: 0 16px 48px rgba(0, 0, 0, .35); }
    .big { font-size: 64px; line-height: 1; }
    h1 { font-size: 26px; font-weight: 900; margin: 14px 0 8px; }
    p { font-size: 16px; color: #66758f; margin: 0; }
    button { margin-top: 24px; height: 50px; border-radius: 25px; padding: 0 28px; border: 0; cursor: pointer;
      background: #1f2a44; color: #fff; font: inherit; font-weight: 800; font-size: 17px; }`;
  let lockRoot = null, lockBox = null;
  function showLock(why) {
    if (!lockRoot) {
      const host = document.createElement('div');
      host.id = 'kidtube-lock';
      host.style.cssText = `position:fixed!important;inset:0!important;z-index:${Z}!important;display:block!important`;
      lockRoot = host.attachShadow({ mode: 'closed' });
      const sheet = el('style');
      sheet.textContent = LOCK_CSS;
      lockBox = el('div', 'lockcover');
      lockRoot.append(sheet, lockBox);
    }
    if (!lockRoot.host.isConnected) document.documentElement.appendChild(lockRoot.host);
    const unlock = el('button', '', 'Unlock with the PIN');
    unlock.type = 'button';
    unlock.addEventListener('click', () => ask({ type: 'openApps' }));
    const card = el('div', 'lockcard');
    card.append(el('div', 'big', '🔒'), el('h1', '', 'Ask a grown-up'), el('p', '', why || 'KidTube is locked.'), unlock);
    lockBox.replaceChildren(card);
    for (const v of document.querySelectorAll('video')) { v.muted = true; if (!v.paused) v.pause(); }
  }
  const hideLock = () => lockRoot?.host.remove();
  // Behind the lock, a link that still gets a tap or a key (the cover takes the taps) goes nowhere.
  const swallow = (e) => {
    if (!shell?.locked || !e.target.closest?.('a[href]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  for (const t of ['click', 'auxclick']) document.addEventListener(t, swallow, true);

  // --- the state, handed to the app's script ---------------------------------------------------------------
  // shell: the apps header is on (no app runs: plain YouTube, where the parent signs in or switches the account).
  let shell = null, parentOn = false, last = null;
  const listeners = [];
  async function refresh() {
    const st = await ask({ type: 'state' });
    if (!st?.shell) return;
    last = st;
    const wasShell = !!shell, wasParent = parentOn;
    shell = st.shell.on ? st.shell : null;
    parentOn = !!st.parentMode;
    if (shell?.locked) { hideHeader(); showLock(shell.why); }
    else {
      hideLock();
      // Parent mode: on a video page. Any other YouTube page is about to become the app's parent screens.
      if (shell || (parentOn && location.pathname === '/watch')) showHeader(); else hideHeader();
    }
    for (const fn of listeners) fn(st);
    // An app was opened at the header, or parent mode ended: the app's rules check this page again.
    if ((wasShell && !shell) || (wasParent && !parentOn && !shell)) ask({ type: 'recheck', url: location.href });
  }

  // --- who is signed in (core/content/youtube-page.js reads YouTube's config) ------------------------------------
  // The email comes from YouTube's own account switcher, asked from this page so it carries the YouTube sign-in;
  // the background picks that account's data.
  let accountSeen = false, lastWho = null;
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.kidtube !== 'account') return;
    accountSeen = true;
    reportAccount(e.data.loggedIn, e.data.datasyncId);
  });
  // The page-world script may not run (Orion): read the same two values from YouTube's own page text.
  setTimeout(() => {
    if (accountSeen) return;
    const text = [...document.scripts].map((x) => x.textContent).find((t) => t.includes('"LOGGED_IN"')) ?? '';
    const loggedIn = text.match(/"LOGGED_IN":(true|false)/)?.[1];
    if (loggedIn) reportAccount(loggedIn === 'true', text.match(/"DATASYNC_ID":"([^"]*)"/)?.[1] ?? '');
  }, 4000);
  async function reportAccount(loggedIn, datasyncId) {
    lastWho = [loggedIn, datasyncId];
    let switcher = '';
    if (loggedIn) {
      try { switcher = (await (await fetch(`${location.origin}/getAccountSwitcherEndpoint`, { credentials: 'include' })).text()).slice(0, 400000); } catch {}
    }
    ask({ type: 'account', loggedIn: !!loggedIn, datasyncId: String(datasyncId ?? '').slice(0, 200), switcher });
  }

  // Parent mode can end without any storage change (an old timer), and at the header the account can change in
  // another tab: ask again now and then.
  let beat = 0;
  setInterval(() => {
    if (++beat % (shell ? 5 : 30) === 0) refresh();
    if (shell && beat % 10 === 0 && lastWho) reportAccount(...lastWho);
  }, 1000);
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.data || ch.localConfig || ch.settings || ch.account || ch.shell) refresh();
  });
  refresh();

  globalThis.KidTubeShell = {
    ask, Z,
    // Ask the background again now (an app's script after a page change).
    refresh,
    // fn(state) after every answer: { app, shell, parentMode, ...the app's view }. Called at once with the last one.
    onState(fn) { listeners.push(fn); if (last) fn(last); },
  };
})();
