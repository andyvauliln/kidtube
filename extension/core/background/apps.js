// The background parts of the apps. main.js registers them (the list is in apps/backgrounds.js); the core asks
// the current profile's app for what only the app knows. A part is a plain object (all fields optional but id):
//   id            the app's id, as in apps/registry.js
//   stateKeys     storage keys of the app kept per profile and changed through withState()
//   profileKeys   more storage keys kept per profile (written outside withState)
//   fileKeys      storage keys that go into the settings file (the header's Save / Load)
//   prepare(s)    fills empty state keys with their defaults, before withState's fn runs
//   guard(s, tabId, c, href)   a YouTube page in the app (c: lib/youtube.js classifyUrl); returns a URL or null
//   view(s)       what the app's screens on YouTube need (the 'state' message)
//   handlers      { type: (msg, ctx) => answer } messages only this app handles; pageOnly: those only its pages may send
//   sync(ctx)     the app's files in the data repo; ctx { loc, token, data, status, acct }; false: the profile
//                 changed meanwhile, so nothing was kept
//   beforeSync(msg)   the 'sync' message from the app's own pages (KidTube: the notes held for Update go too)
//   siteRules(stored) { block, allowed, ads }: other websites closed, the domains still open, and ad servers blocked
//   created(s)    a new profile of the app (the header's Add app): its starting state
//   tabRemoved(s, tabId)
//   aiView(s)     what waits for the AI, for the header's notifications: { held, run, message, at, page, send } (notes the
//                 parent added that are not sent yet, the server's latest run, the page to act on) or { queued }
//   notes         the parent's notes not sent yet, for the header's list: { list(s) → [{ id, at, type, text, list,
//                 videoId, title, doc }], edit(s, id, text), drop(s, id), send(ids) } (Edit, Delete, Send on each)
//   questions     the parent's questions already sent: { list(s) → [{ id, text, about, state: waiting | answered | none,
//                 answer }], dismiss(s, id) } (the header's Question rows, Got it)
//   waiting(s)    true while the app waits for the server (a question, a run): the core syncs every minute then
//   checks        { start: [...], actions: { type: check } } what the app's start and messages must do
//                 (core/checks/README.md)
import { appOf } from '../../apps/registry.js';

const parts = {};

export function registerApps(list) {
  for (const p of list) {
    for (const type of Object.keys(p.handlers ?? {})) {
      const other = Object.values(parts).find((q) => q.handlers?.[type]);
      if (other) throw new Error(`${p.id} and ${other.id} both handle the message "${type}"`);
    }
    parts[p.id] = p;
  }
}

// The part of the profile's app (an unknown app: KidTube's, like appOf).
export const partOf = (account) => parts[appOf(account).id] ?? {};
export const allParts = () => Object.values(parts);
