import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, toInternalView, toDebugView } from '../src/core/personalization-engine.js';
import { USERS, KUNDLIS, HOROSCOPES, panchangFor } from '../mocks/fixtures.js';

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
  assert.deepEqual([...plan.selectedContextLabels].sort(),
    ['10th House', 'Career Horoscope', 'Current Dasha', "Today's Panchang"].sort(),
    'content is what matters here; ordering has its own test');
});

test('context is ordered by priority within a tier, so a budget cut is principled', () => {
  // Truncation drops from the end, so the end must be the least useful thing.
  // Today-specific readings before the standing birth chart.
  const plan = buildPlan({
    question: 'What should I prioritize this week?', user: USERS.user_101, services: services(),
  });
  assert.equal(plan.intent, 'general');
  const labels = plan.selectedContextLabels;
  const idx = (l) => labels.indexOf(l);

  assert.ok(idx('Career Horoscope') < idx('Lagna'),
    "today's reading must outrank the standing chart");
  assert.ok(idx("Today's Panchang") < idx('Moon Sign'),
    'daily almanac must outrank a birth-chart constant');
  assert.ok(idx('Current Dasha') < idx('10th House'),
    'the active period must outrank a static house');
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

test('a config listing an id as both primary and exclude is rejected at boot', async () => {
  const { validateConfig } = await import('../src/server.js');
  const { INTENTS } = await import('../src/config/personalization.config.js');

  // Injected, not monkey-patched. Before config was a parameter this test had to
  // mutate a module export — the smell that showed the engine was not composable.
  const contradictory = { ...INTENTS, career: { ...INTENTS.career, exclude: ['house_10'] } };
  assert.throws(() => validateConfig(contradictory), /both primary and exclude/);
  assert.doesNotThrow(() => validateConfig(), 'the shipped config must still be valid');
});

test('two configurations can coexist in one process', () => {
  // The point of "configuration-driven": a different rule set is a different
  // argument, not a different deployment.
  const alternate = {
    DEFAULT_INTENT: 'general',
    CLASSIFIER_WEIGHTS: { phrase: 3, strong: 2, term: 1, negative: -2, minScoreForIntent: 2, decisiveMargin: 2 },
    RESPONSE_SHAPING: {
      language: { _default: 'English' }, tone: { _default: 'Neutral' },
      lengthBySubscription: { _default: 50 }, lengthMultiplierByIntent: { _default: 1 },
    },
    INTENTS: {
      general: { id: 'general', match: { phrases: [], any: [], negative: [] }, primary: '*', secondary: [], exclude: [] },
      // A career intent that, unlike the shipped one, wants the panchang only.
      career: {
        id: 'career',
        match: { phrases: [], strong: ['job'], any: [], negative: [] },
        primary: ['panchang_today'], secondary: [], exclude: ['career_horoscope'],
      },
    },
  };

  const q = 'should I change my job';
  const shipped = buildPlan({ question: q, user: USERS.user_101, services: services() });
  const custom = buildPlan({ question: q, user: USERS.user_101, services: services(), config: alternate });

  assert.equal(shipped.intent, 'career');
  assert.equal(custom.intent, 'career');
  assert.deepEqual([...shipped.selectedContextLabels].sort(),
    ['10th House', 'Career Horoscope', 'Current Dasha', "Today's Panchang"].sort());
  assert.deepEqual(custom.selectedContextLabels, ["Today's Panchang"]);
  assert.deepEqual(custom.excludedContextLabels, ['Career Horoscope']);
  assert.equal(custom.maxWords, 50, 'shaping comes from the injected config too');

  // and the shipped config is untouched by the alternate run
  const again = buildPlan({ question: q, user: USERS.user_101, services: services() });
  assert.deepEqual(again.selectedContextLabels, shipped.selectedContextLabels);
});

test('a partial config merges over the defaults', () => {
  // The realistic override: new intent rules, everything else inherited.
  const plan = buildPlan({
    question: 'should I change my job',
    user: USERS.user_101,
    services: services(),
    config: {
      INTENTS: {
        general: { id: 'general', match: { phrases: [], any: [], negative: [] }, primary: '*', secondary: [], exclude: [] },
        career: { id: 'career', match: { phrases: [], strong: ['job'], any: [], negative: [] },
                  primary: ['panchang_today'], secondary: [], exclude: [] },
      },
    },
  });
  assert.equal(plan.intent, 'career');
  assert.deepEqual(plan.selectedContextLabels, ["Today's Panchang"], 'injected rules applied');
  assert.equal(plan.language, 'English', 'shaping inherited from the default config');
  assert.equal(plan.maxWords, 250, 'weights and shaping tables inherited too');
});

test('replacing a nested table wholesale reports what is missing', () => {
  // The merge is shallow, so overriding RESPONSE_SHAPING replaces it entirely.
  // That must say so, not fail as "cannot read properties of undefined".
  assert.throws(() => buildPlan({
    question: 'my health',
    user: USERS.user_101,
    services: services(),
    config: { RESPONSE_SHAPING: { language: { _default: 'French' } } },
  }), /missing RESPONSE_SHAPING\.lengthBySubscription/);
});

test('an injected config naming an unknown context id fails with a clear message', () => {
  // Regression: this used to surface as
  // "TypeError: Cannot read properties of undefined (reading 'service')".
  assert.throws(() => buildPlan({
    question: 'should I change my job',
    user: USERS.user_101,
    services: services(),
    config: {
      INTENTS: {
        general: { id: 'general', match: { phrases: [], any: [], negative: [] }, primary: '*', secondary: [], exclude: [] },
        career: { id: 'career', match: { phrases: [], strong: ['job'], any: [], negative: [] }, primary: ['saturn_transit'], secondary: [], exclude: [] },
      },
    },
  }), /Unknown context id "saturn_transit"/);
});
