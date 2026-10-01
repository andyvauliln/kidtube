// The talking friend: says the intro before a video, and after it says what we learned and asks the questions.
// The service worker decides what comes next; this page only talks, listens and reports.
import { say, listen } from './voice.js';
import { isCorrect, correctText } from '../lib/mark.js';
import { checkPin } from '../lib/pin.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
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

let flap = null;
function talking(on) {
  document.body.classList.toggle('talking', on);
  const mouth = svg.isConnected ? $('mouth') : null;
  clearInterval(flap);
  if (!mouth) return;
  if (on) flap = setInterval(() => mouth.setAttribute('ry', String(3 + Math.random() * 11)), 110);
  else mouth.setAttribute('ry', '3');
}

async function speak(line) {
  if (skipAll) return;
  $('bubble').textContent = line.text;
  talking(true);
  try { await say(line, script.voice); } finally { talking(false); }
}

function setupFriend() {
  if (script.imageUrl) {
    const img = Object.assign(document.createElement('img'), { src: script.imageUrl, alt: '' });
    img.onerror = () => img.replaceWith(svg);
    svg.replaceWith(img);
  }
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
    $('heard').textContent = 'I’m listening…';
    const heard = await listen(script.voice?.lang || 'en-US');
    mic.classList.remove('on');
    mic.disabled = false;
    if (heard === null) {                 // no microphone here: type instead, from now on
      micWorks = false;
      $('heard').textContent = '';
      return typedAnswer(item, resolve);
    }
    if (!heard.length) { $('heard').textContent = 'I didn’t hear you. Tap the 🎤 and say it again.'; return; }
    $('heard').textContent = `I heard: “${heard[0]}”`;
    resolve({ value: heard, by: 'spoken' });
  };
  mic.onclick = go;
  go();                                   // start listening right after the question
}

const PRAISE = ['Yes! Great job!', 'Correct! You’re so smart!', 'That’s right! Hooray!'];
const RETRY = ['Hmm, not quite. Try again!', 'Almost! One more try!'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function ask(item) {
  const result = { quizId: item.quizId, attempts: 0, answers: [] };
  if (!item.supported) {
    await speak({ text: 'This question needs a newer app. Let’s skip it!' });
    return { ...result, result: 'unsupported' };
  }
  if (skipAll) return { ...result, result: 'skippedByParent' };
  const skipped = new Promise((r) => { skipNow = r; });
  await speak({ text: item.prompt, audioUrl: item.audioUrl });
  $('bubble').textContent = item.prompt;
  while (result.attempts < script.maxAttempts) {
    const a = skipAll ? 'skip' : await Promise.race([getAnswer(item), skipped]);
    if (a === 'skip') { clearAnswers(); return { ...result, result: 'skippedByParent' }; }
    result.attempts++;
    result.answeredBy = a.by;
    result.answers.push([].concat(a.value)[0]);
    clearAnswers();
    if (isCorrect(item, a.value, { spoken: a.by === 'spoken' })) {
      await speak({ text: pick(PRAISE) });
      return { ...result, result: 'passed' };
    }
    if (result.attempts < script.maxAttempts) {
      await speak({ text: pick(RETRY) });
      $('bubble').textContent = item.prompt;
    }
  }
  await speak({ text: `Good try! The answer is ${correctText(item)}.` });
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
  document.body.classList.add('wave');
  for (const line of script.lines) await speak(line);
  if (mode === 'outro' && script.items.length) {
    if (!script.lines.length) await speak({ text: `Hi, it’s ${script.name}! I have a question for you.` });
    const results = [];
    for (const item of script.items) results.push(await ask(item));
    const { next } = await send({ type: 'quizResults', videoId, results });
    const allGood = results.every((r) => r.result !== 'failed');
    await speak({ text: next === 'rewatch' ? 'Let’s watch it one more time and listen carefully!'
      : next === 'stopForToday' ? 'That’s all for today. Let’s try again tomorrow. Bye bye!'
      : allGood ? 'You did great! Now pick the next video.' : 'Good job trying! Now pick the next video.' });
  }
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

script = await send({ type: 'talk', videoId, mode });
setupFriend();
if (!script.lines.length && !script.items.length) finish();
// Browsers only let a page speak after a tap, so he taps the friend to start.
$('start').onclick = run;
