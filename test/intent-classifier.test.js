import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, __test__ } from '../src/core/intent-classifier.js';

test('routes every sample question from the brief', () => {
  const cases = [
    ['Should I consider changing my job in the next few months?', 'career'],
    ['Should I consider changing my job this year?', 'career'],
    ['How does this month look for my relationship?', 'relationship'],
    ['What should I focus on for my health?', 'health'],
    ['What should I prioritize this week?', 'general'],
    ["Can you summarize today's guidance?", 'general'],
  ];
  for (const [q, expected] of cases) {
    assert.equal(classify(q).intent, expected, `"${q}" should route to ${expected}`);
  }
});

test('stemming makes inflected phrasings match', () => {
  // The regression that motivated the stemmer: "changing" vs the configured "change".
  assert.equal(classify('changing my job').intent, 'career');
  assert.equal(classify('I want to change my job').intent, 'career');
  assert.equal(classify('thinking about switching jobs').intent, 'career');
  assert.equal(classify('should I be investing now').intent, 'finance');
});

test('stemmer is conservative on short words', () => {
  assert.equal(__test__.stem('is'), 'is');
  assert.equal(__test__.stem('job'), 'job');
  assert.equal(__test__.stem('jobs'), 'job');
  assert.equal(__test__.stem('changing'), 'chang');
});

test('negative terms disambiguate overlapping questions', () => {
  // "partner" pushes away from career even though "work" is present.
  const r = classify('how is work going for my partner and me');
  assert.notEqual(r.intent, 'career');
});

test('unmatched questions fall back to general rather than guessing', () => {
  const r = classify('what colour should I paint my door');
  assert.equal(r.intent, 'general');
  assert.equal(r.decisive, false);
});

test('reports a decisive flag so confidence can reflect ambiguity', () => {
  assert.equal(classify('Should I consider changing my job this year?').decisive, true);
  assert.equal(classify('what should I prioritize this week').decisive, false);
});
