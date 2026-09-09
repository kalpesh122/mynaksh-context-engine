/**
 * Orchestrator.
 *
 * The only place that knows the ORDER of operations:
 *   fetch context concurrently -> build a plan -> build a prompt -> call the LLM
 *
 * Each step is a pure-ish unit tested on its own; this file is the seam where
 * they meet, and it is intentionally thin. `plan()` stops before the LLM so the
 * debug endpoint and the real endpoint share one code path and cannot drift —
 * a debug view that is computed differently from the real thing is worse than
 * no debug view at all.
 */

import { buildPlan, toDebugView } from './personalization-engine.js';
import { buildPrompt } from './prompt-builder.js';

export class PersonalizeService {
  constructor({ upstream, llm, logger }) {
    this.upstream = upstream;
    this.llm = llm;
    this.logger = logger;
  }

  /** Everything up to (but not including) the LLM call. */
  async plan({ userId, question }, log) {
    const { services, failed, timings, cacheHits } = await this.upstream.fetchAll(userId, log);
    const plan = buildPlan({ question, user: services.user, services, failedServices: failed });
    return { plan, services, failed, timings, cacheHits };
  }

  async debug(input, log) {
    const { plan, timings, cacheHits } = await this.plan(input, log);
    log.info('debug.personalization', {
      intent: plan.intent, confidence: plan.confidence,
      selected: plan.selectedContextLabels.length, excluded: plan.excludedContextLabels.length,
      upstreamMs: timings, cacheHits,
    });
    return toDebugView(plan);
  }

  async personalize(input, log) {
    const { plan, services } = await this.plan(input, log);
    const prompt = buildPrompt({ question: input.question, plan, user: services.user });

    log.info('prompt.built', {
      intent: plan.intent,
      promptChars: prompt.promptChars,
      estimatedTokens: prompt.estimatedTokens,
      contextItems: plan.selectedContext.length,
      maxWords: plan.maxWords,
    });

    const t0 = performance.now();
    let completion;
    try {
      completion = await this.llm.generate({
        system: prompt.system, user: prompt.user, maxWords: plan.maxWords,
      });
    } catch (err) {
      log.error('llm.failed', { provider: this.llm.name, error: err.message });
      // The context work still succeeded; surface that rather than a bare 500.
      const e = new Error('The guidance service is temporarily unavailable.');
      e.statusCode = 503;
      e.details = { stage: 'llm', provider: this.llm.name };
      throw e;
    }
    const llmMs = Math.round(performance.now() - t0);

    log.info('llm.completed', { provider: this.llm.name, model: completion.model, llmMs });

    return {
      answer: completion.text,
      confidence: plan.confidence,
      sourcesUsed: plan.selectedContextLabels,
      meta: {
        intent: plan.intent,
        coverage: plan.coverage,
        degraded: plan.failedServices.length > 0,
        failedServices: plan.failedServices,
        provider: this.llm.name,
        model: completion.model,
        promptChars: prompt.promptChars,
        llmMs,
      },
    };
  }
}
