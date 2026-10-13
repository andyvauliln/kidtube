// Dev mode on a page (core/background/bridge.js has the rest): what the server's AI sees and taps. A plain script,
// not a module, next to core/ui/watch.js in every content script and page; it sets globalThis.KidTubeBridgePage.
// The background sends { type: 'bridgePage', id, tabId, fid, do, ref, args } to every frame of the tab; the frame
// it is for answers with the 'bridgeFrame' message. do:
//   snapshot   the visible page as lines "- button "Update now" [ref=k3f9a:12]", the app's closed shadow roots too
//              (core/ui/watch.js shadow); refs stay valid until the page reloads
//   tap        { ref } or { text }: pointer events and a click on it
//   type       { ref, text, enter }: the value, its input and change events, Enter if asked
//   scroll     { ref } into view, or { dy } pixels
//   wait       { text | selector, gone, ms }: until it is there (or gone), at most 15 s
//   errors     the page's last uncaught errors
// Never: a tap or typing inside data-bridge="no" (the PIN, the rules, the GitHub card, dev mode) or on the PIN page,
// and on YouTube or Instagram a tap on what acts for the account (like, subscribe, follow, comment, share, send).
// While the AI works, a small "AI is testing · Stop" shows on the page (storage bridgeLog).
(() => {
  if (globalThis.KidTubeBridgePage) return;
  let base = '';
  try { base = chrome.runtime.getURL(''); } catch { return; }
  const ownPage = location.href.startsWith(base);
  const top = window.top === window;
  const fid = Math.random().toString(36).slice(2, 7);
  const done = new Set();
  const pinPage = ownPage && location.pathname.endsWith('/core/pages/pin.html');
  // Only an extension page compares the tab id: a content script got the request through its own tab.
  const myTab = ownPage && chrome.tabs?.getCurrent ? new Promise((r) => { try { chrome.tabs.getCurrent((t) => { void chrome.runtime.lastError; r(t?.id ?? null); }); } catch { r(null); } }) : Promise.resolve(null);

  const errors = [];
  addEventListener('error', (e) => { errors.push({ at: new Date().toISOString(), message: String(e.message ?? e.error ?? 'error').slice(0, 300), where: `${e.filename ?? ''}:${e.lineno ?? ''}` }); errors.splice(0, errors.length - 20); });
  addEventListener('unhandledrejection', (e) => { errors.push({ at: new Date().toISOString(), message: String(e.reason?.message ?? e.reason ?? 'rejection').slice(0, 300) }); errors.splice(0, errors.length - 20); });

  // --- the outline -------------------------------------------------------------------------------------------------
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'HEAD']);
  const LANDMARK = new Set(['SECTION', 'NAV', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'DIALOG', 'FORM']);
  const ROLE_LANDMARK = /^(dialog|alertdialog|tablist|menu|toolbar|navigation|region|list)$/;
  const ACT = 'button,a[href],input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=option],[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
  const SECRET = /\b(github_pat_|ghp_|gho_|ghs_|AIza|sk-or-|sk-|gsk_)[A-Za-z0-9_-]{6,}/g;
  let refs = new Map(), refOf = new WeakMap(), next = 1;
  const clean = (s, max = 120) => String(s ?? '').replace(SECRET, '$1•••').replace(/\s+/g, ' ').trim().slice(0, max);
  const hostsNow = () => new Map((globalThis.KidTubeWatch?.roots?.() ?? []).map((r) => [r.host, r]));
  const visible = (el) => {
    if (el.hidden) return false;
    if (el.checkVisibility) return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  };
  const labelOf = (el) => clean(el.getAttribute('aria-label') || (el.tagName === 'INPUT' && ['button', 'submit'].includes(el.type) ? el.value : '')
    || el.innerText || el.textContent || el.title || el.getAttribute('placeholder') || el.getAttribute('alt') || el.name || el.id, 80);
  const roleOf = (el) => el.getAttribute('role') || ({ A: 'link', BUTTON: 'button', SELECT: 'select', TEXTAREA: 'textbox', SUMMARY: 'button' })[el.tagName]
    || (el.tagName === 'INPUT' ? ({ checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', range: 'slider' })[el.type] ?? 'textbox' : 'clickable');
  function refFor(el) {
    let n = refOf.get(el);
    if (!n) { n = next++; refOf.set(el, n); refs.set(n, new WeakRef(el)); }
    return `${fid}:${n}`;
  }
  function snapshot({ max = 400 } = {}) {
    const hosts = hostsNow();
    const lines = [];
    const add = (depth, text) => { if (lines.length < max) lines.push(`${'  '.repeat(Math.min(depth, 8))}- ${text}`); };
    const walk = (node, depth) => {
      for (const kid of node.childNodes) {
        if (lines.length >= max) return;
        if (kid.nodeType === 3) {
          const t = clean(kid.data, 200);
          if (t && !/^[·•|,.:;–—-]+$/.test(t) && !kid.parentElement?.closest?.(ACT)) add(depth, `text "${t}"`);
          continue;
        }
        if (kid.nodeType !== 1 || SKIP.has(kid.tagName) || !visible(kid)) continue;
        const el = kid;
        let d = depth;
        if (el.matches(ACT) && !(el.tagName === 'INPUT' && el.type === 'hidden')) {
          const bits = [];
          if (el.disabled) bits.push('disabled');
          if (el.matches('[aria-pressed=true],[aria-selected=true],[aria-checked=true]') || el.checked) bits.push('on');
          if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !['checkbox', 'radio', 'button', 'submit'].includes(el.type)) {
            bits.push(el.type === 'password' ? 'value hidden' : `value "${clean(el.value, 60)}"`);
          }
          if (el.tagName === 'A') bits.push(`href ${clean(el.getAttribute('href'), 80)}`);
          if (el.closest('[data-bridge=no]') || pinPage) bits.push('parent only');
          add(depth, `${roleOf(el)} "${labelOf(el)}"${bits.length ? ` (${bits.join(', ')})` : ''} [ref=${refFor(el)}]`);
          if (el.tagName !== 'SELECT') continue;
        } else if (/^H[1-6]$/.test(el.tagName)) {
          add(depth, `heading "${clean(el.innerText ?? el.textContent)}"`);
          continue;
        } else if (el.tagName === 'IMG' && el.alt) {
          add(depth, `img "${clean(el.alt)}"`);
        } else if (el.tagName === 'VIDEO') {
          add(depth, `video (${el.paused ? 'paused' : 'playing'} ${Math.round(el.currentTime)}/${Math.round(el.duration || 0)} s${el.muted ? ', muted' : ''})`);
        } else if (el.tagName === 'IFRAME') {
          add(depth, `frame ${clean(el.getAttribute('src'), 100)}`);
        } else if (LANDMARK.has(el.tagName) || ROLE_LANDMARK.test(el.getAttribute('role') ?? '')) {
          add(depth, `${(el.getAttribute('role') || el.tagName).toLowerCase()} "${clean(el.getAttribute('aria-label') || el.id)}"`);
          d = depth + 1;
        }
        const sr = hosts.get(el) ?? el.shadowRoot;
        if (sr) walk(sr, d);
        walk(el, d);
      }
    };
    if (document.body) walk(document.body, 0);
    // The app's roots whose hosts sit outside body (on documentElement) are walked too.
    for (const [host, sr] of hosts) if (!document.body?.contains(host)) walk(sr, 0);
    return { title: document.title, href: location.href, viewport: `${innerWidth}x${innerHeight}`, scrollY: Math.round(scrollY), lines, cut: lines.length >= max };
  }

  // --- acting ------------------------------------------------------------------------------------------------------
  // What acts for the account on YouTube and Instagram (English and Russian labels).
  const OUTSIDE_ACT = /\b(like|dislike|subscribe|unsubscribe|follow|unfollow|comment|reply|share|send|post|message|report|block|join|buy|donate|thanks|save to)\b|нрав|подпис|коммент|ответ|подел|отправ|сообщ|пожал/i;
  const ours = (el) => ownPage || (globalThis.KidTubeWatch?.roots?.() ?? []).some((r) => r.contains(el));
  function find({ ref, text }) {
    if (ref) {
      const el = refs.get(Number(String(ref).split(':')[1]))?.deref();
      if (!el?.isConnected) throw new Error(`ref ${ref} is gone (the page changed): take a new snapshot.`);
      return el;
    }
    const want = clean(text).toLowerCase();
    if (!want) throw new Error('Name the element: { ref } from a snapshot, or { text }.');
    const scopes = [document, ...(globalThis.KidTubeWatch?.roots?.() ?? [])];
    const all = scopes.flatMap((s) => [...s.querySelectorAll(ACT)]).filter(visible);
    const el = all.find((x) => labelOf(x).toLowerCase() === want) ?? all.find((x) => labelOf(x).toLowerCase().includes(want));
    if (!el) throw new Error(`Nothing to tap says “${text}”.`);
    return el;
  }
  function allowed(el, what) {
    if (pinPage) throw new Error(`Refused: the PIN page is the parent's (${what}).`);
    if (el.closest('[data-bridge=no]')) throw new Error(`Refused: “${labelOf(el)}” is the parent's (the PIN, the rules, the GitHub connection, dev mode).`);
    if (!ours(el)) {
      const words = [el, el.parentElement, el.parentElement?.parentElement].map((x) => (x ? `${x.getAttribute?.('aria-label') ?? ''} ${x.title ?? ''} ${x === el ? labelOf(x) : ''}` : '')).join(' ');
      if (OUTSIDE_ACT.test(words)) throw new Error(`Refused: “${labelOf(el)}” acts for the account on ${location.hostname}.`);
      if (what === 'type' && !el.matches('input[type=search],input[name=search_query],[role=combobox],[role=searchbox]')) {
        throw new Error(`Refused: typing on ${location.hostname} only goes into its search box.`);
      }
    }
  }
  function tap(args) {
    const el = find(args);
    allowed(el, 'tap');
    el.scrollIntoView?.({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      el.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, { ...at, pointerType: 'touch', isPrimary: true }) : new MouseEvent(type, at));
    }
    el.click();
    return { tapped: `${roleOf(el)} "${labelOf(el)}"` };
  }
  function type(args) {
    const el = find(args);
    allowed(el, 'type');
    el.focus?.();
    const text = String(args.text ?? '');
    if (el.isContentEditable) el.textContent = text;
    else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
    }
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    if (args.enter) {
      for (const t of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, composed: true }));
      el.form?.requestSubmit?.();
    }
    return { typed: `${roleOf(el)} "${labelOf(el)}"` };
  }
  function scroll(args) {
    if (args.ref) { find(args).scrollIntoView?.({ block: 'center' }); return { scrollY: Math.round(scrollY) }; }
    scrollBy(0, Number(args.dy ?? innerHeight * 0.8));
    return { scrollY: Math.round(scrollY) };
  }
  async function wait({ text, selector, gone = false, ms = 5000 }) {
    const until = Date.now() + Math.min(Number(ms) || 5000, 15000);
    const scopes = () => [document, ...(globalThis.KidTubeWatch?.roots?.() ?? [])];
    const there = () => (selector ? scopes().some((s) => [...s.querySelectorAll(selector)].some(visible))
      : scopes().some((s) => clean((s.body ?? s).innerText ?? s.textContent, 1e6).toLowerCase().includes(clean(text).toLowerCase())));
    while (Date.now() < until) {
      if (there() !== !!gone) return { found: !gone, ms: Math.round(Number(ms) - (until - Date.now())) };
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`${selector ?? `“${text}”`} ${gone ? 'still there' : 'not there'} after ${ms} ms.`);
  }
  const DO = { snapshot, tap, type, scroll, wait, errors: () => ({ errors: errors.slice() }) };

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'bridgePage' || done.has(msg.id)) return;
    if (msg.fid ? msg.fid !== fid : msg.do !== 'snapshot' && !top) return;   // a tap without a ref: the top frame
    done.add(msg.id);
    myTab.then(async (tab) => {
      if (tab != null && msg.tabId != null && tab !== msg.tabId) return;
      let result;
      try {
        const fn = DO[msg.do];
        if (!fn) throw new Error(`Unknown page command “${msg.do}”.`);
        result = { ok: true, ...(await fn(msg.args ?? {})) };
        globalThis.KidTubeWatch?.step({ kind: 'ai', label: `${msg.do}${result.tapped ? ` ${result.tapped}` : ''}` });
      } catch (e) {
        result = { ok: false, error: String(e?.message ?? e) };
      }
      try { chrome.runtime.sendMessage({ type: 'bridgeFrame', id: msg.id, fid, url: location.href, top, result }, () => void chrome.runtime.lastError); } catch {}
    });
  });

  // --- "AI is testing" on the page, while it works (and 8 s after) ------------------------------------------------
  let pill = null, pillTimer = null;
  function showPill(cmd) {
    if (!top) return;
    if (!pill) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed!important;right:10px!important;bottom:10px!important;z-index:2147483647!important;display:block!important';
      const root = host.attachShadow({ mode: 'closed' });
      const box = document.createElement('div');
      box.setAttribute('role', 'status');
      box.style.cssText = 'font:500 13px/1 system-ui,sans-serif;background:#1a73e8;color:#fff;border-radius:16px;padding:6px 6px 6px 12px;display:flex;gap:8px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.3)';
      const label = document.createElement('span');
      const stop = document.createElement('button');
      stop.textContent = 'Stop';
      stop.dataset.bridge = 'no';
      stop.style.cssText = 'font:inherit;border:0;border-radius:12px;padding:4px 10px;background:#fff;color:#1a73e8;cursor:pointer';
      stop.addEventListener('click', () => { try { chrome.runtime.sendMessage({ type: 'devStop' }, () => void chrome.runtime.lastError); } catch {} host.remove(); pill = null; });
      box.append(label, stop);
      root.append(box);
      pill = { host, label };
    }
    pill.label.textContent = `AI is testing this tablet · ${cmd}`;
    if (!pill.host.isConnected) (document.body || document.documentElement).append(pill.host);
    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => { pill?.host.remove(); }, 8000);
  }
  try {
    chrome.storage.onChanged.addListener((ch) => {
      const v = ch.bridgeLog?.newValue;
      if (v?.at && v.cmd) showPill(v.cmd);
      if (ch.settings && ch.settings.newValue?.devMode === false) pill?.host.remove();
    });
  } catch {}

  globalThis.KidTubeBridgePage = { fid, snapshot };
})();
