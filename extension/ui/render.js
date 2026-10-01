export function card(v, onTap, { small = false } = {}) {
  const b = document.createElement('button');
  b.className = 'card';
  const img = document.createElement('img');
  img.src = v.thumbnailUrl || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`;
  img.alt = '';
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = v.title;
  b.append(img, t);
  if (!small && v.durationSeconds) {
    const d = document.createElement('div');
    d.className = 'd';
    d.textContent = `${Math.round(v.durationSeconds / 60)} min`;
    b.append(d);
  }
  b.addEventListener('click', onTap);
  return b;
}

export function renderLock(root, lock) {
  const when = lock.opens ? `See you ${lock.opens.day} at ${lock.opens.at}` : 'See you later';
  const [icon, title] = lock.reason === 'dailyCap' ? ['🌙', 'That’s all for today'] : ['⏰', 'Videos are sleeping'];
  root.innerHTML = `<div class="center" style="background:#efeaff"><div><div class="big">${icon}</div><h1>${title}</h1><p></p></div></div>`;
  root.querySelector('p').textContent = when;
}
