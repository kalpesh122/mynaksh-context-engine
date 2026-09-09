/**
 * Runtime configuration. Env in, frozen object out, one place to look.
 * Defaults are chosen so `node src/main.js` works with no .env at all.
 */

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

/** Absolute expiry at the next local midnight. */
export function endOfLocalDay(now = Date.now()) {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

export function loadConfig(env = process.env) {
  return Object.freeze({
    port: num(env.PORT, 3000),
    logLevel: env.LOG_LEVEL ?? 'info',

    upstreamBaseUrl: env.UPSTREAM_BASE_URL ?? `http://127.0.0.1:${num(env.UPSTREAM_PORT, 4001)}`,
    upstreamPort: num(env.UPSTREAM_PORT, 4001),
    upstreamTimeoutMs: num(env.UPSTREAM_TIMEOUT_MS, 800),
    upstreamRetries: num(env.UPSTREAM_RETRIES, 2),
    /** Ceiling on the whole upstream fan-out, not one attempt. */
    upstreamDeadlineMs: num(env.UPSTREAM_DEADLINE_MS, 2500),

    llmProvider: env.LLM_PROVIDER ?? 'mock',
    llmTimeoutMs: num(env.LLM_TIMEOUT_MS, 15_000),
    openaiApiKey: env.OPENAI_API_KEY ?? '',
    openaiModel: env.OPENAI_MODEL ?? 'gpt-4o-mini',
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
    anthropicModel: env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',

    /**
     * Cache TTLs per upstream service. Rationale in lib/cache.js.
     *
     * Panchang is the exception: it is a DAILY value, so its rule is a function
     * returning midnight rather than a duration. A rolling TTL would let a
     * value cached at 23:30 be served past midnight — i.e. yesterday's almanac
     * presented as today's. Everyone rolls over together instead of drifting.
     */
    cacheTtls: {
      kundli: num(env.CACHE_TTL_KUNDLI_MS, 24 * 60 * 60 * 1000),
      panchang: endOfLocalDay,
      horoscope: num(env.CACHE_TTL_HOROSCOPE_MS, 30 * 60 * 1000),
      user: num(env.CACHE_TTL_USER_MS, 5 * 60 * 1000),
      _default: 60_000,
    },
  });
}
