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
  // show: what of the answer goes on the screen (never the token or the PIN: this result is sent to others).
  async function bothWays(name, fn, args, show = short) {
    try {
      const r = fn(...args);
      const thenable = !!r && typeof r.then === 'function';
      const v = thenable ? await within(r, 4000) : r;
      row(thenable && v !== undefined, `${name} (promise)`, thenable ? `answer: ${show(v)}` : `returned ${typeof r}, not a promise`);
    } catch (e) { row(false, `${name} (promise)`, e.message ?? e); }
    try {
      const v = await within(new Promise((resolve, reject) => {
        fn(...args, (x) => { const err = chrome.runtime.lastError; err ? reject(new Error(err.message)) : resolve(x); });
      }), 4000);
      row(v !== undefined, `${name} (callback)`, `answer: ${show(v)}`);
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
    await bothWays('Storage (storage.local.get)', chrome.storage.local.get.bind(chrome.storage.local), [['settings']],
      (v) => (v?.settings ? `settings with ${Object.keys(v.settings).join(', ') || 'nothing'}` : short(v)));
    try {
      const st = await within(chrome.runtime.sendMessage({ type: 'state' }), 6000);
      row(!!st, 'Kid list from the background (state)', st ? `${st.videos?.length ?? 0} videos, lock: ${short(st.lock)}` : `answer: ${short(st)}`);
    } catch (e) { row(false, 'Kid list from the background (state)', e.message ?? e); }
    try {
      const { bgStuck } = await chrome.storage.local.get('bgStuck');
      row(bgStuck ? false : true, 'Background steps', bgStuck ? `one got stuck at ${bgStuck.at}: ${bgStuck.from}` : 'none got stuck');
    } catch (e) { row(null, 'Background steps', e.message ?? e); }
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
  run().catch((e) => row(false, 'Check itself', e.message ?? e)).then(showChecks);

  // --- KidTube's own checks (core/checks/): the results and the problem reports ----------------------------------
  const ask = (msg, ms = 20000) => within(new Promise((resolve) => chrome.runtime.sendMessage(msg, (v) => { void chrome.runtime.lastError; resolve(v); })), ms);
  const mk = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = String(text); if (cls) n.className = cls; return n; };
  const ICON = { pass: '✅', fail: '❌', warn: '⚠️', skip: '➖', cleared: '◻️' };
  const PICON = { unsent: '⚠️', waiting: '⏳', late: '⚠️', working: '🔧', reload: '⟳', fixed: '✅', checked: '✅', 'needs-you': '✋', retry: '⚠️', 'gave-up': '⚠️' };
  let reports = [];
  async function showChecks() {
    let v;
    try { v = await ask({ type: 'checks' }, 6000); } catch (e) { document.getElementById('chkOut').textContent = `The background did not answer: ${e.message}`; return; }
    if (!v?.ok) { document.getElementById('chkOut').textContent = 'The background did not answer.'; return; }
    reports = v.reports ?? [];
    const s = v.start;
    document.getElementById('chkStart').textContent = s ? `Start checks (${s.reason}, ${new Date(s.at).toLocaleString()}, version ${s.version}): ${s.pass} passed, ${s.fail} failed, ${s.skip} skipped.` : 'The start checks have not run yet.';
    // The problems: one per check (the same problem again is its counter), with where it is (core/checks/runner.js
    // problemsOf: the server's fix agent answers in fixes.json), and its reports under it.
    const dev = await new Promise((res) => { try { chrome.management.getSelf((m) => { void chrome.runtime.lastError; res(m?.installType === 'development'); }); } catch { res(false); } });
    const HOW = dev ? 'Run git pull in the KidTube folder, then press ⟳ Reload on KidTube in chrome://extensions.'
      : v.target === 'orion' ? 'Download the new .zip on the install page and install it in Orion.' : 'Parent screens → Update KidTube.';
    const server = v.fixesAt ? `The server’s answers were read ${new Date(v.fixesAt).toLocaleTimeString()}${v.fixesError ? ` (failed: ${v.fixesError})` : ''}.` : 'The server’s answers were not read yet.';
    document.getElementById('probHead').textContent = (v.problems ?? []).length ? `${v.problems.length} problem(s). ${server}` : 'No problems.';
    const box = document.getElementById('reports');
    box.replaceChildren(...(v.problems ?? []).map((p) => {
      const d = mk('div', null, `report ${p.done ? 'done' : p.state}`);
      d.append(mk('h3', `${PICON[p.state] ?? '⚠'} ${p.check}${p.count > 1 ? ` (×${p.count})` : ''}`), mk('div', p.label, 'state'), mk('div', p.expect, 'muted'));
      if (p.saw) d.append(mk('div', `Saw: ${p.saw}`, 'muted'));
      if (p.fix?.message) d.append(mk('div', `AI: ${p.fix.message}`, 'ai'));
      if (p.state === 'reload') d.append(mk('div', HOW, 'ai'));
      d.append(mk('div', `Versions: ${p.versions.join(', ')} · first ${new Date(p.firstAt).toLocaleString()} · last ${new Date(p.lastAt).toLocaleString()} · ${p.sentAt ? `sent ${new Date(p.sentAt).toLocaleString()}` : 'not sent yet'}`, 'muted'));
      const det = mk('details');
      det.append(mk('summary', `The report${p.reportIds.length > 1 ? `s (${p.reportIds.length})` : ''}`));
      for (const r of reports.filter((x) => p.reportIds.includes(x.reportId))) {
        const t = mk('table');
        for (const m of r.mismatch ?? []) {
          const tr = mk('tr');
          tr.append(mk('td', m.what), mk('td', `expected ${typeof m.expected === 'string' ? m.expected : JSON.stringify(m.expected)} · saw ${typeof m.actual === 'string' ? m.actual : JSON.stringify(m.actual)}`));
          t.append(tr);
        }
        det.append(mk('div', `${r.fingerprint} · ×${r.count} · ${r.context?.profile?.mode ?? '?'} mode · ${r.context?.page?.url ?? 'background'}`, 'muted'), t, mk('pre', JSON.stringify(r, null, 2)));
      }
      d.append(det);
      return d;
    }));
    const rowsBox = document.getElementById('checkRows');
    rowsBox.replaceChildren(...(v.results ?? []).map((r) => {
      const tr = mk('tr', null, r.status);
      tr.append(mk('td', ICON[r.status] ?? '?'), mk('td', r.id), mk('td', r.status === 'pass' ? `${r.expect} (${r.passes}×)` : `${r.expect}${r.saw ? ` — ${r.saw}` : ''}`));
      return tr;
    }));
  }
  document.getElementById('runChecks').addEventListener('click', async () => {
    const out = document.getElementById('chkOut');
    out.textContent = 'Running… (up to a minute)';
    try { const r = await ask({ type: 'runChecks' }, 90000); out.textContent = r?.ok ? `Done: ${r.start.pass} passed, ${r.start.fail} failed, ${r.start.skip} skipped.` : 'No answer.'; }
    catch (e) { out.textContent = e.message; }
    showChecks();
  });
  document.getElementById('copyReports').addEventListener('click', async () => {
    const text = JSON.stringify(reports, null, 2);
    try { await navigator.clipboard.writeText(text); document.getElementById('chkOut').textContent = `Copied ${reports.length} report(s).`; }
    catch { const ta = Object.assign(document.createElement('textarea'), { value: text }); ta.style.cssText = 'width:100%;height:12em'; document.getElementById('reports').prepend(ta); ta.select(); }
  });
  document.getElementById('sendReports').addEventListener('click', async () => {
    const out = document.getElementById('chkOut');
    out.textContent = 'Sending…';
    try { const r = await ask({ type: 'sendChecks' }, 30000); out.textContent = r?.ok ? `Sent ${r.sent} report(s).` : (r?.error ?? 'No answer.'); } catch (e) { out.textContent = e.message; }
    showChecks();
  });
  // A new report, a report sent, the server's answers: shown again (at most once every 2 s).
  let showTimer = null;
  chrome.storage.onChanged.addListener((ch) => { if (ch.checks) { clearTimeout(showTimer); showTimer = setTimeout(showChecks, 2000); } });
  document.getElementById('askServer').addEventListener('click', async () => {
    const out = document.getElementById('chkOut');
    out.textContent = 'Reading the server’s answers…';
    try { const r = await ask({ type: 'readFixes' }, 30000); out.textContent = r?.ok ? (r.error ? `Failed: ${r.error}` : 'Read.') : (r?.error ?? 'No answer.'); } catch (e) { out.textContent = e.message; }
    showChecks();
  });
  document.getElementById('clearReports').addEventListener('click', async () => { await ask({ type: 'clearChecks' }, 6000).catch(() => {}); showChecks(); });
})();
