import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, toInternalView, toDebugView } from '../src/core/personalization-engine.js';
import { USERS, KUNDLIS, HOROSCOPES, panchangFor } from '../src/services/fixtures.js';

const services = () => ({
  user: USERS.user_101,
  kundli: KUNDLIS.user_101,
  horoscope: HOROSCOPES.user_101,
  panchang: panchangFor(new Date('2026-08-01T00:00:00Z')),
});

test('career question selects exactly the configured context', () => {
  const plan = buildPlan({
    question: 'Should I consider changing my job this year?',
    user: USERS.user_101, services: services(),
  });
  assert.equal(plan.intent, 'career');
  assert.deepEqual(plan.selectedContextLabels,
    ['10th House', 'Career Horoscope', 'Current Dasha', "Today's Panchang"]);
});

test('excluded context never appears in selection, even though it was fetched', () => {
  const plan = buildPlan({
    question: 'Should I consider changing my job this year?',
    user: USERS.user_101, services: services(),
  });
  assert.deepEqual(plan.excludedContextLabels, ['Relationship Horoscope']);
  assert.ok(!plan.selectedContextLabels.includes('Relationship Horoscope'));
  // and the data WAS available — exclusion is a decision, not a gap
  assert.ok(services().horoscope.relationship);
});

test('general widens to all registered context', () => {
  const plan = buildPlan({
    question: 'What should I prioritize this week?',
    user: USERS.user_101, services: services(),
  });
  assert.equal(plan.intent, 'general');
  assert.equal(plan.selectedContextLabels.length, 11);
  assert.deepEqual(plan.excludedContextLabels, []);
});

test('a failed service becomes missing context and lowers coverage', () => {
  const s = services();
  s.kundli = null; // kundli service down
  const plan = buildPlan({
    question: 'Should I consider changing my job this year?',
    user: USERS.user_101, services: s, failedServices: ['kundli'],
  });
  assert.deepEqual(plan.missingContextLabels, ['10th House', 'Current Dasha']);
  assert.equal(plan.coverage, 0.5);
  assert.equal(plan.confidence, 'MEDIUM');
  assert.deepEqual(plan.failedServices, ['kundli']);
});

test('response shaping comes from the user profile, not hardcoded', () => {
  const s = services();
  s.user = USERS.user_202; // hi / free / calm
  const plan = buildPlan({ question: 'Should I invest my savings?', user: USERS.user_202, services: s });
  assert.equal(plan.language, 'Hindi');
  assert.equal(plan.tone, 'Calm');
  assert.equal(plan.maxWords, 108); // free tier 120 * finance multiplier 0.9
});

test('unknown language and tone fall back to defaults instead of throwing', () => {
  const s = services();
  const weird = { ...USERS.user_101, language: 'xx', tonePreference: 'sarcastic', subscription: 'gold' };
  s.user = weird;
  const plan = buildPlan({ question: 'how is my health', user: weird, services: s });
  assert.equal(plan.language, 'English');
  assert.equal(plan.tone, 'Neutral');
  assert.equal(plan.maxWords, 108); // _default 120 * health 0.9
});

test('internal view matches the shape the brief specifies', () => {
  const plan = buildPlan({
    question: 'Should I consider changing my job this year?',
    user: USERS.user_101, services: services(),
  });
  assert.deepEqual(Object.keys(toInternalView(plan)),
    ['intent', 'language', 'tone', 'maxWords', 'selectedContext', 'excludedContext']);
});

test('debug view states plainly that no LLM was invoked', () => {
  const plan = buildPlan({ question: 'my health', user: USERS.user_101, services: services() });
  assert.equal(toDebugView(plan).llmInvoked, false);
});
