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
    #kidtube-pagehome { position: fixed; inset: 0; z-index: ${Z}; background: #fff8ec; color: #2b2b2b;
      font: 600 16px/1.3 system-ui, -apple-system, sans-serif; overflow: auto; }
    #kidtube-pagehome .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding: 16px; }
    #kidtube-pagehome .card { position: relative; background: #fff; border: 0; padding: 0; border-radius: 18px; overflow: hidden;
      text-align: left; color: inherit; font: inherit; box-shadow: 0 3px 0 #0000000f, 0 6px 16px #00000014; cursor: pointer; }
    #kidtube-pagehome .card img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; background: #eee; }
    #kidtube-pagehome .t { padding: 10px 12px 12px; font-size: 17px; }
    #kidtube-pagehome .d { padding: 0 12px 12px; color: #8a7f70; font-size: 14px; font-weight: 500; }
    #kidtube-pagehome .center { min-height: 100%; display: grid; place-items: center; text-align: center; padding: 24px; }
    #kidtube-pagehome .big { font-size: 64px; line-height: 1; }
    #kidtube-pagehome h1 { font-size: 28px; margin: 16px 0 8px; }
    #kidtube-pagehome p { margin: 4px 0; color: #8a7f70; font-weight: 500; font-size: 18px; }
    #kidtube-pagehome .gear { position: fixed; right: 12px; bottom: 12px; width: 44px; height: 44px; border: 0; border-radius: 50%;
      background: #ffffffcc; font-size: 22px; }
    #kidtube-pagehome .waiting { opacity: .45; filter: grayscale(.7); }
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
  function drop(name) {
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
    const pageHome = document.getElementById('kidtube-pagehome');
    if (pageHome) document.documentElement.appendChild(pageHome); // stay above the iframe (same z-index)
    if (!homeReady && !homeWatch) homeWatch = setTimeout(() => { if (!homeReady && page === 'home') showPageHome(); }, 1500);
  }

  // The home list normally lives in an extension iframe. On Orion that iframe is placed but never
  // says it opened (0.6.3 on Mac: frame placed, promise sendMessage undefined, callback alive).
  // Draw the same list in the page; the content script is the part that already runs.
  let homeReady = false, homeWatch = null, pageHomeGen = 0;
  function markHomeReady() {
    homeReady = true;
    clearTimeout(homeWatch);
    homeWatch = null;
    document.getElementById('kidtube-pagehome')?.remove();
    document.getElementById('kidtube-fallback')?.remove();
  }
  window.addEventListener('message', (e) => {
    if (e.data?.kidtube !== 'frame-ready') return;
    if (e.source !== frames.home?.contentWindow) return;
    markHomeReady();
  });
  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'frameReady') markHomeReady(); });

  function pageHomeBox() {
    let box = document.getElementById('kidtube-pagehome');
    if (!box) {
      box = document.createElement('div');
      box.id = 'kidtube-pagehome';
      const gear = document.createElement('button');
      gear.className = 'gear';
      gear.textContent = '⚙️';
      gear.title = 'Parent settings';
      gear.addEventListener('click', () => ask({ type: 'openSettings' }));
      box.append(gear);
      document.documentElement.appendChild(box);
    }
    return box;
  }
  function lockCopy(lock) {
    const when = lock.reason === 'stopped' ? 'Let’s try again tomorrow' : lock.opens ? `See you ${lock.opens.day} at ${lock.opens.at}` : 'See you later';
    const [icon, title] = lock.reason === 'dailyCap' ? ['🌙', 'That’s all for today']
      : lock.reason === 'stopped' ? ['🌟', 'Good work today'] : ['⏰', 'Videos are sleeping'];
    return { icon, title, when };
  }
  async function showPageHome() {
    if (homeReady || page !== 'home') return;
    const gen = ++pageHomeGen;
    const box = pageHomeBox();
    const st = await ask({ type: 'state' });
    if (gen !== pageHomeGen || homeReady || page !== 'home') return;
    box.querySelectorAll('.grid, .center').forEach((n) => n.remove());
    if (!st) return showFallback(box);
    if (st.lock) {
      const { icon, title, when } = lockCopy(st.lock);
      const center = document.createElement('div');
      center.className = 'center';
      center.style.background = '#efeaff';
      const inner = document.createElement('div');
      inner.append(
        Object.assign(document.createElement('div'), { className: 'big', textContent: icon }),
        Object.assign(document.createElement('h1'), { textContent: title }),
        Object.assign(document.createElement('p'), { textContent: when }),
      );
      center.append(inner);
      box.append(center);
      return;
    }
    if (!st.videos.length) {
      const center = document.createElement('div');
      center.className = 'center';
      const inner = document.createElement('div');
      inner.append(
        Object.assign(document.createElement('div'), { className: 'big', textContent: '🌱' }),
        Object.assign(document.createElement('h1'), { textContent: 'New videos are coming' }),
        Object.assign(document.createElement('p'), { textContent: 'Ask a grown-up to check back later.' }),
      );
      center.append(inner);
      box.append(center);
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const v of st.videos) {
      const b = document.createElement('button');
      b.className = 'card' + (v.waiting ? ' waiting' : '');
      const img = document.createElement('img');
      img.src = v.thumbnailUrl || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`;
      img.alt = '';
      const t = document.createElement('div');
      t.className = 't';
      t.textContent = v.title;
      b.append(img, t);
      if (v.durationSeconds) {
        const d = document.createElement('div');
        d.className = 'd';
        d.textContent = `${Math.round(v.durationSeconds / 60)} min`;
        b.append(d);
      }
      if (v.required) b.append(Object.assign(document.createElement('div'), { textContent: '⭐', style: 'position:absolute;top:6px;left:6px;font-size:30px' }));
      if (!v.waiting) b.addEventListener('click', () => ask({ type: 'open', videoId: v.videoId }));
      grid.append(b);
    }
    box.append(grid);
  }
  function showFallback(box) {
    const center = document.createElement('div');
    center.className = 'center';
    center.style.cssText = 'display:block;text-align:left;padding:24px';
    const line = (text, tag = 'p') => center.appendChild(Object.assign(document.createElement(tag), { textContent: text }));
    line('KidTube’s screen didn’t open in this browser', 'h1');
    line('Ask a grown-up to press the button below and send the result.');
    const a = Object.assign(document.createElement('a'), { href: chrome.runtime.getURL('ui/check.html'), target: '_blank', textContent: 'Check this browser' });
    a.style.cssText = 'display:inline-block;margin:12px 0;font-size:20px';
    center.appendChild(a);
    box.append(center);
    line(`Details: home screen frame ${frames.home?.isConnected ? 'placed' : 'missing'}; the list did not load; ${navigator.userAgent}`);
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
    document.getElementById('kidtube-pagehome')?.remove();
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
      if (page !== 'watch' || vid !== videoId) {
        page = 'watch'; videoId = vid; drop('home'); drop('lock');
        document.getElementById('kidtube-pagehome')?.remove();
        played = 0; maxReached = 0; loadRules();
      }
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
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.data || ch.localConfig || ch.parentPass) loadRules();
    if (ch.data || ch.watched || ch.today) showPageHome();
  });
  loadRules();
  document.addEventListener('fullscreenchange', () => page === 'watch' && route());
  route();
})();
