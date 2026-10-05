// Ask the service worker and wait for its answer.
// Chrome's promise form of sendMessage resolves to undefined in Orion (Mac, 0.6.3): the message
// is delivered and the callback form returns the answer. One call, callback only, so a tick is never counted twice.
export function ask(msg) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 8000);
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
