#!/usr/bin/env node
/**
 * Mock upstream services.
 *
 * Runs as a SEPARATE process on its own port rather than as an in-process stub,
 * so the concurrency, timeout, retry and partial-failure paths in
 * UpstreamClient exercise real HTTP instead of resolved promises. A stub would
 * have made those code paths untestable in the way that matters.
 *
 * Fault injection (env, all optional):
 *   UPSTREAM_LATENCY_MS   - artificial delay per request
 *   UPSTREAM_FAILURE_RATE - 0..1 probability of a 503 per request
 *   UPSTREAM_FAIL_SERVICE - comma list, e.g. "kundli" to fail one deterministically
 */

import http from 'node:http';
import { USERS, KUNDLIS, HOROSCOPES, panchangFor } from './fixtures.js';

const PORT = Number(process.env.UPSTREAM_PORT ?? 4001);
const LATENCY = Number(process.env.UPSTREAM_LATENCY_MS ?? 40);
const FAILURE_RATE = Number(process.env.UPSTREAM_FAILURE_RATE ?? 0);
const ALWAYS_FAIL = new Set((process.env.UPSTREAM_FAIL_SERVICE ?? '').split(',').map(s => s.trim()).filter(Boolean));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

function serviceOf(pathname) {
  if (pathname.startsWith('/users/')) return 'user';
  if (pathname.startsWith('/kundli/')) return 'kundli';
  if (pathname.startsWith('/horoscope/')) return 'horoscope';
  if (pathname === '/panchang') return 'panchang';
  return null;
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  const service = serviceOf(pathname);

  if (LATENCY > 0) await sleep(LATENCY);

  if (service && (ALWAYS_FAIL.has(service) || Math.random() < FAILURE_RATE)) {
    return send(res, 503, { error: 'service_unavailable', service });
  }

  const id = decodeURIComponent(pathname.split('/')[2] ?? '');

  switch (service) {
    case 'user': {
      const u = USERS[id];
      return u ? send(res, 200, u) : send(res, 404, { error: 'user_not_found', userId: id });
    }
    case 'kundli': {
      const k = KUNDLIS[id];
      return k ? send(res, 200, k) : send(res, 404, { error: 'kundli_not_found', userId: id });
    }
    case 'horoscope': {
      const h = HOROSCOPES[id];
      return h ? send(res, 200, h) : send(res, 404, { error: 'horoscope_not_found', userId: id });
    }
    case 'panchang':
      return send(res, 200, panchangFor());
    default:
      return send(res, 404, { error: 'not_found' });
  }
});

server.listen(PORT, () => {
  process.stdout.write(JSON.stringify({
    ts: new Date().toISOString(), level: 'info', msg: 'mock-upstream.listening',
    port: PORT, latencyMs: LATENCY, failureRate: FAILURE_RATE,
    alwaysFail: [...ALWAYS_FAIL],
  }) + '\n');
});
