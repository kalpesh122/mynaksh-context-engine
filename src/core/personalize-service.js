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
    const { services, failed, notFound, timings, cacheHits } = await this.upstream.fetchAll(userId, log);

    /**
     * If the user service says 404, this user does not exist. Answering anyway
     * from whatever context is global (panchang is the same for everyone) would
     * hand a caller a plausible-looking reading for an id they made up. That is
     * a correctness bug, not graceful degradation, so it is a 404.
     *
     * A user service that is DOWN (5xx/timeout) is different and still degrades:
     * the user exists, we just cannot read their preferences right now.
     */
    if (notFound.includes('user')) {
      const err = new Error(`No such user: ${userId}`);
      err.statusCode = 404;
      err.details = { stage: 'upstream', service: 'user' };
      throw err;
    }

    const plan = buildPlan({ question, user: services.user, services, failedServices: failed });
    return { plan, services, failed, notFound, timings, cacheHits };
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

    /**
     * Zero resolved context means there is nothing to ground an answer in.
     * Calling the model here would buy a fluent, confident, entirely invented
     * reading — and bill for it. For a product giving people guidance about
     * their careers and health, an ungrounded answer is worse than an honest
     * failure, so this refuses instead of degrading.
     *
     * Note this is strictly "we got NOTHING". Partial context still answers,
     * with confidence lowered to match — that path is exercised by the
     * kundli-down case in the tests.
     */
    if (plan.selectedContext.length === 0) {
      log.error('context.empty', {
        intent: plan.intent, failedServices: plan.failedServices,
      });
      const err = new Error('Guidance is unavailable right now: no astrological context could be retrieved.');
      err.statusCode = 503;
      err.details = { stage: 'context', failedServices: plan.failedServices, llmInvoked: false };
      throw err;
    }

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
        /**
         * `confidence` is about GROUNDING (did we get the astrological context).
         * This is a separate axis: whether the answer was shaped to this user at
         * all. If the user service is down we still answer, well-grounded, but
         * in default language/tone/length — and the caller deserves to know.
         */
        personalized: services.user != null,
        failedServices: plan.failedServices,
        provider: this.llm.name,
        model: completion.model,
        promptChars: prompt.promptChars,
        llmMs,
      },
    };
  }
}
