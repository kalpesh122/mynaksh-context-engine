/**
 * Orchestrator: the only place that knows the order of operations.
 *   fetch context concurrently -> build plan -> build prompt -> call the LLM
 *
 * plan() stops before the LLM so /debug and /personalize share one code path
 * and cannot drift.
 */

import { buildPlan, toDebugView } from './personalization-engine.js';
import { buildPrompt } from './prompt-builder.js';

/** Errors this layer raises with an HTTP status the router maps directly. */
function httpError(statusCode, message, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.details = details;
  return err;
}

export class PersonalizeService {
  constructor({ upstream, llm, logger }) {
    this.upstream = upstream;
    this.llm = llm;
    this.logger = logger;
  }

  /** Everything up to (but not including) the LLM call. */
  async plan({ userId, question }, log) {
    const { services, failed, notFound, timings, cacheHits } = await this.upstream.fetchAll(userId, log);

    // A 404 from the user service means no such user. A 5xx means the user
    // exists and we cannot read them — that still degrades. Conflating the two
    // lets an invented userId get a plausible reading from global context.
    if (notFound.includes('user')) {
      throw httpError(404, `No such user: ${userId}`, { stage: 'upstream', service: 'user' });
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

    // Zero context means nothing to ground an answer in. Calling the model here
    // buys a fluent, entirely invented reading — and bills for it.
    if (plan.selectedContext.length === 0) {
      log.error('context.empty', { intent: plan.intent, failedServices: plan.failedServices });
      throw httpError(503, 'Guidance is unavailable right now: no astrological context could be retrieved.',
        { stage: 'context', failedServices: plan.failedServices, llmInvoked: false });
    }

    const prompt = buildPrompt({ question: input.question, plan, user: services.user });
    log.info('prompt.built', {
      intent: plan.intent, promptChars: prompt.promptChars,
      estimatedTokens: prompt.estimatedTokens,
      contextItems: plan.selectedContext.length, maxWords: plan.maxWords,
    });

    const t0 = performance.now();
    let completion;
    try {
      completion = await this.llm.generate({
        system: prompt.system, user: prompt.user, maxWords: plan.maxWords,
      });
    } catch (err) {
      log.error('llm.failed', { provider: this.llm.name, error: err.message });
      throw httpError(503, 'The guidance service is temporarily unavailable.',
        { stage: 'llm', provider: this.llm.name });
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
        // Separate axis from confidence: was the answer shaped to THIS user at all.
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
