/**
 * LLM Provider seam.
 *
 * Every provider implements one method:
 *   generate({ system, user, maxWords, temperature }) -> { text, model, usage }
 *
 * Keeping the interface this narrow is what makes "swappable" true rather than
 * aspirational: the engine never sees a provider SDK type, a message array, or
 * a token parameter. Swapping OpenAI for Anthropic — or for the mock — changes
 * one env var and nothing else in the codebase.
 *
 * The mock is the DEFAULT, not a fallback. The assignment must be runnable and
 * reviewable without anyone holding an API key, so the happy path has to work
 * with zero credentials.
 */

import { MockProvider } from './mock-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';

export class LLMError extends Error {
  constructor(message, { provider, status } = {}) {
    super(message);
    this.name = 'LLMError';
    this.provider = provider;
    this.status = status ?? null;
  }
}

export function createProvider(config, logger) {
  const name = (config.llmProvider ?? 'mock').toLowerCase();
  switch (name) {
    case 'openai':
      if (!config.openaiApiKey) {
        logger.warn('llm.no_api_key', { requested: 'openai', fallback: 'mock' });
        return new MockProvider();
      }
      return new OpenAIProvider(config);
    case 'anthropic':
      if (!config.anthropicApiKey) {
        logger.warn('llm.no_api_key', { requested: 'anthropic', fallback: 'mock' });
        return new MockProvider();
      }
      return new AnthropicProvider(config);
    case 'mock':
      return new MockProvider();
    default:
      logger.warn('llm.unknown_provider', { requested: name, fallback: 'mock' });
      return new MockProvider();
  }
}
