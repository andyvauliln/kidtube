// A YouTube video id: 11 characters of [A-Za-z0-9_-].
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const isVideoId = (id) => VIDEO_ID.test(id ?? '');
export const thumbUrl = (videoId) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

// Classifies a URL the tab is about to show.
export function classifyUrl(href) {
  let u;
  try { u = new URL(href); } catch { return { kind: 'other' }; }
  if (!/^https?:$/.test(u.protocol)) return { kind: 'internal' };
  if (!/(^|\.)youtube\.com$/.test(u.hostname)) return { kind: 'external', host: u.hostname };
  const host = u.hostname;
  // Google's sign-in passes through accounts.youtube.com (SetSID) and YouTube's /signin handler: never sent
  // "home" (accounts.youtube.com/ is a 404 page), and never a host to send him back to.
  if (['accounts.youtube.com', 'consent.youtube.com'].includes(host) || /^\/(signin|ServiceLogin)$/.test(u.pathname)) return { kind: 'signin', host };
  if (u.pathname === '/' || u.pathname === '') return { kind: 'home', host };
  if (u.pathname === '/watch') {
    const videoId = u.searchParams.get('v');
    return isVideoId(videoId) ? { kind: 'watch', host, videoId } : { kind: 'other', host };
  }
  if (u.pathname.startsWith('/shorts/')) return { kind: 'shorts', host };
  if (u.pathname.startsWith('/results') || u.pathname.startsWith('/search')) return { kind: 'search', host };
  if (u.pathname.startsWith('/@') || u.pathname.startsWith('/channel/') || u.pathname.startsWith('/c/') || u.pathname.startsWith('/user/')) return { kind: 'channel', host };
  return { kind: 'other', host };
}

export const homeUrl = (host) => `https://${host || 'm.youtube.com'}/`;
export const watchUrl = (host, videoId) => `https://${host || 'm.youtube.com'}/watch?v=${videoId}`;
