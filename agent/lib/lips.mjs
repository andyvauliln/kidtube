// audio/lips.json next to the friend's recordings ({ schemaVersion, lines: { "<name>.mp3": track } }): the mouth
// shapes the avatar on the tablet shows while each recording plays. The rules live in extension/apps/kidtube/lib/lips.js.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { lipTrack, whisperWords } from '../../extension/apps/kidtube/lib/lips.js';
export { vowelsOf, lipTrack, whisperWords, LIPS_MODELS } from '../../extension/apps/kidtube/lib/lips.js';

export const LIPS_FILE = 'audio/lips.json';

// Brings audio/lips.json up to date: a track for every recording in `want` (paths "audio/x.mp3", langs: path → lang),
// kept when it is already there, dropped when the recording is gone. Without a key nothing new is made.
export async function makeLips({ dataDir, want, langs = new Map(), key, cfg = {}, deadline = Infinity, fetchImpl = fetch }) {
  const report = { made: 0, kept: 0, skipped: 0, errors: [] };
  const file = join(dataDir, LIPS_FILE);
  let old = {};
  try { old = JSON.parse(readFileSync(file, 'utf8')).lines ?? {}; } catch {}
  const lines = {};
  let stop = !key || cfg === false;
  for (const path of [...want].filter((p) => p.endsWith('.mp3')).sort()) {
    const name = basename(path);
    if (old[name]) { lines[name] = old[name]; report.kept++; continue; }
    if (stop || Date.now() > deadline || !existsSync(join(dataDir, path))) { report.skipped++; continue; }
    try {
      const track = lipTrack(await whisperWords(readFileSync(join(dataDir, path)), { key, lang: langs.get(path), models: cfg.models, fetchImpl }));
      if (track.length) { lines[name] = track; report.made++; } else report.skipped++;
    } catch (e) {
      report.errors.push(`${name}: ${e.message.slice(0, 160)}`);
      if (e.limit) stop = true;
    }
  }
  if (Object.keys(lines).length) writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, lines })}\n`);
  else if (existsSync(file)) unlinkSync(file);
  return report;
}
