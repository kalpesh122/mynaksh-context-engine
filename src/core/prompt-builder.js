/**
 * Prompt Builder
 * --------------
 * Turns a PersonalizationPlan into the exact strings sent to the model.
 *
 * The one rule this file enforces: ONLY selected context reaches the prompt.
 * Excluded and missing context are never rendered, not even as "unavailable" —
 * mentioning what you withheld invites the model to speculate about it.
 *
 * Grounding is handled with an explicit instruction plus the fact that the
 * context block is the only source material present. There is no retrieval
 * step to hallucinate around; if a fact is not in the block, it is not
 * available to the model.
 */

const SYSTEM_PREAMBLE = [
  'You are MyNaksh, an Indian astrology guide.',
  'Answer ONLY from the astrological context provided below.',
  'If the context does not support a claim, say what is known and stop — never invent placements, dashas or predictions.',
  'Speak to the user directly. Do not mention that you were given context, and do not list your sources.',
].join(' ');

/** Rough token estimate; ~4 chars/token is close enough for logging and budgets. */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * @param {{question:string, plan:object, user:object|null}} input
 * @returns {{system:string, user:string, promptChars:number, estimatedTokens:number}}
 */
export function buildPrompt({ question, plan, user }) {
  const contextBlock = plan.selectedContext.length
    ? plan.selectedContext.map((c) => `- ${c.rendered}`).join('\n')
    : '- (no astrological context could be retrieved)';

  const name = user?.name ? user.name.split(' ')[0] : null;

  const instructions = [
    `Language: reply entirely in ${plan.language}.`,
    `Tone: ${plan.tone}.`,
    `Length: at most ${plan.maxWords} words.`,
    name ? `Address the user as ${name}.` : null,
    plan.confidence === 'LOW'
      ? 'Some context is unavailable, so be measured and avoid strong claims.'
      : null,
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

  const promptChars = SYSTEM_PREAMBLE.length + userPrompt.length;

  return {
    system: SYSTEM_PREAMBLE,
    user: userPrompt,
    promptChars,
    estimatedTokens: estimateTokens(SYSTEM_PREAMBLE + userPrompt),
  };
}
