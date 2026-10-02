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
  if (v.required) {
    const star = document.createElement('div');
    star.className = 'star';
    star.textContent = '⭐';
    b.append(star);
  }
  if (v.waiting) {
    // Must-watch videos come first: this one waits, and a tap only says so.
    b.classList.add('waiting');
    b.addEventListener('click', () => {
      b.classList.remove('nudge'); void b.offsetWidth; b.classList.add('nudge');
      document.querySelectorAll('.card .star').forEach((x) => { x.classList.remove('nudge'); void x.offsetWidth; x.classList.add('nudge'); });
    });
    return b;
  }
  b.addEventListener('click', onTap);
  return b;
}

export function renderLock(root, lock) {
  const when = lock.reason === 'stopped' ? 'Let’s try again tomorrow' : lock.opens ? `See you ${lock.opens.day} at ${lock.opens.at}` : 'See you later';
  const [icon, title] = lock.reason === 'dailyCap' ? ['🌙', 'That’s all for today']
    : lock.reason === 'stopped' ? ['🌟', 'Good work today'] : ['⏰', 'Videos are sleeping'];
  root.innerHTML = `<div class="center" style="background:#efeaff"><div><div class="big">${icon}</div><h1>${title}</h1><p></p></div></div>`;
  root.querySelector('p').textContent = when;
}
