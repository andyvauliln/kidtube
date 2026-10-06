// Which YouTube account is signed in. The content script sends YouTube's own account switcher
// answer (getAccountSwitcherEndpoint) and the page's DATASYNC_ID; every setting, list and log is kept per account.
const EMAIL = /^[^\s@"<>]+@[^\s@"<>]+\.[a-z]{2,}$/i;

const text = (x) => (typeof x === 'string' ? x : x?.simpleText ?? (x?.runs ?? []).map((r) => r.text).join('')) || '';

// Returns { email, name } of the selected account, or null. The email can sit in the account item
// or in its Google-account header, so the one closest to the selected item wins.
export function accountFromSwitcher(raw) {
  let json;
  try { json = typeof raw === 'string' ? JSON.parse(raw.replace(/^\)\]\}'\s*/, '')) : raw; } catch { return null; }
  const emails = [];
  let selected = null;
  const walk = (x, path) => {
    if (typeof x === 'string') { if (EMAIL.test(x.trim())) emails.push({ email: x.trim().toLowerCase(), path }); return; }
    if (!x || typeof x !== 'object') return;
    if (x.isSelected === true && !selected) selected = { path, name: text(x.accountName) };
    for (const [k, v] of Object.entries(x)) walk(v, [...path, k]);
  };
  walk(json, []);
  if (!emails.length && !selected) return null;
  const shared = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
  const best = selected ? [...emails].sort((a, b) => shared(b.path, selected.path) - shared(a.path, selected.path))[0] : emails[0];
  return { email: best?.email ?? null, name: selected?.name || null };
}

// The storage key of an account: its email, else YouTube's id for it.
export function accountKey({ email, datasyncId }) {
  if (email && EMAIL.test(email)) return email.toLowerCase();
  const id = String(datasyncId ?? '').split('||')[0].replace(/[^A-Za-z0-9_-]/g, '');
  return id ? `yt:${id}` : null;
}

// The profile's folder in the data repo (<app>/<folder>/): the email's name part, e.g.
// johnnypitt.ind@gmail.com → johnnypitt.ind. Given once and kept, so the folder never moves.
// taken: folders other profiles already use; a clash adds the first part of the domain.
export function profileFolder({ email, datasyncId }, taken = []) {
  const clean = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  const key = accountKey({ email, datasyncId });
  if (!key) return null;
  let base = key.startsWith('yt:') ? `yt-${clean(key.slice(3))}` : clean(key.split('@')[0]) || 'profile';
  if (taken.includes(base) && !key.startsWith('yt:')) base = `${base}-${clean(key.split('@')[1].split('.')[0])}`;
  let folder = base;
  for (let i = 2; taken.includes(folder); i++) folder = `${base}-${i}`;
  return folder;
}

// Google's account chooser for this email, coming back to YouTube (parent mode → Profiles → Switch).
export function chooserUrl(email, host = 'm.youtube.com') {
  const back = `https://${host}/`;
  return email ? `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(email)}&continue=${encodeURIComponent(back)}` : back;
}
