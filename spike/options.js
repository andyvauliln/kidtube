const out = document.getElementById('out');
document.getElementById('ver').textContent = `v${chrome.runtime.getManifest().version} · id ${chrome.runtime.id} · ${navigator.userAgent}`;

async function render() {
  const { report = {} } = await chrome.storage.local.get('report');
  out.textContent = JSON.stringify(report, null, 2);
}

const commands = {
  updateCheck: () => chrome.runtime.sendMessage({ type: 'updateCheck' }),
  fetchGithub: () => chrome.runtime.sendMessage({ type: 'fetchGithub' }),
  allowlistOn: () => chrome.runtime.sendMessage({ type: 'allowlist', on: true }),
  allowlistOff: () => chrome.runtime.sendMessage({ type: 'allowlist', on: false }),
  incognito: () => chrome.runtime.sendMessage({ type: 'incognito' }),
  copy: () => navigator.clipboard.writeText(out.textContent),
  clear: () => chrome.storage.local.set({ report: {} }),
};

document.addEventListener('click', async (e) => {
  const cmd = e.target.dataset?.cmd;
  if (!cmd) return;
  e.target.disabled = true;
  try { await commands[cmd](); } finally { e.target.disabled = false; await render(); }
});
chrome.storage.onChanged.addListener(render);
render();
