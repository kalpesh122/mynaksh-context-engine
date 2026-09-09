/**
 * Fetches the four backend services concurrently, with per-attempt timeouts,
 * bounded retries, an overall deadline, and a cache in front of each.
 *
 * Partial failure is a first-class outcome: fetchAll always resolves. A failed
 * service yields null and its name in failed[]; a 404 also lands in notFound[]
 * because "does not exist" and "is broken" need different handling upstream.
 */

import { TTLCache } from '../lib/cache.js';
import { UPSTREAM_SOURCES } from '../config/sources.js';

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
  constructor({ baseUrl, timeoutMs, retries, deadlineMs, cache, logger, fetchImpl = fetch, sources = UPSTREAM_SOURCES }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    /** Ceiling on the whole fan-out, not one attempt. */
    this.deadlineMs = deadlineMs ?? timeoutMs * (retries + 1) + 500;
    this.cache = cache;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    /** Declared, not hardcoded: adding a context source is a config change. */
    this.sources = sources;
  }

  async #attempt(path, deadline) {
    const ac = new AbortController();
    const budget = Math.max(1, Math.min(this.timeoutMs, deadline - Date.now()));
    const timer = setTimeout(() => ac.abort(), budget);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, { signal: ac.signal });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        // A 404 is an answer, not a blip — retrying it just burns the budget.
        err.retryable = RETRYABLE_STATUS.has(res.status);
        throw err;
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async #withRetries(service, path, deadline) {
    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        return await this.#attempt(path, deadline);
      } catch (err) {
        lastErr = err;
        const retryable = err.retryable !== false; // aborts and network errors are retryable
        if (!retryable || attempt === this.retries || deadline - Date.now() <= 0) break;
        await new Promise((r) => setTimeout(r, Math.random() * 50 * 2 ** attempt)); // full jitter
      }
    }
    throw new UpstreamError(service, lastErr?.message ?? 'unknown', lastErr?.status);
  }

  #fetchCached(service, cacheKey, path, log, deadline) {
    return this.cache.wrap(service, cacheKey, async () => {
      const started = performance.now();
      const data = await this.#withRetries(service, path, deadline);
      log.debug('upstream.fetched', { service, latencyMs: Math.round(performance.now() - started) });
      return data;
    });
  }

  /** @returns {Promise<{services:object, failed:string[], notFound:string[], timings:object, cacheHits:string[]}>} */
  async fetchAll(userId, log = this.logger) {
    const jobs = Object.entries(this.sources).map(
      ([service, src]) => [service, src.cacheKey(userId), src.path(userId)],
    );

    const started = performance.now();
    const deadline = Date.now() + this.deadlineMs;
    const settled = await Promise.allSettled(
      jobs.map(async ([service, key, path]) => {
        const t0 = performance.now();
        const { value, cached } = await this.#fetchCached(service, key, path, log, deadline);
        return { service, value, cached, ms: Math.round(performance.now() - t0) };
      }),
    );

    const services = {};
    const failed = [];
    const notFound = [];
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
        if (r.reason?.status === 404) notFound.push(service);
        log.warn('upstream.failed', { service, status: r.reason?.status ?? null, error: r.reason?.message });
      }
    });

    log.info('upstream.fanout', {
      totalMs: Math.round(performance.now() - started), timings, failed, notFound, cacheHits,
    });

    return { services, failed, notFound, timings, cacheHits };
  }
}
