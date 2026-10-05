// On KidTube's own install page: keeps a copy of the connection (data repo, GitHub token, parent PIN)
// in this site's storage. Removing the extension erases its own storage but not this, so a new
// install (Orion updates are remove + install) takes the copy back from here.
(async () => {
  const KEY = 'kidtube-settings-backup';
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  let r;
  try { r = await chrome.runtime.sendMessage({ type: 'settingsBackup', saved }); } catch { return; }
  if (r?.backup) try { localStorage.setItem(KEY, JSON.stringify(r.backup)); } catch {}
  if (r?.restored) {
    const b = document.createElement('div');
    b.textContent = '✓ KidTube: your GitHub connection and parent PIN are back. You can close this page.';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99;padding:12px 16px;background:#2e7d32;color:#fff;font:600 16px system-ui;text-align:center';
    document.documentElement.append(b);
  }
})();
