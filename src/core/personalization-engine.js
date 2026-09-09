/**
 * Personalization Engine
 * ----------------------
 * Turns (question, user profile, whatever upstream returned) into a
 * PersonalizationPlan: what the LLM will be told, in what language, in what
 * tone, at what length — and, just as importantly, what was deliberately
 * withheld.
 *
 * The engine contains no knowledge of any specific intent or context item. It
 * reads INTENTS and CONTEXT_REGISTRY. Adding "education" as an intent, or
 * "Saturn transit" as context, is a config edit; this file does not change.
 * That is the "configuration-driven, not large if/else blocks" requirement
 * taken literally.
 *
 * The plan is deliberately produced BEFORE any LLM call, which is what lets
 * /debug/personalization return the real plan without spending a token.
 */

import { INTENTS, DEFAULT_INTENT, RESPONSE_SHAPING } from '../config/personalization.config.js';
import { CONTEXT_REGISTRY, ALL_CONTEXT_IDS, labelsFor } from '../config/context-registry.js';
import { classify } from './intent-classifier.js';
import { scoreConfidence } from './confidence.js';

/** '*' in config means "every registered context". */
function expand(ids) {
  return ids === '*' ? [...ALL_CONTEXT_IDS] : [...(ids ?? [])];
}

function pick(map, key, fallbackKey = '_default') {
  return map[key] ?? map[fallbackKey];
}

/**
 * Resolve a context id against the upstream payloads.
 * Returns null when the owning service failed or the field was absent —
 * the two are treated the same on purpose: from the answer's point of view,
 * context you do not have is context you do not have.
 */
function resolveContext(id, services) {
  const entry = CONTEXT_REGISTRY[id];
  const payload = services[entry.service];
  if (payload == null) return null;
  const value = entry.extract(payload);
  return value == null ? null : { id, label: entry.label, value, rendered: entry.render(value) };
}

/**
 * @param {object} input
 * @param {string} input.question
 * @param {object|null} input.user            - user service payload (may be null)
 * @param {Record<string, object|null>} input.services - { user, kundli, horoscope, panchang }
 * @param {string[]} input.failedServices
 */
export function buildPlan({ question, user, services, failedServices = [] }) {
  const classification = classify(question);
  const intentId = classification.intent;
  const intentCfg = INTENTS[intentId] ?? INTENTS[DEFAULT_INTENT];

  const excludeIds = new Set(expand(intentCfg.exclude));

  /**
   * No exclude-filter here on purpose: validateConfig() rejects at boot any
   * intent that lists the same id as both primary/secondary and exclude, so the
   * overlap cannot exist by the time a request runs. Filtering it here as well
   * would be unreachable code that quietly masks the contradiction rather than
   * reporting it. (Confirmed by mutation testing: the filter was unkillable.)
   *
   * The secondary de-dupe against primary IS reachable — `general` expands to
   * every context id, and an intent may legitimately list an id in both tiers.
   */
  const primaryIds = expand(intentCfg.primary);
  const secondaryIds = expand(intentCfg.secondary).filter((id) => !primaryIds.includes(id));

  const resolved = [];
  const missing = [];

  for (const id of [...primaryIds, ...secondaryIds]) {
    const ctx = resolveContext(id, services);
    if (ctx) resolved.push(ctx);
    else missing.push(id);
  }

  const primaryResolved = primaryIds.filter((id) => resolved.some((c) => c.id === id)).length;

  const { confidence, coverage, reason } = scoreConfidence({
    primaryTotal: primaryIds.length,
    primaryResolved,
    decisive: classification.decisive,
    anyContext: resolved.length > 0,
  });

  const language = pick(RESPONSE_SHAPING.language, user?.language);
  const tone = pick(RESPONSE_SHAPING.tone, user?.tonePreference);
  const baseWords = pick(RESPONSE_SHAPING.lengthBySubscription, user?.subscription);
  const multiplier = pick(RESPONSE_SHAPING.lengthMultiplierByIntent, intentId);
  const maxWords = Math.round(baseWords * multiplier);

  return {
    intent: intentId,
    intentScore: classification.score,
    intentDecisive: classification.decisive,
    matchedTerms: classification.matched,
    language,
    tone,
    maxWords,
    // Ordered: primary context first, so prompt truncation degrades sensibly.
    selectedContext: resolved,
    selectedContextLabels: resolved.map((c) => c.label),
    excludedContext: [...excludeIds],
    excludedContextLabels: labelsFor([...excludeIds]),
    missingContext: missing,
    missingContextLabels: labelsFor(missing),
    failedServices,
    confidence,
    coverage: Number(coverage.toFixed(2)),
    confidenceReason: reason,
  };
}

/** The shape the brief's "Example Internal Personalization Output" describes. */
export function toInternalView(plan) {
  return {
    intent: plan.intent,
    language: plan.language,
    tone: plan.tone,
    maxWords: plan.maxWords,
    selectedContext: plan.selectedContextLabels,
    excludedContext: plan.excludedContextLabels,
  };
}

/** The debug endpoint's public view — richer, because its whole job is auditability. */
export function toDebugView(plan) {
  return {
    intent: plan.intent,
    intentScore: plan.intentScore,
    intentDecisive: plan.intentDecisive,
    matchedTerms: plan.matchedTerms,
    language: plan.language,
    tone: plan.tone,
    maxWords: plan.maxWords,
    selectedContext: plan.selectedContextLabels,
    excludedContext: plan.excludedContextLabels,
    missingContext: plan.missingContextLabels,
    failedServices: plan.failedServices,
    confidence: plan.confidence,
    coverage: plan.coverage,
    confidenceReason: plan.confidenceReason,
    llmInvoked: false,
  };
}
