// Checks a kid's answer against a quiz item (PLAN.md §3.1 "Text marking").
// Typed answers must match; spoken answers only have to contain an accepted answer,
// because speech recognition hears "um it's six" as a whole sentence.

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

export function normalize(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}\s.,-]/gu, ' ')
    .replace(/(\D)[.,]+|[.,]+(\D|$)/g, '$1 $2')
    .replace(/\s+/g, ' ').trim();
}

const NUMBER_WORDS_RU = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять',
  'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать', 'двадцать'];

function asNumber(s) {
  const t = normalize(s).replace(/ё/g, 'е');
  const i = NUMBER_WORDS.indexOf(t);
  if (i >= 0) return i;
  const r = NUMBER_WORDS_RU.indexOf(t);
  if (r >= 0) return r;
  return /^-?\d+([.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : null;
}

export function sameAnswer(given, accepted) {
  const a = asNumber(given), b = asNumber(accepted);
  if (a !== null && b !== null) return a === b;
  return normalize(given) === normalize(accepted);
}

// True when one of the accepted answers appears as whole words in what he said.
export function heardAnswer(transcript, accepted) {
  const words = normalize(transcript).split(' ');
  return accepted.some((acc) => {
    const want = normalize(acc).split(' ');
    for (let i = 0; i + want.length <= words.length; i++) {
      if (want.every((w, j) => sameAnswer(words[i + j], w))) return true;
    }
    return false;
  });
}

// answer: { kind:'text', accept } | { kind:'choice', options, correct }. given: string or (spoken) string[] of alternatives.
export function isCorrect(item, given, { spoken = false } = {}) {
  const ans = item.answer;
  const tries = [].concat(given);
  if (ans.kind === 'choice') {
    return tries.some((g) => (spoken ? heardAnswer(g, [ans.correct]) : sameAnswer(g, ans.correct)));
  }
  return tries.some((g) => (spoken ? heardAnswer(g, ans.accept) : ans.accept.some((a) => sameAnswer(g, a))));
}

export function correctText(item) {
  return item.answer.kind === 'choice' ? item.answer.correct : item.answer.accept[0];
}
