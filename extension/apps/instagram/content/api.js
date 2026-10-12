// Instagram's own web API, read from its page with the signed-in account (same origin, so the login cookies go
// along on every browser). A plain script: it sets globalThis.KidTubeIgApi for content/app.js.
// The answers are cut down to the fields apps/instagram/lib/posts.js parseMedia reads, so the messages stay small.
(() => {
  if (globalThis.KidTubeIgApi) return;
  const APP_ID = '936619743392459';   // Instagram's web app; its API refuses requests without it
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // detail: what Instagram answered (the call, the status, its own words), shown on the screen.
  class LoginNeeded extends Error { constructor(message, detail = '') { super(message); this.detail = detail; } }
  const csrf = () => document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1] ?? '';

  // GET a path of the API. Throws LoginNeeded when Instagram wants a sign-in; waits and tries again on "slow down".
  // Instagram also says require_login (with "Please wait a few minutes") when it limits a signed-in account, so the
  // caller decides what a LoginNeeded means: KidTubeIgApi.me() tells whether anybody is signed in.
  async function get(path) {
    for (let i = 0; ; i++) {
      const r = await fetch(path, { credentials: 'include', headers: { 'X-IG-App-ID': APP_ID, 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': csrf() } });
      if (r.status === 429 && i < 3) { await wait(20000 * (i + 1)); continue; }
      const text = await r.text().catch(() => '');
      let j = null;
      try { j = JSON.parse(text); } catch {}
      const toLogin = /\/accounts\/login/.test(r.url);
      const said = `${path.split('?')[0]} → ${toLogin ? 'the sign-in page' : r.status}${j?.message ? `: ${j.message}` : j || toLogin ? '' : `, not data: ${text.replace(/\s+/g, ' ').slice(0, 80)}`}`;
      if (toLogin || j?.require_login || j?.message === 'login_required') throw new LoginNeeded('Sign in to Instagram first.', said);
      if ((r.status === 401 || r.status === 403) && !j) throw new LoginNeeded('Sign in to Instagram first.', said);
      if (!j || !r.ok || j.status === 'fail') throw Object.assign(new Error(`Instagram refused ${said}`), { status: r.status });
      return j;
    }
  }

  const slimItem = (x) => x && ({
    media_type: x.media_type,
    image_versions2: { candidates: (x.image_versions2?.candidates ?? []).map((c) => ({ url: c.url, width: c.width })) },
    video_versions: (x.video_versions ?? []).slice(0, 1).map((v) => ({ url: v.url, width: v.width })),
  });
  const slim = (m) => m && ({
    ...slimItem(m), pk: m.pk, id: m.id, code: m.code, product_type: m.product_type, taken_at: m.taken_at, video_duration: m.video_duration,
    user: { username: m.user?.username ?? m.owner?.username }, caption: { text: m.caption?.text ?? '' },
    saved_collection_ids: m.saved_collection_ids, carousel_media: m.carousel_media?.map(slimItem),
  });
  async function collectionsBy(url) {
    const out = [];
    let maxId = null;
    for (let i = 0; i < 20; i++) {
      const j = await get(url(maxId));
      for (const c of j.items ?? []) {
        if (c.collection_type && c.collection_type !== 'MEDIA') continue;
        out.push({ id: String(c.collection_id), name: c.collection_name ?? '', count: c.collection_media_count ?? 0 });
      }
      if (!j.more_available || !j.next_max_id) break;
      maxId = j.next_max_id;
    }
    return out;
  }
  const page = (j) => ({ media: (j.items ?? []).map((i) => slim(i.media ?? i)).filter(Boolean), next: j.more_available && j.next_max_id ? String(j.next_max_id) : null });
  const q = (maxId) => (maxId ? `?max_id=${encodeURIComponent(maxId)}` : '');

  globalThis.KidTubeIgApi = {
    LoginNeeded,
    // A post cut down to what lib/posts.js parseMedia reads (also for posts found in the page's own answers).
    slim,
    // The saved posts, newest saved first: { media, next }.
    saved: async (maxId) => page(await get(`/api/v1/feed/saved/posts/${q(maxId)}`)),
    // One collection's posts: { media, next }.
    collection: async (id, maxId) => page(await get(`/api/v1/feed/collection/${encodeURIComponent(id)}/posts/${q(maxId)}`)),
    // The account's own collections: [{ id, name, count }] (not "All posts" or saved audio). Instagram's web app has
    // asked for them in more than one way; a 404 (the way is gone) tries the next one.
    async collections() {
      const types = encodeURIComponent(JSON.stringify(['ALL_MEDIA_AUTO_COLLECTION', 'MEDIA', 'AUDIO_AUTO_COLLECTION']));
      const ways = [
        (maxId) => `/api/v1/collections/list/?collection_types=${types}&include_public_only=0&get_cover_media_lists=true&max_id=${encodeURIComponent(maxId ?? '')}`,
        (maxId) => `/api/v1/collections/list/${maxId ? `?max_id=${encodeURIComponent(maxId)}` : ''}`,
      ];
      for (const [n, way] of ways.entries()) {
        try { return await collectionsBy(way); } catch (e) { if (e.status !== 404 || n === ways.length - 1) throw e; }
      }
    },
    // The signed-in account: { username, id }; LoginNeeded when nobody is. Instagram's own Edit profile form names it;
    // without that, the account's info by the id in the ds_user_id cookie.
    async me() {
      const id = document.cookie.match(/(?:^|;\s*)ds_user_id=(\d+)/)?.[1] ?? null;
      let username = null;
      try { username = (await get('/api/v1/accounts/edit/web_form_data/')).form_data?.username ?? null; }
      catch (e) { if (!id) throw e; }
      if (!username && id) username = (await get(`/api/v1/users/${encodeURIComponent(id)}/info/`)).user?.username ?? null;
      return { username: username ? String(username).toLowerCase() : null, id };
    },
    // One post again, with fresh picture and video addresses (they expire after some days).
    async media(id) {
      const j = await get(`/api/v1/media/${encodeURIComponent(id)}/info/`);
      return slim(j.items?.[0]) ?? null;
    },
  };
})();
