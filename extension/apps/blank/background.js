// The blank test app's background part: YouTube shows its white page, in kid and in parent mode.
// Nothing to sync but profile.json (the core writes it); other websites stay closed.
import { APPS } from '../registry.js';

export default {
  id: 'blank',
  guard: () => chrome.runtime.getURL(APPS.blank.page),
};
