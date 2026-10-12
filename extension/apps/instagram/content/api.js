// Instagram's own web API, read from its page with the signed-in account (same origin, so the login cookies go
// along on every browser). A plain script: it sets globalThis.KidTubeIgApi for content/app.js.
// The answers are cut down to the fields apps/instagram/lib/posts.js parseMedia reads, so the messages stay small.
(() => {
  if (globalThis.KidTubeIgApi) return;
  const APP_ID = '936619743392459';   // Instagram's web app; its API refuses requests without it
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  class LoginNeeded extends Error {}
  const csrf = () => document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1] ?? '';

  // GET a path of the API. Throws LoginNeeded when Instagram wants a sign-in; waits and tries again on "slow down".
  async function get(path) {
    for (let i = 0; ; i++) {
      const r = await fetch(path, { credentials: 'include', headers: { 'X-IG-App-ID': APP_ID, 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': csrf() } });
      if (r.status === 429 && i < 3) { await wait(20000 * (i + 1)); continue; }
      if (r.status === 401 || r.status === 403 || /\/accounts\/login/.test(r.url)) throw new LoginNeeded('Sign in to Instagram first.');
      const j = await r.json().catch(() => null);
      if (!j) throw new LoginNeeded('Instagram did not answer with data: sign in to Instagram first.');
      if (j.require_login || j.message === 'login_required') throw new LoginNeeded('Sign in to Instagram first.');
      if (!r.ok || j.status === 'fail') throw new Error(`Instagram: ${j.message || `answered ${r.status}`}`);
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
  const page = (j) => ({ media: (j.items ?? []).map((i) => slim(i.media ?? i)).filter(Boolean), next: j.more_available && j.next_max_id ? String(j.next_max_id) : null });
  const q = (maxId) => (maxId ? `?max_id=${encodeURIComponent(maxId)}` : '');

  globalThis.KidTubeIgApi = {
    LoginNeeded,
    // The saved posts, newest saved first: { media, next }.
    saved: async (maxId) => page(await get(`/api/v1/feed/saved/posts/${q(maxId)}`)),
    // One collection's posts: { media, next }.
    collection: async (id, maxId) => page(await get(`/api/v1/feed/collection/${encodeURIComponent(id)}/posts/${q(maxId)}`)),
    // The account's own collections: [{ id, name, count }] (not "All posts" or saved audio).
    async collections() {
      const out = [];
      let maxId = null;
      for (let i = 0; i < 20; i++) {
        const types = encodeURIComponent(JSON.stringify(['ALL_MEDIA_AUTO_COLLECTION', 'MEDIA', 'PRODUCT_AUTO_COLLECTION']));
        const j = await get(`/api/v1/collections/list/?collection_types=${types}&include_public_only=0&get_cover_media_lists=false${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''}`);
        for (const c of j.items ?? []) {
          if (c.collection_type && c.collection_type !== 'MEDIA') continue;
          out.push({ id: String(c.collection_id), name: c.collection_name ?? '', count: c.collection_media_count ?? 0 });
        }
        if (!j.more_available || !j.next_max_id) break;
        maxId = j.next_max_id;
      }
      return out;
    },
    // The signed-in account: { username, id }; LoginNeeded when nobody is. Instagram's own Edit profile form names it;
    // without that, the account's info by the id in the ds_user_id cookie.
    async me() {
      const id = document.cookie.match(/(?:^|;\s*)ds_user_id=(\d+)/)?.[1] ?? null;
      let username = null;
      try { username = (await get('/api/v1/accounts/edit/web_form_data/')).form_data?.username ?? null; }
      catch (e) { if (e instanceof LoginNeeded || !id) throw e; }
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
