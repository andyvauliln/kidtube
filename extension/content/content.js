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
      z-index: ${Z} !important; background: #fff; color-scheme: normal; display: block !important; }
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
    const v = document.querySelector('video.html5-main-video') || document.querySelector('#movie_player video, #player video, video');
    return v;
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

  // --- in-page screens: the same screens as ui/home.html, strip.html, cover.html ------------------------------
  // In a closed shadow root, so YouTube's CSS can't reach them. Each panel is attached once and redrawn only
  // when what it shows changes, so a list keeps its scroll position.
  const PAGE_CSS = `
    * { box-sizing: border-box; }
    .panel { position: fixed; pointer-events: auto; overflow: hidden; background: #fff8ec; color: #2b2b2b;
      font: 600 16px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-tap-highlight-color: transparent;
      user-select: none; -webkit-user-select: none; }
    .home, .strip { overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding: 16px 16px 80px; align-content: start; }
    .strip .grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; padding: 12px 16px 24px; }
    .card { position: relative; background: #fff; border: 0; padding: 0; border-radius: 18px; overflow: hidden; text-align: left;
      color: inherit; font: inherit; box-shadow: 0 3px 0 #0000000f, 0 6px 16px #00000014; cursor: pointer; }
    .card img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; background: #eee; }
    .card .t { padding: 10px 12px 12px; font-size: 17px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .strip .card .t { font-size: 15px; }
    .card .d { padding: 0 12px 12px; color: #8a7f70; font-size: 14px; font-weight: 500; }
    .card .star { position: absolute; top: 6px; left: 6px; font-size: 30px; }
    .card.waiting { opacity: .45; filter: grayscale(.7); }
    .center { min-height: 100%; display: grid; place-items: center; text-align: center; padding: 24px; }
    .lockbg { background: #efeaff; }
    .big { font-size: 64px; line-height: 1; }
    h1 { font-size: 28px; margin: 16px 0 8px; }
    p { margin: 4px 0; color: #8a7f70; font-weight: 500; font-size: 18px; }
    a { color: #6c63ff; font-size: 20px; display: inline-block; margin-top: 16px; }
    .parentbtn { position: fixed; right: 12px; top: 12px; height: 36px; padding: 0 14px; border: 0; border-radius: 18px; background: #ffffffe0;
      color: #6b6257; font: 600 14px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 1px 4px #0002; z-index: 1; }
    .home .grid { padding-top: 60px; }
    .bar { display: flex; align-items: center; gap: 12px; padding: 12px 16px 0; }
    .bar .parentbtn { position: static; margin-left: auto; flex: none; }
    .homebtn { border: 0; border-radius: 14px; background: #ff7a3d; color: #fff; font: inherit; font-size: 18px; padding: 10px 18px; flex: none; }
    .homebtn:disabled { background: #d9d2c7; }
    .wait { color: #8a7f70; font-weight: 500; }
    .locked .grid .card { filter: grayscale(1); opacity: .45; pointer-events: none; }
    .lockcover { inset: 0; background: #f4f2fb; display: grid; place-items: center; text-align: center; padding: 24px; }
    .lockcard { background: #fff; border-radius: 24px; padding: 36px 28px 28px; max-width: 440px; box-shadow: 0 12px 40px #0000001a; }
    .lockcard p { font-size: 16px; }
    .lockcover button { margin-top: 24px; height: 48px; border: 0; border-radius: 24px; padding: 0 28px; font: inherit; background: #0f0f0f; color: #fff; }
  `;
  let ui = null;
  function shadow() {
    if (!ui) {
      const host = document.createElement('div');
      host.id = 'kidtube-ui';
      host.style.cssText = `position:fixed!important;inset:0!important;z-index:${Z}!important;pointer-events:none!important;display:block!important`;
      ui = host.attachShadow({ mode: 'closed' });
      ui.append(Object.assign(document.createElement('style'), { textContent: PAGE_CSS }));
    }
    if (!ui.host.isConnected) document.documentElement.appendChild(ui.host);
    return ui;
  }
  const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});
  function button(cls, text, onTap) {
    const b = el('button', cls, text);
    b.addEventListener('click', onTap);
    return b;
  }

  function panel(name, src) {
    let p = frames[name];
    if (!p) {
      p = frames[name] = el('div', 'panel');
      shadow().append(p);
      if (src === 'ui/home.html') fillHome(p);
      else if (src === 'ui/home.html?locked=1') fillLock(p);
      else if (src === 'ui/strip.html') fillStrip(p);
    } else shadow();
    return p;
  }
  function every(p, ms) {
    p.refresh();
    const t = setInterval(p.refresh, ms);
    p.stop = () => clearInterval(t);
  }

  // The grown-up's way out of kid mode: the PIN page, then parent mode (as ui/home.js and ui/strip.html).
  const parentButton = () => Object.assign(button('parentbtn', '🔒 Parent', () => ask({ type: 'parentGate' })), { title: 'Parent mode (PIN)' });

  function cards(videos, small) {
    const grid = el('div', 'grid');
    for (const v of videos) {
      const b = el('button', 'card' + (v.waiting ? ' waiting' : ''));
      const img = el('img');
      img.src = v.thumbnailUrl || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`;
      img.alt = '';
      b.append(img, el('div', 't', v.title));
      if (!small && v.durationSeconds) b.append(el('div', 'd', `${Math.round(v.durationSeconds / 60)} min`));
      if (v.required) b.append(el('div', 'star', '⭐'));
      if (!v.waiting) b.addEventListener('click', () => ask({ type: 'open', videoId: v.videoId }));
      grid.append(b);
    }
    return grid;
  }
  function message(icon, title, text, cls = '') {
    const box = el('div', `center ${cls}`);
    const inner = el('div');
    inner.append(el('div', 'big', icon), el('h1', '', title), el('p', '', text));
    box.append(inner);
    return box;
  }
  function lockView(lock) {
    const when = lock.reason === 'stopped' ? 'Let’s try again tomorrow' : lock.opens ? `See you ${lock.opens.day} at ${lock.opens.at}` : 'See you later';
    const [icon, title] = lock.reason === 'dailyCap' ? ['🌙', 'That’s all for today']
      : lock.reason === 'stopped' ? ['🌟', 'Good work today'] : ['⏰', 'Videos are sleeping'];
    return message(icon, title, when, 'lockbg');
  }
  function problemView() {
    const box = message('🔧', 'KidTube can’t reach its background in this browser', 'Ask a grown-up to open the check below and send the result.');
    const a = el('a', '', 'Check this browser');
    a.href = chrome.runtime.getURL('ui/check.html');
    a.target = '_blank';
    box.firstChild.append(a);
    return box;
  }

  function fillHome(p) {
    p.classList.add('home');
    const body = el('div');
    p.append(body, parentButton());
    let shown = null;
    p.refresh = async () => {
      const st = await ask({ type: 'state' });
      if (!p.isConnected) return;
      if (!st) { if (shown === null) { shown = 'problem'; body.replaceChildren(problemView()); } return; }
      const key = JSON.stringify([st.lock, st.videos.map((v) => [v.videoId, v.title, !!v.waiting, !!v.required])]);
      if (key === shown) return;
      shown = key;
      body.replaceChildren(st.lock ? lockView(st.lock)
        : st.videos.length ? cards(st.videos, false) : message('🌱', 'New videos are coming', 'Ask a grown-up to check back later.'));
    };
    every(p, 30000);
  }
  function fillLock(p) {
    p.refresh = async () => {
      const st = await ask({ type: 'state' });
      if (p.isConnected) p.replaceChildren(lockView(st?.lock ?? { reason: 'dailyCap' }));
    };
    p.refresh();
  }
  const fmt = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`);
  function fillStrip(p) {
    p.classList.add('strip');
    const home = button('homebtn', '🏠 Home', () => ask({ type: 'goHome' }));
    const wait = el('span', 'wait');
    const bar = el('div', 'bar');
    bar.append(home, wait, parentButton());
    const body = el('div');
    p.append(bar, body);
    let shown = null;
    p.refresh = async () => {
      const st = await ask({ type: 'state' });
      if (!st || !p.isConnected) return;
      const left = st.session?.secondsUntilUnlock ?? 0;
      const locked = left > 0;
      p.classList.toggle('locked', locked);
      home.disabled = locked;
      wait.textContent = locked ? `You can choose another video in ${fmt(left)}` : '';
      const key = st.videos.map((v) => `${v.videoId}${v.waiting ? '-' : ''}`).join();
      if (key !== shown) { shown = key; body.replaceChildren(cards(st.videos, true)); }
    };
    every(p, 1000);
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
        lockBox = el('div', 'panel lockcover');
        shadow().append(lockBox);
      } else shadow();
      const inner = el('div', 'lockcard');
      inner.append(el('div', 'big', '🔒'), el('h1', '', 'Ask a grown-up'), el('p', '', shell.why || 'KidTube is locked.'),
        button('', 'Unlock with the PIN', () => ask({ type: 'openApps' })));
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
