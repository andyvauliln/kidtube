// GitHub's contents API for the private data repo: read and write one JSON file at a time.
// loc = { repo: 'owner/name', base: 'kidtube/<folder>/' }: where the current profile's files are.
// No state here: the service worker (core/background/sync.js and the apps' sync) decides what to read and when.

export function ghHeaders(token, accept = 'application/vnd.github.raw+json') {
  const h = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export const contentsUrl = (loc, path) => `https://api.github.com/repos/${loc.repo}/contents/${loc.base ?? ''}${path}`;

// GitHub says 404 both for "no such file" and "this token can't see the repo". Tell them apart.
export async function explainHttp(status, loc, token, path) {
  const repo = loc.repo;
  if (status === 401) return 'GitHub says the token is wrong or expired. Make a new one and paste it again.';
  if (status === 403) return `GitHub refused the token for ${repo}. Check the token's Contents permission.`;
  if (status !== 404) return `${path}: GitHub answered ${status}.`;
  if (!token) return `${repo} is private and there is no token yet. Using the built-in list.`;
  const who = await fetch('https://api.github.com/user', { headers: ghHeaders(token, 'application/vnd.github+json') });
  if (who.status === 401) return 'GitHub says the token is wrong or expired. Make a new one and paste it again.';
  const login = who.ok ? (await who.json()).login : null;
  const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers: ghHeaders(token, 'application/vnd.github+json') });
  if (repoRes.status === 404) {
    return `The token${login ? ` (${login})` : ''} works but can't see ${repo}. On GitHub, edit the token: Repository access → Only select repositories → ${repo.split('/')[1]}.`;
  }
  return `${loc.base ?? ''}${path} is missing in ${repo}.`;
}

// Reads a JSON file with its sha (null when it doesn't exist yet).
export async function getRepoFile(loc, token, path) {
  const r = await fetch(contentsUrl(loc, path), { headers: ghHeaders(token, 'application/vnd.github+json'), cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(await explainHttp(r.status, loc, token, path));
  const j = await r.json();
  const text = new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
  return { json: JSON.parse(text), sha: j.sha };
}

// Returns true when written, false on a sha conflict (someone else wrote first).
export async function putRepoFile(loc, token, path, json, sha, message) {
  const r = await fetch(contentsUrl(loc, path), {
    method: 'PUT',
    headers: { ...ghHeaders(token, 'application/vnd.github+json'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: toBase64(JSON.stringify(json, null, 2) + '\n'), ...(sha ? { sha } : {}) }),
  });
  if (r.ok) return true;
  if (r.status === 409 || r.status === 422) return false;
  throw new Error(await explainHttp(r.status, loc, token, path));
}

// Base64 of bytes, in chunks: String.fromCharCode(...all) overflows the call stack on big files.
export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const toBase64 = (text) => bytesToBase64(new TextEncoder().encode(text));
