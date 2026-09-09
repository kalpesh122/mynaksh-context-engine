/**
 * Runtime configuration. Env in, frozen object out, one place to look.
 * Defaults are chosen so `node src/main.js` works with no .env at all.
 */

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

export function loadConfig(env = process.env) {
  return Object.freeze({
    port: num(env.PORT, 3000),
    logLevel: env.LOG_LEVEL ?? 'info',

    upstreamBaseUrl: env.UPSTREAM_BASE_URL ?? `http://127.0.0.1:${num(env.UPSTREAM_PORT, 4001)}`,
    upstreamPort: num(env.UPSTREAM_PORT, 4001),
    upstreamTimeoutMs: num(env.UPSTREAM_TIMEOUT_MS, 800),
    upstreamRetries: num(env.UPSTREAM_RETRIES, 2),

    llmProvider: env.LLM_PROVIDER ?? 'mock',
    llmTimeoutMs: num(env.LLM_TIMEOUT_MS, 15_000),
    openaiApiKey: env.OPENAI_API_KEY ?? '',
    openaiModel: env.OPENAI_MODEL ?? 'gpt-4o-mini',
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
    anthropicModel: env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',

    /**
     * Cache TTLs in ms, per upstream service. Rationale in lib/cache.js.
     * Panchang expires at the end of the local day rather than on a rolling
     * window, so everyone rolls over together instead of drifting.
     */
    cacheTtls: {
      kundli: num(env.CACHE_TTL_KUNDLI_MS, 24 * 60 * 60 * 1000),
      panchang: num(env.CACHE_TTL_PANCHANG_MS, 60 * 60 * 1000),
      horoscope: num(env.CACHE_TTL_HOROSCOPE_MS, 30 * 60 * 1000),
      user: num(env.CACHE_TTL_USER_MS, 5 * 60 * 1000),
      _default: 60_000,
    },
  });
}
