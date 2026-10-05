// The parent's changes to the plan made on the tablet (parent mode): they work here at once, and go to the
// helper as `plan` events in the activity log. Once the helper has read them (memory.json processedThrough)
// its own files already include them and they are dropped here.
//
// planLog: { events: [{ eventId, at, action, videoId, value? }], entries: { videoId: queue entry }, items: { quizId: item } }
//   today     move a planned video onto today's list (it is approved too)
//   notToday  take it off today's list; it goes back to the planned ones
//   drop      remove it for good (helper status "no")
//   restore   undo drop
//   required  value true|false: must watch (⭐)
//   approve   value true|false
export const PLAN_ACTIONS = ['today', 'notToday', 'drop', 'restore', 'required', 'approve'];

const byTime = (a, b) => a.at.localeCompare(b.at);

// Today's queue with the parent's changes.
export function applyPlan(queue, plan) {
  const events = [...(plan?.events ?? [])].sort(byTime);
  if (!events.length) return queue;
  const videos = queue.videos.map((v) => ({ ...v }));
  let upcoming = [...(queue.upcoming ?? [])];
  const without = (id) => { upcoming = upcoming.filter((u) => u.videoId !== id); };
  for (const e of events) {
    const i = videos.findIndex((v) => v.videoId === e.videoId);
    if (e.action === 'today') {
      if (i < 0) {
        const entry = plan.entries?.[e.videoId] ?? { videoId: e.videoId, title: upcoming.find((u) => u.videoId === e.videoId)?.title || 'Video' };
        videos.push({ ...entry });
      }
      without(e.videoId);
    } else if (e.action === 'notToday') {
      if (i >= 0) { const [v] = videos.splice(i, 1); without(v.videoId); upcoming.unshift({ videoId: v.videoId, title: v.title }); }
    } else if (e.action === 'drop') {
      if (i >= 0) videos.splice(i, 1);
      without(e.videoId);
    } else if (e.action === 'restore') {
      if (i < 0 && !upcoming.some((u) => u.videoId === e.videoId)) upcoming.push({ videoId: e.videoId, title: plan.entries?.[e.videoId]?.title ?? '' });
    } else if (e.action === 'required' && i >= 0) {
      if (e.value) videos[i].required = true;
      else delete videos[i].required;
    }
  }
  return { ...queue, videos, upcoming };
}

// One video record { status, approved, required } after a plan event (the helper does the same in agent/lib/plan.mjs).
export function applyPlanEvent(r, e) {
  const back = () => (r.approved ? 'planned' : 'idea');
  if (e.action === 'today') { r.approved = true; r.status = 'today'; }
  else if (e.action === 'notToday') { if (r.status === 'today') r.status = back(); }
  else if (e.action === 'drop') r.status = 'no';
  else if (e.action === 'restore') { if (r.status === 'no') r.status = back(); }
  else if (e.action === 'required') r.required = e.value ? (r.required === 'today' ? 'today' : 'yes') : null;
  else if (e.action === 'approve') {
    r.approved = !!e.value;
    if (r.approved && r.status === 'idea') r.status = 'planned';
    if (!r.approved && r.status === 'planned') r.status = 'idea';
  }
  return r;
}

// Events the helper hasn't read yet. Without memory.json (no helper) everything is kept.
export function pendingPlan(plan, processedThrough) {
  const events = (plan?.events ?? []).filter((e) => !processedThrough || e.at > processedThrough).slice(-300);
  const ids = new Set(events.map((e) => e.videoId));
  const keep = (m) => Object.fromEntries(Object.entries(m ?? {}).filter(([id]) => ids.has(id)));
  const entries = keep(plan?.entries);
  const quiz = new Set(Object.values(entries).flatMap((v) => v.quizIds ?? []));
  return { events, entries, items: Object.fromEntries(Object.entries(plan?.items ?? {}).filter(([q]) => quiz.has(q))) };
}

// A queue entry for a planned video, made from the helper's record in memory.json.
export function entryFromRecord(videoId, v) {
  const c = v.content ?? {};
  return {
    videoId, title: String(v.title ?? 'Video').slice(0, 200), ...(v.channelId ? { channelId: v.channelId } : {}),
    ...(v.channelTitle ? { channelTitle: v.channelTitle } : {}), durationSeconds: v.durationSeconds || 0,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, addedAt: v.addedAt ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    ...(v.lang && v.lang !== 'en' ? { lang: v.lang } : {}), ...(v.required ? { required: true } : {}),
    ...(c.intro ? { intro: { text: c.intro } } : {}), ...(c.outro ? { outro: { text: c.outro } } : {}),
    ...(c.quizIds?.length ? { quizIds: c.quizIds } : {}), ...(v.why ? { note: String(v.why).slice(0, 500) } : {}),
  };
}
