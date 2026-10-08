import { renderLock, card } from './render.js';
import { ask } from '../lib/ask.js';

const root = document.getElementById('root');
const forceLock = new URLSearchParams(location.search).has('locked');

// Tells the YouTube page this screen runs. postMessage can be dropped or rejected on Orion;
// the service worker relays frameReady to the content script, which is the path that works there.
// The lock screen is the same file (?locked=1) and must not count as the home list opening.
if (!forceLock) {
  try { parent.postMessage({ kidtube: 'frame-ready' }, '*'); } catch {}
  ask({ type: 'frameReady' });
}

// Instead of a blank screen: say what is wrong and where to look.
function showProblem() {
  const box = document.createElement('div');
  box.className = 'center';
  const inner = document.createElement('div');
  const h = Object.assign(document.createElement('h1'), { textContent: 'KidTube can’t reach its background in this browser' });
  const p = Object.assign(document.createElement('p'), { textContent: 'Ask a grown-up to open the check below and send the result.' });
  const a = Object.assign(document.createElement('a'), { href: 'check.html', target: '_blank', textContent: 'Check this browser' });
  a.style.cssText = 'display:inline-block;margin-top:16px;font-size:20px';
  inner.append(Object.assign(document.createElement('div'), { className: 'big', textContent: '🔧' }), h, p, a);
  box.append(inner);
  root.replaceChildren(box);
}

async function draw() {
  const st = await ask({ type: 'state' });
  if (!st) { if (!root.childElementCount) showProblem(); return; }
  if (st.lock || forceLock) return renderLock(root, st.lock ?? { reason: 'dailyCap' });
  if (!st.videos.length) {
    root.innerHTML = `<div class="center"><div><div class="big">🌱</div><h1>New videos are coming</h1><p>Ask a grown-up to check back later.</p></div></div>`;
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const v of st.videos) grid.appendChild(card(v, () => ask({ type: 'open', videoId: v.videoId })));
  root.replaceChildren(grid);
}

// The grown-up's way out of kid mode, top right: the PIN page, then parent mode.
const parentBtn = document.createElement('button');
parentBtn.className = 'parentbtn';
parentBtn.textContent = '🔒 Parent';
parentBtn.title = 'Parent mode (PIN)';
parentBtn.addEventListener('click', () => ask({ type: 'parentGate' }));
if (!forceLock) { document.body.append(parentBtn); document.body.classList.add('kidhome'); }

draw();
setInterval(draw, 30000);
chrome.storage.onChanged.addListener((c) => { if (c.data || c.watched || c.today) draw(); });
