// The checks on a page: KidTube's own pages, its screens on YouTube, and the content scripts. A plain script, not a
// module, so content scripts and pages that fail to load modules can use it; it sets globalThis.KidTubeWatch.
// It reports to the background (the 'checkResult' message, core/checks/runner.js), which keeps the results and
// turns a failure into a report with the browser, the profile, the mode and the last steps:
//   check(def, test, within)   a screen check: test(t) must pass now, or within `within` ms (asked again every 250 ms)
//   watchTaps(root, where)     the rule "no dead buttons": after a tap, something on the page must change within 5 s
//   noAnswer(msg, ms)          the rule "the background answers": an ask that got nothing back
//   step(s)                    something the parent or he did (a tap, a page shown), sent with a failure
//   banner(alert)              a new report, for 15 s (pulled from the background where the parent is)
// Uncaught errors in KidTube's own code are reported by themselves (the rule "no silent errors").
(() => {
  if (globalThis.KidTubeWatch) return;
  let base = '';
  try { base = chrome.runtime.getURL(''); } catch { return; }
  const ownPage = location.href.startsWith(base);
  let gone = false;   // the page is leaving: checks still running are dropped, not failed
  addEventListener('pagehide', () => { gone = true; });

  // Same as core/checks/kit.js (this is not a module).
  class Expect {
    constructor() { this.mismatch = []; this.evidence = {}; this.skipped = null; }
    eq(what, expected, actual) {
      if (JSON.stringify(expected) !== JSON.stringify(actual)) this.mismatch.push({ what, expected, actual: actual === undefined ? '(nothing)' : actual });
      return this;
    }
    ok(what, cond, actual, expected = 'true') { if (!cond) this.mismatch.push({ what, expected, actual: actual === undefined ? '(nothing)' : actual }); return !!cond; }
    has(what, actual, expected = 'a value') { return this.ok(what, actual != null && actual !== '' && !(Array.isArray(actual) && !actual.length), actual ?? null, expected); }
    note(key, value) { this.evidence[key] = value; return this; }
    skip(why) { this.skipped = why; return this; }
    get passed() { return !this.mismatch.length; }
  }

  // --- the page's last steps --------------------------------------------------------------------------------------
  const steps = [];
  const where = () => (ownPage ? location.pathname.replace(/^\//, '') + location.hash : `youtube ${location.pathname}`);
  function step(s) {
    steps.push({ at: new Date().toISOString(), where: where(), ...s });
    steps.splice(0, Math.max(0, steps.length - 20));
  }

  // --- sending: one result at a time; kept and tried again while the background doesn't answer ----------------------
  const queue = [];
  let sending = false, tries = 0;
  function send(result) {
    queue.push({ type: 'checkResult', result, steps: steps.slice() });
    if (queue.length > 20) queue.shift();
    flush();
  }
  function flush() {
    if (sending || !queue.length) return;
    sending = true;
    const done = (ok) => {
      sending = false;
      if (ok) { tries = 0; queue.shift(); flush(); }
      else if (++tries < 6) setTimeout(flush, 10000);
    };
    const timer = setTimeout(() => done(false), 5000);
    try {
      chrome.runtime.sendMessage(queue[0], (r) => { clearTimeout(timer); void chrome.runtime.lastError; done(!!r); });
    } catch { clearTimeout(timer); queue.length = 0; sending = false; }   // KidTube was updated or removed: this page is cut off
  }

  const page = () => ({ path: ownPage ? location.pathname : `youtube ${location.pathname}`, tab: location.hash.slice(1, 40) || null,
    title: document.title.slice(0, 80), viewport: `${innerWidth}x${innerHeight}`, visible: document.visibilityState === 'visible' });
  const passedOnce = new Set();
  function finish(def, t, ms) {
    if (t.skipped) return 'skip';
    const status = t.passed ? 'pass' : 'fail';
    if (status === 'pass') { if (passedOnce.has(def.id)) return status; passedOnce.add(def.id); }
    send({ id: def.id, kind: def.kind ?? 'screen', area: def.area, expect: def.expect, code: def.code ?? [], strikes: def.strikes ?? 0,
      status, mismatch: t.mismatch, evidence: t.evidence, ms: Math.round(ms), page: page() });
    return status;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // def: { id, area, expect, code, kind, strikes }. Resolves to 'pass' | 'fail' | 'skip' | 'gone'.
  async function check(def, test, within = 0) {
    const t0 = performance.now();
    for (;;) {
      const t = new Expect();
      try { await test(t); } catch (e) { t.mismatch.push({ what: 'the check itself', expected: 'finishes', actual: String(e?.message ?? e).slice(0, 200) }); }
      if (gone) return 'gone';
      const late = performance.now() - t0 >= within;
      if (t.passed || t.skipped || late) {
        // He or the parent left the page meanwhile, or the browser froze it: nothing to blame.
        if (!t.passed && document.visibilityState !== 'visible') return 'skip';
        return finish(def, t, performance.now() - t0);
      }
      await sleep(250);
    }
  }

  // --- no dead buttons --------------------------------------------------------------------------------------------
  // root: the page (document) or a closed shadow root (the apps header). On YouTube only our own root is watched
  // (YouTube's page changes all the time). A button with data-check="none" is left out (it opens a file picker).
  const OPTS = { subtree: true, childList: true, attributes: true, characterData: true };
  const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'unnamed';
  function labelOf(b) {
    return (b.getAttribute('aria-label') || b.textContent || b.title || b.getAttribute('href') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  }
  function watchTaps(root, area) {
    root.addEventListener('click', (e) => {
      const b = e.composedPath().find((n) => n instanceof Element && n.matches('button, [role=button], [role=menuitem], a[href^="#"]'));
      if (!b || b.disabled || b.closest('[data-check=none]')) return;
      const label = labelOf(b);
      step({ kind: 'tap', label, area });
      let changed = false;
      const mark = () => { changed = true; };
      const obs = new MutationObserver(mark);
      obs.observe(root === document ? document.documentElement : root, OPTS);
      const href = location.href;
      addEventListener('beforeunload', mark, { once: true });
      setTimeout(() => {
        obs.disconnect();
        removeEventListener('beforeunload', mark);
        if (changed || gone || location.href !== href) return;
        const t = new Expect();
        t.mismatch.push({ what: `the tap on “${label}”`, expected: 'something on the screen changes within 5 s (a new screen, a busy state, a message)', actual: 'nothing changed' });
        t.note('button', { label, tag: b.tagName.toLowerCase(), classes: String(b.className).slice(0, 80) });
        if (document.visibilityState === 'visible') finish({ id: `rule.deadButton.${slug(label)}`, kind: 'rule', area, expect: `“${label}” does something`, code: [] }, t, 5000);
      }, 5000);
    }, true);
  }

  // --- the background answers ----------------------------------------------------------------------------------
  function noAnswer(msg, ms) {
    const type = String(msg?.type ?? '?').slice(0, 40);
    if (type === 'checkResult') return;
    const t = new Expect();
    t.mismatch.push({ what: `answer to "${type}"`, expected: `within ${ms / 1000} s`, actual: 'no answer' });
    finish({ id: `rule.noAnswer.${slug(type)}`, kind: 'rule', area: 'background', strikes: 2, expect: `the background answers "${type}"`,
      code: ['core/background/messages.js handle'] }, t, ms);
  }

  // --- no silent errors: uncaught errors in KidTube's own code -------------------------------------------------------
  const ours = (s) => ownPage || String(s ?? '').includes(base);
  const frame = (stack) => String(stack ?? '').split('\n').map((l) => l.trim()).find((l) => l.includes(base))?.replace(base, '') ?? '';
  function pageError(message, file, line, stack) {
    if (/ResizeObserver loop|Extension context invalidated/.test(message)) return;
    const at = file ? `${file.replace(base, '').split('/').pop()}:${line ?? 0}` : (frame(stack).match(/([\w.-]+\.js):(\d+)/)?.slice(1).join(':') ?? 'unknown');
    const t = new Expect();
    t.mismatch.push({ what: 'an uncaught error', expected: 'none', actual: String(message).slice(0, 300) });
    t.note('stack', String(stack ?? '').split('\n').slice(0, 6).map((l) => l.replace(base, '')).join('\n'));
    finish({ id: `rule.pageError.${slug(at.replace(':', '_'))}`, kind: 'rule', area: ownPage ? 'page' : 'youtube', expect: 'no uncaught error in KidTube’s code',
      code: [file ? file.replace(base, '') : frame(stack)] }, t, 0);
  }
  addEventListener('error', (e) => {
    if (!(e instanceof ErrorEvent) || !String(e.filename ?? '').startsWith(base) && !ours(e.error?.stack)) return;
    pageError(e.message, e.filename, e.lineno, e.error?.stack);
  });
  addEventListener('unhandledrejection', (e) => {
    const stack = e.reason?.stack;
    if (!ours(stack)) return;
    pageError(`(async) ${e.reason?.message ?? e.reason}`, null, null, stack);
  });

  // --- the banner: a new report, shown for 15 s where the parent is (the background says no in kid mode) ----------
  const BANNER_MS = 15000;
  const BANNER_CSS = `
    :host { all: initial; }
    .b { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 24px)); box-sizing: border-box;
      background: #fff8e1; color: #3e2f00; border: 1px solid #f0c36d; border-radius: 14px; box-shadow: 0 8px 28px rgba(0,0,0,.22);
      padding: 12px 14px 14px; font: 14px/1.4 Roboto, system-ui, -apple-system, "Segoe UI", sans-serif; overflow: hidden; }
    b { display: block; font-size: 15px; margin-bottom: 2px; }
    .saw { color: #6b5500; font-size: 13px; word-break: break-word; }
    .sent { margin-top: 6px; font-weight: 500; }
    .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
    button { font: inherit; font-weight: 500; border: 0; border-radius: 16px; height: 32px; padding: 0 14px; cursor: pointer; background: #f3e2b3; color: inherit; }
    .bar { position: absolute; left: 0; bottom: 0; height: 3px; background: #e0a800; animation: t ${BANNER_MS}ms linear forwards; }
    @keyframes t { from { width: 100%; } to { width: 0; } }`;
  function banner(a) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed!important;inset:0 0 auto 0!important;z-index:2147483647!important;display:block!important';
    const root = host.attachShadow({ mode: 'closed' });
    const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const box = mk('div', 'b');
    box.setAttribute('role', 'alert');
    const details = mk('button', '', 'Details');
    details.addEventListener('click', () => { window.open(chrome.runtime.getURL('core/pages/check.html'), '_blank'); });
    const close = mk('button', '', 'Close');
    const row = mk('div', 'row');
    row.append(details, close);
    box.append(mk('b', '', `⚠ Something did not work: ${a.expect}`), mk('div', 'saw', String(a.saw ?? '').slice(0, 220)),
      mk('div', 'sent', a.willSend ? 'The report goes to the server now. A fix comes as a new version.' : 'The report is saved on this tablet. Connect GitHub to send it to the server.'),
      row, mk('div', 'bar'));
    const style = mk('style', '', BANNER_CSS);
    root.append(style, box);
    const remove = () => host.remove();
    close.addEventListener('click', remove);
    setTimeout(remove, BANNER_MS);
    (document.body || document.documentElement).append(host);
  }
  let asking = false;
  function pullAlert() {
    if (asking || location.href.startsWith(`${base}core/pages/check.html`)) return;
    asking = true;
    try {
      chrome.runtime.sendMessage({ type: 'checkAlert' }, (r) => { void chrome.runtime.lastError; asking = false; if (r?.alert) banner(r.alert); });
    } catch { asking = false; }
  }
  // Only the top page asks (a page's frames would show it twice).
  if (window.top === window) {
    setTimeout(pullAlert, 1500);
    try { chrome.storage.onChanged.addListener((ch) => { if (ch.checkAlert?.newValue && !ch.checkAlert.newValue.shown) pullAlert(); }); } catch {}
  }

  if (ownPage) step({ kind: 'page', label: document.title });
  addEventListener('hashchange', () => step({ kind: 'page', label: location.hash }));
  globalThis.KidTubeWatch = { check, watchTaps, noAnswer, step, send, Expect, banner };
})();
