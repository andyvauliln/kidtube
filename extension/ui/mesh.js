// The talking friend as a mesh avatar (mesh-avatar-studio, extension/vendor/mesh-avatar): one illustration cut into
// layers and moved on a WebGL2 canvas. It answers the same calls as rig.js (talking, word, react, mood, wave, destroy),
// plus audio(el, track): a recording that plays moves the mouth with its loudness and, with a track, its vowels.
// An avatar folder holds rig.json and built/ (layers.json, the layer PNGs, optional sprites/), as the studio saves them.

import { shapeAt } from '../lib/lips.js';

const clamp = (x) => Math.min(1, Math.max(0, x));
const rand = (a, b) => a + Math.random() * (b - a);

export function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

// Loudness 0..1 of one block of samples, as the studio's microphone lip sync does.
export function rmsLevel(samples, gain = 1) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return clamp((Math.sqrt(sum / samples.length) - 0.008) * gain * 5);
}

// Speech without audio we can hear (the device's own voice): a made-up syllable rhythm, pushed up on every word.
export function fakeVoice() {
  let t = 0, bump = 0, rate = rand(4, 6);
  return {
    word() { bump = 1; rate = rand(4, 6); },
    level(dt) {
      t += dt;
      bump = Math.max(0, bump - dt * 3);
      const syllable = 0.5 + 0.5 * Math.sin(t * rate * 2 * Math.PI);
      return clamp(0.15 + 0.55 * syllable * syllable + 0.3 * bump);
    },
  };
}

// The helper's [mood] tags (agent/lib/moods.mjs) as the engine's emotions (a face, sometimes with a motion) and motions.
export const MOODS = {
  happy: (a) => a.setEmotion('happy'),                                         // smile and nod
  excited: (a) => { a.setEmotion('happy', { playMotion: false }); a.play('giggle'); },
  surprised: (a) => a.setEmotion('surprised'),
  curious: (a) => { a.setEmotion('neutral'); a.play('tilt'); },
  thinking: (a) => { a.setEmotion('neutral'); a.play('think'); },
  calm: (a) => a.setEmotion('relaxed'),
  sad: (a) => a.setEmotion('sad'),                                             // sad face and a sigh
  playful: (a) => { a.setEmotion('happy', { playMotion: false }); a.play('wink'); },
};

// box: the element to fill; base: the avatar folder URL. load: the engine (a test passes a fake one).
export async function createMeshFriend(box, { base, load = () => import('../vendor/mesh-avatar/mesh-avatar.js') } = {}) {
  if (!hasWebGL2()) throw new Error('no WebGL2 here');
  const root = String(base).replace(/\/?$/, '/');
  const res = await fetch(`${root}rig.json`);
  if (!res.ok) throw new Error(`avatar not found: ${root}rig.json`);
  const rig = await res.json();
  const { createMeshAvatar } = await load();
  const canvas = Object.assign(document.createElement('canvas'), { className: 'mesh' });
  box.append(canvas);
  let avatar;
  try { avatar = await createMeshAvatar(canvas, { rig, assetsBase: `${root}built/` }); }
  catch (e) { canvas.remove(); throw e; }

  let talkingNow = false, raf = 0, last = 0, fake = null, analyser = null, samples = null, ctx = null, destroyed = false;
  let lips = null;                // { track, el, at, shape }: the recording's mouth shapes (lib/lips.js)

  function loop(now) {
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    let level = 0;
    if (analyser) { analyser.getFloatTimeDomainData(samples); level = rmsLevel(samples, 1.6); }
    else if (fake) level = fake.level(dt);
    avatar.setVoiceLevel(level);
    if (lips) {
      // The vowel of this moment; a quiet moment (a consonant, a breath) closes the mouth when we can hear it.
      const { shape, index } = shapeAt(lips.track, lips.el.currentTime, lips.at);
      lips.at = index;
      const want = analyser && level < 0.05 ? 'n' : shape;
      if (want !== lips.shape) { lips.shape = want; avatar.holdMouth(want); }
    }
    raf = requestAnimationFrame(loop);
  }

  function talking(on) {
    if (on === talkingNow || destroyed) return;
    talkingNow = on;
    avatar.setSpeaking(on);
    cancelAnimationFrame(raf);
    analyser = null;
    if (lips) { lips = null; avatar.stopLipSync(); }
    if (!on) { fake = null; avatar.setVoiceLevel(0); return; }
    unlock();
    fake = fakeVoice();
    last = 0;
    raf = requestAnimationFrame(loop);
  }

  // The audio engine that measures a recording: made inside his tap (unlock()), or the browser keeps it stopped.
  function unlock() {
    try { ctx ??= new AudioContext(); if (ctx.state !== 'running') ctx.resume().catch(() => {}); } catch { ctx = null; }
  }

  // A recording about to play, with its mouth shapes when there are some (track: [[seconds, shape], ...]).
  // Only our own blob/extension URLs are measured: a sound from another site would come out silent through the
  // analyser, and a stopped audio engine would silence it too, so those keep the made-up rhythm.
  function audio(el, track) {
    if (!talkingNow) return;
    if (track?.length) lips = { track, el, at: 0, shape: null };
    if (!ctx || ctx.state !== 'running') return;
    const url = new URL(el.src, location.href);
    if (url.protocol !== 'blob:' && url.origin !== location.origin) return;
    try {
      const node = ctx.createAnalyser();
      node.fftSize = 1024;
      ctx.createMediaElementSource(el).connect(node);
      node.connect(ctx.destination);
      samples = new Float32Array(node.fftSize);
      analyser = node;
    } catch { analyser = null; }
  }

  return {
    avatar,
    talking,
    audio,
    unlock,
    word() { if (talkingNow) fake?.word(); },
    // happy: smiling face and a nod; sad: a sad face and a sigh. Both end a moment after the next line.
    react(kind) { avatar.setEmotion(kind === 'happy' ? 'happy' : kind === 'sad' ? 'sad' : 'neutral'); },
    // A mood for the words that follow (see MOODS); an unknown one is ignored.
    mood(name) { MOODS[name]?.(avatar); },
    wave() { avatar.play('greet'); },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      avatar.destroy();
      ctx?.close().catch(() => {});
    },
  };
}
