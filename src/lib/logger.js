/**
 * Structured JSON-line logger.
 *
 * One line per event, machine-parseable, no dependency. Every request carries a
 * requestId so the upstream fan-out, the prompt size and the final latency can
 * be stitched together after the fact — which is the minimum needed to answer
 * "why was this answer slow / thin / wrong" in production.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger({ level = 'info', stream = process.stdout, now = () => new Date().toISOString() } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function emit(lvl, msg, fields = {}) {
    if (LEVELS[lvl] < threshold) return;
    stream.write(JSON.stringify({ ts: now(), level: lvl, msg, ...fields }) + '\n');
  }

  return {
    debug: (m, f) => emit('debug', m, f),
    info:  (m, f) => emit('info', m, f),
    warn:  (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (bound) => {
      const base = { ...bound };
      return {
        debug: (m, f) => emit('debug', m, { ...base, ...f }),
        info:  (m, f) => emit('info', m, { ...base, ...f }),
        warn:  (m, f) => emit('warn', m, { ...base, ...f }),
        error: (m, f) => emit('error', m, { ...base, ...f }),
      };
    },
  };
}
