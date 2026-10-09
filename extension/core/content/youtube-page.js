// Page world: reads YouTube's own player data so the extension checks the real channel and length,
// and who is signed in (every setting and list is kept per YouTube account).
(() => {
  let sent = '', who = '';
  setInterval(() => {
    const cfg = window.ytcfg;
    const loggedIn = cfg?.get?.('LOGGED_IN');
    if (typeof loggedIn === 'boolean') {
      const datasyncId = String(cfg.get('DATASYNC_ID') ?? '');
      if (`${loggedIn}|${datasyncId}` !== who) {
        who = `${loggedIn}|${datasyncId}`;
        window.postMessage({ kidtube: 'account', loggedIn, datasyncId }, '*');
      }
    }
    const pr = document.querySelector('#movie_player')?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
    const d = pr?.videoDetails;
    const v = new URL(location.href).searchParams.get('v');
    if (!d || d.videoId !== v || sent === v) return;
    sent = v;
    window.postMessage({ kidtube: 'details', videoId: d.videoId, channelId: d.channelId, lengthSeconds: Number(d.lengthSeconds) || 0, isLive: !!d.isLiveContent }, '*');
  }, 1000);
})();
