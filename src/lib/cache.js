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
 *   horoscope - per user, regenerated daily.
 *   user      - per user, changes when they edit their profile; shortest TTL
 *               so preference edits (tone, language) show up quickly.
 *
 * Deliberately not LRU-bounded: see README "production concerns left out".
 */

export class TTLCache {
  #store = new Map();
  #hits = 0;
  #misses = 0;

  /** @param {Record<string, number>} ttls namespace -> ttl in ms */
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
    const ttl = this.ttls[ns] ?? this.ttls._default ?? 60_000;
    this.#store.set(this.#key(ns, key), { value, expiresAt: this.now() + ttl });
    return value;
  }

  /** Fetch-through helper: returns {value, cached}. */
  async wrap(ns, key, producer) {
    const cached = this.get(ns, key);
    if (cached !== undefined) return { value: cached, cached: true };
    const value = await producer();
    this.set(ns, key, value);
    return { value, cached: false };
  }

  stats() {
    const total = this.#hits + this.#misses;
    return {
      entries: this.#store.size,
      hits: this.#hits,
      misses: this.#misses,
      hitRate: total === 0 ? 0 : Number((this.#hits / total).toFixed(3)),
    };
  }

  clear() { this.#store.clear(); }
}
