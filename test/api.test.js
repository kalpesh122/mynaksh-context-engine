import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildApp } from '../src/server.js';
import { loadConfig } from '../src/config/app.config.js';
import { createLogger } from '../src/lib/logger.js';
import { USERS, KUNDLIS, HOROSCOPES, panchangFor } from '../mocks/fixtures.js';

const silent = createLogger({ level: 'error', stream: { write() {} } });

/** Counts calls so we can prove the debug endpoint never reaches the model. */
class CountingProvider {
  name = 'counting';
  calls = 0;
  async generate() { this.calls++; return { text: 'answer', model: 'counting-1', usage: null }; }
}

const fakeFetch = async (url) => {
  const body =
    url.includes('/users/') ? USERS.user_101 :
    url.includes('/kundli/') ? KUNDLIS.user_101 :
    url.includes('/horoscope/') ? HOROSCOPES.user_101 :
    panchangFor(new Date('2026-08-01T00:00:00Z'));
  return { ok: true, status: 200, json: async () => body };
};

let server, base, llm;

before(async () => {
  llm = new CountingProvider();
  const app = buildApp(loadConfig({ LOG_LEVEL: 'error' }), { logger: silent, llm, fetchImpl: fakeFetch });
  server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

const post = async (path, body) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, json: await res.json() };
};

test('POST /personalize returns the contract the brief specifies', async () => {
  const { status, json } = await post('/personalize', {
    userId: 'user_101', question: 'Should I consider changing my job this year?',
  });
  assert.equal(status, 200);
  assert.ok(typeof json.answer === 'string' && json.answer.length > 0);
  assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(json.confidence));
  assert.deepEqual([...json.sourcesUsed].sort(),
    ['10th House', 'Career Horoscope', 'Current Dasha', "Today's Panchang"].sort());
});

test('POST /debug/personalization does NOT invoke the LLM', async () => {
  const before = llm.calls;
  const { status, json } = await post('/debug/personalization', {
    userId: 'user_101', question: 'How does this month look for my relationship?',
  });
  assert.equal(status, 200);
  assert.equal(llm.calls, before, 'the model must not be called by the debug endpoint');
  assert.equal(json.llmInvoked, false);
  assert.equal(json.intent, 'relationship');
  assert.deepEqual(json.excludedContext, ['Career Horoscope']);
});

test('debug and personalize agree on the plan — one code path, no drift', async () => {
  const q = { userId: 'user_101', question: 'What should I focus on for my health?' };
  const dbg = (await post('/debug/personalization', q)).json;
  const real = (await post('/personalize', q)).json;
  assert.deepEqual(real.sourcesUsed, dbg.selectedContext);
  assert.equal(real.confidence, dbg.confidence);
  assert.equal(real.meta.intent, dbg.intent);
});

test('rejects a missing userId with 400, not 500', async () => {
  const { status, json } = await post('/personalize', { question: 'hello' });
  assert.equal(status, 400);
  assert.match(json.message, /userId is required/);
});

test('rejects a blank question', async () => {
  const { status } = await post('/personalize', { userId: 'user_101', question: '   ' });
  assert.equal(status, 400);
});

test('rejects an over-long question rather than paying to embed it', async () => {
  const { status } = await post('/personalize', { userId: 'user_101', question: 'x'.repeat(2001) });
  assert.equal(status, 400);
});

test('unknown route returns 404 with a request id', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  assert.ok(res.headers.get('x-request-id'));
});

test('GET /health reports the active provider', async () => {
  const res = await fetch(`${base}/health`);
  const json = await res.json();
  assert.equal(json.status, 'ok');
  assert.equal(json.provider, 'counting');
});

test('GET /config exposes the live intent and context configuration', async () => {
  const res = await fetch(`${base}/config`);
  const json = await res.json();
  assert.ok(json.intents.career, 'career intent should be introspectable');
  assert.deepEqual(json.intents.career.exclude, ['relationship_horoscope']);
  assert.equal(json.contexts.house_10.label, '10th House');
});

test('an LLM failure degrades to 503, not a raw 500', async () => {
  const failing = { name: 'failing', async generate() { throw new Error('provider exploded'); } };
  const app = buildApp(loadConfig({ LOG_LEVEL: 'error' }), { logger: silent, llm: failing, fetchImpl: fakeFetch });
  const s = http.createServer(app.handler);
  await new Promise((r) => s.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/personalize`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'user_101', question: 'my job' }),
    });
    assert.equal(res.status, 503);
    const json = await res.json();
    assert.equal(json.details.stage, 'llm');
  } finally { s.close(); }
});

// --- behaviours found during adversarial review -----------------------------

test('an unknown user is 404, not a confident answer built from global context', async () => {
  // Regression: this previously returned 200 with an answer grounded only in
  // Panchang (which is the same for everyone), i.e. a plausible reading for an
  // id the caller invented.
  const notFound = async (url) => {
    if (url.endsWith('/panchang')) return { ok: true, status: 200, json: async () => panchangFor(new Date()) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const app = buildApp(loadConfig({ LOG_LEVEL: 'error', UPSTREAM_RETRIES: '0' }),
    { logger: silent, llm: new CountingProvider(), fetchImpl: notFound });
  const s = http.createServer(app.handler);
  await new Promise((r) => s.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/personalize`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'ghost_999', question: 'my career' }),
    });
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.error, 'not_found');
  } finally { s.close(); }
});

test('a user service that is DOWN still degrades to an answer (not a 404)', async () => {
  // The distinction that makes the 404 above safe: 5xx means the user exists
  // and we cannot read them; 404 means they do not exist.
  const userDown = async (url) => {
    if (url.includes('/users/')) return { ok: false, status: 503, json: async () => ({}) };
    if (url.includes('/kundli/')) return { ok: true, status: 200, json: async () => KUNDLIS.user_101 };
    if (url.includes('/horoscope/')) return { ok: true, status: 200, json: async () => HOROSCOPES.user_101 };
    return { ok: true, status: 200, json: async () => panchangFor(new Date()) };
  };
  const app = buildApp(loadConfig({ LOG_LEVEL: 'error', UPSTREAM_RETRIES: '0' }),
    { logger: silent, llm: new CountingProvider(), fetchImpl: userDown });
  const s = http.createServer(app.handler);
  await new Promise((r) => s.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/personalize`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'user_101', question: 'Should I change my job?' }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.meta.personalized, false, 'must report that shaping fell back to defaults');
    assert.ok(json.sourcesUsed.length > 0);
  } finally { s.close(); }
});

test('zero grounding refuses with 503 and never calls the model', async () => {
  const allDown = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const llm2 = new CountingProvider();
  const app = buildApp(loadConfig({ LOG_LEVEL: 'error', UPSTREAM_RETRIES: '0' }),
    { logger: silent, llm: llm2, fetchImpl: allDown });
  const s = http.createServer(app.handler);
  await new Promise((r) => s.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/personalize`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'user_101', question: 'my career' }),
    });
    assert.equal(res.status, 503);
    const json = await res.json();
    assert.equal(json.error, 'service_unavailable', '503 must not be labelled internal_error');
    assert.equal(json.details.llmInvoked, false);
    assert.equal(llm2.calls, 0, 'must not pay for an ungrounded completion');
  } finally { s.close(); }
});

test('malformed userId is rejected at the edge, not passed upstream', async () => {
  for (const bad of ['../../etc/passwd', 'a b', 'x'.repeat(65), 'drop;table']) {
    const { status } = await post('/personalize', { userId: bad, question: 'my job' });
    assert.equal(status, 400, `"${bad}" should be rejected`);
  }
});

test('a JSON body that is not an object is 400, not 500', async () => {
  // JSON.parse("null") is valid JSON but reading .userId off it threw a TypeError.
  for (const raw of ['null', '[]', '"hello"', '7']) {
    const res = await fetch(`${base}/personalize`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: raw,
    });
    assert.equal(res.status, 400, `body ${raw} should be 400`);
  }
});

test('wrong method on a real path is 405 with an Allow header, not 404', async () => {
  const res = await fetch(`${base}/personalize`);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST');
  assert.equal((await res.json()).error, 'method_not_allowed');
});

test('HEAD works on GET routes, with no body', async () => {
  const res = await fetch(`${base}/health`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
});

test('an oversized body is rejected as 413 before it is parsed', async () => {
  const res = await fetch(`${base}/personalize`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'user_101', question: 'x'.repeat(70_000) }),
  });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error, 'payload_too_large');
});

test('sourcesUsed reports what reached the model, not what was selected', async () => {
  // If the budget drops context, claiming it as a source would be a lie.
  const app = buildApp(
    loadConfig({ LOG_LEVEL: 'error', PROMPT_CONTEXT_TOKEN_BUDGET: '40' }),
    { logger: silent, llm: new CountingProvider(), fetchImpl: fakeFetch },
  );
  const s = http.createServer(app.handler);
  await new Promise((r) => s.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/personalize`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'user_101', question: 'What should I prioritize this week?' }),
    });
    const json = await res.json();
    // debug shows the full selection; the answer reports only what was sent
    const dbg = (await post('/debug/personalization', { userId: 'user_101', question: 'What should I prioritize this week?' })).json;
    assert.equal(dbg.selectedContext.length, 11);
    assert.ok(json.sourcesUsed.length < 11, 'budget applied');
    assert.ok(json.sourcesUsed.every((l) => dbg.selectedContext.includes(l)));
  } finally { s.close(); }
});
