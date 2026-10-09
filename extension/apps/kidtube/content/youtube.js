// KidTube on youtube.com and m.youtube.com: covers YouTube with the kid's screens (his list, the strip beside the
// player, the lock when the time is up) and reports playback. Runs after core/content/shell.js, which shows the
// apps header and hands over the state (KidTubeShell); this script acts only while a KidTube profile runs.
// It never decides what is allowed: the service worker does, and also guards every URL change.
(() => {
  const S = globalThis.KidTubeShell;
  if (!S) return;
  const { ask, Z } = S;
  // A KidTube profile runs (not the apps header, not another app). Assumed until the state says otherwise,
  // so YouTube is covered from the first moment.
  let active = true;
  let page = null;             // 'home' | 'watch'
  let videoId = null;
  let frames = {};             // our screens by name: extension iframes, or in-page panels (below)

  const style = document.createElement('style');
  // Links and suggestions drawn inside the player, and YouTube's bottom tabs: hidden while KidTube runs.
  const hidden = document.createElement('style');
  hidden.textContent = `
    .ytp-ce-element, .ytp-endscreen-content, .ytp-pause-overlay, .ytp-chrome-top, .ytp-show-cards-title, .ytp-watermark,
    .ytp-youtube-button, .ytp-suggestion-set, .ytp-videowall-still, .ytp-cards-teaser, .ytp-cards-button, .ytp-autonav-endscreen,
    .ytp-title, .ytp-title-channel, .ytm-autonav-bar, .player-endscreen, .fullscreen-watch-next-entrypoint-wrapper,
    .ytwPlayerMiniplayerHost, ytm-pivot-bar-renderer { display: none !important; }`;
  style.textContent = `
    html.kidtube-on, html.kidtube-on body { overflow: hidden !important; overscroll-behavior: none !important; }
    iframe.kidtube-frame { position: fixed !important; border: 0 !important; margin: 0 !important; padding: 0 !important;
      z-index: ${Z} !important; background: #e6f2ff; color-scheme: normal; display: block !important; }
    /* allowSkip off: the seek bar can't be dragged (the video element is also guarded below) */
    html.kidtube-noskip .ytp-progress-bar-container, html.kidtube-noskip .ytp-progress-bar, html.kidtube-noskip .ytm-progress-bar,
    html.kidtube-noskip .YtmProgressBarHost, html.kidtube-noskip .ytp-scrubber-container, html.kidtube-noskip .player-controls-progress-bar,
    html.kidtube-noskip .ytp-doubletap-ui-legacy { pointer-events: none !important; }
  `;
  (document.head || document.documentElement).append(style, hidden);
  document.documentElement.classList.add('kidtube-on');

  // Where the screens are drawn. Normally extension iframes (kid/*.html), which YouTube's CSS can't touch.
  // Orion doesn't show extension iframes on web pages (blank white), so its build (version_name "… Orion",
  // build/build-orion.mjs) draws the same screens in the page, inside a shadow root. Any other browser whose
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
    const c = Object.fromEntries(COVERS.map((n) => [n, frame(n, 'apps/kidtube/kid/cover.html')]));
    const strip = frame('strip', 'apps/kidtube/kid/strip.html');
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
    place(frame('home', 'apps/kidtube/kid/home.html'), 0, 0, innerWidth, innerHeight);
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

  // --- in-page screens: the same screens as kid/home.html, strip.html and cover.html, drawn by kid/render.js -------
  // In a closed shadow root with kid/ui.css, so YouTube's CSS can't reach them and they look the same as the iframes.
  // Each panel is attached once and redrawn only when what it shows changes, so a list keeps its scroll position.
  // Enough to position and paint the panels before ui.css arrives (or if it never does): they must cover
  // YouTube and take taps from the first moment.
  const PANEL_CSS = `
    .panel { position: fixed; pointer-events: auto; overflow: hidden; background: #e6f2ff; }`;
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
      fetch(chrome.runtime.getURL('apps/kidtube/kid/ui.css')).then((r) => r.text()).then((css) => { sheet.textContent = `${css}\n${PANEL_CSS}`; }).catch(() => {});
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
      if (src === 'apps/kidtube/kid/home.html') ctl = K().mountHome(p, { ask });
      else if (src === 'apps/kidtube/kid/home.html?locked=1') ctl = K().mountHome(p, { ask, locked: true });
      else if (src === 'apps/kidtube/kid/strip.html') ctl = K().mountStrip(p, { ask });
      else p.classList.add('cover');
      p.refresh = () => ctl?.refresh();
      p.stop = () => ctl?.stop();
    } else shadow();
    return p;
  }

  function showLock() {
    player()?.pause();
    place(frame('lock', 'apps/kidtube/kid/home.html?locked=1'), 0, 0, innerWidth, innerHeight);
  }

  // The apps header, another app or an account change: plain YouTube again (core/content/shell.js does the rest).
  function standDown() {
    active = false;
    Object.keys(frames).forEach(drop);
    page = null;
    document.documentElement.classList.remove('kidtube-on', 'kidtube-noskip');
    hidden.remove();
  }
  function activate() {
    active = true;
    (document.head || document.documentElement).append(hidden);
    route();
  }

  // allowSkip off: no jumping forward and no speed above 1x. Going back is fine.
  // parentOn: parent mode: YouTube's home becomes the parent's screens, a video plays with nothing covered.
  let allowSkip = false, maxReached = 0, parentOn = false;
  S.onState((st) => {
    if (st.shell.on || st.app !== 'kidtube') { if (active) standDown(); return; }
    if (!active) activate();
    allowSkip = !!st.rules?.allowSkip;
    parentOn = !!st.parentMode;
    document.documentElement.classList.toggle('kidtube-noskip', !allowSkip);
    if (parentOn && page === 'home') ask({ type: 'openParent' });
    if (page === 'watch') route();
  });

  // A parent watching (parent mode): nothing covered, nothing counted. The header is shell.js's.
  function showParentView() {
    [...COVERS, 'strip', 'lock', 'home'].forEach(drop);
    document.documentElement.classList.remove('kidtube-on');
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
    if (!active) return;
    const u = new URL(location.href);
    const vid = u.pathname === '/watch' ? u.searchParams.get('v') : null;
    if (vid) {
      if (page !== 'watch' || vid !== videoId) { page = 'watch'; videoId = vid; drop('home'); drop('lock'); played = 0; maxReached = 0; S.refresh(); }
      if (parentOn) return showParentView();
      document.documentElement.classList.add('kidtube-on');
      layoutWatch();
    } else {
      if (page !== 'home') { page = 'home'; videoId = null; document.documentElement.classList.add('kidtube-on'); if (parentOn) ask({ type: 'openParent' }); }
      showHome();
      silenceVideos();
    }
  }

  // Playback time: only while the video plays and the page is visible (PLAN.md §3.1).
  let played = 0, last = performance.now(), hooked = new WeakSet();
  setInterval(async () => {
    if (!active) return;
    route();
    const now = performance.now(), dt = (now - last) / 1000;
    last = now;
    if (page !== 'watch' || frames.lock || parentOn) return;
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

  // Player data from the page world (core/content/youtube-page.js): the real channel and length.
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.kidtube !== 'details') return;
    const d = e.data;
    if (d.videoId === videoId) ask({ type: 'details', videoId: d.videoId, channelId: d.channelId, lengthSeconds: d.lengthSeconds, isLive: d.isLive });
  });

  // Last line before the service worker's URL guard: swallow taps on links we don't own.
  const swallow = (e) => {
    if (!active) return;
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  for (const t of ['click', 'auxclick']) document.addEventListener(t, swallow, true);

  addEventListener('resize', () => (page === 'watch' ? route() : page === 'home' && showHome()));
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.data || ch.watched || ch.today) for (const n of ['home', 'strip']) frames[n]?.refresh?.();
  });
  document.addEventListener('fullscreenchange', () => page === 'watch' && route());
  route();
})();
