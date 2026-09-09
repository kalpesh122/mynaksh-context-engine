import { LLMError } from './provider.js';

/** OpenAI Chat Completions. No SDK — one fetch, so there is no dependency to audit. */
export class OpenAIProvider {
  name = 'openai';

  constructor({ openaiApiKey, openaiModel, llmTimeoutMs }) {
    this.apiKey = openaiApiKey;
    this.model = openaiModel;
    this.timeoutMs = llmTimeoutMs;
  }

  async generate({ system, user, maxWords, temperature = 0.6 }) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: ac.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          temperature,
          max_tokens: Math.round(maxWords * 2),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!res.ok) {
        throw new LLMError(`OpenAI HTTP ${res.status}`, { provider: 'openai', status: res.status });
      }
      const json = await res.json();
      return {
        text: json.choices?.[0]?.message?.content ?? '',
        model: json.model ?? this.model,
        usage: json.usage ?? null,
      };
    } catch (err) {
      if (err instanceof LLMError) throw err;
      throw new LLMError(err.message, { provider: 'openai' });
    } finally {
      clearTimeout(timer);
    }
  }
}
