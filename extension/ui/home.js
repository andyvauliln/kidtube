import { renderLock, card } from './render.js';

const root = document.getElementById('root');
const forceLock = new URLSearchParams(location.search).has('locked');

async function draw() {
  const st = await chrome.runtime.sendMessage({ type: 'state' });
  if (!st) return;
  if (st.lock || forceLock) return renderLock(root, st.lock ?? { reason: 'dailyCap' });
  if (!st.videos.length) {
    root.innerHTML = `<div class="center"><div><div class="big">🌱</div><h1>New videos are coming</h1><p>Ask a grown-up to check back later.</p></div></div>`;
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const v of st.videos) grid.appendChild(card(v, () => chrome.runtime.sendMessage({ type: 'open', videoId: v.videoId })));
  root.replaceChildren(grid);
}

draw();
setInterval(draw, 30000);
chrome.storage.onChanged.addListener((c) => { if (c.data || c.watched || c.today) draw(); });
