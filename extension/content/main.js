// Page world: reads YouTube's own player data so the extension checks the real channel and length.
(() => {
  let sent = '';
  setInterval(() => {
    const pr = document.querySelector('#movie_player')?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
    const d = pr?.videoDetails;
    const v = new URL(location.href).searchParams.get('v');
    if (!d || d.videoId !== v || sent === v) return;
    sent = v;
    window.postMessage({ kidtube: 'details', videoId: d.videoId, channelId: d.channelId, lengthSeconds: Number(d.lengthSeconds) || 0, isLive: !!d.isLiveContent }, '*');
  }, 1000);
})();
