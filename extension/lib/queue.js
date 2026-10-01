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
