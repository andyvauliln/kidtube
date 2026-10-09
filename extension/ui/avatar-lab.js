// Avatar lab: tries the mesh avatar friend with the talk screen's own calls (talking, word, audio, react, wave).
// Opens as an extension page (ui/avatar-lab.html) or from any static web server pointed at extension/.
import { createMeshFriend, hasWebGL2 } from './mesh.js';
import { say } from './voice.js';
import { parseMoods, moodTrack, MOODS } from '../lib/moods.js';

const $ = (id) => document.getElementById(id);
let friend = null, busy = false;
const log = (text) => { $('status').textContent = text; };

// A made-up voice: a buzzing tone in syllables and words, so the mouth can follow a real recording's loudness.
function babbleWav(seconds = 4, rate = 16000) {
  const n = seconds * rate, data = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const word = Math.sin(t * Math.PI * 1.1) > -0.6 ? 1 : 0;                  // short pauses between words
    const syllable = Math.max(0, Math.sin(t * 2 * Math.PI * 4.5)) ** 0.7;
    const pitch = 190 + 30 * Math.sin(t * 2.3);
    const tone = Math.sin(2 * Math.PI * pitch * t) * 0.6 + Math.sin(4 * Math.PI * pitch * t) * 0.3 + Math.sin(6 * Math.PI * pitch * t) * 0.1;
    data[i] = tone * syllable * word * 0.5 * 32767;
  }
  const head = new DataView(new ArrayBuffer(44));
  const text = (o, s) => [...s].forEach((c, k) => head.setUint8(o + k, c.charCodeAt(0)));
  text(0, 'RIFF'); head.setUint32(4, 36 + n * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, 1, true); head.setUint32(24, rate, true);
  head.setUint32(28, rate * 2, true); head.setUint16(32, 2, true); head.setUint16(34, 16, true); text(36, 'data'); head.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([head, data], { type: 'audio/wav' }));
}

// The talk screen's speak(): talking on, the line (recording or tablet voice) with its [mood] tags, talking off.
async function speak(raw, audioUrl) {
  if (!friend || busy) return;
  const { text, moods, unknown } = parseMoods(raw);
  busy = true;
  log(`Moods: ${moods.map((m) => `${m.mood} at "${text.slice(m.at, m.at + 18)}…"`).join(', ') || 'none'}${unknown.length ? `\nUnknown tags (ignored): ${unknown.join(', ')}` : ''}`);
  friend.talking(true);
  const reach = moodTrack(moods, (m) => { friend.mood(m); $('mood').textContent = `Mood now: ${m}`; });
  reach(0);
  const follow = (a) => a.addEventListener('timeupdate', () => { if (a.duration) reach((a.currentTime / a.duration) * text.length); });
  try { await say({ text, audioUrl }, { lang: 'en-US', pitch: 1.6 }, { onWord: () => friend.word(), onAudio: (a) => { friend.audio(a); follow(a); }, onSentence: reach }); }
  finally { friend.talking(false); busy = false; }
}

async function load() {
  const base = $('avatar').value || $('folder').value.trim();
  if (!base) return;
  friend?.destroy();
  $('friend').replaceChildren();
  friend = null;
  log('Loading…');
  const t = performance.now();
  try {
    friend = await createMeshFriend($('friend'), { base });
    window.friend = friend;           // for the browser console and the automated check
    log(`Loaded ${base} in ${Math.round(performance.now() - t)} ms. WebGL2: yes.`);
  } catch (e) {
    log(`Could not load ${base}: ${e.message}${hasWebGL2() ? '' : '\nThis browser has no WebGL2: the talk screen shows the drawing instead.'}`);
  }
}

$('avatar').onchange = () => { $('folder').hidden = !!$('avatar').value; };
$('load').onclick = load;
$('say').onclick = () => speak($('text').value);
$('babble').onclick = () => speak($('text').value, babbleWav(Math.min(12, Math.max(3, Math.round(parseMoods($('text').value).text.length / 14)))));
$('file').onchange = () => { const f = $('file').files[0]; if (f) speak($('text').value, URL.createObjectURL(f)); };
// One button per mood, as the helper's tags use them.
for (const m of MOODS) {
  const b = Object.assign(document.createElement('button'), { textContent: m });
  b.onclick = () => { friend?.mood(m); $('mood').textContent = `Mood now: ${m}`; };
  $('moods').append(b);
}
$('wave').onclick = () => friend?.wave();
$('stop').onclick = () => speechSynthesis?.cancel();

// How wide the mouth is open now, from the engine.
(function meter() {
  const open = friend?.avatar.getLipSyncState?.().open ?? 0;
  $('level').style.width = `${Math.round(Math.min(1, open) * 100)}%`;
  requestAnimationFrame(meter);
})();

load();
