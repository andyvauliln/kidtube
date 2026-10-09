// Transcripts fetched on the tablet and uploaded for the agent; the friend's picture from the data repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCaptions, captionsToText } from '../../extension/apps/kidtube/lib/captions.js';
import { installFakeChrome } from '../helpers/fake-chrome.mjs';

test('captions: old and srv3 formats, entities, 20-second lines', () => {
  const old = '<transcript><text start="0.5" dur="2">Hello &amp;amp; welcome</text><text start="3" dur="2">it&amp;#39;s a spider</text><text start="25" dur="2">eight legs</text></transcript>';
  const lines = parseCaptions(old);
  assert.deepEqual(lines.map((l) => l.text), ['Hello & welcome', "it's a spider", 'eight legs']);
  assert.equal(captionsToText(lines), "[0:01] Hello & welcome it's a spider\n[0:25] eight legs");
  const srv3 = '<timedtext><body><p t="61000" d="900"><s>Hi</s><s> there</s></p></body></timedtext>';
  assert.deepEqual(parseCaptions(srv3), [{ start: 61, text: 'Hi there' }]);
});

const fake = installFakeChrome();
await import('../../extension/core/background/main.js');
fake.store.account = { key: 'kid@example.com', email: 'kid@example.com', app: 'kidtube', folder: 'kid' };
const send = (msg) => new Promise((resolve) => fake.listeners.message[0](msg, { tab: { id: 7, url: 'https://m.youtube.com/' } }, resolve));

test('sync uploads a transcript for each listed video once, and the friend picture is loaded', async () => {
  const put = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const ok = (body, extra = {}) => ({ ok: true, status: 200, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), headers: { get: () => 'etag1' }, ...extra });
    if (u.startsWith('https://www.youtube.com/watch')) return ok('<script>ytcfg.set({"INNERTUBE_API_KEY": "KEY123"})</script>');
    if (u.startsWith('https://www.youtube.com/youtubei/v1/player?key=KEY123')) {
      const videoId = JSON.parse(opts.body).videoId;
      return ok({ videoDetails: { title: `T ${videoId}`, author: 'Ch', lengthSeconds: '300', shortDescription: 'about spiders' },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', kind: 'asr', baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&fmt=srv3` }] } } });
    }
    if (u.startsWith('https://www.youtube.com/api/timedtext')) {
      assert.ok(!u.includes('fmt=srv3'));
      return ok('<transcript><text start="1" dur="2">spiders have eight legs</text></transcript>');
    }
    if (u.includes('/contents/kidtube/kid/transcripts/') && opts.method === 'PUT') {
      put[u.split('/').pop()] = JSON.parse(Buffer.from(JSON.parse(opts.body).content, 'base64').toString('utf8'));
      return ok({});
    }
    if (u.includes('/contents/kidtube/kid/transcripts/')) return { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } };
    if (u.endsWith('/contents/kidtube/kid/characters/pika.svg')) return ok('<svg xmlns="http://www.w3.org/2000/svg"><ellipse id="mouth"/></svg>');
    if (u.includes('/contents/')) return { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } };
    return realFetch(url, opts);
  };
  await chrome.storage.local.set({ settings: { token: 'github_pat_ok' }, localConfig: { presenter: { intro: true, imageUrl: 'repo:characters/pika.svg', catchphrase: 'Pika pika!' } } });
  // keep the rules local so the test doesn't need a parent-config PUT
  const r = await send({ type: 'sync' });
  const files = Object.values(put);
  assert.equal(files.length, 11, JSON.stringify(r.errors));
  assert.equal(files[0].available, true);
  assert.equal(files[0].kind, 'auto');
  assert.equal(files[0].text, '[0:01] spiders have eight legs');
  assert.equal(files[0].description, 'about spiders');
  const again = Object.keys(put).length;
  await send({ type: 'sync' });
  assert.equal(Object.keys(put).length, again, 'not uploaded twice');
  const st = await send({ type: 'status' });
  assert.equal(st.transcripts.uploaded, 11);
  const t = await send({ type: 'talk', videoId: files[0].videoId, mode: 'intro' });
  assert.match(t.svg, /id="mouth"/);
  assert.equal(t.lines[0].text, 'Pika pika!');
  globalThis.fetch = realFetch;
});
