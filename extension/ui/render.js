// The kid's screens, built once for every place they show: the extension's own pages (home.html, strip.html;
// inside iframes on YouTube, or opened directly) and the in-page panels content.js draws where a browser
// shows extension iframes blank (Orion). A plain script, not a module, so the content script can use it too:
// it sets globalThis.KidTubeUI. No innerHTML anywhere: YouTube's Trusted Types policy refuses it.
// Styles: ui/ui.css (everything hangs off .screen).
(() => {
  if (globalThis.KidTubeUI) return;
  const NS = 'http://www.w3.org/2000/svg';

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const PATH = {
    home: 'M12 3 2 12h3v8h5v-6h4v6h5v-8h3L12 3z',
    lock: 'M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2zm-7-2a2 2 0 0 1 4 0v2h-4V7z',
    star: 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.5L12 17.3l-5.9 3.2 1.3-6.5L2.5 9.4l6.6-.8L12 2.5z',
    sun: 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0-5 1.5 3h-3L12 2zm0 20-1.5-3h3L12 22zM2 12l3-1.5v3L2 12zm20 0-3 1.5v-3l3 1.5zM4.9 4.9l3.2 1.1-2.1 2.1-1.1-3.2zm14.2 14.2-3.2-1.1 2.1-2.1 1.1 3.2zM4.9 19.1l1.1-3.2 2.1 2.1-3.2 1.1zM19.1 4.9l-1.1 3.2-2.1-2.1 3.2-1.1z',
  };
  function icon(name, size = 20) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size); s.setAttribute('height', size);
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('fill', 'currentColor');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', PATH[name] ?? PATH.star);
    s.append(p);
    return s;
  }
  function button(cls, label, onTap, iconName) {
    const b = el('button', cls);
    b.type = 'button';
    if (iconName) b.append(icon(iconName, 20));
    if (label) b.append(el('span', '', label));
    if (onTap) b.addEventListener('click', onTap);
    return b;
  }
  const thumb = (v) => v.thumbnailUrl || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`;
  const mins = (s) => `${Math.max(1, Math.round(s / 60))} min`;
  const fmt = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`);
  const checkUrl = () => { try { return chrome.runtime.getURL('ui/check.html'); } catch { return 'check.html'; } };

  // Plays an animation class again from the start.
  function replay(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }

  // --- pieces ----------------------------------------------------------------------------------------------
  // One video. v: { videoId, title, thumbnailUrl, durationSeconds, required, waiting }.
  function card(v, onTap, { small = false } = {}) {
    const b = el('button', `card${v.waiting ? ' waiting' : ''}${small ? ' small' : ''}`);
    b.type = 'button';
    const pic = el('div', 'pic');
    const img = el('img');
    img.src = thumb(v); img.alt = ''; img.draggable = false; img.loading = 'lazy';
    pic.append(img);
    if (v.durationSeconds && !small) pic.append(el('span', 'len', mins(v.durationSeconds)));
    if (v.required) { const s = el('span', 'star'); s.append(icon('star', small ? 18 : 22)); pic.append(s); }
    if (v.waiting) {   // must-watch videos come first: this one waits, and a tap only says so
      const w = el('span', 'waittag');
      w.append(icon('lock', 14), icon('star', 14), el('span', '', 'first'));
      pic.append(w);
    }
    b.append(pic, el('div', 't', v.title));
    if (v.waiting) {
      b.addEventListener('click', () => {
        replay(b, 'nudge');
        const root = b.getRootNode();
        for (const s of (root.querySelectorAll ? root : document).querySelectorAll('.card .star')) replay(s, 'nudge');
      });
      return b;
    }
    b.addEventListener('click', onTap);
    return b;
  }

  function cards(videos, onOpen, { small = false } = {}) {
    const grid = el('div', `grid${small ? ' small' : ''}`);
    for (const v of videos) grid.append(card(v, () => onOpen(v), { small }));
    return grid;
  }

  // A centered message: a big emoji, a title and a line.
  function message(emoji, title, text, cls = '') {
    const box = el('div', `center${cls ? ` ${cls}` : ''}`);
    const inner = el('div');
    inner.append(el('div', 'big', emoji), el('h1', '', title), el('p', '', text));
    box.append(inner);
    return box;
  }

  // Why he can't watch now. lock: { reason: outsideHours | dailyCap | stopped, opens: { day, at } | null }.
  function lockView(lock) {
    const when = lock.reason === 'stopped' ? 'Let’s try again tomorrow' : lock.opens ? `See you ${lock.opens.day} at ${lock.opens.at}` : 'See you later';
    const [emoji, title] = lock.reason === 'dailyCap' ? ['🌙', 'That’s all for today']
      : lock.reason === 'stopped' ? ['🌟', 'Good work today'] : ['⏰', 'Videos are sleeping'];
    return message(emoji, title, when, 'lockview');
  }

  // Instead of a blank screen: say what is wrong and where to look.
  function problemView() {
    const box = message('🔧', 'KidTube can’t reach its background in this browser', 'Ask a grown-up to open the check below and send the result.');
    const a = el('a', 'link', 'Check this browser');
    a.href = checkUrl();
    a.target = '_blank';
    box.firstChild.append(a);
    return box;
  }
  const emptyView = () => message('🌱', 'New videos are coming', 'Ask a grown-up to check back later.');

  // The grown-up's way out of kid mode: the PIN page, then parent mode.
  function parentButton(ask) {
    const b = button('parentbtn', 'Parent', () => ask({ type: 'parentGate' }), 'lock');
    b.title = 'Parent mode (PIN)';
    return b;
  }

  // The home screen's top bar: a hello from the friend, the time left today (a sun that sets), the Parent button.
  function topbar(ask) {
    const bar = el('header', 'topbar');
    const hello = el('div', 'hello', 'Pick a video');
    const meter = el('div', 'meter');
    const fill = el('div', 'fill');
    const sun = el('span', 'sunicon');
    sun.append(icon('sun', 18));
    fill.append(sun);
    meter.append(fill);
    meter.hidden = true;
    bar.append(hello, meter, parentButton(ask));
    return {
      el: bar,
      update(st) {
        hello.textContent = st.friend ? `${st.friend} says: pick a video` : 'Pick a video';
        const show = st.maxMinutes > 0 && st.minutesLeft != null && !st.lock;
        meter.hidden = !show;
        if (!show) return;
        const left = Math.max(0, Math.min(1, st.minutesLeft / st.maxMinutes));
        fill.style.width = `${Math.round(left * 100)}%`;
        meter.classList.toggle('low', st.minutesLeft <= 5);
        meter.title = `${st.minutesLeft} of ${st.maxMinutes} minutes left today`;
        meter.setAttribute('aria-label', meter.title);
      },
    };
  }

  // --- the screens ----------------------------------------------------------------------------------------
  // The home list (or the lock screen), drawn into root (a body or a panel). ask(msg) reaches the background.
  // locked: always the lock screen (content.js covers the player with it when the time is up).
  // Returns { refresh(), stop() }. Redraws only when what it shows changes, so the list keeps its scroll.
  function mountHome(root, { ask, locked = false, every = 30000 } = {}) {
    root.classList.add('screen', 'home');
    const bar = topbar(ask);
    const body = el('div', 'body');
    root.append(bar.el, body);
    let shown = null, alive = true;
    const open = (v) => ask({ type: 'open', videoId: v.videoId });
    async function refresh() {
      const st = await ask({ type: 'state' });
      if (!alive) return;
      if (!st) { if (shown === null) { shown = 'problem'; root.classList.toggle('night', locked); body.replaceChildren(locked ? lockView({ reason: 'dailyCap' }) : problemView()); } return; }
      const lock = st.lock ?? (locked ? { reason: 'dailyCap' } : null);
      bar.update({ ...st, lock });
      const key = JSON.stringify([lock, st.videos.map((v) => [v.videoId, v.title, !!v.waiting, !!v.required])]);
      if (key === shown) return;
      shown = key;
      root.classList.toggle('night', !!lock);
      body.replaceChildren(lock ? lockView(lock) : st.videos.length ? cards(st.videos, open) : emptyView());
    }
    refresh();
    const timer = setInterval(refresh, every);
    return { refresh, stop() { alive = false; clearInterval(timer); } };
  }

  // The strip beside the player: Home, the wait until he may choose another video, and the other cards.
  function mountStrip(root, { ask, every = 1000 } = {}) {
    root.classList.add('screen', 'strip');
    const bar = el('div', 'bar');
    const home = button('homebtn', 'Home', () => ask({ type: 'goHome' }), 'home');
    const wait = el('span', 'wait');
    bar.append(home, wait, parentButton(ask));
    const body = el('div', 'body');
    root.append(bar, body);
    let shown = null, alive = true;
    const open = (v) => ask({ type: 'open', videoId: v.videoId });
    async function refresh() {
      const st = await ask({ type: 'state' });
      if (!st || !alive) return;
      const left = st.session?.secondsUntilUnlock ?? 0;
      const locked = left > 0;
      root.classList.toggle('locked', locked);
      home.disabled = locked;
      wait.replaceChildren();
      if (locked) wait.append('Another video in ', el('b', '', fmt(left)));
      const key = st.videos.map((v) => `${v.videoId}${v.waiting ? '-' : ''}${v.required ? '*' : ''}`).join();
      if (key !== shown) { shown = key; body.replaceChildren(cards(st.videos, open, { small: true })); }
    }
    refresh();
    const timer = setInterval(refresh, every);
    return { refresh, stop() { alive = false; clearInterval(timer); } };
  }

  globalThis.KidTubeUI = { el, icon, button, card, cards, message, lockView, problemView, emptyView, parentButton, mountHome, mountStrip };
})();
