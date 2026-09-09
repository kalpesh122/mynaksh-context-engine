import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TTLCache } from '../src/lib/cache.js';

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('per-namespace TTLs expire independently', () => {
  const clock = fakeClock();
  const c = new TTLCache({ kundli: 1000, user: 100 }, { now: clock.now });
  c.set('kundli', 'u1', { lagna: 'Libra' });
  c.set('user', 'u1', { name: 'Aarav' });

  clock.advance(150);
  assert.equal(c.get('user', 'u1'), undefined, 'short-TTL user entry should be gone');
  assert.deepEqual(c.get('kundli', 'u1'), { lagna: 'Libra' }, 'long-TTL kundli entry should survive');

  clock.advance(1000);
  assert.equal(c.get('kundli', 'u1'), undefined);
});

test('panchang shares one key across users, so user count does not multiply fetches', async () => {
  const c = new TTLCache({ panchang: 10_000 });
  let fetches = 0;
  const producer = async () => { fetches++; return { date: '2026-09-09' }; };

  await c.wrap('panchang', 'global', producer);
  await c.wrap('panchang', 'global', producer);
  await c.wrap('panchang', 'global', producer);

  assert.equal(fetches, 1, 'three users, one upstream call');
});

test('wrap reports whether the value was cached', async () => {
  const c = new TTLCache({ user: 10_000 });
  const first = await c.wrap('user', 'u1', async () => 'v');
  const second = await c.wrap('user', 'u1', async () => 'v2');
  assert.equal(first.value, 'v');
  assert.equal(first.cached, false);
  assert.equal(second.value, 'v', 'producer must not run on a hit');
  assert.equal(second.cached, true);
});

test('stats expose hit rate for observability', async () => {
  const c = new TTLCache({ user: 10_000 });
  await c.wrap('user', 'u1', async () => 1);
  await c.wrap('user', 'u1', async () => 1);
  const s = c.stats();
  assert.equal(s.entries, 1);
  assert.equal(s.hits, 1);
  assert.equal(s.misses, 1);
  assert.equal(s.hitRate, 0.5);
});

test('a function TTL expires on a calendar boundary, not after a duration', () => {
  // 23:30 local. A rolling 1h TTL would serve this value until 00:30 the NEXT
  // day — yesterday's almanac presented as today's. It must die at midnight.
  const at2330 = new Date(); at2330.setHours(23, 30, 0, 0);
  let t = at2330.getTime();
  const endOfDay = (now) => { const d = new Date(now); d.setHours(24, 0, 0, 0); return d.getTime(); };
  const c = new TTLCache({ panchang: endOfDay }, { now: () => t });

  c.set('panchang', 'global', { date: 'today' });
  t += 20 * 60 * 1000;                       // 23:50, same day
  assert.deepEqual(c.get('panchang', 'global'), { date: 'today' });

  t += 20 * 60 * 1000;                       // 00:10, next day
  assert.equal(c.get('panchang', 'global'), undefined, 'must not survive midnight');
});

test('concurrent cold reads are coalesced into a single upstream call', async () => {
  const c = new TTLCache({ user: 10_000 });
  let calls = 0;
  const slow = async () => { calls++; await new Promise(r => setTimeout(r, 30)); return 'v'; };

  const results = await Promise.all(Array.from({ length: 30 }, () => c.wrap('user', 'u1', slow)));

  assert.equal(calls, 1, '30 concurrent cold reads must produce ONE upstream call');
  assert.ok(results.every(r => r.value === 'v'));
  assert.equal(results.filter(r => r.coalesced).length, 29);
  assert.equal(c.stats().inflight, 0, 'in-flight map must drain');
});

test('a failed in-flight fetch does not poison later attempts', async () => {
  const c = new TTLCache({ user: 10_000 });
  let n = 0;
  const flaky = async () => { n++; if (n === 1) throw new Error('boom'); return 'ok'; };

  await assert.rejects(() => c.wrap('user', 'u1', flaky));
  const second = await c.wrap('user', 'u1', flaky);
  assert.equal(second.value, 'ok', 'a later call must be able to retry');
  assert.equal(c.stats().inflight, 0);
});
