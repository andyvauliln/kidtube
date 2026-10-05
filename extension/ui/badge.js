import { ask } from '../lib/ask.js';
// In parent mode the badge leads back to the parent's screens.
document.body.addEventListener('click', () => ask({ type: 'openParent' }));
