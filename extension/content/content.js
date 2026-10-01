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
    iframe.kidtube-frame { position: fixed !important; left: 0 !important; width: 100vw !important; border: 0 !important;
      z-index: ${Z} !important; background: #fff; color-scheme: normal; display: block !important; }
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

  // Covers above and below the player so only the player itself can be touched.
  function layoutWatch() {
    const v = player();
    const box = (v?.closest('#movie_player, .html5-video-player, #player-container-id, #player') || v)?.getBoundingClientRect();
    const top = frame('top', 'ui/cover.html');
    const strip = frame('strip', `ui/strip.html`);
    if (!box || box.height < 50) {           // player not drawn yet: cover everything below the header area
      top.style.top = '0'; top.style.height = '0';
      strip.style.top = '35vh'; strip.style.height = '65vh';
      return;
    }
    if (window.scrollY) window.scrollTo(0, 0);
    top.style.top = '0'; top.style.height = `${Math.max(0, box.top)}px`;
    strip.style.top = `${box.bottom}px`; strip.style.height = `${Math.max(0, innerHeight - box.bottom)}px`;
  }

  function showHome() {
    drop('top'); drop('strip'); drop('lock');
    const f = frame('home', 'ui/home.html');
    f.style.top = '0'; f.style.height = '100vh';
  }

  function showLock() {
    player()?.pause();
    const f = frame('lock', 'ui/home.html?locked=1');
    f.style.top = '0'; f.style.height = '100vh';
  }

  function route() {
    const u = new URL(location.href);
    const vid = u.pathname === '/watch' ? u.searchParams.get('v') : null;
    if (vid) {
      if (page !== 'watch' || vid !== videoId) { page = 'watch'; videoId = vid; drop('home'); drop('lock'); played = 0; }
      layoutWatch();
    } else {
      if (page !== 'home') { page = 'home'; videoId = null; }
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
    if (page !== 'watch' || frames.lock) return;
    const v = player();
    if (!v) return;
    if (!hooked.has(v)) {
      hooked.add(v);
      v.addEventListener('ended', () => { if (videoId) ask({ type: 'ended', videoId }); });
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

  addEventListener('resize', () => page === 'watch' && layoutWatch());
  document.addEventListener('fullscreenchange', () => page === 'watch' && layoutWatch());
  route();
})();
