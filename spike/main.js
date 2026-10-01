// M0 probe, MAIN world: proves a page-world script runs and can see YouTube's SPA navigation (C18 layer 2).
window.postMessage({ kidtubeSpike: 'main' }, '*');
const origPush = history.pushState;
history.pushState = function (state, title, url) {
  window.postMessage({ kidtubeSpike: 'pushState', url: String(url) }, '*');
  return origPush.apply(this, arguments);
};
