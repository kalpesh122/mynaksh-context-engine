/**
 * How well-grounded an answer is in the context we actually retrieved.
 * Not the model's self-reported certainty, and not a claim about astrology.
 * Computed pre-LLM so /debug/personalization can report it without a call.
 */

export const CONFIDENCE = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' });

/**
 * @param {{primaryTotal:number, primaryResolved:number, decisive:boolean, anyContext:boolean}} input
 * @returns {{confidence:string, coverage:number, reason:string}}
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
      reason: decisive ? 'some primary context missing' : 'intent match was ambiguous',
    };
  }
  return { confidence: CONFIDENCE.LOW, coverage, reason: 'most primary context unavailable' };
}
