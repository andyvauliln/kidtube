// A small Notion REST client (API version 2026-03-11: databases hold data sources; pages can be
// read and written as Markdown). Waits between calls to stay under Notion's ~3 requests a second.
const API = 'https://api.notion.com/v1';
const VERSION = '2026-03-11';

export function createNotion({ token, log = console.log, fetchImpl = fetch }) {
  let last = 0;
  async function call(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const wait = last + 350 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      const r = await fetchImpl(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60000),
      });
      if ((r.status === 429 || r.status >= 500) && attempt < 4) {
        await new Promise((res) => setTimeout(res, (Number(r.headers.get('retry-after')) || 2 ** attempt) * 1000));
        continue;
      }
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        const err = new Error(`Notion ${method} ${path.split('?')[0]}: ${json.message ?? `HTTP ${r.status}`}`);
        err.status = r.status;
        err.code = json.code;
        throw err;
      }
      return json;
    }
  }

  return {
    call,
    page: (id) => call('GET', `/pages/${id}`),
    markdown: async (id) => (await call('GET', `/pages/${id}/markdown`)).markdown ?? '',
    setMarkdown: (id, md) => call('PATCH', `/pages/${id}/markdown`, { type: 'replace_content', replace_content: { new_str: md, allow_deleting_content: true } }),
    addMarkdown: (id, md, where = 'end') => call('PATCH', `/pages/${id}/markdown`, { type: 'insert_content', insert_content: { content: md, position: { type: where } } }),
    createPage: ({ parentPage, dataSource, title, properties = {}, markdown, icon }) => call('POST', '/pages', {
      parent: dataSource ? { type: 'data_source_id', data_source_id: dataSource } : { type: 'page_id', page_id: parentPage },
      properties: dataSource ? properties : { title: { title: rich(title) } },
      ...(icon ? { icon: { type: 'emoji', emoji: icon } } : {}),
      ...(markdown ? { markdown } : {}),
    }),
    updatePage: (id, properties) => call('PATCH', `/pages/${id}`, { properties }),
    async createDatabase({ parentPage, title, properties, icon }) {
      const db = await call('POST', '/databases', {
        parent: { type: 'page_id', page_id: parentPage }, title: rich(title), is_inline: false,
        ...(icon ? { icon: { type: 'emoji', emoji: icon } } : {}),
        initial_data_source: { properties },
      });
      return { databaseId: db.id, dataSourceId: db.data_sources?.[0]?.id };
    },
    updateDataSource: (id, properties) => call('PATCH', `/data_sources/${id}`, { properties }),
    createView: (body) => call('POST', '/views', body),
    async query(dataSource, filter) {
      const out = [];
      let cursor;
      do {
        const r = await call('POST', `/data_sources/${dataSource}/query`, { page_size: 100, ...(filter ? { filter } : {}), ...(cursor ? { start_cursor: cursor } : {}) });
        out.push(...r.results);
        cursor = r.has_more ? r.next_cursor : null;
      } while (cursor);
      return out;
    },
    async comments(blockId) {
      try {
        const r = await call('GET', `/comments?block_id=${blockId}&page_size=100`);
        return r.results.map((c) => ({ id: c.id, at: c.created_time, text: plain(c.rich_text) }));
      } catch (e) {
        if (e.status === 403) return null; // the connection may not have "Read comments"
        throw e;
      }
    },
  };
}

// --- property helpers ---------------------------------------------------------------------------

export const rich = (text) => chunks(String(text ?? ''), 1900).map((content) => ({ type: 'text', text: { content } }));
const chunks = (s, n) => (s ? s.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g')) : []);
export const plain = (arr) => (arr ?? []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');

export const prop = {
  title: (t) => ({ title: rich(t).slice(0, 1) }),
  text: (t) => ({ rich_text: rich(String(t ?? '').slice(0, 1900)) }),
  select: (name) => ({ select: name ? { name } : null }),
  multi: (names) => ({ multi_select: [...new Set(names ?? [])].slice(0, 10).map((name) => ({ name: String(name).replace(/,/g, ' ').slice(0, 90) })) }),
  date: (d) => ({ date: d ? { start: d } : null }),
  number: (n) => ({ number: Number.isFinite(n) ? n : null }),
  check: (b) => ({ checkbox: !!b }),
  url: (u) => ({ url: u || null }),
};

export function readProp(p) {
  if (!p) return undefined;
  switch (p.type) {
    case 'title': return plain(p.title);
    case 'rich_text': return plain(p.rich_text);
    case 'select': return p.select?.name ?? null;
    case 'multi_select': return p.multi_select.map((x) => x.name);
    case 'checkbox': return p.checkbox;
    case 'date': return p.date?.start ?? null;
    case 'number': return p.number;
    case 'url': return p.url;
    default: return undefined;
  }
}

// Notion-flavoured Markdown: escape what would turn into formatting.
export const esc = (s) => String(s ?? '').replace(/([\\*~`$[\]<>{}|^])/g, '\\$1');
