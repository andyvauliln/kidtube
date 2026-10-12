// Instagram's background part: what the core (core/background/apps.js) asks the app of an Instagram profile.
// The saved posts come from the app's screen on instagram.com (content/app.js reads them with the Instagram login)
// and are kept here per profile (state key `ig`, lib/posts.js); sync.js puts them in the data repo for the agent.
import { APPS } from '../../registry.js';
import { emptyIg, duePosts } from '../lib/posts.js';
import { HANDLERS } from './handlers.js';
import { syncInstagram } from './sync.js';

export default {
  id: 'instagram',
  // ig: the saved posts, the collections, the notes and the handle requests.
  stateKeys: ['ig'],
  // igAudio: note recordings no model could write down here, waiting to go to GitHub for the agent ({ noteId: base64 WAV }).
  profileKeys: ['igAudio'],
  prepare(s) { s.ig ??= emptyIg(); },
  created(s) { s.ig = emptyIg(); },
  // Every YouTube page: the app's screen on instagram.com.
  guard: () => APPS.instagram.home,
  handlers: HANDLERS,
  sync: syncInstagram,
  // The header's AI line: the posts in the list that the posts agent has not done yet.
  aiView: (s) => ({ queued: duePosts(Object.values(s.ig.posts), s.data.handled?.posts ?? {}).length }),
  siteRules: () => ({ block: true, allowed: APPS.instagram.sites, ads: false }),
};
