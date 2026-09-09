import { LLMError } from './provider.js';

/** Anthropic Messages API. Same narrow interface as the other providers. */
export class AnthropicProvider {
  name = 'anthropic';

  constructor({ anthropicApiKey, anthropicModel, llmTimeoutMs }) {
    this.apiKey = anthropicApiKey;
    this.model = anthropicModel;
    this.timeoutMs = llmTimeoutMs;
  }

  async generate({ system, user, maxWords, temperature = 0.6 }) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ac.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          system,
          temperature,
          max_tokens: Math.round(maxWords * 2),
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!res.ok) {
        throw new LLMError(`Anthropic HTTP ${res.status}`, { provider: 'anthropic', status: res.status });
      }
      const json = await res.json();
      return {
        text: json.content?.map((c) => c.text ?? '').join('') ?? '',
        model: json.model ?? this.model,
        usage: json.usage ?? null,
      };
    } catch (err) {
      if (err instanceof LLMError) throw err;
      throw new LLMError(err.message, { provider: 'anthropic' });
    } finally {
      clearTimeout(timer);
    }
  }
}
