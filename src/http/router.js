/**
 * Minimal router over node:http.
 *
 * No framework: the app has four routes and adding Express would mean a
 * dependency tree to audit for a take-home that must run on a reviewer's
 * machine with no install step. Documented as a trade-off in the README.
 */

import { randomUUID } from 'node:crypto';

const MAX_BODY_BYTES = 64 * 1024;

export class HttpError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body must be valid JSON');
  }
}

function sendJson(res, status, body, requestId) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'x-request-id': requestId,
  });
  res.end(payload);
}

export function createRouter({ routes, logger }) {
  return async function handle(req, res) {
    const requestId = req.headers['x-request-id'] ?? randomUUID();
    const log = logger.child({ requestId });
    const started = performance.now();
    const { pathname } = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const key = `${req.method} ${pathname}`;
    const route = routes[key];

    try {
      if (!route) throw new HttpError(404, `No route for ${key}`);
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const result = await route({ body, req, log });
      sendJson(res, result.status ?? 200, result.body, requestId);
      log.info('request.completed', {
        route: key, status: result.status ?? 200,
        latencyMs: Math.round(performance.now() - started),
      });
    } catch (err) {
      const status = err.statusCode ?? 500;
      if (status >= 500) log.error('request.failed', { route: key, error: err.message, stack: err.stack });
      else log.warn('request.rejected', { route: key, status, error: err.message });
      sendJson(res, status, {
        error: status >= 500 ? 'internal_error' : 'bad_request',
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
        requestId,
      }, requestId);
      log.info('request.completed', { route: key, status, latencyMs: Math.round(performance.now() - started) });
    }
  };
}
