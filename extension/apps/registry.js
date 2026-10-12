// The apps of Custom Apps (this extension): plain data, read by the background and by the pages. No app is the
// center: the core (extension/core) runs each one the same way, and the header lists them all. Every profile has one
// (account.app); its data lives in <app>/<folder>/ of the data repo, and the helper on the server picks its
// prompts by the same id (agent/config.json apps). An app's background part is listed in backgrounds.js.
//   page        the app's own page: YouTube shows it instead of YouTube (kid and parent mode)
//   parentPage  the app's parent screens (parent mode; the PIN page's settings open them at #settings)
//   home        a web address that is the app's screen (its content script draws it there): YouTube sends every page to it
//   modes       false: no parent and kid mode; opening the app always opens the header too (parent mode)
//   account     the site whose signed-in account names the profile (SITES): the header's Connect on that site
//               connects it. One profile per account and app: KidTube per YouTube email, Instagram per username.
// None of page, home: the app runs on its site itself (KidTube on YouTube, in kid mode); its parent screens are its own page.
export const APPS = {
  kidtube: {
    id: 'kidtube',
    label: 'KidTube (YouTube)',
    // The apps header: the tile's color and glyph (core/ui/header.js PATH), and one line about it.
    color: '#ff3b30', glyph: 'play', about: 'His own video list on YouTube, with time limits and a talking friend.',
    sites: ['youtube.com'],
    account: 'youtube',
    parentPage: 'apps/kidtube/parent/parent.html',
    // Context documents (parent mode → Context): context/<id>.md, written by the helper. Same list as agent/config.json apps.kidtube.contextDocs.
    contextDocs: ['kid', 'strategy', 'math', 'letters', 'world'],
  },
  // Instagram: the connected Instagram account's saved posts, with voice notes, and the server's posts agent
  // (agent/instagram.mjs) writing down what each queued video says. No parent or kid mode. Its screen is drawn
  // by its content script over Instagram's own Saved page of the account; home is a launch address that goes on
  // there (a light page of Instagram's: robots.txt). YouTube sends every page there.
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
// The app of a profile saved without one: the profiles from before there were apps were all KidTube's (their keys
// are the bare email, their data repo folders kidtube/<name>/). Not a default for anything new.
export const DEFAULT_APP = 'kidtube';
export const appOf = (account) => APPS[account?.app] ?? APPS[DEFAULT_APP];
// Where the app's own screen is: its home address, or its extension page. null: YouTube itself (KidTube).
export const appHome = (app) => app.home ?? (app.page ? chrome.runtime.getURL(app.page) : null);

// The sites whose signed-in account names a profile (an app's `account`). Its page reports the account
// (stored: YouTube's core/content/shell.js, Instagram's apps/instagram/content/app.js) and has the header's Connect.
//   by     what names the account: 'email' (YouTube: its email, or YouTube's id without one), 'username' (@name)
//   home   the plain site, with no app (the site side of the header's App | site switch); null: the YouTube in use
export const SITES = {
  youtube: { id: 'youtube', label: 'YouTube', hosts: ['youtube.com'], stored: 'ytAccount', by: 'email', home: null },
  instagram: { id: 'instagram', label: 'Instagram', hosts: ['instagram.com'], stored: 'igAccount', by: 'username', home: 'https://www.instagram.com/' },
};
export const siteOfHost = (host) => Object.values(SITES).find((x) => x.hosts.some((d) => host === d || String(host).endsWith(`.${d}`))) ?? null;
export const siteOfApp = (app) => SITES[app?.account] ?? SITES.youtube;
