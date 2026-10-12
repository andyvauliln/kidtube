// How the app finds the saved posts in what Instagram's own Saved page receives (lib/reader.js): plain values, so a
// change on Instagram's side can be fixed with data. site/remote.json `instagram.reader` replaces any of them (the
// background reads it, core/background/remote.js); a value with a wrong shape is ignored and the default stays.
//   savedPath         where the app opens: Instagram's own Saved page of the account ({user})
//   savedMatch        words in a request's address, its name or its answer's top keys that mean "the saved posts"
//   collectionsMatch  the same for the collections and one collection's posts
//   cursorKeys        where an answer says the next page's position
//   moreKeys          where it says whether there is a next page
//   cursorVars        the request's own name for that position (to ask for the next page with the page's request)
//   api               also use Instagram's web API from the page (content/api.js) when the page itself gave nothing
export const READER_DEFAULTS = Object.freeze({
  savedPath: '/{user}/saved/all-posts/',
  savedMatch: ['saved'],
  collectionsMatch: ['collection'],
  cursorKeys: ['next_max_id', 'end_cursor', 'max_id'],
  moreKeys: ['more_available', 'has_next_page'],
  cursorVars: ['max_id', 'after', 'cursor'],
  api: true,
});

const WORD = /^[\w.:-]{1,60}$/;
const words = (v) => (Array.isArray(v) && v.length && v.length <= 12 && v.every((w) => typeof w === 'string' && WORD.test(w)) ? [...v] : null);

// The defaults with the remote values that have the right shape.
export function readerRules(remote) {
  const r = { ...READER_DEFAULTS };
  for (const k of Object.keys(READER_DEFAULTS)) r[k] = Array.isArray(r[k]) ? [...r[k]] : r[k];
  if (!remote || typeof remote !== 'object') return r;
  if (typeof remote.savedPath === 'string' && /^\/(?:[\w.-]+\/|\{user\}\/)*$/.test(remote.savedPath) && remote.savedPath.includes('{user}')) r.savedPath = remote.savedPath;
  for (const k of ['savedMatch', 'collectionsMatch', 'cursorKeys', 'moreKeys', 'cursorVars']) r[k] = words(remote[k]) ?? r[k];
  if (typeof remote.api === 'boolean') r.api = remote.api;
  return r;
}

export const savedPathOf = (rules, user) => rules.savedPath.replace('{user}', encodeURIComponent(user));
