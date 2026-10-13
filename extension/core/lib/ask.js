// Ask the service worker and wait for its answer: 8 s, or longer for the messages in WAIT.
// Chrome's promise form of sendMessage resolves to undefined in Orion (Mac, 0.6.3): the message
// is delivered and the callback form returns the answer. One call, callback only, so a tick is never counted twice.
// WAIT: messages that go to GitHub and back several times. ↻ Update (runHelper) sends the notes (a whole sync),
// then writes requests/run.json: 8–9 s on a slow tablet (0.12.2), so 8 s gave up on a run that was on its way.
// sync (the parent page every 30 s while a run works, Settings → Update now) took 7–10.5 s there too (0.12.2).
// core/checks/runner.js waitOf reads the same table.
// inbox: the header's Send on a note does the same as ↻ Update (core/background/inbox.js); the header's own ask too.
// updateApp: asked by the device tools' device_update (agent/devices/mcp.mjs, 60 s), not a page; the browser's own
// update check took 10.5 s on a tablet (0.12.21).
export const WAIT = { runHelper: 60000, sync: 60000, inbox: 60000, updateApp: 60000 };
export function ask(msg, ms = WAIT[msg?.type] ?? 8000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { globalThis.KidTubeWatch?.noAnswer(msg, ms); resolve(undefined); }, ms);
    try {
      chrome.runtime.sendMessage(msg, (value) => {
        clearTimeout(timer);
        void chrome.runtime.lastError;
        resolve(value);
      });
    } catch {
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}
