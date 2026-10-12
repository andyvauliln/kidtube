// Finds what Instagram's own Saved page receives: the saved posts, the collections, and where the next page starts,
// in any answer (the web API's JSON or GraphQL's), by the rules of lib/rules.js (site/remote.json can change them).
// A plain script that sets globalThis.KidTubeIgReader: Instagram's page world loads it before content/net.js; the
// tests import it. It only reads what it is given.
(() => {
  if (globalThis.KidTubeIgReader) return;
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  // An answer's text → its JSON (GraphQL may put "for (;;);" first, or send several JSON objects, one per line).
  function parseBody(text) {
    const t = String(text ?? '').replace(/^\s*for\s*\(;;\);/, '').trim();
    if (!t || !/^[[{]/.test(t)) return null;
    try { return JSON.parse(t); } catch {}
    const parts = [];
    for (const line of t.split(/\r?\n/)) { try { if (line.trim()) parts.push(JSON.parse(line)); } catch { return null; } }
    return parts.length ? parts : null;
  }

  // The structure of a value without its values: keys and types, arrays as their first item and length.
  function shape(v, depth = 0, max = 4) {
    if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1, max), `×${v.length}`] : [];
    if (isObj(v)) {
      if (depth >= max) return `{${Object.keys(v).length} keys}`;
      return Object.fromEntries(Object.keys(v).slice(0, 25).map((k) => [k, shape(v[k], depth + 1, max)]));
    }
    return v === null ? 'null' : typeof v;
  }

  // Every object in v, breadth first (at most max). skip(o): true = do not look inside o.
  function each(v, fn, { skip = () => false, max = 50000 } = {}) {
    const queue = [v];
    for (let i = 0; i < queue.length && i < max; i++) {
      const x = queue[i];
      if (Array.isArray(x)) { for (const y of x) if (y && typeof y === 'object') queue.push(y); continue; }
      if (!isObj(x)) continue;
      if (fn(x) === false || skip(x)) continue;
      for (const y of Object.values(x)) if (y && typeof y === 'object') queue.push(y);
    }
  }

  // A post in the web API's form (code, pk, image_versions2), or GraphQL's older one (shortcode, display_url),
  // as the web API's form; null when o is not a post.
  const GRAPH_TYPE = { GraphImage: 1, GraphVideo: 2, GraphSidecar: 8, XDTGraphImage: 1, XDTGraphVideo: 2, XDTGraphSidecar: 8 };
  function asMedia(o) {
    if (!isObj(o)) return null;
    if (typeof o.code === 'string' && (o.pk != null || o.id != null) && (o.image_versions2 || o.carousel_media || o.video_versions || o.media_type != null)) return o;
    if (typeof o.shortcode === 'string' && o.id != null && (o.display_url || o.thumbnail_src || o.display_resources)) {
      const pics = (x) => ({ candidates: [...(x.display_resources ?? []).map((r) => ({ url: r.src, width: r.config_width })),
        ...(x.display_url ? [{ url: x.display_url, width: x.dimensions?.width ?? 1080 }] : [])].filter((c) => c.url) });
      const one = (x) => ({ media_type: x.is_video ? 2 : 1, image_versions2: pics(x), video_versions: x.video_url ? [{ url: x.video_url, width: x.dimensions?.width ?? 0 }] : [] });
      const type = GRAPH_TYPE[o.__typename] ?? (o.edge_sidecar_to_children ? 8 : o.is_video ? 2 : 1);
      return { ...one(o), media_type: type, pk: String(o.id), id: String(o.id), code: o.shortcode, product_type: o.product_type ?? null,
        taken_at: o.taken_at_timestamp ?? null, video_duration: o.video_duration ?? null, user: { username: o.owner?.username ?? '' },
        caption: { text: o.edge_media_to_caption?.edges?.[0]?.node?.text ?? '' },
        carousel_media: type === 8 ? (o.edge_sidecar_to_children?.edges ?? []).map((e) => one(e.node ?? {})) : undefined };
    }
    return null;
  }

  // The posts in an answer, in its order, each once (a carousel's items are not posts of their own).
  function findMedia(json) {
    const out = [], seen = new Set();
    each(json, (o) => {
      const m = asMedia(o);
      if (m && !seen.has(m.code)) { seen.add(m.code); out.push(m); }
    }, { skip: (o) => !!asMedia(o) });
    return out;
  }

  // The collections in an answer: [{ id, name, count }] ("All posts" and the saved audio are not collections).
  function findCollections(json) {
    const out = [], seen = new Set();
    each(json, (o) => {
      if (o.collection_id == null || typeof o.collection_name !== 'string') return;
      if (o.collection_type && o.collection_type !== 'MEDIA') return;
      const id = String(o.collection_id);
      if (!/^\d+$/.test(id) || seen.has(id)) return;
      seen.add(id);
      out.push({ id, name: o.collection_name, count: Number(o.collection_media_count ?? o.media_count ?? 0) || 0 });
    });
    return out;
  }

  // Where the next page starts: { next, more }. next null: the last page (or the answer does not say).
  function findCursor(json, rules) {
    let found = null;
    each(json, (o) => {
      if (found) return false;
      const k = rules.cursorKeys.find((c) => o[c] != null && o[c] !== '');
      const m = rules.moreKeys.find((c) => typeof o[c] === 'boolean');
      if (!k && !m) return;
      const more = m ? o[m] : true;
      found = { next: k && more ? String(o[k]) : null, more };
      return false;
    });
    return found ?? { next: null, more: false };
  }

  // The words of an answer: its top keys (three levels), to match the rules' words against. Not a post's own keys:
  // every post has has_viewer_saved, in the home feed too.
  function topKeys(json) {
    const keys = [];
    const walk = (v, d) => {
      if (d > 3 || !v || typeof v !== 'object' || asMedia(v)) return;
      for (const [k, x] of Object.entries(Array.isArray(v) ? { ...v.slice(0, 3) } : v)) { if (!/^\d+$/.test(k)) keys.push(k); walk(x, d + 1); }
    };
    walk(json, 0);
    return keys;
  }
  const matches = (meta, json, list) => {
    const text = [meta.path, meta.query, ...topKeys(json)].filter(Boolean).join(' ').toLowerCase();
    return list.some((w) => text.includes(w.toLowerCase()));
  };

  // What one answer holds for the app. meta: { path, query, collectionId } of its request (content/net.js);
  // savedPage: the request came on a Saved page. → { saved, collection: { id, media }, collections, next }.
  function classify(meta, json, rules, savedPage = false) {
    const media = findMedia(json);
    const collections = findCollections(json);
    const out = { saved: null, collection: null, collections: collections.length ? collections : null, next: null };
    if (!media.length) return out;
    out.next = findCursor(json, rules).next;
    const colId = meta.collectionId ?? String(meta.path ?? '').match(/\/collection\/(\d+)/)?.[1] ?? null;
    if (colId && matches(meta, json, rules.collectionsMatch)) out.collection = { id: String(colId), media };
    else if (matches(meta, json, rules.savedMatch) || (savedPage && media.every((m) => m.has_viewer_saved === true))) out.saved = media;
    return out;
  }

  // The page's request again, for the page that starts at cursor. spec: { url, method, headers, body } as the page
  // sent it. → a new spec, or null when the request has no place for a position.
  function withCursor(spec, cursor, rules) {
    if (!spec || cursor == null) return null;
    const url = new URL(spec.url, 'https://www.instagram.com');
    let changed = false;
    for (const k of rules.cursorVars) if (url.searchParams.has(k)) { url.searchParams.set(k, cursor); changed = true; }
    let body = spec.body ?? null;
    if (typeof body === 'string' && body) {
      const form = new URLSearchParams(body);
      for (const k of rules.cursorVars) if (form.has(k)) { form.set(k, cursor); changed = true; }
      if (form.has('variables')) {
        let vars = null;
        try { vars = JSON.parse(form.get('variables')); } catch {}
        if (isObj(vars)) {
          let set = false;
          each(vars, (o) => { for (const k of rules.cursorVars) if (k in o) { o[k] = cursor; set = true; } });
          // A GraphQL query with no position yet (the first page): the next one starts "after" it.
          if (!set && ('first' in vars || 'count' in vars)) { vars.after = cursor; set = true; }
          if (set) { form.set('variables', JSON.stringify(vars)); changed = true; }
        }
      }
      body = form.toString();
    } else if (String(spec.method ?? 'GET').toUpperCase() === 'GET' && !changed) {
      url.searchParams.set(rules.cursorVars[0], cursor);
      changed = true;
    }
    return changed ? { ...spec, url: url.pathname + url.search, body } : null;
  }

  globalThis.KidTubeIgReader = { parseBody, shape, asMedia, findMedia, findCollections, findCursor, classify, withCursor };
})();
