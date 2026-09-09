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
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body must be valid JSON');
  }
  /**
   * `null`, `[]`, `"str"` and `7` are all valid JSON but not objects. Without
   * this, `null` reached field validation and threw a TypeError on property
   * access — surfacing to the caller as a 500 for what is plainly a bad request.
   */
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'Body must be a JSON object');
  }
  return parsed;
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
    // HEAD is GET without a body (RFC 9110). Health checkers rely on it.
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const key = `${method} ${pathname}`;
    const route = routes[key];

    try {
      if (!route) {
        /**
         * Distinguish "no such path" from "wrong verb on a real path". A 404
         * for `GET /personalize` tells the caller the endpoint does not exist,
         * which is false and sends them debugging the wrong thing.
         */
        const allowed = Object.keys(routes)
          .filter((k) => k.endsWith(` ${pathname}`))
          .map((k) => k.split(' ')[0]);
        if (allowed.length) {
          const err = new HttpError(405, `Method ${req.method} not allowed on ${pathname}`);
          err.allow = [...new Set([...allowed, ...(allowed.includes('GET') ? ['HEAD'] : [])])].join(', ');
          throw err;
        }
        throw new HttpError(404, `No route for ${key}`);
      }
      const body = method === 'POST' ? await readJsonBody(req) : {};
      const result = await route({ body, req, log });
      if (req.method === 'HEAD') {
        res.writeHead(result.status ?? 200, { 'content-type': 'application/json', 'x-request-id': requestId });
        res.end();
      } else {
        sendJson(res, result.status ?? 200, result.body, requestId);
      }
      log.info('request.completed', {
        route: key, status: result.status ?? 200,
        latencyMs: Math.round(performance.now() - started),
      });
    } catch (err) {
      const status = err.statusCode ?? 500;
      if (status >= 500) log.error('request.failed', { route: key, error: err.message, stack: err.stack });
      else log.warn('request.rejected', { route: key, status, error: err.message });
      if (err.allow) res.setHeader('allow', err.allow);
      /**
       * 503 means a dependency is unavailable and the caller may retry; calling
       * that "internal_error" tells them the wrong thing about whether to.
       */
      const code = status === 503 ? 'service_unavailable'
        : status === 404 ? 'not_found'
        : status === 405 ? 'method_not_allowed'
        : status === 413 ? 'payload_too_large'
        : status >= 500 ? 'internal_error'
        : 'bad_request';
      sendJson(res, status, {
        error: code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
        requestId,
      }, requestId);
      log.info('request.completed', { route: key, status, latencyMs: Math.round(performance.now() - started) });
    }
  };
}
