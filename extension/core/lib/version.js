// Version numbers "major.minor.patch": negative when a < b, 0 when equal, positive when a > b.
// Shared by the service worker (updates) and the release tools (build/build-orion.mjs).
export function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}
