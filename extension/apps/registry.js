// The apps a profile can use: plain data, read by the background and by the pages. Every profile has one
// (account.app); its data lives in <app>/<folder>/ of the data repo, and the helper on the server picks its
// prompts by the same id (agent/config.json apps). An app's background part is listed in backgrounds.js.
//   page        the app's own page: YouTube shows it instead of YouTube (kid and parent mode)
//   parentPage  the app's parent screens (parent mode; the PIN page's settings open them at #settings)
//   home        a web address that is the app's screen (its content script draws it there): YouTube sends every page to it
//   modes       false: no parent and kid mode; opening the app always opens the header too (parent mode)
//   account     the site whose signed-in account names the profile (SITES): the header's Connect on that site
//               connects it. One profile per account and app: KidTube per YouTube email, Instagram per username.
// None of page, parentPage, home: the app runs on YouTube itself in kid mode (KidTube).
export const APPS = {
  kidtube: {
    id: 'kidtube',
    label: 'KidTube (YouTube)',
    // The apps header: the tile's color and glyph (play, square), and one line in "Add an app".
    color: '#ff3b30', glyph: 'play', about: 'His own video list on YouTube, with time limits and a talking friend.',
    sites: ['youtube.com'],
    account: 'youtube',
    parentPage: 'apps/kidtube/parent/parent.html',
    // Context documents (parent mode → Context): context/<id>.md, written by the helper. Same list as agent/config.json apps.kidtube.contextDocs.
    contextDocs: ['kid', 'strategy', 'math', 'letters', 'world'],
  },
  // Instagram: the connected Instagram account's saved posts, with voice notes, and the server's posts agent
  // (agent/instagram.mjs) writing down what each queued video says. No parent or kid mode. Its screen is drawn
  // by its content script on www.instagram.com (home), so the page can read the saved posts with the
  // Instagram login; YouTube sends every page there.
  instagram: {
    id: 'instagram',
    label: 'Instagram (saved posts)',
    color: '#d62976', glyph: 'camera', about: 'Your saved posts: voice notes, and the AI writes down what each video says.',
    sites: ['instagram.com', 'facebook.com'],
    account: 'instagram',
    home: 'https://www.instagram.com/robots.txt?kidtube=app',
    modes: false,
    contextDocs: [],
  },
};
export const DEFAULT_APP = 'kidtube';
export const appOf = (account) => APPS[account?.app] ?? APPS[DEFAULT_APP];
// Where the app's own screen is: its home address, or its extension page. null: YouTube itself (KidTube).
export const appHome = (app) => app.home ?? (app.page ? chrome.runtime.getURL(app.page) : null);

// The sites whose signed-in account names a profile (an app's `account`). Its page reports the account
// (stored: YouTube's core/content/shell.js, Instagram's apps/instagram/content/app.js) and has the header's Connect.
//   by     what names the account: 'email' (YouTube: its email, or YouTube's id without one), 'username' (@name)
//   home   the plain site, with no app (the header's site tiles); null: the YouTube in use
export const SITES = {
  youtube: { id: 'youtube', label: 'YouTube', hosts: ['youtube.com'], stored: 'ytAccount', by: 'email', home: null, color: '#ff0033', glyph: 'youtube' },
  instagram: { id: 'instagram', label: 'Instagram', hosts: ['instagram.com'], stored: 'igAccount', by: 'username', home: 'https://www.instagram.com/', color: '#c13584', glyph: 'camera' },
};
export const siteOfHost = (host) => Object.values(SITES).find((x) => x.hosts.some((d) => host === d || String(host).endsWith(`.${d}`))) ?? null;
export const siteOfApp = (app) => SITES[app?.account] ?? SITES.youtube;
