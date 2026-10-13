// Ask the service worker and wait for its answer: 8 s, or longer for the messages in WAIT.
// Chrome's promise form of sendMessage resolves to undefined in Orion (Mac, 0.6.3): the message
// is delivered and the callback form returns the answer. One call, callback only, so a tick is never counted twice.
// WAIT: messages that go to GitHub and back several times. ↻ Update (runHelper) sends the notes (a whole sync),
// then writes requests/run.json: 8–9 s on a slow tablet (0.12.2), so 8 s gave up on a run that was on its way.
// core/checks/runner.js waitOf reads the same table.
export const WAIT = { runHelper: 60000 };
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
