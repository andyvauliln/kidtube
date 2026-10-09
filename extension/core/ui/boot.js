// Loaded before parent.js (a plain script): if the parent screens fail to start, show why on the page
// instead of a white page — the iPad has no developer console. parent.js sets window.kidtubeParentReady.
(() => {
  const show = (text) => {
    let box = document.getElementById('bootErr');
    if (!box) {
      box = document.createElement('pre');
      box.id = 'bootErr';
      box.style.cssText = 'white-space:pre-wrap;margin:16px;padding:12px;border-radius:10px;background:#fdecea;color:#b71c1c;font:13px/1.4 ui-monospace,monospace';
      (document.body || document.documentElement).append(box);
    }
    box.textContent += text + '\n';
  };
  addEventListener('error', (e) => show(`Error: ${e.message || e.target?.src || e.type} ${e.filename ? `(${e.filename.split('/').slice(-2).join('/')}:${e.lineno}:${e.colno})` : ''}`), true);
  addEventListener('unhandledrejection', (e) => show(`Error (async): ${e.reason?.message ?? e.reason} ${e.reason?.stack?.split('\n')[0] ?? ''}`));
  setTimeout(() => {
    if (window.kidtubeParentReady) return;
    show(`The parent screens did not start (KidTube ${chrome?.runtime?.getManifest?.().version ?? '?'}, ${navigator.userAgent}).\nPlease send a screenshot of this box.`);
  }, 6000);
})();
