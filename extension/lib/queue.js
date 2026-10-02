// Which queue items he can open right now (PLAN.md §3.2).
export function visibleVideos(queue, cfg, watched = {}) {
  const blocked = new Set(cfg.blockedChannelIds ?? []);
  const max = cfg.maxVideoDurationSeconds ?? 0;
  const out = [];
  const seen = new Set();
  for (const v of queue?.videos ?? []) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(v.videoId) || seen.has(v.videoId)) continue;
    if (watched[v.videoId] && !v.allowRewatch) continue;
    if (blocked.has(v.channelId)) continue;
    if (v.durationSeconds < (cfg.minVideoDurationSeconds ?? 0)) continue;
    if (max > 0 && v.durationSeconds > max) continue;
    seen.add(v.videoId);
    out.push(v);
    if (out.length >= (cfg.queueSize ?? 10)) break;
  }
  return out;
}

// Must-watch videos (⭐, `required` in the queue). config.requiredFirst:
//   "first": the others wait until every ⭐ video on the list is watched;
//   "mix":   one ⭐ video, then one free choice, then ⭐ again;
//   "off":   ⭐ is only a mark.
// watchedToday: { required, free } counts of videos finished today.
export function waitingIds(videos, cfg, watchedToday = { required: 0, free: 0 }) {
  const mode = cfg.requiredFirst ?? 'off';
  if (mode === 'off' || !videos.some((v) => v.required)) return new Set();
  if (mode === 'mix' && watchedToday.free < watchedToday.required) return new Set();
  return new Set(videos.filter((v) => !v.required).map((v) => v.videoId));
}
