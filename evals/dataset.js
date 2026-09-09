/**
 * The golden set: questions with the intent and sources a correct system must
 * produce. This is the specification of "good context selection" — the thing
 * the assignment is actually about — expressed as data rather than opinion.
 *
 * `mustInclude` is graded as recall (did we bring what the answer needs).
 * `mustExclude` is graded as a hard failure: shipping relationship guidance
 * into a career answer is not a near-miss, it is wrong.
 */

export const CASES = [
  // --- the brief's own examples -------------------------------------------
  { q: 'Should I consider changing my job in the next few months?', intent: 'career',
    mustInclude: ['10th House', 'Career Horoscope'], mustExclude: ['Relationship Horoscope'] },
  { q: 'How does this month look for my relationship?', intent: 'relationship',
    mustInclude: ['7th House', 'Relationship Horoscope'], mustExclude: ['Career Horoscope'] },
  { q: 'What should I focus on for my health?', intent: 'health',
    mustInclude: ['6th House', 'Health Horoscope'], mustExclude: ['Finance Horoscope'] },
  { q: 'What should I prioritize this week?', intent: 'general', mustInclude: [], mustExclude: [] },
  { q: "Can you summarize today's guidance?", intent: 'general', mustInclude: [], mustExclude: [] },

  // --- paraphrases: same meaning, wording nobody put in the config ---------
  { q: 'thinking of switching jobs, good idea?', intent: 'career',
    mustInclude: ['Career Horoscope'], mustExclude: ['Relationship Horoscope'] },
  { q: 'is my marriage going to improve', intent: 'relationship',
    mustInclude: ['Relationship Horoscope'], mustExclude: ['Career Horoscope'] },
  { q: 'I keep falling ill, what does my chart say', intent: 'health',
    mustInclude: ['Health Horoscope'], mustExclude: ['Finance Horoscope'] },
  { q: 'should I put money into stocks now', intent: 'finance',
    mustInclude: ['Finance Horoscope'], mustExclude: ['Relationship Horoscope'] },
  { q: 'will I get a promotion this year', intent: 'career',
    mustInclude: ['10th House'], mustExclude: ['Relationship Horoscope'] },

  // --- ambiguous: two life areas in one question --------------------------
  // Not a trick. Real users write these, and the point is that the system
  // commits to one intent and reports low decisiveness rather than pretending.
  { q: 'my work stress is affecting my health', intent: 'health',
    mustInclude: ['Health Horoscope'], mustExclude: [], allowIntent: ['health', 'career'] },
  // A true tie: 'loan' scores finance, 'business' scores career, neither wins.
  // `general` is accepted here on purpose — the question genuinely spans both,
  // and widening gives it finance AND career context. Forcing a pick would drop
  // half of what the answer needs. A tie widening is the designed behaviour,
  // not a miss.
  { q: 'should I take a loan to start a business', intent: 'general',
    mustInclude: [], mustExclude: [], allowIntent: ['finance', 'career', 'general'] },

  // --- out of domain: must widen, not guess -------------------------------
  { q: 'what colour should I paint my door', intent: 'general', mustInclude: [], mustExclude: [] },
  { q: 'hello', intent: 'general', mustInclude: [], mustExclude: [] },
];
