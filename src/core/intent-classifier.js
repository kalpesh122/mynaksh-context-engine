/**
 * Intent Classifier
 * -----------------
 * Deterministic, LLM-free scoring over the phrase/term lists in
 * personalization.config.js.
 *
 * WHY NOT AN LLM CALL:
 * The brief requires POST /debug/personalization to return the interpreted
 * intent while explicitly NOT invoking the LLM. If classification were an LLM
 * call the debug endpoint could not answer truthfully — it would have to lie or
 * call the model anyway. A deterministic classifier keeps that endpoint honest,
 * free and instant, and makes the whole selection path unit-testable with no
 * network. It is also stable: the same question always routes the same way,
 * which matters when you are debugging a bad answer in production.
 *
 * WHY STEMMING:
 * Exact matching failed the brief's own example question — "changing my job"
 * did not match the phrase "change my job", and bare "job" scored below the
 * threshold, so a plainly career question fell through to `general`. Rather
 * than accumulate phrase variants forever (changing/changed/switching/...), a
 * light suffix stemmer normalises both the question and the config at compare
 * time. It is crude by design: no dictionary, no dependency, and easy to
 * reason about when a route looks wrong.
 *
 * KNOWN LIMITATION: it is English-only and keyword-driven, so a question
 * phrased in Hindi or in terms nobody listed lands on `general`. `general`
 * widens context rather than refusing, and the score is reported so confidence
 * can reflect a weak match instead of hiding it. See README trade-offs.
 */

import { INTENTS, DEFAULT_INTENT, CLASSIFIER_WEIGHTS as W } from '../config/personalization.config.js';

const WORD = /[a-z0-9']+/g;

/**
 * Light suffix stemmer. Order matters: longest suffix first.
 * "changing"->"chang", "switched"->"switch", "jobs"->"job", "investing"->"invest"
 */
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

function stemAll(text) {
  return (String(text ?? '').toLowerCase().match(WORD) ?? []).map(stem);
}

/** Stemmed token sequence, joined, so phrases can be matched positionally. */
function stemmedLine(text) {
  return ` ${stemAll(text).join(' ')} `;
}

export function classify(question) {
  const tokens = new Set(stemAll(question));
  const line = stemmedLine(question);
  const scores = {};
  const matchedByIntent = {};

  for (const [id, cfg] of Object.entries(INTENTS)) {
    if (id === DEFAULT_INTENT) continue; // the fallback never competes on score
    let score = 0;
    const matched = [];

    for (const phrase of cfg.match.phrases ?? []) {
      if (line.includes(` ${stemAll(phrase).join(' ')} `)) {
        score += W.phrase;
        matched.push(phrase);
      }
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

    scores[id] = score;
    matchedByIntent[id] = matched;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topId, topScore] = ranked[0] ?? [DEFAULT_INTENT, 0];
  const runnerUpScore = ranked[1]?.[1] ?? 0;

  if (topScore < W.minScoreForIntent) {
    return { intent: DEFAULT_INTENT, score: topScore, decisive: false, matched: [], scores };
  }

  return {
    intent: topId,
    score: topScore,
    decisive: topScore - runnerUpScore >= W.decisiveMargin,
    matched: matchedByIntent[topId] ?? [],
    scores,
  };
}

export const __test__ = { stem, stemAll };
