// The talking friend: says the intro before a video, and after it says what we learned and asks the questions.
// The service worker decides what comes next; this page only talks, listens and reports.
import { say, listen, recordedUrl, recordAnswer, transcribeAnswer, listenKeys } from './voice.js';
import { createRig } from './rig.js';
import { isCorrect, correctText } from '../lib/mark.js';
import { checkPin } from '../lib/pin.js';
import { ask as send } from '../lib/ask.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const mode = q.get('mode') === 'outro' ? 'outro' : 'intro';
const videoId = q.get('v');

let script;
let micWorks = true;            // turns false once the microphone fails; then he types instead
let skipAll = false;            // a parent typed the PIN: skip the rest
let skipNow = null;             // resolves the question on screen when a parent skips
let running = false, finished = false;
const svg = $('buddy');

// --- the character -----------------------------------------------------------------------------

let rig = null;                 // moves the SVG character (rig.js); a plain picture only bobs
function talking(on) {
  document.body.classList.toggle('talking', on);
  rig?.talking(on);
}

// lang: the language of this line (a question can differ from the video); default the video's.
async function speak(line, lang = script.lang) {
  if (skipAll) return;
  $('bubble').textContent = line.text;
  talking(true);
  // A recording made by the helper plays instead of the tablet's own voice (when the parent allows it).
  const recorded = script.recorded !== false && line.audioRef ? await recordedUrl(line.audioRef) : null;
  try { await say(recorded ? { ...line, audioUrl: recorded } : line, { ...script.voice, lang: lang || script.voice?.lang }, { onWord: () => rig?.word() }); }
  finally { talking(false); if (recorded) URL.revokeObjectURL(recorded); }
}

// A line around the questions: the helper's recording of it when there is one, else the built-in text.
function phrase(lang, key, ...args) {
  const l = String(lang ?? '').slice(0, 2);
  const rec = script.phrases?.[l]?.[key];
  if (rec?.length) return pick(rec);
  const p = say_(lang)[key];
  return { text: typeof p === 'function' ? p(...args) : Array.isArray(p) ? pick(p) : p };
}

// What the friend says around the questions, in English and Russian (a Russian video gets Russian).
const PHRASES = {
  en: {
    praise: ['Yes! Great job!', 'Correct! You’re so smart!', 'That’s right! Hooray!'],
    retry: ['Hmm, not quite. Try again!', 'Almost! One more try!'],
    answerIs: (a) => `Good try! The answer is ${a}.`,
    newerApp: 'This question needs a newer app. Let’s skip it!',
    hello: (n) => `Hi, it’s ${n}! I have a question for you.`,
    rewatch: 'Let’s watch it one more time and listen carefully!',
    stop: 'That’s all for today. Let’s try again tomorrow. Bye bye!',
    great: 'You did great! Now pick the next video.',
    tried: 'Good job trying! Now pick the next video.',
    listening: 'I’m listening…', notHeard: 'I didn’t hear you. Tap the 🎤 and say it again.', heard: (h) => `I heard: “${h}”`,
  },
  ru: {
    praise: ['Да! Молодец!', 'Правильно! Ты такой умный!', 'Верно! Ура!'],
    retry: ['Хм, не совсем. Попробуй ещё!', 'Почти! Ещё разок!'],
    answerIs: (a) => `Хорошая попытка! Правильный ответ: ${a}.`,
    newerApp: 'Для этого вопроса нужно обновить приложение. Пропустим!',
    hello: (n) => `Привет, это ${n}! У меня есть вопрос.`,
    rewatch: 'Давай посмотрим ещё раз и будем слушать внимательно!',
    stop: 'На сегодня всё. Попробуем завтра. Пока-пока!',
    great: 'Ты молодец! Теперь выбери следующее видео.',
    tried: 'Ты хорошо старался! Теперь выбери следующее видео.',
    listening: 'Я слушаю…', notHeard: 'Я тебя не услышал. Нажми 🎤 и скажи ещё раз.', heard: (h) => `Я услышал: «${h}»`,
  },
};
const say_ = (lang) => PHRASES[String(lang ?? '').slice(0, 2)] ?? PHRASES.en;

// A character drawn as SVG (from the private data repo) is put into the page so its #mouth can move.
function inlineSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName !== 'svg' || doc.querySelector('parsererror')) return null;
  root.querySelectorAll('script, foreignObject, iframe').forEach((n) => n.remove());
  for (const n of [root, ...root.querySelectorAll('*')]) {
    for (const a of [...n.attributes]) if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
  }
  root.id = 'buddy';
  return document.importNode(root, true);
}

function animate(el) {
  rig = createRig(el);
  if (el.querySelector('#body')) $('friend').classList.add('rigged');
}

function setupFriend() {
  const custom = script.svg && inlineSvg(script.svg);
  if (custom) { svg.replaceWith(custom); animate(custom); }
  else if (script.imageUrl) {
    const img = Object.assign(document.createElement('img'), { src: script.imageUrl, alt: '' });
    img.onerror = () => { img.replaceWith(svg); animate(svg); };
    svg.replaceWith(img);
  } else animate(svg);
  $('startText').textContent = `👆 Tap ${script.name}`;
}

// --- answering -------------------------------------------------------------------------------

function clearAnswers() { $('answers').replaceChildren(); $('heard').textContent = ''; }

function button(text, cls) {
  const b = document.createElement('button');
  b.textContent = text;
  if (cls) b.className = cls;
  return b;
}

// One answer from him: { value, by } where by is tapped | typed | spoken.
function getAnswer(item) {
  return new Promise((resolve) => {
    clearAnswers();
    if (item.answer.kind === 'choice') {
      const opts = [...item.answer.options].sort(() => Math.random() - 0.5);
      for (const o of opts) {
        const b = button(o);
        b.onclick = () => resolve({ value: o, by: 'tapped' });
        $('answers').append(b);
      }
      return;
    }
    if (item.type === 'voice' && micWorks) return voiceAnswer(item, resolve);
    typedAnswer(item, resolve);
  });
}

function typedAnswer(item, resolve) {
  clearAnswers();
  const numeric = item.answer.accept.every((a) => /^\s*-?\d+([.,]\d+)?\s*$/.test(a));
  const input = Object.assign(document.createElement('input'), { inputMode: numeric ? 'numeric' : 'text', autocomplete: 'off' });
  const ok = button('OK', 'ok');
  const submit = () => { if (input.value.trim()) resolve({ value: input.value, by: 'typed' }); };
  ok.onclick = submit;
  input.onkeydown = (e) => e.key === 'Enter' && submit();
  $('answers').append(input, ok);
  input.focus();
}

function voiceAnswer(item, resolve) {
  clearAnswers();
  const mic = button('🎤', 'mic');
  $('answers').append(mic);
  const go = async () => {
    mic.classList.add('on');
    mic.disabled = true;
    $('heard').textContent = say_(item.lang).listening;
    const lang = item.lang || script.voice?.lang || 'en-US';
    let heard = null;
    // Recorded and sent (free Gemini first, then paid OpenRouter; keys stored on this tablet);
    // the device's own recognition is the fallback, and the parent can choose it instead.
    if (script.listen?.provider !== 'device' && (listenKey.gemini || listenKey.openrouter)) {
      heard = await transcribeAnswer(await recordAnswer({ seconds: script.listen?.seconds ?? 6, onLevel: (l) => mic.style.setProperty('--level', l) }),
        { keys: listenKey, freeModels: script.listen?.freeModels, models: script.listen?.models, lang });
    }
    if (heard === null) heard = await listen(lang);
    mic.classList.remove('on');
    mic.disabled = false;
    if (heard === null) {                 // no microphone here: type instead, from now on
      micWorks = false;
      $('heard').textContent = '';
      return typedAnswer(item, resolve);
    }
    if (!heard.length) { $('heard').textContent = say_(item.lang).notHeard; return; }
    $('heard').textContent = say_(item.lang).heard(heard[0]);
    resolve({ value: heard, by: 'spoken' });
  };
  mic.onclick = go;
  go();                                   // start listening right after the question
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function ask(item) {
  const result = { quizId: item.quizId, attempts: 0, answers: [] };
  if (!item.supported) {
    await speak(phrase(item.lang, 'newerApp'), item.lang);
    return { ...result, result: 'unsupported' };
  }
  if (skipAll) return { ...result, result: 'skippedByParent' };
  const skipped = new Promise((r) => { skipNow = r; });
  await speak({ text: item.prompt, audioUrl: item.audioUrl, audioRef: item.audioRef }, item.lang);
  $('bubble').textContent = item.prompt;
  while (result.attempts < script.maxAttempts) {
    const a = skipAll ? 'skip' : await Promise.race([getAnswer(item), skipped]);
    if (a === 'skip') { clearAnswers(); return { ...result, result: 'skippedByParent' }; }
    result.attempts++;
    result.answeredBy = a.by;
    result.answers.push([].concat(a.value)[0]);
    clearAnswers();
    if (isCorrect(item, a.value, { spoken: a.by === 'spoken' })) {
      rig?.react('happy');
      await speak(phrase(item.lang, 'praise'), item.lang);
      return { ...result, result: 'passed' };
    }
    rig?.react('sad');
    if (result.attempts < script.maxAttempts) {
      await speak(phrase(item.lang, 'retry'), item.lang);
      $('bubble').textContent = item.prompt;
    }
  }
  await speak({ text: say_(item.lang).answerIs(correctText(item)), audioRef: item.answerAudioRef }, item.lang);
  return { ...result, result: 'failed' };
}

// --- the show --------------------------------------------------------------------------------

function finish() {
  if (finished) return;
  finished = true;
  send({ type: 'talkDone', videoId });
}

async function run() {
  running = true;
  $('start').hidden = true;
  rig?.wave();
  for (const line of script.lines) await speak(line);
  if (mode === 'outro' && script.items.length) {
    if (!script.lines.length) await speak(phrase(script.lang, 'hello', script.name));
    const results = [];
    for (const item of script.items) results.push(await ask(item));
    const { next } = await send({ type: 'quizResults', videoId, results });
    const allGood = results.every((r) => r.result !== 'failed');
    await speak(phrase(script.lang, next === 'rewatch' ? 'rewatch' : next === 'stopForToday' ? 'stop' : allGood ? 'great' : 'tried'));
  }
  if (mode === 'outro' && script.catchphrase) await speak({ text: script.catchphrase, audioRef: script.catchphraseAudioRef });
  finish();
}

// A parent can skip the questions (or the whole talk) with the PIN.
$('parent').onclick = () => { $('pinbox').hidden = false; $('pin').value = ''; $('pinErr').textContent = ''; $('pin').focus(); };
$('pinCancel').onclick = () => { $('pinbox').hidden = true; };
$('pinOk').onclick = async () => {
  const r = await checkPin($('pin').value.trim());
  if (!r.ok) { $('pinErr').textContent = r.error; return; }
  $('pinbox').hidden = true;
  skipAll = true;
  window.speechSynthesis?.cancel();
  skipNow?.('skip');
  if (!running) finish();
};

$('parent').append(globalThis.KidTubeUI.icon('lock', 22));
script = await send({ type: 'talk', videoId, mode });
// The keys for listening never leave this tablet (the parent stores them in Settings).
const listenKey = await listenKeys();
if (!script) {
  // The background didn't answer: say so instead of a friend that never speaks, and offer the way out.
  $('stage').replaceChildren(globalThis.KidTubeUI.problemView());
  $('stage').firstChild.classList.add('problem');
  const from = (() => { try { return new URL(document.referrer).hostname; } catch { return ''; } })();
  const home = `https://${/(^|\.)youtube\.com$/.test(from) ? from : 'm.youtube.com'}/`;
  $('stage').firstChild.firstChild.append(globalThis.KidTubeUI.button('go', 'Back to the list', () => { location.href = home; }));
} else {
  setupFriend();
  if (!script.lines.length && !script.items.length) finish();
  // Browsers only let a page speak after a tap, so he taps the friend to start.
  $('start').hidden = false;
  $('start').onclick = run;
}
