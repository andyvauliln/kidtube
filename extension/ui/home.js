import { renderLock, card } from './render.js';

const root = document.getElementById('root');
const forceLock = new URLSearchParams(location.search).has('locked');

// Tells the YouTube page this screen runs (content.js shows a fallback when it never hears it).
try { parent.postMessage({ kidtube: 'frame-ready' }, '*'); } catch {}

// The background's answer: promise style first, then callback style (a browser may only have one).
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
async function ask(msg) {
  const a = await within(Promise.resolve().then(() => chrome.runtime.sendMessage(msg)).catch(() => undefined), 5000);
  if (a !== undefined) return a;
  return within(new Promise((resolve) => {
    try { chrome.runtime.sendMessage(msg, (x) => { void chrome.runtime.lastError; resolve(x); }); } catch { resolve(undefined); }
  }), 5000);
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
  for (const v of st.videos) grid.appendChild(card(v, () => chrome.runtime.sendMessage({ type: 'open', videoId: v.videoId })));
  root.replaceChildren(grid);
}

// Parent settings: a small gear in the corner. The settings page asks for the PIN.
const gear = document.createElement('button');
gear.className = 'gear';
gear.textContent = '⚙️';
gear.title = 'Parent settings';
gear.addEventListener('click', () => ask({ type: 'openSettings' }));
document.body.append(gear);

draw();
setInterval(draw, 30000);
chrome.storage.onChanged.addListener((c) => { if (c.data || c.watched || c.today) draw(); });
