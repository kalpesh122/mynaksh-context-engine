import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UpstreamClient } from '../src/services/upstream-client.js';
import { TTLCache } from '../src/lib/cache.js';
import { createLogger } from '../src/lib/logger.js';

const silent = createLogger({ level: 'error', stream: { write() {} } });
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const bad = (status) => ({ ok: false, status, json: async () => ({}) });

function client(fetchImpl, opts = {}) {
  return new UpstreamClient({
    baseUrl: 'http://upstream.test', timeoutMs: 200, retries: 2,
    cache: new TTLCache({ _default: 10_000 }), logger: silent, fetchImpl, ...opts,
  });
}

test('fetches all four services concurrently, not sequentially', async () => {
  let inFlight = 0, maxInFlight = 0;
  const c = client(async () => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 30));
    inFlight--;
    return ok({ v: 1 });
  });
  const started = Date.now();
  const { failed } = await c.fetchAll('user_101');
  const elapsed = Date.now() - started;

  assert.deepEqual(failed, []);
  assert.equal(maxInFlight, 4, 'all four requests should be in flight together');
  assert.ok(elapsed < 100, `concurrent fan-out should be ~30ms, took ${elapsed}ms`);
});

test('one failing service does not fail the request', async () => {
  const c = client(async (url) => (url.includes('/kundli/') ? bad(503) : ok({ v: 1 })), { retries: 0 });
  const { services, failed } = await c.fetchAll('user_101');
  assert.deepEqual(failed, ['kundli']);
  assert.equal(services.kundli, null);
  assert.deepEqual(services.horoscope, { v: 1 }, 'healthy services still return data');
});

test('retries 5xx up to the configured limit', async () => {
  let attempts = 0;
  const c = client(async (url) => {
    if (!url.includes('/kundli/')) return ok({ v: 1 });
    attempts++;
    return attempts <= 2 ? bad(503) : ok({ recovered: true });
  }, { retries: 2 });

  const { services, failed } = await c.fetchAll('user_101');
  assert.equal(attempts, 3, 'two failures then a success');
  assert.deepEqual(failed, []);
  assert.deepEqual(services.kundli, { recovered: true });
});

test('does NOT retry a 404 — an unknown user is an answer, not a blip', async () => {
  let attempts = 0;
  const c = client(async (url) => {
    if (!url.includes('/kundli/')) return ok({ v: 1 });
    attempts++;
    return bad(404);
  }, { retries: 3 });

  const { failed } = await c.fetchAll('nobody');
  assert.equal(attempts, 1, 'a 404 must not be retried');
  assert.deepEqual(failed, ['kundli']);
});

test('aborts a hanging upstream on timeout instead of blocking the request', async () => {
  const c = client(async (url, { signal }) => {
    if (!url.includes('/horoscope/')) return ok({ v: 1 });
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }, { timeoutMs: 50, retries: 0 });

  const started = Date.now();
  const { failed } = await c.fetchAll('user_101');
  assert.deepEqual(failed, ['horoscope']);
  assert.ok(Date.now() - started < 400, 'must not hang waiting on the slow service');
});

test('second call for the same user is served from cache', async () => {
  let calls = 0;
  const c = client(async () => { calls++; return ok({ v: 1 }); });
  await c.fetchAll('user_101');
  const first = calls;
  const { cacheHits } = await c.fetchAll('user_101');
  assert.equal(calls, first, 'no additional upstream calls');
  assert.deepEqual(cacheHits.sort(), ['horoscope', 'kundli', 'panchang', 'user']);
});

test('panchang is cached globally, so a different user still hits the cache', async () => {
  const urls = [];
  const c = client(async (url) => { urls.push(url); return ok({ v: 1 }); });
  await c.fetchAll('user_101');
  await c.fetchAll('user_202');
  assert.equal(urls.filter((u) => u.endsWith('/panchang')).length, 1,
    'panchang must be fetched once for all users');
});
