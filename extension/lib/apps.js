// The apps a profile can use. Every profile has one (account.app); its data lives in <app>/<folder>/
// of the data repo, and the helper on the server picks its prompts by the same id (agent/config.json apps).
// KidTube is the only one so far: a new app adds an entry here and on the server.
export const APPS = {
  kidtube: {
    id: 'kidtube',
    label: 'KidTube (YouTube)',
    sites: ['youtube.com'],
    // Context documents (parent mode → Context): context/<id>.md, written by the helper. Same list as agent/config.json apps.kidtube.contextDocs.
    contextDocs: ['kid', 'strategy', 'math', 'letters', 'world'],
  },
};
export const DEFAULT_APP = 'kidtube';
export const appOf = (account) => APPS[account?.app] ?? APPS[DEFAULT_APP];
