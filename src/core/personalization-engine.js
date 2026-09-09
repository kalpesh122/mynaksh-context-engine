/**
 * Builds the PersonalizationPlan: what the LLM will be told, how to say it,
 * and what was deliberately withheld.
 *
 * Contains no knowledge of any specific intent or context item — it reads
 * INTENTS and CONTEXT_REGISTRY. Adding either is a config change.
 */

import * as defaultConfig from '../config/personalization.config.js';
import { CONTEXT_REGISTRY, ALL_CONTEXT_IDS, labelsFor } from '../config/context-registry.js';
import { classify } from './intent-classifier.js';
import { scoreConfidence } from './confidence.js';

/** '*' in config means "every registered context". */
const expand = (ids) => (ids === '*' ? [...ALL_CONTEXT_IDS] : [...(ids ?? [])]);
const pick = (map, key) => map[key] ?? map._default;

/** null when the owning service failed OR the field was absent — same thing to the answer. */
function resolveContext(id, services) {
  const entry = CONTEXT_REGISTRY[id];
  const payload = services[entry.service];
  if (payload == null) return null;
  const value = entry.extract(payload);
  return value == null ? null : { id, label: entry.label, value, rendered: entry.render(value) };
}

function shapeResponse(user, intentId, RESPONSE_SHAPING) {
  const baseWords = pick(RESPONSE_SHAPING.lengthBySubscription, user?.subscription);
  const multiplier = pick(RESPONSE_SHAPING.lengthMultiplierByIntent, intentId);
  return {
    language: pick(RESPONSE_SHAPING.language, user?.language),
    tone: pick(RESPONSE_SHAPING.tone, user?.tonePreference),
    maxWords: Math.round(baseWords * multiplier),
  };
}

/**
 * @param {object} input
 * @param {object} [input.config] personalization rules; defaults to the shipped
 *   config. Injected rather than imported so the engine is composable — two
 *   configs can coexist in one process and tests need not mutate a singleton.
 */
export function buildPlan({ question, user, services, failedServices = [], config = defaultConfig }) {
  const { INTENTS, DEFAULT_INTENT, RESPONSE_SHAPING } = config;
  const classification = classify(question, config);
  const intentId = classification.intent;
  const cfg = INTENTS[intentId] ?? INTENTS[DEFAULT_INTENT];

  // No exclude-filter on primary: validateConfig() rejects that contradiction at
  // boot, so filtering here would be unreachable code masking a config error.
  const primaryIds = expand(cfg.primary);
  const secondaryIds = expand(cfg.secondary).filter((id) => !primaryIds.includes(id));

  const resolved = [];
  const missing = [];
  for (const id of [...primaryIds, ...secondaryIds]) {
    const ctx = resolveContext(id, services);
    if (ctx) resolved.push(ctx); else missing.push(id);
  }

  const { confidence, coverage, reason } = scoreConfidence({
    primaryTotal: primaryIds.length,
    primaryResolved: primaryIds.filter((id) => resolved.some((c) => c.id === id)).length,
    decisive: classification.decisive,
    anyContext: resolved.length > 0,
  });

  const excludedIds = expand(cfg.exclude);

  return {
    intent: intentId,
    intentScore: classification.score,
    intentDecisive: classification.decisive,
    matchedTerms: classification.matched,
    ...shapeResponse(user, intentId, RESPONSE_SHAPING),
    // Primary first, so prompt truncation degrades sensibly.
    selectedContext: resolved,
    selectedContextLabels: resolved.map((c) => c.label),
    excludedContext: excludedIds,
    excludedContextLabels: labelsFor(excludedIds),
    missingContext: missing,
    missingContextLabels: labelsFor(missing),
    failedServices,
    confidence,
    coverage: Number(coverage.toFixed(2)),
    confidenceReason: reason,
  };
}

/** The shape the brief's "Example Internal Personalization Output" describes. */
export const toInternalView = (plan) => ({
  intent: plan.intent,
  language: plan.language,
  tone: plan.tone,
  maxWords: plan.maxWords,
  selectedContext: plan.selectedContextLabels,
  excludedContext: plan.excludedContextLabels,
});

/** Richer than the internal view: auditability is this endpoint's whole job. */
export const toDebugView = (plan) => ({
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
});
