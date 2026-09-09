#!/usr/bin/env node
/**
 * Composition root. Every dependency is constructed here and injected, so tests
 * build the same graph with a fake fetch and a fake clock.
 */

import http from 'node:http';
import { loadConfig } from './config/app.config.js';
import { createLogger } from './lib/logger.js';
import { TTLCache } from './lib/cache.js';
import { UpstreamClient } from './services/upstream-client.js';
import { createProvider } from './llm/provider.js';
import { PersonalizeService } from './core/personalize-service.js';
import { createRouter, HttpError } from './http/router.js';
import { INTENTS } from './config/personalization.config.js';
import { CONTEXT_REGISTRY, assertKnownContextIds } from './config/context-registry.js';

/** Fail fast on a config typo rather than silently dropping context at runtime. */
export function validateConfig(intents = INTENTS) {
  for (const [id, cfg] of Object.entries(intents)) {
    for (const field of ['primary', 'secondary', 'exclude']) {
      const ids = cfg[field];
      if (ids === '*' || ids == null) continue;
      assertKnownContextIds(ids, `INTENTS.${id}.${field}`);
    }

    // An id that is both required and forbidden is a contradiction; report it
    // at boot rather than resolving it silently on every request.
    const excluded = new Set(cfg.exclude === '*' ? [] : (cfg.exclude ?? []));
    for (const field of ['primary', 'secondary']) {
      const ids = cfg[field] === '*' ? [] : (cfg[field] ?? []);
      const clash = ids.filter((x) => excluded.has(x));
      if (clash.length) {
        throw new Error(
          `Config error in INTENTS.${id}: ${clash.join(', ')} listed in both ${field} and exclude`,
        );
      }
    }
  }
}

/** Constrained at the edge so a malformed id fails visibly, not as four upstream 404s. */
const USER_ID_RE = /^[A-Za-z0-9_.:@-]{1,64}$/;

function requireFields(body) {
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!userId) throw new HttpError(400, 'userId is required and must be a non-empty string');
  if (!USER_ID_RE.test(userId)) {
    throw new HttpError(400, 'userId must be 1-64 chars of letters, digits, or _ . : @ -');
  }
  if (!question) throw new HttpError(400, 'question is required and must be a non-empty string');
  if (question.length > 2000) throw new HttpError(400, 'question must be 2000 characters or fewer');
  return { userId, question };
}

export function buildApp(config = loadConfig(), deps = {}) {
  validateConfig();

  const logger = deps.logger ?? createLogger({ level: config.logLevel });
  const cache = deps.cache ?? new TTLCache(config.cacheTtls);
  const upstream = deps.upstream ?? new UpstreamClient({
    baseUrl: config.upstreamBaseUrl,
    timeoutMs: config.upstreamTimeoutMs,
    retries: config.upstreamRetries,
    deadlineMs: config.upstreamDeadlineMs,
    cache, logger,
    fetchImpl: deps.fetchImpl,
  });
  const llm = deps.llm ?? createProvider(config, logger);
  const service = new PersonalizeService({ upstream, llm, logger });

  const routes = {
    'POST /personalize': async ({ body, log }) => ({
      status: 200,
      body: await service.personalize(requireFields(body), log),
    }),

    'POST /debug/personalization': async ({ body, log }) => ({
      status: 200,
      body: await service.debug(requireFields(body), log),
    }),

    'GET /health': async () => ({
      status: 200,
      body: { status: 'ok', provider: llm.name, uptimeSec: Math.round(process.uptime()) },
    }),

    /** Introspection: the live intent/context config. */
    'GET /config': async () => ({
      status: 200,
      body: {
        intents: Object.fromEntries(Object.entries(INTENTS).map(([id, c]) => [id, {
          description: c.description, primary: c.primary, secondary: c.secondary, exclude: c.exclude,
        }])),
        contexts: Object.fromEntries(Object.entries(CONTEXT_REGISTRY).map(([id, c]) => [id, { label: c.label, service: c.service }])),
        cache: cache.stats(),
      },
    }),
  };

  return { handler: createRouter({ routes, logger }), logger, config, cache, llm, service };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const app = buildApp(config);
  const server = http.createServer(app.handler);

  server.listen(config.port, () => {
    app.logger.info('server.listening', {
      port: config.port, provider: app.llm.name, upstream: config.upstreamBaseUrl,
    });
  });

  // Drain in-flight requests: SIGTERM during a deploy should not cut responses.
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      app.logger.info('server.shutdown', { signal });
      server.close(() => {
        app.logger.info('server.closed', {});
        process.exit(0);
      });
      // Do not hang forever on a wedged keep-alive connection.
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}
