/**
 * In-memory TTL cache with per-namespace expiry and single-flight.
 *
 * A namespace TTL is either a duration in ms, or a function (now) => absolute
 * expiry — panchang is a daily value and must die at midnight, not after an
 * hour, or a value cached at 23:30 is served into the next day.
 *
 * Single-flight matters: without it, N concurrent cold reads each fire their own
 * upstream call (measured: 30 requests -> 120 fetches instead of 4).
 */

export class TTLCache {
  #store = new Map();
  #inflight = new Map();
  #hits = 0;
  #misses = 0;
  #coalesced = 0;

  /** @param {Record<string, number|((now:number)=>number)>} ttls */
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
    this.#store.set(this.#key(ns, key), {
      value,
      expiresAt: typeof rule === 'function' ? rule(now) : now + rule,
    });
    return value;
  }

  /** @returns {Promise<{value:any, cached:boolean, coalesced:boolean}>} */
  async wrap(ns, key, producer) {
    const cached = this.get(ns, key);
    if (cached !== undefined) return { value: cached, cached: true, coalesced: false };

    const k = this.#key(ns, key);
    const existing = this.#inflight.get(k);
    if (existing) {
      this.#coalesced++;
      return { value: await existing, cached: false, coalesced: true };
    }

    const promise = (async () => this.set(ns, key, await producer()))();
    this.#inflight.set(k, promise);
    try {
      return { value: await promise, cached: false, coalesced: false };
    } finally {
      this.#inflight.delete(k); // also on failure, so one error cannot wedge the key
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
