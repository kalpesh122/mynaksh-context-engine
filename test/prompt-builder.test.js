import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../src/core/personalization-engine.js';
import { buildPrompt, estimateTokens } from '../src/core/prompt-builder.js';
import { USERS, KUNDLIS, HOROSCOPES, panchangFor } from '../mocks/fixtures.js';

const services = () => ({
  user: USERS.user_101, kundli: KUNDLIS.user_101,
  horoscope: HOROSCOPES.user_101, panchang: panchangFor(new Date('2026-08-01T00:00:00Z')),
});

const careerPlan = () => buildPlan({
  question: 'Should I consider changing my job this year?',
  user: USERS.user_101, services: services(),
});

test('prompt contains every selected context item', () => {
  const plan = careerPlan();
  const { user } = buildPrompt({ question: 'Should I consider changing my job this year?', plan, user: USERS.user_101 });
  assert.match(user, /Networking may bring new opportunities/);
  assert.match(user, /10th house/);
  assert.match(user, /Rahu mahadasha/);
});

test('EXCLUDED context never leaks into the prompt', () => {
  const plan = careerPlan();
  const { user } = buildPrompt({ question: 'Should I consider changing my job this year?', plan, user: USERS.user_101 });
  // relationship horoscope was fetched and deliberately excluded
  assert.ok(!user.includes('Communication with your partner improves'),
    'excluded context must not reach the model');
  assert.ok(!user.includes('Relationship horoscope'));
});

test('prompt carries the personalization directives', () => {
  const plan = careerPlan();
  const { user } = buildPrompt({ question: 'q', plan, user: USERS.user_101 });
  assert.match(user, /reply entirely in English/);
  assert.match(user, /Tone: Motivational/);
  assert.match(user, /at most 250 words/);
  assert.match(user, /Address the user as Aarav/);
});

test('low confidence adds a hedging instruction', () => {
  const s = services();
  s.kundli = null; s.horoscope = null;
  const plan = buildPlan({ question: 'Should I consider changing my job this year?', user: USERS.user_101, services: s, failedServices: ['kundli', 'horoscope'] });
  assert.equal(plan.confidence, 'LOW');
  const { user } = buildPrompt({ question: 'q', plan, user: USERS.user_101 });
  assert.match(user, /be measured and avoid strong claims/);
});

test('system prompt forbids inventing placements', () => {
  const plan = careerPlan();
  const { system } = buildPrompt({ question: 'q', plan, user: USERS.user_101 });
  assert.match(system, /never invent placements/i);
});

test('token estimate is reported for prompt-size logging', () => {
  assert.equal(estimateTokens('a'.repeat(400)), 100);
});
