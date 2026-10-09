// The apps a profile can use. Every profile has one (account.app); its data lives in <app>/<folder>/
// of the data repo, and the helper on the server picks its prompts by the same id (agent/config.json apps).
// KidTube is the only one so far: a new app adds an entry here and on the server.
export const APPS = {
  kidtube: {
    id: 'kidtube',
    label: 'KidTube (YouTube)',
    // The apps header: the tile's color and glyph (play, square), and one line in "Add an app".
    color: '#ff3b30', glyph: 'play', about: 'His own video list on YouTube, with time limits and a talking friend.',
    sites: ['youtube.com'],
    // Context documents (parent mode → Context): context/<id>.md, written by the helper. Same list as agent/config.json apps.kidtube.contextDocs.
    contextDocs: ['kid', 'strategy', 'math', 'letters', 'world'],
  },
  // A test app that does nothing: YouTube shows a white page (page), nothing is synced, the helper never runs.
  // Shows that a profile's app decides what the tablet does; parent mode still opens the parent screens.
  blank: {
    id: 'blank',
    label: 'Blank (test: a white page)',
    color: '#8e8e93', glyph: 'square', about: 'A test app: YouTube shows a white page.',
    sites: [],
    page: 'apps/blank/blank.html',
    sync: false,
    contextDocs: [],
  },
};
export const DEFAULT_APP = 'kidtube';
export const appOf = (account) => APPS[account?.app] ?? APPS[DEFAULT_APP];
