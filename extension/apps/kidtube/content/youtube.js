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
  // ▶ Play intro (playIntro below): the video this page was opened for with …&kidtube=intro, its clips, the one playing.
  const INTRO_CLIPS = 8, INTRO_SECONDS = 3;
  const introFor = (() => { const u = new URL(location.href); return u.searchParams.get('kidtube') === 'intro' ? u.searchParams.get('v') : null; })();
  let intro = null;   // { vid, at: [start s…], i, timer, box }

  const style = document.createElement('style');
  // Links and suggestions drawn inside the player, and YouTube's bottom tabs: hidden while KidTube runs.
  const hidden = document.createElement('style');
  hidden.textContent = `
    .ytp-ce-element, .ytp-endscreen-content, .ytp-pause-overlay, .ytp-chrome-top, .ytp-show-cards-title, .ytp-watermark,
    .ytp-youtube-button, .ytp-suggestion-set, .ytp-videowall-still, .ytp-cards-teaser, .ytp-cards-button, .ytp-autonav-endscreen,
    .ytp-title, .ytp-title-channel, .ytm-autonav-bar, .player-endscreen, .fullscreen-watch-next-entrypoint-wrapper,
    .ytwPlayerMiniplayerHost, ytm-pivot-bar-renderer { display: none !important; }`;
  // YouTube's ad boxes (config.blockAds): in the lists, beside and over the player. Video ads: skipAds below.
  const adBoxes = document.createElement('style');
  adBoxes.textContent = `
    ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-banner-promo-renderer, ytd-statement-banner-renderer,
    ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer, ytd-display-ad-renderer, ytd-companion-slot-renderer,
    ytd-action-companion-ad-renderer, ytd-player-legacy-desktop-watch-ads-renderer, ytd-merch-shelf-renderer, #player-ads,
    #masthead-ad, .ytp-ad-overlay-container, .ytp-ad-overlay-slot, .ytp-ad-image-overlay, .ytp-ad-text-overlay,
    ytm-promoted-sparkles-web-renderer, ytm-companion-ad-renderer, ytm-promoted-video-renderer, ad-slot-renderer,
    ytm-ad-slot-renderer { display: none !important; }`;
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
      globalThis.KidTubeWatch?.shadow?.(ui);   // dev mode reads and taps inside it (core/ui/bridge.js)
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
    adBoxes.remove();
    blockAds = false;
  }
  function activate() {
    active = true;
    (document.head || document.documentElement).append(hidden);
    route();
  }

  // allowSkip off: no jumping forward and no speed above 1x. Going back is fine.
  // parentOn: parent mode: YouTube's home becomes the parent's screens, a video plays with nothing covered.
  let allowSkip = false, maxReached = 0, parentOn = false, blockAds = false;
  S.onState((st) => {
    if (st.shell.on || st.app !== 'kidtube') { if (active) standDown(); return; }
    if (!active) activate();
    allowSkip = !!st.rules?.allowSkip;
    blockAds = !!st.rules?.blockAds;
    if (blockAds) (document.head || document.documentElement).append(adBoxes); else adBoxes.remove();
    parentOn = !!st.parentMode;
    document.documentElement.classList.toggle('kidtube-noskip', !allowSkip);
    if (parentOn && page === 'home') openParent();
    if (page === 'watch') route();
  });

  // Parent mode on YouTube's home: the parent screens, once the background knows who is signed in here (after
  // Switch, another account must stop the app instead).
  let parentAsked = false;
  function openParent() {
    if (parentAsked) return;
    parentAsked = true;
    S.whenAccount().then(() => ask({ type: 'openParent' })).finally(() => { parentAsked = false; });
  }

  // A parent watching (parent mode): nothing covered, nothing counted. The header is shell.js's.
  function showParentView() {
    [...COVERS, 'strip', 'lock', 'home'].forEach(drop);
    document.documentElement.classList.remove('kidtube-on');
  }
  // An ad plays in the same video element: it is not his video, so it is not guarded (skipAds runs it to its end).
  function guardSkipping(v) {
    v.addEventListener('timeupdate', () => {
      if (!adOn && !v.seeking && v.currentTime <= maxReached + 3) maxReached = Math.max(maxReached, v.currentTime);
    });
    v.addEventListener('seeking', () => {
      if (!allowSkip && !adOn && v.currentTime > maxReached + 1.5) v.currentTime = maxReached;
    });
    v.addEventListener('ratechange', () => {
      if (!allowSkip && !adOn && v.playbackRate > 1) v.playbackRate = 1;
    });
    for (const t of ['emptied', 'loadstart']) v.addEventListener(t, () => { maxReached = 0; }); // new media (ad -> video)
  }

  function route() {
    if (!active) return;
    const u = new URL(location.href);
    const vid = u.pathname === '/watch' ? u.searchParams.get('v') : null;
    if (vid) {
      if (page !== 'watch' || vid !== videoId) { page = 'watch'; videoId = vid; drop('home'); drop('lock'); played = 0; maxReached = 0; S.refresh(); checkPlayer(vid); }
      if (parentOn) { showParentView(); if (vid === introFor) playIntro(vid); return; }
      document.documentElement.classList.add('kidtube-on');
      layoutWatch();
    } else {
      if (page !== 'home') { page = 'home'; videoId = null; document.documentElement.classList.add('kidtube-on'); if (parentOn) openParent(); else checkCovered(); }
      showHome();
      silenceVideos();
    }
  }

  // His list covers YouTube's home: nothing of YouTube can be tapped, and its suggestions are hidden.
  let coverChecked = false;
  function checkCovered() {
    if (coverChecked) return;
    coverChecked = true;
    globalThis.KidTubeWatch?.check({ id: 'kid.covered', area: 'kid', expect: 'In kid mode YouTube’s home is covered by his list, and YouTube’s suggestions are hidden',
      code: ['apps/kidtube/content/youtube.js showHome', 'apps/kidtube/content/youtube.js hidden'] }, (t) => {
      if (parentOn || !active || page !== 'home') return t.skip('not his home now');
      const f = frames.home ?? frames.lock;
      const box = f?.getBoundingClientRect?.();
      t.ok('his list over the whole screen', !!box && box.width >= innerWidth - 2 && box.height >= innerHeight - 2,
        box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'no screen', `${innerWidth}x${innerHeight}`);
      t.ok('YouTube’s suggestions hidden', hidden.isConnected, 'the hiding style is off', 'on');
      t.note('drawn', inPage ? 'in the page (Orion)' : 'in a frame');
    }, 5000);
  }

  // The video element must be where player() looks: else his time is not counted and the end never comes.
  // YouTube renaming its player is an outside change, so it fails only on the second video in a row (strikes).
  function checkPlayer(vid) {
    globalThis.KidTubeWatch?.check({ id: 'yt.player', kind: 'probe', strikes: 2, area: 'youtube', expect: 'KidTube finds YouTube’s video player on a watch page',
      code: ['apps/kidtube/content/youtube.js player'] }, (t) => {
      if (parentOn || frames.lock || !active || videoId !== vid) return t.skip('not his video page now');
      if (t.ok('the video element', !!player(), 'not found', 'found by video.html5-main-video / #movie_player video / #player video / video')) return;
      t.note('page', { videos: document.querySelectorAll('video').length, moviePlayer: !!document.querySelector('#movie_player'),
        html5Player: !!document.querySelector('.html5-video-player'), mobilePlayer: !!document.querySelector('ytm-player, #player-container-id'), path: location.pathname });
    }, 10000);
  }

  // --- ▶ Play intro (the parent's note, 2026-10-14) ------------------------------------------------------------------
  // The parent's ▶ Play intro on a video's page (parent.js, background watchHere: …&kidtube=intro): YouTube plays 3 s
  // from INTRO_CLIPS points spread over the video, one after another, then pauses. Nothing is made or kept: the real
  // video jumps. Parent mode only. The address is read once (at the top): YouTube may tidy it afterwards.
  // The clips' starts: the middle of each equal part of the video, fewer for a short one (at least 2 s apart).
  function introPoints(duration) {
    const n = Math.max(1, Math.min(INTRO_CLIPS, Math.floor(duration / (INTRO_SECONDS * 2))));
    return Array.from({ length: n }, (_, i) => Math.max(0, Math.round((duration * (i + 0.5)) / n - INTRO_SECONDS / 2)));
  }
  function introLabel(text, done = false) {
    if (!intro.box) {
      const host = document.createElement('div');
      host.style.cssText = `position:fixed!important;left:50%!important;bottom:24px!important;transform:translateX(-50%)!important;z-index:${Z}!important`;
      const root = host.attachShadow({ mode: 'closed' });
      globalThis.KidTubeWatch?.shadow?.(root);
      const css = document.createElement('style');
      css.textContent = `.b { display: flex; gap: 10px; align-items: center; padding: 10px 14px; border-radius: 12px; background: #222; color: #fff;
        font: 500 15px system-ui, sans-serif; box-shadow: 0 4px 16px #0006; } button { font: inherit; border: 0; border-radius: 16px; padding: 6px 12px;
        background: #fff; color: #222; font-weight: 600; } button.x { background: transparent; color: #fff; }`;
      const b = document.createElement('div');
      b.className = 'b';
      root.append(css, b);
      intro.box = { host, b };
    }
    const { host, b } = intro.box;
    const span = document.createElement('span');
    span.textContent = text;
    const kids = [span];
    if (done) {
      const all = document.createElement('button');
      all.textContent = '▶ Watch it all';
      all.addEventListener('click', () => { const v = player(); host.remove(); if (v) { v.currentTime = 0; v.play().catch(() => {}); } });
      kids.push(all);
    }
    const x = document.createElement('button');
    x.className = 'x';
    x.textContent = '✕';
    x.title = 'Stop the intro';
    x.addEventListener('click', () => { stopIntro(); host.remove(); });
    kids.push(x);
    b.replaceChildren(...kids);
    if (!host.isConnected) document.documentElement.appendChild(host);
  }
  function stopIntro() { if (intro) { clearInterval(intro.timer); intro.timer = null; } }
  function playIntro(vid) {
    if (intro?.vid === vid) return;
    intro = { vid, at: null, i: 0, timer: null, box: null, played: 0, asked: Date.now() };
    introLabel('Intro: getting the video…');
    intro.timer = setInterval(() => {
      const v = player();
      if (videoId !== vid || !parentOn) { stopIntro(); intro.box?.host.remove(); return; }
      if (!v || adOn || adPlayer() || !(v.duration > 0)) return;
      if (!intro.at) {
        intro.at = introPoints(v.duration);
        v.currentTime = intro.at[0];
        v.play().catch(() => introLabel('Tap ▶ on the video: the intro starts.'));
        introLabel(`Intro: clip 1 of ${intro.at.length}`);
        return;
      }
      if (v.paused) return;   // waiting for a tap on ▶ (a browser that does not play by itself)
      const from = intro.at[intro.i];
      if (v.currentTime < from + INTRO_SECONDS && v.currentTime >= from - 1) return;
      if (v.currentTime >= from + INTRO_SECONDS) intro.played++;
      intro.i++;
      if (intro.i >= intro.at.length) {
        v.pause();
        stopIntro();
        introLabel(`That was the intro: ${intro.at.length} clips of ${INTRO_SECONDS} s.`, true);
        return;
      }
      v.currentTime = intro.at[intro.i];
      introLabel(`Intro: clip ${intro.i + 1} of ${intro.at.length}`);
    }, 200);
    globalThis.KidTubeWatch?.check({ id: 'yt.intro', kind: 'probe', area: 'youtube', expect: '▶ Play intro: the video plays its 3 s clips, one after another',
      code: ['apps/kidtube/content/youtube.js playIntro'] }, (t) => {
      if (intro?.vid !== vid) return t.skip('another video now');
      if (intro.at && player()?.paused && intro.i === 0) return t.skip('waiting for a tap on ▶');
      t.ok('the clips started', !!intro.at, 'no video length after 20 s', 'the clips’ starts');
      t.ok('a clip played', intro.played > 0 || intro.i > 0 || (player()?.currentTime ?? 0) > (intro.at?.[0] ?? 0), 'still at the start', 'at least one clip');
    }, 20000);
  }

  // --- ads -------------------------------------------------------------------------------------------------------
  // A video ad plays in YouTube's own player (the class ad-showing). With blockAds it is muted, run to its end, and
  // Skip is tapped when YouTube shows it. adOn is kept either way: an ad's end is not his video's end.
  // (Blocking YouTube's own ad requests instead makes YouTube warn about ad blockers.)
  const SKIP_AD = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot button, .ytm-skip-ad-button, button[class*="skip-ad"]';
  const adPlayer = () => document.querySelector('.html5-video-player.ad-showing, #movie_player.ad-showing, .ad-showing .html5-video-player');
  let adOn = false, adMuted = null, warned = '';
  function skipAds() {
    const p = adPlayer();
    if (!p) {
      if (adOn) adOn = false;
      if (adMuted) { if (page === 'watch') adMuted.muted = false; adMuted = null; }   // his video has its sound back
      return;
    }
    if (!adOn) { adOn = true; if (blockAds) checkAdGone(); }
    if (!blockAds) return;
    const v = p.querySelector('video') ?? player();
    if (v) {
      if (!v.muted) { v.muted = true; adMuted = v; }
      if (v.playbackRate < 16) v.playbackRate = 16;
      if (Number.isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.1) v.currentTime = v.duration;
    }
    for (const b of document.querySelectorAll(SKIP_AD)) b.click();
  }
  setInterval(() => { if (active && page === 'watch') skipAds(); }, 300);

  // YouTube changing its ads (a new class, a new Skip button) is an outside change: the fix agent gets the player's
  // classes and the buttons it found. Strikes: one ad that YouTube won't let go is not yet a pattern.
  function checkAdGone() {
    globalThis.KidTubeWatch?.check({ id: 'yt.adSkipped', kind: 'probe', strikes: 2, area: 'youtube',
      expect: 'With “Hide and skip ads” on, a video ad is gone within 10 seconds', code: ['apps/kidtube/content/youtube.js skipAds'] }, (t) => {
      if (!active || !blockAds || page !== 'watch') return t.skip('ads not skipped here now');
      const p = adPlayer();
      if (t.ok('the ad is gone', !p, 'still playing', 'gone')) return;
      const v = p.querySelector('video');
      t.note('ad', { duration: v?.duration, at: v?.currentTime, rate: v?.playbackRate, muted: v?.muted, playerClass: p.className.slice(0, 300),
        skipButtons: [...document.querySelectorAll('button[class*="skip"], [class*="skip-ad"]')].slice(0, 5).map((b) => `${b.tagName.toLowerCase()}.${String(b.className).slice(0, 80)}`) });
    }, 10000);
  }

  // YouTube's warning about ad blockers: the fix agent must know at once (once per page).
  function checkAdWarning() {
    const box = blockAds && document.querySelector('ytd-enforcement-message-view-model, ytm-enforcement-message-view-model');
    if (!box || warned === location.href) return;
    warned = location.href;
    globalThis.KidTubeWatch?.check({ id: 'yt.adWarning', kind: 'probe', area: 'youtube',
      expect: 'YouTube does not warn about ad blockers while KidTube hides and skips ads', code: ['apps/kidtube/content/youtube.js skipAds', 'core/background/sites.js AD_DOMAINS'] }, (t) => {
      t.ok('no ad blocker warning', false, String(box.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300), 'none');
    });
  }

  // Playback time: only while the video plays and the page is visible (PLAN.md §3.1).
  let played = 0, last = performance.now(), hooked = new WeakSet();
  setInterval(async () => {
    if (!active) return;
    route();
    checkAdWarning();
    const now = performance.now(), dt = (now - last) / 1000;
    last = now;
    if (page !== 'watch' || frames.lock || parentOn) return;
    const v = player();
    if (!v) return;
    if (!hooked.has(v)) {
      hooked.add(v);
      v.addEventListener('ended', () => { if (videoId && !adOn && !adPlayer()) ask({ type: 'ended', videoId }); });
      guardSkipping(v);
    }
    if (!v.paused && !v.ended && !adOn && document.visibilityState === 'visible') played += Math.min(dt, 2);
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
