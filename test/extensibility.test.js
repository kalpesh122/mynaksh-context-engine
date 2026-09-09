import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildApp } from '../src/server.js';
import { loadConfig } from '../src/config/app.config.js';
import { createLogger } from '../src/lib/logger.js';
import { buildPlan } from '../src/core/personalization-engine.js';
import { UPSTREAM_SOURCES } from '../src/config/sources.js';
import * as shippedRules from '../src/config/personalization.config.js';
import * as shippedRegistry from '../src/config/context-registry.js';
import { USERS, KUNDLIS, HOROSCOPES, panchangFor } from '../mocks/fixtures.js';

const silent = createLogger({ level: 'error', stream: { write() {} } });

/**
 * The extensibility claim, executed rather than asserted in prose.
 *
 * Everything below adds a FIFTH upstream service and a new piece of context
 * that reaches the model — without touching a single file in src/. If any of
 * this required a production code change, the claim in the README would be
 * false and this test would not compile.
 */

// 1. A new upstream service. Structural facts only: where, and under what identity.
const transitSource = {
  path: (userId) => `/transits/${encodeURIComponent(userId)}`,
  cacheKey: (userId) => userId,
};

// 2. A new context item pointing at it.
const saturnTransit = {
  id: 'saturn_transit',
  label: 'Saturn Transit',
  service: 'transit',
  priority: 25,
  extract: (t) => t?.saturn ?? null,
  render: (v) => `Saturn transit: ${v.house}th house, ${v.phase}`,
};

const REGISTRY = { ...shippedRegistry.CONTEXT_REGISTRY, saturn_transit: saturnTransit };

// 3. Config bundle: registry + the intents that want the new context.
const extendedConfig = {
  CONTEXT_REGISTRY: REGISTRY,
  ALL_CONTEXT_IDS: Object.keys(REGISTRY),
  labelsFor: (ids) => ids.map((id) => REGISTRY[id].label),
  INTENTS: {
    ...shippedRules.INTENTS,
    career: {
      ...shippedRules.INTENTS.career,
      secondary: [...shippedRules.INTENTS.career.secondary, 'saturn_transit'],
    },
  },
};

const services = () => ({
  user: USERS.user_101,
  kundli: KUNDLIS.user_101,
  horoscope: HOROSCOPES.user_101,
  panchang: panchangFor(new Date('2026-08-01T00:00:00Z')),
  transit: { saturn: { house: 10, phase: 'sade sati' } },
});

test('a new context source reaches the model with no production code change', () => {
  const plan = buildPlan({
    question: 'Should I consider changing my job this year?',
    user: USERS.user_101,
    services: services(),
    config: extendedConfig,
  });

  assert.equal(plan.intent, 'career');
  assert.ok(plan.selectedContextLabels.includes('Saturn Transit'),
    'the new context must be selected for career questions');
  // priority 25 sits between the horoscopes (10) and the dasha (30)
  assert.ok(plan.selectedContextLabels.indexOf('Saturn Transit')
          < plan.selectedContextLabels.indexOf('Current Dasha'),
    'the new context must take its declared place in the ordering');
});

test('the new source is fetched concurrently with the original four', async () => {
  const seen = [];
  const fakeFetch = async (url) => {
    seen.push(new URL(url).pathname);
    const body =
      url.includes('/users/') ? USERS.user_101 :
      url.includes('/kundli/') ? KUNDLIS.user_101 :
      url.includes('/horoscope/') ? HOROSCOPES.user_101 :
      url.includes('/transits/') ? { saturn: { house: 10, phase: 'sade sati' } } :
      panchangFor(new Date());
    return { ok: true, status: 200, json: async () => body };
  };

  const app = buildApp(loadConfig({ LOG_LEVEL: 'error' }), {
    logger: silent,
    fetchImpl: fakeFetch,
    sources: { ...UPSTREAM_SOURCES, transit: transitSource },
    llm: { name: 'stub', async generate() { return { text: 'ok', model: 'stub', usage: null }; } },
  });

  const s = http.createServer(app.handler);
  await new Promise((r) => s.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/personalize`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'user_101', question: 'Should I change my job?' }),
    });
    assert.equal(res.status, 200);
    assert.ok(seen.includes('/transits/user_101'), 'the declared source must be fetched');
    assert.equal(seen.length, 5, 'five services, one fan-out');
  } finally { s.close(); }
});

test('an unknown source is a config error, not a silent gap', () => {
  // Registry entry pointing at a service nobody declared: the context simply
  // never resolves, which is the correct degrade — but it must be visible.
  const orphan = { ...REGISTRY, ghost: { id: 'ghost', label: 'Ghost', service: 'nowhere', priority: 1, extract: () => null, render: () => '' } };
  const plan = buildPlan({
    question: 'Should I change my job this year?',
    user: USERS.user_101,
    services: services(),
    config: {
      CONTEXT_REGISTRY: orphan,
      ALL_CONTEXT_IDS: Object.keys(orphan),
      labelsFor: (ids) => ids.map((id) => orphan[id].label),
      INTENTS: { ...shippedRules.INTENTS, career: { ...shippedRules.INTENTS.career, secondary: ['ghost'] } },
    },
  });
  assert.ok(plan.missingContextLabels.includes('Ghost'),
    'unresolvable context must be reported as missing, not vanish');
});
