// The Instagram app's reader (apps/instagram/lib/reader.js): the saved posts, collections and the next page's
// position in what Instagram's own page receives, by the rules of lib/rules.js (site/remote.json can change them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { READER_DEFAULTS, readerRules, savedPathOf } from '../../extension/apps/instagram/lib/rules.js';
import { parseMedia } from '../../extension/apps/instagram/lib/posts.js';

await import('../../extension/apps/instagram/lib/reader.js');
const R = globalThis.KidTubeIgReader;
const rules = readerRules();

const v1 = (pk, extra = {}) => ({ pk: String(pk), id: `${pk}_9`, code: `C${pk}`, media_type: 1, has_viewer_saved: true, user: { username: 'chef' },
  caption: { text: `Post ${pk}` }, image_versions2: { candidates: [{ url: `https://scontent.cdninstagram.com/v/${pk}.jpg`, width: 640 }] },
  saved_collection_ids: ['17900'], comments: [{ pk: '1', text: 'hi', next_max_id: 'comment-cursor' }], ...extra });

test('the web API’s saved page: its posts in order, the next position, "saved" from its address', () => {
  const json = { items: [{ media: v1(1) }, { media: v1(2, { media_type: 8, carousel_media: [v1(21), v1(22)] }) }], more_available: true, next_max_id: 'QVF-next', status: 'ok' };
  const found = R.classify({ path: '/api/v1/feed/saved/posts/' }, json, rules);
  assert.deepEqual(found.saved.map((m) => m.code), ['C1', 'C2'], 'a carousel’s items are not posts of their own');
  assert.equal(found.next, 'QVF-next', 'the page’s position, not a comment’s');
  assert.equal(parseMedia(found.saved[1]).items.length, 2);
  assert.deepEqual(R.findCursor({ ...json, more_available: false }, rules), { next: null, more: false });
});

test('GraphQL: the web API’s posts under data.xdt…, the position in page_info, "saved" from the answer’s keys', () => {
  const json = { data: { xdt_api__v1__feed__saved__posts__connection: { edges: [{ node: { media: v1(5) } }, { node: { media: v1(6) } }],
    page_info: { end_cursor: 'END-2', has_next_page: true } } }, extensions: {} };
  const found = R.classify({ path: '/graphql/query', query: 'PolarisSavedPostsGridQuery' }, json, rules);
  assert.deepEqual(found.saved.map((m) => m.code), ['C5', 'C6']);
  assert.equal(found.next, 'END-2');
  const last = structuredClone(json);
  last.data.xdt_api__v1__feed__saved__posts__connection.page_info = { end_cursor: 'END-3', has_next_page: false };
  assert.equal(R.classify({ path: '/graphql/query' }, last, rules).next, null, 'no next page');
});

test('GraphQL’s older posts (shortcode, display_url) become the web API’s form, which parseMedia reads', () => {
  const node = { __typename: 'GraphSidecar', id: '777', shortcode: 'Bxy', display_url: 'https://scontent.cdninstagram.com/v/a.jpg', dimensions: { width: 1080 },
    owner: { username: 'ann' }, taken_at_timestamp: 1790000000, edge_media_to_caption: { edges: [{ node: { text: 'Hello' } }] },
    edge_sidecar_to_children: { edges: [{ node: { is_video: true, video_url: 'https://scontent.cdninstagram.com/v/b.mp4', display_url: 'https://scontent.cdninstagram.com/v/b.jpg' } }] } };
  const [m] = R.findMedia({ data: { user: { edge_saved_media: { edges: [{ node }] } } } });
  const p = parseMedia(m);
  assert.deepEqual([p.id, p.code, p.kind, p.author, p.caption], ['777', 'Bxy', 'carousel', 'ann', 'Hello']);
  assert.equal(p.items[0].video, 'https://scontent.cdninstagram.com/v/b.mp4');
});

test('what is not the saved list: the home feed’s posts (has_viewer_saved is no proof), a collection’s, the collections', () => {
  const feed = { feed_items: [{ media_or_ad: v1(8, { has_viewer_saved: false }) }], next_max_id: 'x' };
  assert.equal(R.classify({ path: '/api/v1/feed/timeline/' }, feed, rules).saved, null);
  const allSaved = { items: [{ media: v1(9) }] };
  assert.equal(R.classify({ path: '/graphql/query', query: 'SomeGrid' }, allSaved, rules).saved, null, 'elsewhere: not saved');
  assert.equal(R.classify({ path: '/graphql/query', query: 'SomeGrid' }, allSaved, rules, true).saved.length, 1, 'on the Saved page, all saved: the saved list');
  const col = R.classify({ path: '/api/v1/feed/collection/17900/posts/' }, allSaved, rules);
  assert.deepEqual([col.saved, col.collection.id, col.collection.media.length], [null, '17900', 1]);
  const list = { items: [{ collection_id: '17900', collection_name: 'Recipes', collection_media_count: 4, collection_type: 'MEDIA' },
    { collection_id: '1', collection_name: 'All posts', collection_type: 'ALL_MEDIA_AUTO_COLLECTION' }] };
  assert.deepEqual(R.classify({ path: '/x' }, list, rules).collections, [{ id: '17900', name: 'Recipes', count: 4 }]);
});

test('the page’s request again for the next page: the web API’s max_id, GraphQL’s variables, nothing to change', () => {
  const get = R.withCursor({ url: '/api/v1/feed/saved/posts/', method: 'GET', headers: { 'x-ig-app-id': '1' } }, 'NEXT', rules);
  assert.equal(get.url, '/api/v1/feed/saved/posts/?max_id=NEXT');
  assert.deepEqual(get.headers, { 'x-ig-app-id': '1' }, 'the page’s own headers go again');
  const body = new URLSearchParams({ fb_dtsg: 'TOKEN', doc_id: '123', variables: JSON.stringify({ data: { count: 12, after: 'A' } }) }).toString();
  const gql = R.withCursor({ url: '/graphql/query', method: 'POST', body }, 'B', rules);
  const form = new URLSearchParams(gql.body);
  assert.deepEqual(JSON.parse(form.get('variables')), { data: { count: 12, after: 'B' } });
  assert.equal(form.get('fb_dtsg'), 'TOKEN');
  const firstPage = new URLSearchParams({ doc_id: '1', variables: JSON.stringify({ first: 12 }) }).toString();
  assert.deepEqual(JSON.parse(new URLSearchParams(R.withCursor({ url: '/graphql/query', method: 'POST', body: firstPage }, 'C', rules).body).get('variables')), { first: 12, after: 'C' });
  assert.equal(R.withCursor({ url: '/graphql/query', method: 'POST', body: 'doc_id=1' }, 'C', rules), null);
});

test('answers as Instagram sends them: "for (;;);" first, several JSON objects, not JSON', () => {
  assert.deepEqual(R.parseBody('for (;;);{"a":1}'), { a: 1 });
  assert.deepEqual(R.parseBody('{"a":1}\r\n{"b":2}'), [{ a: 1 }, { b: 2 }]);
  assert.equal(R.parseBody('<!DOCTYPE html>'), null);
  assert.deepEqual(R.shape({ items: [{ code: 'x', n: 1 }, {}], ok: null }), { items: [{ code: 'string', n: 'number' }, '×2'], ok: 'null' });
});

test('the rules: defaults; remote values with the right shape replace them, others are ignored; the Saved page’s address', () => {
  assert.deepEqual(readerRules(null), { ...READER_DEFAULTS });
  const r = readerRules({ savedMatch: ['saved', 'bookmarks'], cursorKeys: 'nope', moreKeys: ['ok', '<script>'], api: false, savedPath: '/{user}/saved/', extra: 1 });
  assert.deepEqual(r.savedMatch, ['saved', 'bookmarks']);
  assert.deepEqual(r.cursorKeys, READER_DEFAULTS.cursorKeys);
  assert.deepEqual(r.moreKeys, READER_DEFAULTS.moreKeys, 'one bad word: the whole list stays the default');
  assert.equal(r.api, false);
  assert.equal(savedPathOf(r, 'an_dreidel'), '/an_dreidel/saved/');
  assert.equal(readerRules({ savedPath: 'https://evil.example/{user}' }).savedPath, READER_DEFAULTS.savedPath);
  assert.equal(readerRules({ savedPath: '/accounts/' }).savedPath, READER_DEFAULTS.savedPath, 'it must name the account');
});

test('site/remote.json: schema 1, and its Instagram rules are the ones the code accepts', () => {
  const remote = JSON.parse(readFileSync('site/remote.json', 'utf8'));
  assert.equal(remote.schemaVersion, 1);
  assert.deepEqual(readerRules(remote.instagram.reader), Object.fromEntries(Object.entries(READER_DEFAULTS).map(([k, v]) => [k, remote.instagram.reader[k] ?? v])));
});
