/**
 * Upstream Client
 * ---------------
 * Fetches the four backend services CONCURRENTLY, with a per-attempt timeout,
 * bounded retries with jittered backoff, and a cache in front of each.
 *
 * Partial failure is a first-class outcome, not an exception. `fetchAll` always
 * resolves. A service that fails yields `null` and its name in `failed[]`; the
 * Personalization Engine then decides whether the answer is still worth giving
 * and the confidence score reflects what was lost. The alternative — failing
 * the whole request because Panchang was slow — would be a worse product for a
 * question that never needed Panchang.
 *
 * Retries apply only to transport errors, timeouts and 5xx. A 404 for an
 * unknown user is a real answer and retrying it just burns the budget.
 */

import { TTLCache } from '../lib/cache.js';

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class UpstreamError extends Error {
  constructor(service, cause, status) {
    super(`upstream ${service} failed: ${cause}`);
    this.name = 'UpstreamError';
    this.service = service;
    this.status = status ?? null;
  }
}

export class UpstreamClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl
   * @param {number} opts.timeoutMs   per attempt
   * @param {number} opts.retries     additional attempts after the first
   * @param {TTLCache} opts.cache
   * @param {object} opts.logger
   * @param {typeof fetch} [opts.fetchImpl] injectable for tests
   */
  constructor({ baseUrl, timeoutMs, retries, cache, logger, fetchImpl = fetch }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.cache = cache;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
  }

  async #attempt(path) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, { signal: ac.signal });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        err.retryable = RETRYABLE_STATUS.has(res.status);
        throw err;
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async #withRetries(service, path) {
    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        return await this.#attempt(path);
      } catch (err) {
        lastErr = err;
        const retryable = err.retryable !== false; // aborts and network errors are retryable
        if (!retryable || attempt === this.retries) break;
        // Full jitter backoff: 50ms, 100ms, ... randomised to avoid lock-step retries.
        const backoff = Math.random() * 50 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw new UpstreamError(service, lastErr?.message ?? 'unknown', lastErr?.status);
  }

  #fetchCached(service, cacheKey, path, log) {
    return this.cache.wrap(service, cacheKey, async () => {
      const started = performance.now();
      const data = await this.#withRetries(service, path);
      log.debug('upstream.fetched', { service, latencyMs: Math.round(performance.now() - started) });
      return data;
    });
  }

  /**
   * @returns {Promise<{services:Record<string,object|null>, failed:string[], timings:Record<string,number>, cacheHits:string[]}>}
   */
  async fetchAll(userId, log = this.logger) {
    const jobs = [
      ['user',      userId,   `/users/${encodeURIComponent(userId)}`],
      ['kundli',    userId,   `/kundli/${encodeURIComponent(userId)}`],
      ['horoscope', userId,   `/horoscope/${encodeURIComponent(userId)}`],
      // Panchang is identical for every user today: one shared cache key.
      ['panchang',  'global', `/panchang`],
    ];

    const started = performance.now();
    const settled = await Promise.allSettled(
      jobs.map(async ([service, key, path]) => {
        const t0 = performance.now();
        const { value, cached } = await this.#fetchCached(service, key, path, log);
        return { service, value, cached, ms: Math.round(performance.now() - t0) };
      }),
    );

    const services = {};
    const failed = [];
    const timings = {};
    const cacheHits = [];

    settled.forEach((r, i) => {
      const service = jobs[i][0];
      if (r.status === 'fulfilled') {
        services[service] = r.value.value;
        timings[service] = r.value.ms;
        if (r.value.cached) cacheHits.push(service);
      } else {
        services[service] = null;
        failed.push(service);
        log.warn('upstream.failed', { service, error: r.reason?.message });
      }
    });

    log.info('upstream.fanout', {
      totalMs: Math.round(performance.now() - started),
      timings, failed, cacheHits,
    });

    return { services, failed, timings, cacheHits };
  }
}
