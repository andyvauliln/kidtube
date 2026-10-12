// The saved posts and their status: plain functions, used by the background (apps/instagram/background/) and by
// the posts agent on the server (agent/instagram.mjs), so both read a post's status the same way.
//
// A post (the tablet's state key `ig`, posts[id]):
//   id, code, kind ('video' | 'image' | 'carousel'), reel, author, caption, takenAt, thumb,
//   items [{ kind, src, video }]   the pictures and videos (a carousel has several)
//   collections [ids]               the Instagram collections it is in
//   notes [{ id, at, text, audio }] voice or typed notes; audio: 'notes/<id>.wav' while the agent still has to write it down
//   handle { at, why } | null       asked to be handled at `at` (why: 'asked', 'note', 'again')
//   seenAt, mediaAt                 first seen on this tablet; when its picture and video addresses were read
// What the agent did (handled.json from the data repo, posts[id]):
//   { at, request, notes: [noteIds], transcript: chars | 0, error, noteTexts: { noteId: text } }
//   request: the handle.at it worked on, so a newer request or note makes the post due again.

export const STATUS = {
  new: 'Not handled',
  queued: 'In the list',
  handled: 'Handled',
  failed: 'Failed',
};

// 'new' (never asked), 'queued' (asked, the agent has not done it yet), 'handled', 'failed'.
export function statusOf(post, done) {
  const at = post?.handle?.at ?? null;
  if (done && (!at || done.request >= at)) return done.error ? 'failed' : 'handled';
  return at ? 'queued' : 'new';
}

// The agent's work list: asked for and not done since (oldest request first).
export const duePosts = (posts, handled = {}) =>
  posts.filter((p) => statusOf(p, handled[p.id]) === 'queued').sort((a, b) => a.handle.at.localeCompare(b.handle.at));

export const postUrl = (p) => `https://www.instagram.com/${p.reel ? 'reel' : 'p'}/${p.code}/`;
export const videosOf = (p) => (p.items ?? []).map((i) => i.video).filter(Boolean);

// A post as Instagram's web API sends it (feed/saved, feed/collection, media/info) → our post, or null.
export function parseMedia(m) {
  if (!m || (m.pk == null && m.id == null) || !m.code) return null;
  const pick = (c, want) => {
    const list = (c ?? []).filter((x) => x?.url).sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
    return (list.find((x) => (x.width ?? 0) >= want) ?? list.at(-1))?.url ?? null;
  };
  const item = (x) => ({
    kind: x.media_type === 2 ? 'video' : 'image',
    src: pick(x.image_versions2?.candidates, 1080),
    video: x.media_type === 2 ? (x.video_versions ?? [])[0]?.url ?? null : null,
  });
  const items = m.media_type === 8 ? (m.carousel_media ?? []).map(item) : [item(m)];
  const first = m.media_type === 8 ? m.carousel_media?.[0] : m;
  return {
    id: String(m.pk ?? m.id).split('_')[0],
    code: String(m.code),
    kind: m.media_type === 2 ? 'video' : m.media_type === 8 ? 'carousel' : 'image',
    reel: m.product_type === 'clips',
    author: m.user?.username ?? m.owner?.username ?? '',
    caption: String(m.caption?.text ?? '').slice(0, 2200),
    takenAt: m.taken_at ? new Date(m.taken_at * 1000).toISOString() : null,
    duration: m.video_duration ?? null,
    thumb: pick(first?.image_versions2?.candidates, 320),
    items,
    collections: Array.isArray(m.saved_collection_ids) ? m.saved_collection_ids.map(String) : null,
  };
}

// A post from the page, checked: only the fields we keep, of the right types.
export function cleanPost(p) {
  if (!p || !/^\d+$/.test(String(p.id ?? '')) || !/^[\w-]+$/.test(String(p.code ?? ''))) return null;
  const url = (u) => (typeof u === 'string' && /^https:\/\/[^/]+\.(cdninstagram\.com|fbcdn\.net)\//.test(u) ? u : null);
  return {
    id: String(p.id), code: String(p.code),
    kind: ['video', 'image', 'carousel'].includes(p.kind) ? p.kind : 'image',
    reel: !!p.reel,
    author: String(p.author ?? '').slice(0, 60),
    caption: String(p.caption ?? '').slice(0, 2200),
    takenAt: typeof p.takenAt === 'string' ? p.takenAt : null,
    duration: Number.isFinite(p.duration) ? p.duration : null,
    thumb: url(p.thumb),
    items: (Array.isArray(p.items) ? p.items : []).slice(0, 20).map((i) => ({ kind: i?.kind === 'video' ? 'video' : 'image', src: url(i?.src), video: url(i?.video) })),
    collections: Array.isArray(p.collections) ? p.collections.map(String).slice(0, 50) : null,
  };
}

export const emptyIg = () => ({ posts: {}, order: [], collections: [], defaultCollection: 'all', loadedAt: null, complete: false, cursor: null, top: 0, rev: 0, pushedRev: 0 });

// One page of the saved list from Instagram. at: 'top' (newest first: unknown posts go in at the top, in the page's
// order; page 0 starts again from the top) or 'end' (the rest of the list, read once). Returns how many were new.
export function mergeSaved(ig, posts, { at = 'end', page = 0, now = new Date().toISOString() } = {}) {
  if (at === 'top' && page === 0) ig.top = 0;
  let added = 0;
  for (const raw of posts) {
    const p = cleanPost(raw);
    if (!p) continue;
    const old = ig.posts[p.id];
    if (old) {
      ig.posts[p.id] = { ...old, ...p, collections: p.collections ?? old.collections, mediaAt: now };
      continue;
    }
    ig.posts[p.id] = { ...p, collections: p.collections ?? [], notes: [], handle: null, seenAt: now, mediaAt: now };
    if (at === 'top') ig.order.splice(ig.top++, 0, p.id); else ig.order.push(p.id);
    added++;
  }
  if (added) ig.rev++;
  return added;
}

// One collection read from Instagram: its posts are in it (unknown ones join the list at its end); done with
// every id of the collection: the others leave it.
export function mergeCollection(ig, id, posts, { done = false, allIds = null, now } = {}) {
  id = String(id);
  const added = mergeSaved(ig, posts, { at: 'end', now });
  for (const raw of posts) {
    const p = ig.posts[String(raw?.id)];
    if (p && !p.collections.includes(id)) { p.collections = [...p.collections, id]; ig.rev++; }
  }
  if (done && Array.isArray(allIds)) {
    const keep = new Set(allIds.map(String));
    for (const p of Object.values(ig.posts)) {
      if (p.collections.includes(id) && !keep.has(p.id)) { p.collections = p.collections.filter((c) => c !== id); ig.rev++; }
    }
  }
  return added;
}

// The post as it goes to GitHub (posts.json): no picture addresses (they expire in days), the video addresses only
// while the agent still has to fetch them.
export function repoPost(p, done) {
  const due = statusOf(p, done) === 'queued';
  return {
    id: p.id, code: p.code, url: postUrl(p), kind: p.kind, reel: !!p.reel, author: p.author, caption: p.caption.slice(0, 500),
    takenAt: p.takenAt, duration: p.duration ?? null, collections: p.collections, notes: p.notes, handle: p.handle,
    ...(due ? { videos: videosOf(p), mediaAt: p.mediaAt } : {}),
  };
}

// A fresh tablet (or one whose storage was erased): the notes, the requests and the collections it had come back
// from posts.json. Only posts the tablet doesn't have yet; their pictures come with the next read from Instagram.
export function restoreFromRepo(ig, file) {
  if (!Array.isArray(file?.posts)) return 0;
  let n = 0;
  for (const r of file.posts) {
    if (!r?.id || ig.posts[r.id]) continue;
    const p = cleanPost({ ...r, items: [] });
    if (!p) continue;
    ig.posts[p.id] = { ...p, collections: p.collections ?? [], notes: Array.isArray(r.notes) ? r.notes : [], handle: r.handle ?? null, seenAt: r.seenAt ?? null, mediaAt: null };
    ig.order.push(p.id);
    n++;
  }
  if (Array.isArray(file.collections) && !ig.collections.length) ig.collections = file.collections;
  if (file.defaultCollection) ig.defaultCollection = String(file.defaultCollection);
  return n;
}
