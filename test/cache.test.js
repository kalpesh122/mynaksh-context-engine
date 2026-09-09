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
  assert.deepEqual(first, { value: 'v', cached: false });
  assert.deepEqual(second, { value: 'v', cached: true }, 'producer must not run on a hit');
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
