// Turns YouTube's caption XML (old <text start dur> or srv3 <p t d>) into lines of plain text.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Returns [{ start: seconds, text }].
export function parseCaptions(xml) {
  const out = [];
  const re = /<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[2];
    const start = m[1] === 'text' ? Number(attrs.match(/start="([\d.]+)"/)?.[1] ?? 0) : Number(attrs.match(/\bt="(\d+)"/)?.[1] ?? 0) / 1000;
    // Entities are decoded twice: YouTube escapes "&#39;" as "&amp;#39;".
    const text = decodeEntities(decodeEntities(m[3].replace(/<[^>]+>/g, ''))).replace(/\s+/g, ' ').trim();
    if (text) out.push({ start: Math.round(start), text });
  }
  return out;
}

// "[1:05] text" lines: short enough for the agent, still shows where things are said.
export function captionsToText(lines) {
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const out = [];
  let bucket = null;
  for (const l of lines) {
    if (!bucket || l.start - bucket.start >= 20) { bucket = { start: l.start, parts: [] }; out.push(bucket); }
    bucket.parts.push(l.text);
  }
  return out.map((b) => `[${fmt(b.start)}] ${b.parts.join(' ')}`).join('\n');
}
