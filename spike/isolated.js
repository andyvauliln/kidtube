// M0 probe, ISOLATED world: proves the content script runs, the iframe overlay works, and how fullscreen behaves.
chrome.runtime.sendMessage({ type: 'content', world: 'isolated' });

window.addEventListener('message', (e) => {
  if (e.source === window && e.data?.kidtubeSpike === 'pushState') chrome.runtime.sendMessage({ type: 'pushState', url: e.data.url });
  if (e.source === window && e.data?.kidtubeSpike === 'main') chrome.runtime.sendMessage({ type: 'content', world: 'main' });
});

let frame;
function mountFrame() {
  if (frame?.isConnected) return;
  frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('frame.html');
  frame.style.cssText = 'position:fixed;right:8px;bottom:8px;width:220px;height:64px;border:0;z-index:2147483647;border-radius:12px;box-shadow:0 2px 8px #0006';
  document.documentElement.appendChild(frame);
}
document.addEventListener('DOMContentLoaded', mountFrame);
new MutationObserver(mountFrame).observe(document.documentElement, { childList: true });

document.addEventListener('fullscreenchange', () => {
  const on = !!document.fullscreenElement;
  // An element outside the fullscreen element is not rendered; record whether our frame is inside it.
  const frameVisible = !on || document.fullscreenElement.contains(frame);
  chrome.runtime.sendMessage({ type: 'fullscreen', on, frameVisible });
});
