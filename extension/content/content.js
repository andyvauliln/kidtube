// Runs on youtube.com and m.youtube.com. Covers YouTube with our screens and reports playback.
// It never decides what is allowed: the service worker does, and also guards every URL change.
(() => {
  const Z = '2147483647';
  const ask = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);
  let page = null;             // 'home' | 'watch'
  let videoId = null;
  let frames = {};

  const style = document.createElement('style');
  style.textContent = `
    html.kidtube-on, html.kidtube-on body { overflow: hidden !important; overscroll-behavior: none !important; }
    /* links and suggestions drawn inside the player */
    .ytp-ce-element, .ytp-endscreen-content, .ytp-pause-overlay, .ytp-chrome-top, .ytp-show-cards-title, .ytp-watermark,
    .ytp-youtube-button, .ytp-suggestion-set, .ytp-videowall-still, .ytp-cards-teaser, .ytp-cards-button, .ytp-autonav-endscreen,
    .ytp-title, .ytp-title-channel, .ytm-autonav-bar, .player-endscreen, .fullscreen-watch-next-entrypoint-wrapper,
    .ytwPlayerMiniplayerHost, ytm-pivot-bar-renderer { display: none !important; }
    iframe.kidtube-frame { position: fixed !important; border: 0 !important; margin: 0 !important; padding: 0 !important;
      z-index: ${Z} !important; background: #fff; color-scheme: normal; display: block !important; }
    /* allowSkip off: the seek bar can't be dragged (the video element is also guarded below) */
    html.kidtube-noskip .ytp-progress-bar-container, html.kidtube-noskip .ytp-progress-bar, html.kidtube-noskip .ytm-progress-bar,
    html.kidtube-noskip .YtmProgressBarHost, html.kidtube-noskip .ytp-scrubber-container, html.kidtube-noskip .player-controls-progress-bar,
    html.kidtube-noskip .ytp-doubletap-ui-legacy { pointer-events: none !important; }
  `;
  (document.head || document.documentElement).appendChild(style);
  document.documentElement.classList.add('kidtube-on');

  function frame(name, src) {
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
  function drop(name) { frames[name]?.remove(); delete frames[name]; }

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
  }

  function showLock() {
    player()?.pause();
    place(frame('lock', 'ui/home.html?locked=1'), 0, 0, innerWidth, innerHeight);
  }

  // allowSkip off: no jumping forward and no speed above 1x. Going back is fine.
  // parentMode: a parent opened this video from the parent page; no covers, no counting, skipping allowed.
  let allowSkip = false, maxReached = 0, parentMode = false;
  async function loadRules() {
    const st = await ask({ type: 'state' });
    if (!st?.rules) return;
    allowSkip = st.rules.allowSkip;
    parentMode = !!st.parent;
    document.documentElement.classList.toggle('kidtube-noskip', !allowSkip);
    if (page === 'watch') route();
  }

  function showParentView() {
    [...COVERS, 'strip', 'lock', 'home'].forEach(drop);
    document.documentElement.classList.remove('kidtube-on');
    place(frame('badge', 'ui/badge.html'), 8, 8, 230, 40);
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
    const u = new URL(location.href);
    const vid = u.pathname === '/watch' ? u.searchParams.get('v') : null;
    if (vid) {
      if (page !== 'watch' || vid !== videoId) { page = 'watch'; videoId = vid; drop('home'); drop('lock'); played = 0; maxReached = 0; loadRules(); }
      if (parentMode) return showParentView();
      document.documentElement.classList.add('kidtube-on');
      drop('badge');
      layoutWatch();
    } else {
      if (page !== 'home') { page = 'home'; videoId = null; parentMode = false; document.documentElement.classList.add('kidtube-on'); drop('badge'); }
      showHome();
      silenceVideos();
    }
  }

  // Playback time: only while the video plays and the page is visible (PLAN.md §3.1).
  let played = 0, last = performance.now(), hooked = new WeakSet();
  setInterval(async () => {
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

  // Player data from the page world (content/main.js): the real channel and length.
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.kidtube !== 'details') return;
    const d = e.data;
    if (d.videoId === videoId) ask({ type: 'details', videoId: d.videoId, channelId: d.channelId, lengthSeconds: d.lengthSeconds, isLive: d.isLive });
  });

  // Last line before the service worker's URL guard: swallow taps on links we don't own.
  const swallow = (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  for (const t of ['click', 'auxclick']) document.addEventListener(t, swallow, true);

  addEventListener('resize', () => (page === 'watch' ? route() : page === 'home' && showHome()));
  chrome.storage.onChanged.addListener((ch) => { if (ch.data || ch.localConfig || ch.parentPass) loadRules(); });
  loadRules();
  document.addEventListener('fullscreenchange', () => page === 'watch' && route());
  route();
})();
