// The apps a profile can use: plain data, read by the background and by the pages. Every profile has one
// (account.app); its data lives in <app>/<folder>/ of the data repo, and the helper on the server picks its
// prompts by the same id (agent/config.json apps). An app's background part is listed in backgrounds.js.
//   page        the app's own page: YouTube shows it instead of YouTube (kid and parent mode)
//   parentPage  the app's parent screens (parent mode; the PIN page's settings open them at #settings)
// Neither: the app runs on YouTube itself in kid mode (KidTube).
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
  // A test app that does nothing: YouTube shows a white page (page), nothing but profile.json is synced, the
  // helper never runs. Shows that a profile's app decides what the tablet does.
  blank: {
    id: 'blank',
    label: 'Blank (test: a white page)',
    color: '#8e8e93', glyph: 'square', about: 'A test app: YouTube shows a white page.',
    sites: [],
    page: 'apps/blank/blank.html',
    contextDocs: [],
  },
};
export const DEFAULT_APP = 'kidtube';
export const appOf = (account) => APPS[account?.app] ?? APPS[DEFAULT_APP];
