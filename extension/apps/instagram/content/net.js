// Instagram's page world (manifest: world "MAIN"): what Instagram's own page asks its servers, and the answers.
// The app's screen (content/app.js) gets what the answers hold for it (lib/reader.js classify, by the rules the
// screen sends: saved posts, a collection's posts, the collections, the next position), and can ask for the next page
// with the page's own request: the same request, the next position. (The reader runs only here: a browser injects a
// file once per page, so the screen's world does not get it too.) The requests
// themselves (with the page's tokens) stay here. A record of the last ones, without values (the address, the
// request's name, the status, the structure of the answer), goes into a report for the fix agent.
// Messages: window.postMessage with "kidtube-ig" (to the screen) and "kidtube-ig-cmd" (from it).
(() => {
  if (window.__kidtubeIgNet) return;
  window.__kidtubeIgNet = true;
  const R = globalThis.KidTubeIgReader;
  if (!R) return;
  const ORIGIN = location.origin;
  const post = (m) => window.postMessage({ 'kidtube-ig': true, ...m }, ORIGIN);
  let rules = null;
  const early = [];            // answers before the screen's rules came (the newest 10)
  const specs = new Map();     // record id → { url, method, headers, body }: only to send it again
  const record = [];           // the last requests, without values
  let n = 0;

  // A request of the page that may answer with data: same site, not a picture or a script.
  const interesting = (url) => {
    try {
      const u = new URL(url, ORIGIN);
      return u.origin === ORIGIN && /^\/(api|graphql|ajax)\b/.test(u.pathname);
    } catch { return false; }
  };
  const headersOf = (h) => {
    const out = {};
    try { if (h) for (const [k, v] of (h instanceof Headers ? h.entries() : Array.isArray(h) ? h : Object.entries(h))) out[k] = String(v); } catch {}
    return out;
  };
  const bodyText = (b) => {
    if (typeof b === 'string') return b;
    if (b instanceof URLSearchParams) return b.toString();
    if (b instanceof FormData) {
      const f = new URLSearchParams();
      for (const [k, v] of b.entries()) if (typeof v === 'string') f.append(k, v);
      return f.toString();
    }
    return null;
  };
  // What a request is, without values: its path, the names of its parameters, GraphQL's name and query id.
  function describe(spec) {
    const u = new URL(spec.url, ORIGIN);
    const form = spec.body ? new URLSearchParams(spec.body) : null;
    let vars = null;
    try { vars = JSON.parse(form?.get('variables') ?? u.searchParams.get('variables') ?? 'null'); } catch {}
    const colId = vars && typeof vars === 'object' ? String(vars.collection_id ?? vars.collectionId ?? vars.id ?? '') : '';
    return {
      method: String(spec.method ?? 'GET').toUpperCase(), path: u.pathname, params: [...u.searchParams.keys()].slice(0, 20),
      query: spec.headers?.['x-fb-friendly-name'] ?? spec.headers?.['X-FB-Friendly-Name'] ?? form?.get('fb_api_req_friendly_name') ?? null,
      docId: form?.get('doc_id') ?? u.searchParams.get('doc_id') ?? null,
      vars: vars && typeof vars === 'object' ? Object.keys(vars).slice(0, 20) : [],
      collectionId: /^\d{5,}$/.test(colId) ? colId : null,
    };
  }

  function seen(spec, status, type, text) {
    const meta = { id: ++n, at: new Date().toISOString(), ...describe(spec), status, type: String(type ?? '').split(';')[0], bytes: text?.length ?? 0 };
    const json = R.parseBody(text);
    if (json) {
      meta.shape = R.shape(json, 0, 8);
      meta.posts = R.findMedia(json).length;
      meta.collections = R.findCollections(json).length;
    }
    record.push(meta);
    record.splice(0, Math.max(0, record.length - 40));
    specs.set(meta.id, spec);
    for (const k of specs.keys()) { if (specs.size <= 40) break; specs.delete(k); }
    if (json && (meta.posts || meta.collections)) {
      if (rules) answer(meta, json, spec.tag);
      else { early.push([meta, json, spec.tag]); early.splice(0, Math.max(0, early.length - 10)); }
    }
    if (spec.tag) post({ type: 'replayed', tag: spec.tag, status, posts: meta.posts ?? 0 });
  }
  const savedPage = () => /^\/[\w.]+\/saved(\/|$)/.test(location.pathname);
  function answer(meta, json, tag) {
    const { shape, ...m } = meta;
    post({ type: 'answer', meta: m, found: R.classify(meta, json, rules, savedPage()), tag: tag ?? null });
  }

  // --- fetch and XMLHttpRequest, as the page uses them --------------------------------------------------------------
  const pageFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = pageFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
      if (interesting(url)) {
        const spec = { url, method: init?.method ?? input?.method ?? 'GET', headers: headersOf(init?.headers ?? input?.headers), body: bodyText(init?.body) };
        p.then((r) => r.clone().text().then((t) => seen(spec, r.status, r.headers.get('content-type'), t))).catch(() => {});
      }
    } catch {}
    return p;
  };
  const X = XMLHttpRequest.prototype;
  const { open, send, setRequestHeader } = X;
  X.open = function (method, url) {
    try { this.__kidtube = interesting(url) ? { url: String(url), method, headers: {}, body: null } : null; } catch { this.__kidtube = null; }
    return open.apply(this, arguments);
  };
  X.setRequestHeader = function (k, v) {
    if (this.__kidtube) this.__kidtube.headers[k] = String(v);
    return setRequestHeader.apply(this, arguments);
  };
  X.send = function (body) {
    const spec = this.__kidtube;
    if (spec) {
      spec.body = bodyText(body);
      this.addEventListener('load', () => {
        try {
          const text = this.responseType === '' || this.responseType === 'text' ? this.responseText
            : this.responseType === 'json' ? JSON.stringify(this.response) : null;
          if (text != null) seen(spec, this.status, this.getResponseHeader('content-type'), text);
        } catch {}
      });
    }
    return send.apply(this, arguments);
  };

  // --- what came with the page itself (Instagram puts the first data into the HTML) --------------------------------
  function pageData() {
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      const t = s.textContent ?? '';
      if (t.length < 200 || !/"(code|shortcode|collection_id)"/.test(t)) continue;
      seen({ url: location.pathname, method: 'PAGE', headers: { 'x-fb-friendly-name': '(the page itself)' }, body: null }, 200, 'application/json', t);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pageData, { once: true }); else pageData();

  // --- the screen's commands ----------------------------------------------------------------------------------------
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || !m || m['kidtube-ig-cmd'] !== true) return;
    if (m.cmd === 'rules') {
      rules = m.rules;
      for (const [meta, json, tag] of early.splice(0)) answer(meta, json, tag);
    }
    else if (m.cmd === 'record') post({ type: 'record', tag: m.tag, requests: record.map(({ id, ...r }) => r) });
    else if (m.cmd === 'replay') {
      // cursor null: the same request again (the newest page now).
      const was = specs.get(m.id);
      const spec = !was || was.method === 'PAGE' || !rules ? null : m.cursor == null ? { ...was } : R.withCursor(was, m.cursor, rules);
      if (!spec) {
        post({ type: 'replayed', tag: m.tag, error: !was ? 'The page’s request is gone.' : was.method === 'PAGE' ? 'It came with the page itself.' : 'The page’s request has no place for the next page.' });
        return;
      }
      spec.tag = m.tag;
      pageFetch(spec.url, { method: spec.method, headers: spec.headers, body: spec.body ?? undefined, credentials: 'include' })
        .then((r) => r.text().then((t) => seen(spec, r.status, r.headers.get('content-type'), t)))
        .catch((err) => post({ type: 'replayed', tag: m.tag, error: String(err?.message ?? err) }));
    }
  });
  document.documentElement?.setAttribute('data-kidtube-net', '1');
  post({ type: 'hello' });
})();
