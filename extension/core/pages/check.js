// "Check this browser": tests what KidTube needs, one row each, so a browser that shows a blank screen can say why.
// A classic script (not a module) on purpose: it must run even where module scripts don't.
(() => {
  const rows = document.getElementById('rows');
  const lines = [];
  function row(ok, name, detail) {
    const tr = document.createElement('tr');
    for (const t of [ok === true ? '✅' : ok === false ? '❌' : '⚠️', name, detail]) {
      const td = document.createElement('td');
      td.textContent = String(t);
      tr.appendChild(td);
    }
    rows.appendChild(tr);
    lines.push(`${ok === true ? 'OK ' : ok === false ? 'BAD' : '?  '} ${name}: ${detail}`);
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const within = (p, ms) => Promise.race([p, wait(ms).then(() => { throw new Error(`no answer in ${ms / 1000} s`); })]);
  const short = (v) => { try { return JSON.stringify(v).slice(0, 300); } catch { return String(v); } };

  // Calls a chrome.* function both ways: promise style (what KidTube uses) and callback style.
  async function bothWays(name, fn, args) {
    try {
      const r = fn(...args);
      const thenable = !!r && typeof r.then === 'function';
      const v = thenable ? await within(r, 4000) : r;
      row(thenable && v !== undefined, `${name} (promise)`, thenable ? `answer: ${short(v)}` : `returned ${typeof r}, not a promise`);
    } catch (e) { row(false, `${name} (promise)`, e.message ?? e); }
    try {
      const v = await within(new Promise((resolve, reject) => {
        fn(...args, (x) => { const err = chrome.runtime.lastError; err ? reject(new Error(err.message)) : resolve(x); });
      }), 4000);
      row(v !== undefined, `${name} (callback)`, `answer: ${short(v)}`);
    } catch (e) { row(false, `${name} (callback)`, e.message ?? e); }
  }

  async function run() {
    row(null, 'Browser', navigator.userAgent);
    row(typeof chrome !== 'undefined', 'chrome namespace', typeof chrome);
    row(null, 'browser namespace', typeof browser);
    try { const m = chrome.runtime.getManifest(); row(true, 'Extension', `${m.name} ${m.version} · id ${chrome.runtime.id} · page ${location.protocol}//${location.host}`); }
    catch (e) { row(false, 'Extension', e.message); }
    await wait(300);
    row(!!window.kidtubeModuleOk, 'Module scripts on extension pages', window.kidtubeModuleOk ? 'run' : 'did not run: every KidTube screen needs them');
    row(window.top === window ? null : true, 'Opened', window.top === window ? 'as its own page' : 'inside a frame on a web page');

    await bothWays('Background answers (runtime.sendMessage ping)', chrome.runtime.sendMessage.bind(chrome.runtime), [{ type: 'ping' }]);
    if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
      try { row(true, 'browser.runtime.sendMessage ping', short(await within(browser.runtime.sendMessage({ type: 'ping' }), 4000))); }
      catch (e) { row(false, 'browser.runtime.sendMessage ping', e.message ?? e); }
    }
    await bothWays('Storage (storage.local.get)', chrome.storage.local.get.bind(chrome.storage.local), [['settings']]);
    try {
      const st = await within(chrome.runtime.sendMessage({ type: 'state' }), 6000);
      row(!!st, 'Kid list from the background (state)', st ? `${st.videos?.length ?? 0} videos, lock: ${short(st.lock)}` : `answer: ${short(st)}`);
    } catch (e) { row(false, 'Kid list from the background (state)', e.message ?? e); }
    try {
      const r = await fetch(chrome.runtime.getURL('apps/kidtube/data/default-config.json'));
      row(r.ok, 'Reading its own files (fetch)', `status ${r.status}`);
    } catch (e) { row(false, 'Reading its own files (fetch)', e.message ?? e); }

    row(!!chrome.alarms, 'Timers (alarms)', chrome.alarms ? 'present' : 'missing');
    row(!!chrome.tabs?.update, 'Tabs', chrome.tabs?.update ? 'present' : 'missing');
    row(null, 'Blocking rules (declarativeNetRequest)', chrome.declarativeNetRequest ? 'present' : 'missing (expected in Orion)');
    row('caches' in self, 'Cache Storage (recorded voice)', 'caches' in self ? 'present' : 'missing: the device voice is used');
    row('speechSynthesis' in self, 'Speaking (speechSynthesis)', 'speechSynthesis' in self ? `${speechSynthesis.getVoices().length} voices so far` : 'missing');
    const SR = self.SpeechRecognition || self.webkitSpeechRecognition;
    row(SR ? true : null, 'Speech recognition', SR ? 'present' : 'missing: he types, or use OpenRouter listening');
    row(navigator.mediaDevices?.getUserMedia ? true : null, 'Microphone API (getUserMedia)', navigator.mediaDevices?.getUserMedia ? 'present' : 'missing');
    row(!!crypto.subtle, 'PIN hashing (crypto.subtle)', crypto.subtle ? 'present' : 'missing');
    try { new Intl.DateTimeFormat('en', { timeZone: 'Europe/Moscow' }).format(); row(true, 'Time zones (Intl)', 'present'); }
    catch (e) { row(false, 'Time zones (Intl)', e.message); }
    document.getElementById('status').textContent = 'Done.';
  }

  document.getElementById('copy').addEventListener('click', async () => {
    const text = `KidTube browser check, ${new Date().toISOString()}\n${lines.join('\n')}`;
    try { await navigator.clipboard.writeText(text); document.getElementById('out').textContent = 'Copied.'; }
    catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      ta.style.cssText = 'width:100%;height:12em';
      document.body.appendChild(ta);
      ta.select();
      document.getElementById('out').textContent = 'Select the text below and copy it.';
    }
  });
  run().catch((e) => row(false, 'Check itself', e.message ?? e));
})();
