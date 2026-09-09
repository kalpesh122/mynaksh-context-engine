/**
 * The product surface. Adding an intent, changing which context reaches the
 * LLM, or re-tuning tone happens HERE — the engine treats this as data.
 *
 *   match.phrases  multi-word, weighted highest
 *   match.strong   domain-unique terms that can carry a question alone
 *   match.any      suggestive but shared across life areas; need corroboration
 *   match.negative pushes away from this intent
 *   primary        needed to answer well; drives confidence coverage
 *   secondary      enriches; absence is not fatal
 *   exclude        deliberately withheld even when available, and surfaced in
 *                  /debug so the decision is auditable
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
      phrases: ['my health', 'feeling tired', 'take care of myself', 'falling ill', 'keep falling'],
      strong: ['health', 'illness', 'ill', 'unwell', 'fitness', 'wellbeing', 'wellness', 'anxiety', 'fever'],
      any: ['sick', 'energy', 'sleep', 'stress', 'body', 'recovery', 'diet', 'pain', 'tired', 'weak'],
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

  /** Fallback: widens to everything rather than guessing narrow and withholding. */
  general: {
    id: 'general',
    description: 'Broad daily guidance with no single life area in focus.',
    match: { phrases: ['today', 'this week', 'summarize', 'summarise', 'overall'], any: ['guidance', 'prioritize', 'prioritise', 'focus'], negative: [] },
    primary: '*',
    secondary: [],
    exclude: [],
  },
});

/** Response shaping — a product decision that will change without an engineer. */
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
  strong: 2,
  term: 1,
  negative: -2,
  minScoreForIntent: 2,  // below this, fall back to `general`
  decisiveMargin: 2,     // lead over the runner-up needed to call it decisive
});
