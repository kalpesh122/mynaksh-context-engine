/**
 * Question -> intent, deterministically.
 *
 * Deliberately not an LLM call: /debug/personalization must report the intent
 * without invoking the model, which is only possible if intent is decided
 * first. Trade-offs (English-only, misses unlisted phrasings) are in the README.
 */

import * as defaultRules from '../config/personalization.config.js';

const WORD = /[a-z0-9']+/g;

/** Crude suffix stemmer: "changing" -> "chang", "jobs" -> "job". No dictionary. */
function stem(word) {
  if (word.length <= 3) return word;
  for (const suffix of ['ings', 'ing', 'ies', 'ied', 'es', 'ed', 's']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      const base = word.slice(0, -suffix.length);
      return suffix === 'ies' || suffix === 'ied' ? `${base}y` : base;
    }
  }
  return word;
}

const stemAll = (text) => (String(text ?? '').toLowerCase().match(WORD) ?? []).map(stem);
const stemmedLine = (text) => ` ${stemAll(text).join(' ')} `;

function scoreIntent(cfg, tokens, line, W) {
  let score = 0;
  const matched = [];

  for (const phrase of cfg.match.phrases ?? []) {
    if (line.includes(` ${stemAll(phrase).join(' ')} `)) { score += W.phrase; matched.push(phrase); }
  }
  for (const term of cfg.match.strong ?? []) {
    if (tokens.has(stem(term))) { score += W.strong; matched.push(term); }
  }
  for (const term of cfg.match.any ?? []) {
    if (tokens.has(stem(term))) { score += W.term; matched.push(term); }
  }
  for (const term of cfg.match.negative ?? []) {
    if (tokens.has(stem(term))) score += W.negative;
  }

  return { score, matched };
}

/**
 * @param {string} question
 * @param {{INTENTS:object, DEFAULT_INTENT:string, CLASSIFIER_WEIGHTS:object}} [config]
 *   Injected so a caller can classify against a different rule set (A/B a
 *   mapping, per-tenant config, or a fixture in a test) without mutating a
 *   module-level singleton.
 * @returns {{intent:string, score:number, decisive:boolean, matched:string[], scores:Record<string,number>}}
 */
export function classify(question, config) {
  const { INTENTS, DEFAULT_INTENT, CLASSIFIER_WEIGHTS: W } =
    config ? { ...defaultRules, ...config } : defaultRules;
  const tokens = new Set(stemAll(question));
  const line = stemmedLine(question);
  const scores = {};
  const matchedByIntent = {};

  for (const [id, cfg] of Object.entries(INTENTS)) {
    if (id === DEFAULT_INTENT) continue; // the fallback never competes on score
    const { score, matched } = scoreIntent(cfg, tokens, line, W);
    scores[id] = score;
    matchedByIntent[id] = matched;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topId, topScore] = ranked[0] ?? [DEFAULT_INTENT, 0];
  const runnerUp = ranked[1]?.[1] ?? 0;

  if (topScore < W.minScoreForIntent) {
    return { intent: DEFAULT_INTENT, score: topScore, decisive: false, matched: [], scores };
  }
  return {
    intent: topId,
    score: topScore,
    decisive: topScore - runnerUp >= W.decisiveMargin,
    matched: matchedByIntent[topId] ?? [],
    scores,
  };
}

export const __test__ = { stem, stemAll };
