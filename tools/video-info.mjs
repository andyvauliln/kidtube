#!/usr/bin/env node
// Reads real video details from YouTube's watch page, so queue entries are never guessed.
//   node tools/video-info.mjs <videoId|url> ...            -> queue.json entries (JSON lines)
//   node tools/video-info.mjs --search "numberblocks" [n]  -> first n search results (title, channel, length)
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1' };

export function parseVideoId(s) {
  const m = String(s).match(/(?:v=|youtu\.be\/|shorts\/|^)([A-Za-z0-9_-]{11})(?:$|[&?#/])/);
  return m ? m[1] : null;
}

function extractJson(html, marker) {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  let i = html.indexOf('{', start), depth = 0, inStr = false, esc = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(i, j + 1));
  }
  return null;
}

export async function videoInfo(videoId) {
  const html = await (await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, { headers: HEADERS })).text();
  const pr = extractJson(html, 'ytInitialPlayerResponse = ');
  const d = pr?.videoDetails;
  if (!d) return { videoId, error: pr?.playabilityStatus?.reason ?? 'no videoDetails' };
  const micro = pr.microformat?.playerMicroformatRenderer ?? {};
  return {
    videoId: d.videoId,
    title: d.title,
    channelId: d.channelId,
    channelTitle: d.author,
    durationSeconds: Number(d.lengthSeconds),
    isLive: !!d.isLiveContent,
    isFamilySafe: micro.isFamilySafe ?? null,
    playable: pr.playabilityStatus?.status === 'OK',
    embeddable: pr.playabilityStatus?.playableInEmbed ?? null,
  };
}

// Search results carry title, channel and length, and work where the watch page asks for a bot check.
export async function search(query, n = 10) {
  const html = await (await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en`, { headers: HEADERS })).text();
  const data = extractJson(html, 'ytInitialData = ');
  const out = [];
  (function walk(node) {
    if (!node || typeof node !== 'object' || out.length >= n) return;
    const r = node.videoRenderer;
    if (r?.videoId && r.lengthText) {
      const owner = r.ownerText?.runs?.[0];
      out.push({
        videoId: r.videoId,
        title: r.title?.runs?.map((x) => x.text).join('') ?? '',
        channelId: owner?.navigationEndpoint?.browseEndpoint?.browseId ?? null,
        channelTitle: owner?.text ?? null,
        durationSeconds: parseLength(r.lengthText.simpleText),
        isLive: false,
      });
      return;
    }
    for (const v of Object.values(node)) walk(v);
  })(data);
  return out;
}

function parseLength(text) {
  return String(text).split(':').map(Number).reduce((acc, x) => acc * 60 + x, 0);
}

async function main(argv) {
  if (argv[0] === '--search') {
    for (const v of await search(argv[1], Number(argv[2] ?? 10))) console.log(JSON.stringify(v));
    return;
  }
  for (const id of argv.map(parseVideoId).filter(Boolean)) console.log(JSON.stringify(await videoInfo(id)));
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
