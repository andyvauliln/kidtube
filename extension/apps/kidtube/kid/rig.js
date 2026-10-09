// Brings the talking friend's SVG to life (PLAN.md §5). Any character SVG can take part by using these ids;
// every part is optional and missing ones are skipped.
//   #body          the whole character: breathes (squash and stretch), hops when happy
//   #head          tilts a little while talking, drops a little when sad
//   #earL #earR    twitch now and then, droop when sad, perk up when happy
//   #eyeL #eyeR    blink every 2–6 s (or one #eyes group for both)
//   #cheekL #cheekR  pulse while talking, throw little sparks when happy
//   #mouth         holds #mouthClosed and #mouthOpen (opens on every spoken word) and optionally #mouthSmile (happy).
//                  A #mouth without those children is itself stretched open, as before.
//   #tail          sways, wags fast when happy
//   #armL #armR    #armR waves hello
// data-origin="x% y%" on a part sets its pivot inside its own box (an ear turns at its base);
// data-wave="-40" on #armR sets how far it waves (degrees).
// Animated parts should be <g> without a transform attribute; a part that has one is wrapped in a new <g>.

const NS = 'http://www.w3.org/2000/svg';
const ORIGIN = {
  body: '50% 100%', head: '50% 92%', earL: '90% 90%', earR: '10% 90%', tail: '0% 100%',
  armL: '85% 15%', armR: '15% 15%', mouthOpen: '50% 0%', mouthSmile: '50% 0%',
};
const rand = (a, b) => a + Math.random() * (b - a);

export function createRig(svg, { reducedMotion = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches } = {}) {
  const timers = new Set();
  const loops = [];
  let talkingNow = false, smiling = false, lastWord = 0, jitter = null, destroyed = false;

  function part(id) {
    let el = svg.querySelector(`#${id}`);
    if (!el) return null;
    if (el.hasAttribute('transform')) {
      const g = document.createElementNS(NS, 'g');
      if (el.dataset.origin) g.dataset.origin = el.dataset.origin;
      el.before(g);
      g.append(el);
      el = g;
    }
    el.style.transformBox = 'fill-box';
    el.style.transformOrigin = el.dataset.origin || ORIGIN[id] || 'center';
    return el;
  }
  const p = Object.fromEntries(['body', 'head', 'earL', 'earR', 'eyeL', 'eyeR', 'eyes', 'cheekL', 'cheekR', 'mouth',
    'mouthClosed', 'mouthOpen', 'mouthSmile', 'tail', 'armL', 'armR'].map((id) => [id, part(id)]));
  const eyes = [p.eyeL, p.eyeR].filter(Boolean).length ? [p.eyeL, p.eyeR].filter(Boolean) : [p.eyes].filter(Boolean);
  const ears = [p.earL, p.earR].filter(Boolean);
  const cheeks = [p.cheekL, p.cheekR].filter(Boolean);

  // Web Animations; "add" lets a twitch or a wag play on top of a pose or a loop.
  function anim(el, frames, opts) {
    if (!el?.animate || destroyed) return null;
    try { return el.animate(frames, opts); } catch {
      const { composite, ...rest } = opts;
      try { return el.animate(frames, rest); } catch { return null; }
    }
  }
  function later(fn, ms) {
    const t = setTimeout(() => { timers.delete(t); if (!destroyed) fn(); }, ms);
    timers.add(t);
  }
  const rot = (deg) => ({ transform: `rotate(${deg}deg)` });

  // --- mouth ------------------------------------------------------------------------------------
  function setMouth(level) {
    if (p.mouthOpen) {
      const open = level > 0.12;
      p.mouthOpen.style.opacity = open ? '1' : '0';
      p.mouthOpen.style.transform = `scaleY(${Math.max(0.35, level).toFixed(2)})`;
      if (p.mouthClosed) p.mouthClosed.style.opacity = open || smiling ? '0' : '1';
      if (p.mouthSmile) p.mouthSmile.style.opacity = !open && smiling ? '1' : '0';
    } else if (p.mouth) {
      p.mouth.style.transform = `scaleY(${(0.5 + level * 1.8).toFixed(2)})`;
    }
  }
  setMouth(0);

  // --- always on: blinking (also with reduced motion) ------------------------------------------------
  function blink() {
    for (const e of eyes) anim(e, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.08)' }, { transform: 'scaleY(1)' }], { duration: 150, easing: 'ease-in-out' });
    if (Math.random() < 0.15) later(blink, 220);
  }
  (function blinkLoop() { later(() => { blink(); blinkLoop(); }, rand(2000, 6000)); })();

  if (!reducedMotion) {
    loops.push(anim(p.body, [{ transform: 'scale(1, 1)' }, { transform: 'scale(.992, 1.022)' }],
      { duration: 2600, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' }));
    loops.push(anim(p.tail, [rot(-4), rot(5)], { duration: 1900, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' }));
    (function twitchLoop() {
      later(() => {
        const ear = ears[Math.floor(Math.random() * ears.length)];
        const deg = ear === p.earL ? -9 : 9;
        anim(ear, [rot(0), rot(deg), rot(0)], { duration: 300, easing: 'ease-out', composite: 'add' });
        twitchLoop();
      }, rand(3000, 8000));
    })();
  }

  // --- talking ----------------------------------------------------------------------------------
  let tilt = null, glow = [];
  function talking(on) {
    if (on === talkingNow) return;
    talkingNow = on;
    clearInterval(jitter);
    tilt?.cancel();
    glow.forEach((a) => a?.cancel());
    glow = [];
    if (!on) { setMouth(0); return; }
    // Words move the mouth (word()); when the speech engine sends no word events, it flaps on its own.
    jitter = setInterval(() => { if (Date.now() - lastWord > 350) setMouth(Math.random() < 0.15 ? 0 : rand(0.25, 1)); }, 110);
    if (reducedMotion) return;
    tilt = anim(p.head, [rot(-2), rot(2.5)], { duration: 700, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out', composite: 'add' });
    glow = cheeks.map((c) => anim(c, [{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }], { duration: 320, iterations: Infinity, direction: 'alternate' }));
  }

  function word() {
    if (!talkingNow) return;
    lastWord = Date.now();
    setMouth(rand(0.75, 1));
    later(() => { if (talkingNow) setMouth(0.3); }, 140);
  }

  // --- reactions --------------------------------------------------------------------------------
  let pose = [];
  function clearPose() { pose.forEach((a) => a?.cancel()); pose = []; }

  function sparks() {
    for (const c of cheeks) {
      let box;
      try { box = c.getBBox(); } catch { return; }
      const side = c === p.cheekL ? -1 : 1;
      for (let i = 0; i < 2; i++) {
        const x = box.x + box.width / 2 + side * (box.width * 0.7 + i * 10), y = box.y + i * 18 - 4;
        const s = document.createElementNS(NS, 'path');
        s.setAttribute('d', `M${x} ${y} l${side * 9} -8 l${-side * 6} -2 l${side * 10} -10`);
        s.setAttribute('fill', 'none');
        s.setAttribute('stroke', '#fff36b');
        s.setAttribute('stroke-width', '4');
        s.setAttribute('stroke-linecap', 'round');
        s.setAttribute('stroke-linejoin', 'round');
        c.parentNode.append(s);
        const a = anim(s, [{ opacity: 0, transform: 'translate(0,0)' }, { opacity: 1, offset: 0.3 },
          { opacity: 0, transform: `translate(${side * 10}px,-8px)` }], { duration: 520, delay: i * 120 });
        if (a) a.onfinish = () => s.remove(); else later(() => s.remove(), 700);
      }
    }
  }

  function react(kind) {
    clearPose();
    smiling = false;
    setMouth(0);
    if (kind === 'happy') {
      smiling = true;
      setMouth(0);
      later(() => { smiling = false; if (!talkingNow) setMouth(0); }, 1800);
      sparks();
      if (reducedMotion) return;
      pose.push(anim(p.body, [{ transform: 'translateY(0) scale(1,1)' }, { transform: 'translateY(0) scale(1.05,.93)', offset: 0.18 },
        { transform: 'translateY(-26px) scale(.96,1.05)', offset: 0.5 }, { transform: 'translateY(0) scale(1.05,.94)', offset: 0.82 },
        { transform: 'translateY(0) scale(1,1)' }], { duration: 700, easing: 'ease-out', composite: 'add' }));
      pose.push(anim(p.tail, [rot(0), rot(14), rot(-10), rot(14), rot(-10), rot(14), rot(0)], { duration: 760, composite: 'add' }));
      pose.push(anim(p.earL, [rot(0), rot(8), rot(8), rot(0)], { duration: 1600, easing: 'ease-in-out' }));
      pose.push(anim(p.earR, [rot(0), rot(-8), rot(-8), rot(0)], { duration: 1600, easing: 'ease-in-out' }));
    } else if (kind === 'sad') {
      if (reducedMotion) return;
      const hold = { duration: 2000, easing: 'ease-in-out' };
      pose.push(anim(p.earL, [rot(0), { transform: 'rotate(-28deg)', offset: 0.2 }, { transform: 'rotate(-28deg)', offset: 0.8 }, rot(0)], hold));
      pose.push(anim(p.earR, [rot(0), { transform: 'rotate(28deg)', offset: 0.2 }, { transform: 'rotate(28deg)', offset: 0.8 }, rot(0)], hold));
      pose.push(anim(p.head, [rot(0), { transform: 'rotate(-5deg)', offset: 0.2 }, { transform: 'rotate(-5deg)', offset: 0.8 }, rot(0)], { ...hold, composite: 'add' }));
    }
  }

  function wave() {
    if (reducedMotion || !p.armR) return;
    const a = Number(p.armR.dataset.wave) || -100;
    anim(p.armR, [rot(0), rot(a), rot(a * 0.7), rot(a), rot(a * 0.7), rot(a), rot(0)], { duration: 1700, easing: 'ease-in-out' });
  }

  function destroy() {
    destroyed = true;
    clearInterval(jitter);
    timers.forEach(clearTimeout);
    [...loops, ...pose, tilt, ...glow].forEach((x) => x?.cancel());
  }

  // The helper's [mood] tags: the drawing can only look happy or sad.
  function mood(name) {
    if (['happy', 'excited', 'playful'].includes(name)) react('happy');
    else if (name === 'sad') react('sad');
  }

  return { talking, word, react, wave, mood, destroy };
}
