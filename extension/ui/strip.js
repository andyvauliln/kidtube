import { card } from './render.js';
import { ask } from '../lib/ask.js';

const grid = document.getElementById('grid');
const home = document.getElementById('home');
const wait = document.getElementById('wait');
let shown = '';

home.addEventListener('click', () => ask({ type: 'goHome' }));
document.getElementById('parent').addEventListener('click', () => ask({ type: 'parentGate' }));

async function draw() {
  const st = await ask({ type: 'state' });
  if (!st) return;
  const left = st.session?.secondsUntilUnlock ?? 0;
  const locked = left > 0;
  document.body.classList.toggle('locked', locked);
  home.disabled = locked;
  wait.textContent = locked ? `You can choose another video in ${fmt(left)}` : '';
  const key = st.videos.map((v) => v.videoId).join();
  if (key !== shown) {
    shown = key;
    grid.replaceChildren(...st.videos.map((v) => card(v, () => ask({ type: 'open', videoId: v.videoId }), { small: true })));
  }
}

const fmt = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`);
draw();
setInterval(draw, 1000);
