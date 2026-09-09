import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, LLMError } from '../src/llm/provider.js';
import { OpenAIProvider } from '../src/llm/openai-provider.js';
import { AnthropicProvider } from '../src/llm/anthropic-provider.js';
import { MockProvider } from '../src/llm/mock-provider.js';
import { createLogger } from '../src/lib/logger.js';

/**
 * These tests stub globalThis.fetch. Restoring it after each is not optional:
 * node:test shares one process across files, so a leaked stub silently changes
 * the behaviour of every later test that does real I/O.
 */
const REAL_FETCH = globalThis.fetch;
function withFetch(stub, fn) {
  globalThis.fetch = stub;
  return (async () => { try { return await fn(); } finally { globalThis.fetch = REAL_FETCH; } })();
}

const silent = createLogger({ level: 'error', stream: { write() {} } });
const captured = () => {
  const lines = [];
  return { logger: createLogger({ level: 'warn', stream: { write: (l) => lines.push(JSON.parse(l)) } }), lines };
};

test('factory falls back to mock when the requested provider has no key', () => {
  const { logger, lines } = captured();
  const p = createProvider({ llmProvider: 'openai', openaiApiKey: '' }, logger);
  assert.equal(p.name, 'mock');
  assert.equal(lines.at(-1).msg, 'llm.no_api_key');
});

test('factory falls back to mock for an unknown provider name', () => {
  const { logger, lines } = captured();
  assert.equal(createProvider({ llmProvider: 'llama-on-a-toaster' }, logger).name, 'mock');
  assert.equal(lines.at(-1).msg, 'llm.unknown_provider');
});

test('factory honours a configured provider when a key is present', () => {
  assert.equal(createProvider({ llmProvider: 'openai', openaiApiKey: 'sk-x' }, silent).name, 'openai');
  assert.equal(createProvider({ llmProvider: 'anthropic', anthropicApiKey: 'sk-x' }, silent).name, 'anthropic');
});

test('mock provider composes its answer from the context it was given', async () => {
  const out = await new MockProvider().generate({
    system: 'sys',
    user: 'QUESTION: will I get promoted\n\nASTROLOGICAL CONTEXT (topic: career):\n- 10th house: strong\n- Career horoscope: good\n\nRESPONSE INSTRUCTIONS:\nLanguage: reply entirely in English.\nTone: Motivational.\nLength: at most 250 words.',
    maxWords: 250,
  });
  assert.match(out.text, /10th house: strong/);
  assert.match(out.text, /Career horoscope: good/);
  assert.match(out.text, /will I get promoted/);
  assert.equal(out.model, 'mock-1');
});

test('OpenAI provider maps a non-2xx to LLMError with the status', async () => {
  const p = new OpenAIProvider({ openaiApiKey: 'sk-x', openaiModel: 'm', llmTimeoutMs: 1000 });
  await withFetch(async () => ({ ok: false, status: 429, json: async () => ({}) }), async () => {
    await assert.rejects(() => p.generate({ system: 's', user: 'u', maxWords: 10 }), (e) => {
      assert.ok(e instanceof LLMError);
      assert.equal(e.status, 429);
      assert.equal(e.provider, 'openai');
      return true;
    });
  });
});

test('OpenAI provider parses a normal completion', async () => {
  const p = new OpenAIProvider({ openaiApiKey: 'sk-x', openaiModel: 'm', llmTimeoutMs: 1000 });
  const out = await withFetch(async () => ({
    ok: true, status: 200,
    json: async () => ({ model: 'gpt-x', choices: [{ message: { content: 'hello' } }], usage: { total_tokens: 5 } }),
  }), () => p.generate({ system: 's', user: 'u', maxWords: 10 }));
  assert.equal(out.text, 'hello');
  assert.equal(out.model, 'gpt-x');
});

test('Anthropic provider concatenates content blocks', async () => {
  const p = new AnthropicProvider({ anthropicApiKey: 'sk-x', anthropicModel: 'm', llmTimeoutMs: 1000 });
  const out = await withFetch(async () => ({
    ok: true, status: 200,
    json: async () => ({ model: 'claude-x', content: [{ text: 'part one ' }, { text: 'part two' }] }),
  }), () => p.generate({ system: 's', user: 'u', maxWords: 10 }));
  assert.equal(out.text, 'part one part two');
});

test('a transport error becomes LLMError, not a raw fetch failure', async () => {
  const p = new AnthropicProvider({ anthropicApiKey: 'sk-x', anthropicModel: 'm', llmTimeoutMs: 1000 });
  await withFetch(async () => { throw new Error('ECONNRESET'); }, async () => {
    await assert.rejects(() => p.generate({ system: 's', user: 'u', maxWords: 10 }), (e) => {
      assert.ok(e instanceof LLMError);
      assert.match(e.message, /ECONNRESET/);
      return true;
    });
  });
});
