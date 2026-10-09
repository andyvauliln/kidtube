// The friend's moods: the helper writes a tag like [surprised] before a sentence of the intro or outro, and the
// avatar on the tablet changes its face there. The tags are taken out of the spoken text; each mood keeps the
// character position where it starts ({ at, mood }), which the tablet matches against the voice.
// Used by the helper (agent/lib/moods.mjs), the talk screen and the avatar lab.
export const MOODS = ['happy', 'excited', 'surprised', 'curious', 'thinking', 'calm', 'sad', 'playful'];

export const MOOD_GUIDE = `Put a mood tag before the sentences where the friend's face should change: ${MOODS.map((m) => `[${m}]`).join(' ')}. `
  + 'Start with a tag, use 1–3 per text, in English even in a Russian text. The tags are not spoken.';

// "[surprised] Wow! [curious] What is it?" → { text: 'Wow! What is it?', moods: [{ at: 0, mood: 'surprised' }, { at: 5, mood: 'curious' }] }
export function parseMoods(raw) {
  const moods = [], unknown = [];
  let text = '', afterTag = false;
  for (const part of String(raw ?? '').split(/(\[[^\]\n]{1,20}\])/)) {
    const tag = part.match(/^\[\s*([^\]]+?)\s*\]$/);
    if (!tag) {
      text += afterTag ? part.trimStart() : part;
      if (part) afterTag = false;
      continue;
    }
    // a tag and the space around it become one space
    text = text.trimEnd();
    if (text) text += ' ';
    afterTag = true;
    const mood = tag[1].toLowerCase();
    if (!MOODS.includes(mood)) { unknown.push(tag[1]); continue; }
    if (moods.at(-1)?.at === text.length) moods.pop();
    moods.push({ at: text.length, mood });
  }
  text = text.trimEnd();
  return { text, moods: moods.map((m) => ({ ...m, at: Math.min(m.at, text.length) })), unknown };
}

// A line for queue.json: { text, moods? }.
export const moodLine = (text, moods) => ({ text, ...(moods?.length ? { moods } : {}) });

// Plays moods in order as the voice moves on: the returned function takes the character position the voice has
// reached and calls apply(mood) for every mood that starts at or before it, once.
export function moodTrack(moods, apply) {
  const list = [...(moods ?? [])].sort((a, b) => a.at - b.at);
  let next = 0;
  return (at) => { while (next < list.length && list[next].at <= at) apply(list[next++].mood); };
}
