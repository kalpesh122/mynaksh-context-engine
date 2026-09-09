/**
 * In-memory TTL cache.
 *
 * Per-namespace TTLs, because the four upstream services have genuinely
 * different volatility and one global TTL would be wrong for all of them:
 *
 *   kundli    - derived from immutable birth details. Effectively static;
 *               cached longest. Recomputing it per request is pure waste.
 *   panchang  - the same for EVERY user on a given day. Cached under a single
 *               shared key, not per user — this is the biggest single saving
 *               and the reason the cache key is per-namespace, not per-request.
 *               Its TTL is a FUNCTION, not a duration: a daily almanac must
 *               expire at midnight, not on a rolling window, or a value cached
 *               at 23:30 is served into the following day.
 *   horoscope - per user, regenerated daily.
 *   user      - per user, changes when they edit their profile; shortest TTL
 *               so preference edits (tone, language) show up quickly.
 *
 * Deliberately not LRU-bounded: see README "production concerns left out".
 */

export class TTLCache {
  #store = new Map();
  /**
   * In-flight producers, keyed the same way as #store.
   *
   * Without this, N concurrent cold requests for the same key each fire their
   * own upstream call — measured at 30 concurrent requests producing 120
   * upstream fetches instead of 4. Coalescing them onto one promise turns a
   * thundering herd into a single fetch that everyone awaits. This matters more
   * as traffic grows, which is the direction this product is going.
   */
  #inflight = new Map();
  #hits = 0;
  #misses = 0;
  #coalesced = 0;

  /**
   * @param {Record<string, number|((now:number)=>number)>} ttls
   *   namespace -> ttl in ms, OR a function taking `now` and returning an
   *   ABSOLUTE expiry timestamp (used for values that expire on a calendar
   *   boundary rather than after a duration).
   */
  constructor(ttls = {}, { now = () => Date.now() } = {}) {
    this.ttls = ttls;
    this.now = now;
  }

  #key(ns, key) { return `${ns}:${key}`; }

  get(ns, key) {
    const k = this.#key(ns, key);
    const hit = this.#store.get(k);
    if (!hit) { this.#misses++; return undefined; }
    if (hit.expiresAt <= this.now()) {
      this.#store.delete(k);
      this.#misses++;
      return undefined;
    }
    this.#hits++;
    return hit.value;
  }

  set(ns, key, value) {
    const rule = this.ttls[ns] ?? this.ttls._default ?? 60_000;
    const now = this.now();
    const expiresAt = typeof rule === 'function' ? rule(now) : now + rule;
    this.#store.set(this.#key(ns, key), { value, expiresAt });
    return value;
  }

  /**
   * Fetch-through with single-flight. Returns {value, cached, coalesced}.
   * `coalesced` means this caller joined an in-flight fetch rather than
   * starting one — distinct from a cache hit, and worth seeing separately in
   * the logs when diagnosing load.
   */
  async wrap(ns, key, producer) {
    const cached = this.get(ns, key);
    if (cached !== undefined) return { value: cached, cached: true, coalesced: false };

    const k = this.#key(ns, key);
    const existing = this.#inflight.get(k);
    if (existing) {
      this.#coalesced++;
      return { value: await existing, cached: false, coalesced: true };
    }

    const promise = (async () => {
      const value = await producer();
      this.set(ns, key, value);
      return value;
    })();

    this.#inflight.set(k, promise);
    try {
      return { value: await promise, cached: false, coalesced: false };
    } finally {
      // Cleared on failure too, so a failed fetch does not poison later attempts.
      this.#inflight.delete(k);
    }
  }

  stats() {
    const total = this.#hits + this.#misses;
    return {
      entries: this.#store.size,
      hits: this.#hits,
      misses: this.#misses,
      coalesced: this.#coalesced,
      inflight: this.#inflight.size,
      hitRate: total === 0 ? 0 : Number((this.#hits / total).toFixed(3)),
    };
  }

  clear() { this.#store.clear(); }
}
