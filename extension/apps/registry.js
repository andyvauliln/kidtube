// The apps a profile can use: plain data, read by the background and by the pages. Every profile has one
// (account.app); its data lives in <app>/<folder>/ of the data repo, and the helper on the server picks its
// prompts by the same id (agent/config.json apps). An app's background part is listed in backgrounds.js.
//   page        the app's own page: YouTube shows it instead of YouTube (kid and parent mode)
//   parentPage  the app's parent screens (parent mode; the PIN page's settings open them at #settings)
//   home        a web address that is the app's screen (its content script draws it there): YouTube sends every page to it
//   modes       false: no parent and kid mode; opening the app always opens the header too (parent mode)
// None of page, parentPage, home: the app runs on YouTube itself in kid mode (KidTube).
export const APPS = {
  kidtube: {
    id: 'kidtube',
    label: 'KidTube (YouTube)',
    // The apps header: the tile's color and glyph (play, square), and one line in "Add an app".
    color: '#ff3b30', glyph: 'play', about: 'His own video list on YouTube, with time limits and a talking friend.',
    sites: ['youtube.com'],
    parentPage: 'apps/kidtube/parent/parent.html',
    // Context documents (parent mode → Context): context/<id>.md, written by the helper. Same list as agent/config.json apps.kidtube.contextDocs.
    contextDocs: ['kid', 'strategy', 'math', 'letters', 'world'],
  },
  // Instagram: the signed-in Instagram account's saved posts, with voice notes, and the server's posts agent
  // (agent/instagram.mjs) writing down what each queued video says. No parent or kid mode. Its screen is drawn
  // by its content script on www.instagram.com (home), so the page can read the saved posts with the
  // Instagram login; YouTube sends every page there.
  instagram: {
    id: 'instagram',
    label: 'Instagram (saved posts)',
    color: '#d62976', glyph: 'camera', about: 'Your saved posts: voice notes, and the AI writes down what each video says.',
    sites: ['instagram.com', 'facebook.com'],
    home: 'https://www.instagram.com/robots.txt?kidtube=app',
    modes: false,
    contextDocs: [],
  },
};
export const DEFAULT_APP = 'kidtube';
export const appOf = (account) => APPS[account?.app] ?? APPS[DEFAULT_APP];
// Where the app's own screen is: its home address, or its extension page. null: YouTube itself (KidTube).
export const appHome = (app) => app.home ?? (app.page ? chrome.runtime.getURL(app.page) : null);
// Apps renamed since: a profile of the old id now belongs to the new one (profiles.js migrateProfileKeys).
export const RENAMED = { blank: 'instagram' };
