import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, sameAnswer, heardAnswer, isCorrect } from '../../extension/apps/kidtube/lib/mark.js';

test('typed answers: spaces, case, full-width digits, 6.0 and 6,0 and number words', () => {
  for (const g of [' 6 ', '6.0', '6,0', 'SIX', '６', 'six.']) assert.ok(sameAnswer(g, '6'), g);
  assert.ok(!sameAnswer('7', '6'));
  assert.ok(sameAnswer('Blue  Whale!', 'blue whale'));
});

test('spoken answers only need to contain the answer as whole words', () => {
  assert.ok(heardAnswer("um I think it's eight", ['eight']));
  assert.ok(heardAnswer('it has 8 legs', ['eight']));
  assert.ok(heardAnswer('a blue whale', ['blue whale']));
  assert.ok(!heardAnswer('weight', ['eight']));
  assert.ok(!heardAnswer('', ['eight']));
});

test('isCorrect: choice, typed text and every speech guess', () => {
  const choice = { answer: { kind: 'choice', options: ['5', '6', '7'], correct: '6' } };
  assert.ok(isCorrect(choice, '6'));
  assert.ok(!isCorrect(choice, '5'));
  const text = { answer: { kind: 'text', accept: ['six'] } };
  assert.ok(isCorrect(text, '6'));
  assert.ok(isCorrect(text, ['it is sex', 'it is six'], { spoken: true }), 'any of the recognizer guesses counts');
  assert.ok(!isCorrect(text, 'it is six'), 'a typed answer must match exactly');
});

test('normalize keeps decimals but drops sentence punctuation', () => {
  assert.equal(normalize('It is 6.5!'), 'it is 6.5');
  assert.equal(normalize('Yes, six.'), 'yes six');
});
