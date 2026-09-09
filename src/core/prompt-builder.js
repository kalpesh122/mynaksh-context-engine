/**
 * PersonalizationPlan -> the exact strings sent to the model.
 * Only selected context is rendered; excluded and missing context are never
 * mentioned, because naming what you withheld invites speculation about it.
 */

const SYSTEM_PREAMBLE = [
  'You are MyNaksh, an Indian astrology guide.',
  'Answer ONLY from the astrological context provided below.',
  'If the context does not support a claim, say what is known and stop — never invent placements, dashas or predictions.',
  'Speak to the user directly. Do not mention that you were given context, and do not list your sources.',
].join(' ');

/** ~4 chars/token; close enough for logging and budgets. */
export const estimateTokens = (text) => Math.ceil(text.length / 4);

/** @returns {{system:string, user:string, promptChars:number, estimatedTokens:number}} */
export function buildPrompt({ question, plan, user }) {
  const contextBlock = plan.selectedContext.length
    ? plan.selectedContext.map((c) => `- ${c.rendered}`).join('\n')
    : '- (no astrological context could be retrieved)';

  const firstName = user?.name ? user.name.split(' ')[0] : null;

  const instructions = [
    `Language: reply entirely in ${plan.language}.`,
    `Tone: ${plan.tone}.`,
    `Length: at most ${plan.maxWords} words.`,
    firstName ? `Address the user as ${firstName}.` : null,
    plan.confidence === 'LOW' ? 'Some context is unavailable, so be measured and avoid strong claims.' : null,
  ].filter(Boolean).join('\n');

  const userPrompt = [
    `QUESTION: ${question}`,
    '',
    `ASTROLOGICAL CONTEXT (topic: ${plan.intent}):`,
    contextBlock,
    '',
    'RESPONSE INSTRUCTIONS:',
    instructions,
  ].join('\n');

  return {
    system: SYSTEM_PREAMBLE,
    user: userPrompt,
    promptChars: SYSTEM_PREAMBLE.length + userPrompt.length,
    estimatedTokens: estimateTokens(SYSTEM_PREAMBLE + userPrompt),
  };
}
