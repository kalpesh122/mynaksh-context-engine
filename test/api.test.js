import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildApp } from '../src/server.js';
import { loadConfig } from '../src/config/app.config.js';
import { createLogger } from '../src/lib/logger.js';
import { USERS, KUNDLIS, HOROSCOPES, panchangFor } from '../src/services/fixtures.js';

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
  assert.deepEqual(json.sourcesUsed, ['10th House', 'Career Horoscope', 'Current Dasha', "Today's Panchang"]);
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
  const res = await fetch(`http://127.0.0.1:${s.address().port}/personalize`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'user_101', question: 'my job' }),
  });
  assert.equal(res.status, 503);
  const json = await res.json();
  assert.equal(json.details.stage, 'llm');
  s.close();
});
