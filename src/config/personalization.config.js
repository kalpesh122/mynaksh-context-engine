/**
 * Personalization Configuration
 * -----------------------------
 * This file is the product surface of the engine. Adding an intent, changing
 * which context reaches the LLM, or re-tuning tone is a change HERE — never in
 * engine code. The engine treats this as data.
 *
 * Contract for an intent:
 *   match.any        - terms that score toward this intent (word-boundary matched)
 *   match.phrases    - multi-word phrases, weighted higher than single terms
 *   match.negative   - terms that push AWAY from this intent (disambiguation)
 *   primary          - context REQUIRED to answer well; drives confidence
 *   secondary        - context that enriches the answer; absence is not fatal
 *   exclude          - context deliberately withheld even if available
 *
 * `exclude` is not the same as "not selected". It is an explicit statement that
 * this context would make the answer worse (bleeding relationship guidance into
 * a career answer), and it is surfaced in the debug endpoint so the decision is
 * auditable.
 */

export const DEFAULT_INTENT = 'general';

export const INTENTS = Object.freeze({
  career: {
    id: 'career',
    description: 'Work, job change, promotion, business, professional direction.',
    match: {
      phrases: ['change my job', 'changing jobs', 'switch jobs', 'job change', 'new job', 'career growth', 'at work', 'my career', 'my job'],
      strong: ['job', 'career', 'promotion', 'appraisal', 'resign', 'profession', 'employer'],
      any: ['work', 'salary', 'boss', 'office', 'business', 'startup', 'interview'],
      negative: ['partner', 'marriage', 'spouse'],
    },
    primary: ['house_10', 'career_horoscope'],
    secondary: ['current_dasha', 'panchang_today'],
    exclude: ['relationship_horoscope'],
  },

  relationship: {
    id: 'relationship',
    description: 'Marriage, partnership, love, family relationships.',
    match: {
      phrases: ['my relationship', 'my marriage', 'my partner', 'love life', 'get married'],
      strong: ['relationship', 'marriage', 'spouse', 'romance', 'boyfriend', 'girlfriend', 'breakup', 'compatibility'],
      any: ['partner', 'love', 'wife', 'husband', 'dating'],
      negative: ['job', 'salary'],
    },
    primary: ['house_7', 'relationship_horoscope'],
    secondary: ['moon_sign', 'current_dasha'],
    exclude: ['career_horoscope'],
  },

  health: {
    id: 'health',
    description: 'Physical and mental wellbeing, energy, illness, recovery.',
    match: {
      phrases: ['my health', 'feeling tired', 'take care of myself'],
      strong: ['health', 'illness', 'fitness', 'wellbeing', 'wellness', 'anxiety'],
      any: ['sick', 'energy', 'sleep', 'stress', 'body', 'recovery', 'diet'],
      negative: [],
    },
    primary: ['house_6', 'health_horoscope'],
    secondary: ['moon_sign', 'panchang_today'],
    exclude: ['finance_horoscope'],
  },

  finance: {
    id: 'finance',
    description: 'Money, investment, savings, financial risk.',
    match: {
      phrases: ['my money', 'should i invest', 'financial situation'],
      strong: ['finance', 'financial', 'invest', 'investment', 'savings', 'wealth', 'debt'],
      any: ['money', 'loan', 'property', 'expenses', 'stocks'],
      negative: [],
    },
    primary: ['finance_horoscope'],
    secondary: ['house_10', 'current_dasha', 'panchang_today'],
    exclude: ['relationship_horoscope', 'health_horoscope'],
  },

  /**
   * Fallback. "What should I prioritise this week?" / "Summarise today's
   * guidance" are legitimately broad questions, so the engine widens rather
   * than guessing a narrow intent and withholding the very context that
   * mattered. `primary: '*'` expands to every registered context id.
   */
  general: {
    id: 'general',
    description: 'Broad daily guidance with no single life area in focus.',
    match: { phrases: ['today', 'this week', 'summarize', 'summarise', 'overall'], any: ['guidance', 'prioritize', 'prioritise', 'focus'], negative: [] },
    primary: '*',
    secondary: [],
    exclude: [],
  },
});

/**
 * Response shaping. Also config, for the same reason: "premium users get longer
 * answers" is a product decision that will change without an engineer.
 */
export const RESPONSE_SHAPING = Object.freeze({
  language: {
    // ISO code from the user profile -> the name we put in the prompt.
    en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', mr: 'Marathi', bn: 'Bengali',
    _default: 'English',
  },
  tone: {
    motivational: 'Motivational', neutral: 'Neutral', calm: 'Calm',
    direct: 'Direct', empathetic: 'Empathetic',
    _default: 'Neutral',
  },
  /** maxWords by subscription tier, then narrowed by intent below. */
  lengthBySubscription: { premium: 250, plus: 180, free: 120, _default: 120 },
  /** Multiplier applied to the tier length. Broad questions get more room. */
  lengthMultiplierByIntent: { general: 1.2, career: 1.0, relationship: 1.0, health: 0.9, finance: 0.9, _default: 1.0 },
});

/** Scoring weights for intent classification. Tunable without touching logic. */
export const CLASSIFIER_WEIGHTS = Object.freeze({
  phrase: 3,
  /**
   * `strong` terms are domain-unique enough to carry a question on their own
   * ("invest", "marriage", "promotion"). `any` terms are suggestive but shared
   * across life areas ("work", "focus", "energy") and need corroboration.
   * Splitting them is what lets the threshold stay at 2 — high enough to reject
   * incidental vocabulary, low enough that one decisive word is sufficient.
   */
  strong: 2,
  term: 1,
  negative: -2,
  /** Minimum score before we trust a specific intent over the fallback. */
  minScoreForIntent: 2,
  /** Score lead the winner needs over the runner-up to be considered decisive. */
  decisiveMargin: 2,
});
