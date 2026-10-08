// Runs on youtube.com and m.youtube.com. Covers YouTube with our screens and reports playback.
// It never decides what is allowed: the service worker does, and also guards every URL change.
(() => {
  const Z = '2147483647';
  // Same as lib/ask.js. Content scripts are not modules, and Orion only returns sendMessage answers to the callback.
  const ask = (msg) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 8000);
    try {
      chrome.runtime.sendMessage(msg, (value) => { clearTimeout(timer); void chrome.runtime.lastError; resolve(value); });
    } catch { clearTimeout(timer); resolve(undefined); }
  });
  let page = null;             // 'home' | 'watch'
  let videoId = null;
  let frames = {};             // our screens by name: extension iframes, or in-page panels (below)

  const style = document.createElement('style');
  // Links and suggestions drawn inside the player, and YouTube's bottom tabs: hidden, except at the apps header.
  const hidden = document.createElement('style');
  hidden.textContent = `
    .ytp-ce-element, .ytp-endscreen-content, .ytp-pause-overlay, .ytp-chrome-top, .ytp-show-cards-title, .ytp-watermark,
    .ytp-youtube-button, .ytp-suggestion-set, .ytp-videowall-still, .ytp-cards-teaser, .ytp-cards-button, .ytp-autonav-endscreen,
    .ytp-title, .ytp-title-channel, .ytm-autonav-bar, .player-endscreen, .fullscreen-watch-next-entrypoint-wrapper,
    .ytwPlayerMiniplayerHost, ytm-pivot-bar-renderer { display: none !important; }`;
  style.textContent = `
    html.kidtube-on, html.kidtube-on body { overflow: hidden !important; overscroll-behavior: none !important; }
    /* the apps header sits above YouTube: YouTube's page and its fixed top bar move down by its height */
    html.kidtube-shell body { margin-top: var(--kidtube-h, 0px) !important; }
    html.kidtube-shell #masthead-container, html.kidtube-shell ytm-mobile-topbar-renderer { top: var(--kidtube-h, 0px) !important; }
    html.kidtube-shell ytd-mini-guide-renderer { top: calc(56px + var(--kidtube-h, 0px)) !important; }
    iframe.kidtube-frame { position: fixed !important; border: 0 !important; margin: 0 !important; padding: 0 !important;
      z-index: ${Z} !important; background: #e6f2ff; color-scheme: normal; display: block !important; }
    /* allowSkip off: the seek bar can't be dragged (the video element is also guarded below) */
    html.kidtube-noskip .ytp-progress-bar-container, html.kidtube-noskip .ytp-progress-bar, html.kidtube-noskip .ytm-progress-bar,
    html.kidtube-noskip .YtmProgressBarHost, html.kidtube-noskip .ytp-scrubber-container, html.kidtube-noskip .player-controls-progress-bar,
    html.kidtube-noskip .ytp-doubletap-ui-legacy { pointer-events: none !important; }
  `;
  (document.head || document.documentElement).append(style, hidden);
  document.documentElement.classList.add('kidtube-on');

  // Where our screens are drawn. Normally extension iframes (ui/*.html), which YouTube's CSS can't touch.
  // Orion doesn't show extension iframes on web pages (blank white), so its build (version_name "… Orion",
  // tools/build-orion.mjs) draws the same screens in the page, inside a shadow root. Any other browser whose
  // home frame stays silent switches to that too.
  let inPage = /orion/i.test(chrome.runtime.getManifest().version_name ?? '');

  function frame(name, src) {
    if (inPage) return panel(name, src);
    let f = frames[name];
    if (!f) {
      f = frames[name] = document.createElement('iframe');
      f.className = 'kidtube-frame';
      f.src = chrome.runtime.getURL(src);
      f.allow = 'autoplay';
    }
    if (!f.isConnected) document.documentElement.appendChild(f);
    return f;
  }
  function drop(name) {
    frames[name]?.stop?.();
    frames[name]?.remove();
    delete frames[name];
    if (name === 'home') { homeReady = false; clearTimeout(homeWatch); homeWatch = null; }
  }

  function silenceVideos() {
    for (const v of document.querySelectorAll('video')) { v.muted = true; if (!v.paused) v.pause(); }
  }

  function player() {
    return document.querySelector('video.html5-main-video') || document.querySelector('#movie_player video, #player video, video');
  }

  function place(f, x, y, w, h) {
    Object.assign(f.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, h)}px` });
  }
  const COVERS = ['top', 'left', 'right', 'bottom'];

  // Covers on every side of the player, so only the player itself can be touched.
  // Upright tablet: the "up next" strip goes below the player. Sideways: it goes on the right.
  function layoutWatch() {
    const v = player();
    const box = (v?.closest('#movie_player, .html5-video-player, #player-container-id, #player') || v)?.getBoundingClientRect();
    const c = Object.fromEntries(COVERS.map((n) => [n, frame(n, 'ui/cover.html')]));
    const strip = frame('strip', 'ui/strip.html');
    const W = innerWidth, H = innerHeight;
    if (!box || box.height < 50 || box.width < 50) {   // player not drawn yet: cover all but the top third
      COVERS.forEach((n) => place(c[n], 0, 0, 0, 0));
      place(strip, 0, H * 0.35, W, H * 0.65);
      return;
    }
    if (window.scrollY) window.scrollTo(0, 0);
    const below = H - box.bottom, right = W - box.right;
    if (below >= 160 || below >= right) {
      place(strip, 0, box.bottom, W, below);
      place(c.top, 0, 0, W, box.top);
      place(c.left, 0, box.top, box.left, box.height);
      place(c.right, box.right, box.top, right, box.height);
      place(c.bottom, 0, 0, 0, 0);
    } else {
      place(strip, box.right, 0, right, H);
      place(c.top, 0, 0, box.right, box.top);
      place(c.left, 0, box.top, box.left, box.height);
      place(c.bottom, 0, box.bottom, box.right, below);
      place(c.right, 0, 0, 0, 0);
    }
  }

  function showHome() {
    [...COVERS, 'strip', 'lock'].forEach(drop);
    place(frame('home', 'ui/home.html'), 0, 0, innerWidth, innerHeight);
    if (!inPage && !homeReady && !homeWatch) homeWatch = setTimeout(() => { if (!homeReady && page === 'home') switchToPage(); }, 4000);
  }

  // The home iframe says "frame-ready" (postMessage, or relayed by the background). Silence = draw in the page.
  let homeReady = false, homeWatch = null;
  function markHomeReady() { homeReady = true; clearTimeout(homeWatch); homeWatch = null; }
  window.addEventListener('message', (e) => {
    if (e.data?.kidtube !== 'frame-ready') return;
    if (e.source !== frames.home?.contentWindow) return;
    markHomeReady();
  });
  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'frameReady') markHomeReady(); });
  function switchToPage() {
    if (inPage) return;
    inPage = true;
    Object.keys(frames).forEach(drop);
    route();
  }

  // --- in-page screens: the same screens as ui/home.html, strip.html and cover.html, drawn by ui/render.js ---------
  // In a closed shadow root with ui/ui.css, so YouTube's CSS can't reach them and they look the same as the iframes.
  // Each panel is attached once and redrawn only when what it shows changes, so a list keeps its scroll position.
  // Enough to position and paint the panels before ui.css arrives (or if it never does): the lock cover must
  // cover YouTube and take taps from the first moment.
  const PANEL_CSS = `
    .panel { position: fixed; pointer-events: auto; overflow: hidden; background: #e6f2ff; }
    .lockcover { position: fixed; inset: 0; pointer-events: auto; background: #242c58; color: #fff; display: grid; place-items: center; text-align: center; padding: 24px; }
    .lockcard { background: #fff; color: #1f2a44; border-radius: 28px; padding: 36px 28px 28px; max-width: 440px; }
    .lockcard button { margin-top: 24px; height: 50px; border-radius: 25px; padding: 0 28px; background: #1f2a44; color: #fff; font: inherit; border: 0; }`;
  let ui = null;
  function shadow() {
    if (!ui) {
      const host = document.createElement('div');
      host.id = 'kidtube-ui';
      host.style.cssText = `position:fixed!important;inset:0!important;z-index:${Z}!important;pointer-events:none!important;display:block!important`;
      ui = host.attachShadow({ mode: 'closed' });
      const sheet = document.createElement('style');
      sheet.textContent = PANEL_CSS;
      ui.append(sheet);
      fetch(chrome.runtime.getURL('ui/ui.css')).then((r) => r.text()).then((css) => { sheet.textContent = `${css}\n${PANEL_CSS}`; }).catch(() => {});
    }
    if (!ui.host.isConnected) document.documentElement.appendChild(ui.host);
    return ui;
  }
  const K = () => globalThis.KidTubeUI;
  const el = (tag, cls, text) => K().el(tag, cls, text);

  function panel(name, src) {
    let p = frames[name];
    if (!p) {
      p = frames[name] = el('div', 'panel screen');
      shadow().append(p);
      let ctl = null;
      if (src === 'ui/home.html') ctl = K().mountHome(p, { ask });
      else if (src === 'ui/home.html?locked=1') ctl = K().mountHome(p, { ask, locked: true });
      else if (src === 'ui/strip.html') ctl = K().mountStrip(p, { ask });
      else p.classList.add('cover');
      p.refresh = () => ctl?.refresh();
      p.stop = () => ctl?.stop();
    } else shadow();
    return p;
  }

  function showLock() {
    player()?.pause();
    place(frame('lock', 'ui/home.html?locked=1'), 0, 0, innerWidth, innerHeight);
  }

  // The apps header (ui/header.js) sits above YouTube where no app runs (state.shell.on: plain YouTube, where the
  // parent signs in or switches the account) and in parent mode. Kid mode has no header.
  // Locked (an app stopped because YouTube's account changed): YouTube is covered until a grown-up's PIN.
  let shell = null, lockBox = null, headerHost = null, header = null, headerSize = null;
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

  function plainYouTube() {
    Object.keys(frames).forEach(drop);
    page = null;
    document.documentElement.classList.remove('kidtube-on', 'kidtube-noskip');
    hidden.remove();
  }
  function showShell() {
    plainYouTube();
    if (shell.locked) {
      hideHeader();
      if (!lockBox) {
        lockBox = el('div', 'screen lockcover');
        shadow().append(lockBox);
      } else shadow();
      const inner = el('div', 'lockcard');
      inner.append(el('div', 'big', '🔒'), el('h1', '', 'Ask a grown-up'), el('p', '', shell.why || 'KidTube is locked.'),
        K().button('', 'Unlock with the PIN', () => ask({ type: 'openApps' })));
      lockBox.replaceChildren(inner);
      silenceVideos();
      return;
    }
    lockBox?.remove(); lockBox = null;
    showHeader();
  }
  function hideShell() {
    lockBox?.remove(); lockBox = null;
    hideHeader();
    (document.head || document.documentElement).append(hidden);
  }

  // allowSkip off: no jumping forward and no speed above 1x. Going back is fine.
  // parentMode: a parent opened this video from the parent page; no covers, no counting, skipping allowed.
  // parentOn: parent mode (settings): YouTube's home becomes the parent's screens and nothing is covered.
  let allowSkip = false, maxReached = 0, parentMode = false, parentOn = false;
  async function loadRules() {
    const st = await ask({ type: 'state' });
    if (!st?.rules) return;
    const wasShell = !!shell;
    shell = st.shell?.on ? st.shell : null;
    if (shell) return showShell();
    if (wasShell) {   // an app was opened: it decides about this page again
      hideShell();
      ask({ type: 'recheck', url: location.href });
    }
    allowSkip = st.rules.allowSkip;
    parentMode = !!st.parent;
    const was = parentOn;
    parentOn = !!st.parentMode;
    document.documentElement.classList.toggle('kidtube-noskip', !allowSkip);
    // Parent mode just ended (switched off or timed out): the kid's rules check this page again.
    if (was && !parentOn) ask({ type: 'recheck', url: location.href });
    if (parentOn && page === 'home') ask({ type: 'openParent' });
    if (page === 'watch') route();
  }

  // A parent watching (parent mode, or a video opened from the parent screens): nothing covered, nothing counted.
  // Parent mode also has the header.
  function showParentView() {
    [...COVERS, 'strip', 'lock', 'home'].forEach(drop);
    document.documentElement.classList.remove('kidtube-on');
    if (parentOn) showHeader(); else hideHeader();
  }
  function guardSkipping(v) {
    v.addEventListener('timeupdate', () => {
      if (!v.seeking && v.currentTime <= maxReached + 3) maxReached = Math.max(maxReached, v.currentTime);
    });
    v.addEventListener('seeking', () => {
      if (!allowSkip && v.currentTime > maxReached + 1.5) v.currentTime = maxReached;
    });
    v.addEventListener('ratechange', () => {
      if (!allowSkip && v.playbackRate > 1) v.playbackRate = 1;
    });
    for (const t of ['emptied', 'loadstart']) v.addEventListener(t, () => { maxReached = 0; }); // new media (ad -> video)
  }

  function route() {
    if (shell) return;
    const u = new URL(location.href);
    const vid = u.pathname === '/watch' ? u.searchParams.get('v') : null;
    if (vid) {
      if (page !== 'watch' || vid !== videoId) { page = 'watch'; videoId = vid; drop('home'); drop('lock'); played = 0; maxReached = 0; loadRules(); }
      if (parentMode) return showParentView();
      document.documentElement.classList.add('kidtube-on');
      hideHeader();
      layoutWatch();
    } else {
      if (page !== 'home') { page = 'home'; videoId = null; parentMode = false; document.documentElement.classList.add('kidtube-on'); hideHeader(); if (parentOn) ask({ type: 'openParent' }); }
      showHome();
      silenceVideos();
    }
  }

  // Playback time: only while the video plays and the page is visible (PLAN.md §3.1).
  let played = 0, last = performance.now(), hooked = new WeakSet(), beat = 0;
  setInterval(async () => {
    if (++beat % (shell ? 5 : 30) === 0) loadRules();   // parent mode can time out without any storage change
    if (shell) {   // ask YouTube again now and then: the account can change in another tab
      if (beat % 10 === 0 && lastWho) reportAccount(...lastWho);
      return;
    }
    route();
    const now = performance.now(), dt = (now - last) / 1000;
    last = now;
    if (page !== 'watch' || frames.lock || parentMode) return;
    const v = player();
    if (!v) return;
    if (!hooked.has(v)) {
      hooked.add(v);
      v.addEventListener('ended', () => { if (videoId) ask({ type: 'ended', videoId }); });
      guardSkipping(v);
    }
    if (!v.paused && !v.ended && document.visibilityState === 'visible') played += Math.min(dt, 2);
    if (played >= 5) {
      const seconds = Math.round(played);
      played -= seconds;
      const r = await ask({ type: 'tick', videoId, seconds });
      if (r?.action === 'lock') showLock();
    }
  }, 1000);

  // Who is signed in (content/main.js reads YouTube's config). The email comes from YouTube's own account
  // switcher, asked from this page so it carries the YouTube sign-in; the background picks that account's data.
  let accountSeen = false;
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
  let lastWho = null;
  async function reportAccount(loggedIn, datasyncId) {
    lastWho = [loggedIn, datasyncId];
    let switcher = '';
    if (loggedIn) {
      try { switcher = (await (await fetch(`${location.origin}/getAccountSwitcherEndpoint`, { credentials: 'include' })).text()).slice(0, 400000); } catch {}
    }
    ask({ type: 'account', loggedIn: !!loggedIn, datasyncId: String(datasyncId ?? '').slice(0, 200), switcher });
  }

  // Player data from the page world (content/main.js): the real channel and length.
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.kidtube !== 'details') return;
    const d = e.data;
    if (d.videoId === videoId) ask({ type: 'details', videoId: d.videoId, channelId: d.channelId, lengthSeconds: d.lengthSeconds, isLive: d.isLive });
  });

  // Last line before the service worker's URL guard: swallow taps on links we don't own.
  const swallow = (e) => {
    if (shell && !shell.locked) return;
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  for (const t of ['click', 'auxclick']) document.addEventListener(t, swallow, true);

  addEventListener('resize', () => (page === 'watch' ? route() : page === 'home' && showHome()));
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.data || ch.localConfig || ch.parentPass || ch.settings || ch.account || ch.shell) loadRules();
    if (ch.data || ch.watched || ch.today) for (const n of ['home', 'strip']) frames[n]?.refresh?.();
  });
  loadRules();
  document.addEventListener('fullscreenchange', () => page === 'watch' && route());
  route();
})();
