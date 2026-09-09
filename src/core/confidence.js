/**
 * Confidence
 * ----------
 * The brief requires a `confidence` field but never defines it. This is the
 * definition, stated explicitly so it can be argued with rather than guessed at.
 *
 * Confidence answers one question: "how well-grounded is this answer in the
 * context we actually got?" It is NOT a claim about astrological truth, and it
 * is NOT the LLM's self-reported certainty (models are famously bad at that).
 *
 * Two inputs, both known before the LLM is called:
 *   1. coverage  - fraction of the intent's PRIMARY context we actually resolved.
 *                  Primary context is what the config says you need to answer
 *                  this kind of question; if Kundli timed out and we lost the
 *                  10th house on a career question, the answer is weaker and we
 *                  say so.
 *   2. decisive  - whether intent classification had a clear winner. A question
 *                  that scored 3-2 between career and finance is a coin flip we
 *                  should not present as certain.
 *
 * Because both inputs are pre-LLM, /debug/personalization can report the same
 * confidence the real call would produce, without spending a token.
 */

export const CONFIDENCE = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' });

/**
 * @param {{primaryTotal:number, primaryResolved:number, decisive:boolean, anyContext:boolean}} input
 */
export function scoreConfidence({ primaryTotal, primaryResolved, decisive, anyContext }) {
  if (!anyContext) {
    return { confidence: CONFIDENCE.LOW, coverage: 0, reason: 'no upstream context available' };
  }

  const coverage = primaryTotal === 0 ? 1 : primaryResolved / primaryTotal;

  if (coverage === 1 && decisive) {
    return { confidence: CONFIDENCE.HIGH, coverage, reason: 'all primary context resolved and intent was decisive' };
  }
  if (coverage >= 0.5) {
    return {
      confidence: CONFIDENCE.MEDIUM,
      coverage,
      reason: decisive
        ? 'some primary context missing'
        : 'intent match was ambiguous',
    };
  }
  return { confidence: CONFIDENCE.LOW, coverage, reason: 'most primary context unavailable' };
}
