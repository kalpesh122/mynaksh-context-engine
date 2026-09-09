/**
 * Builds the PersonalizationPlan: what the LLM will be told, how to say it,
 * and what was deliberately withheld.
 *
 * Contains no knowledge of any specific intent or context item — it reads
 * INTENTS and CONTEXT_REGISTRY. Adding either is a config change.
 */

import * as shippedRules from '../config/personalization.config.js';
import * as shippedRegistry from '../config/context-registry.js';
import { classify } from './intent-classifier.js';
import { scoreConfidence } from './confidence.js';

/**
 * Intents reference registry ids, so the two are ONE configuration unit.
 * Injecting the rules without the registry they point at leaves a half-wired
 * system: an unknown id then fails as a TypeError deep in resolution instead of
 * a clear error at the boundary.
 */
const DEFAULT_CONFIG = { ...shippedRules, ...shippedRegistry };

function pick(map, key, what) {
  if (!map) throw new Error(`Config is missing RESPONSE_SHAPING.${what}`);
  return map[key] ?? map._default;
}

function makeResolver({ CONTEXT_REGISTRY }) {
  /** null when the owning service failed OR the field was absent — same thing to the answer. */
  return function resolveContext(id, services) {
    const entry = CONTEXT_REGISTRY[id];
    if (!entry) throw new Error(`Unknown context id "${id}" — not present in the context registry`);
    const payload = services[entry.service];
    if (payload == null) return null;
    const value = entry.extract(payload);
    return value == null ? null : { id, label: entry.label, value, rendered: entry.render(value) };
  };
}

function shapeResponse(user, intentId, shaping = {}) {
  const baseWords = pick(shaping.lengthBySubscription, user?.subscription, 'lengthBySubscription');
  const multiplier = pick(shaping.lengthMultiplierByIntent, intentId, 'lengthMultiplierByIntent');
  return {
    language: pick(shaping.language, user?.language, 'language'),
    tone: pick(shaping.tone, user?.tonePreference, 'tone'),
    maxWords: Math.round(baseWords * multiplier),
  };
}

/**
 * @param {object} input
 * @param {object} [input.config] personalization rules; defaults to the shipped
 *   config. Injected rather than imported so the engine is composable — two
 *   configs can coexist in one process and tests need not mutate a singleton.
 */
export function buildPlan({ question, user, services, failedServices = [], config }) {
  // Shallow merge over the defaults: override INTENTS without restating the
  // registry or weights. Shallow on purpose — a deep merge would make it
  // ambiguous whether an override replaces or extends a nested table. Replacing
  // one nested table means supplying it whole; pick() says so if you do not.
  const merged = config ? { ...DEFAULT_CONFIG, ...config } : DEFAULT_CONFIG;
  const { INTENTS, DEFAULT_INTENT, RESPONSE_SHAPING, ALL_CONTEXT_IDS, labelsFor, CONTEXT_REGISTRY } = merged;
  const resolveContext = makeResolver(merged);
  const expand = (ids) => (ids === '*' ? [...ALL_CONTEXT_IDS] : [...(ids ?? [])]);

  const classification = classify(question, merged);
  const intentId = classification.intent;
  const cfg = INTENTS[intentId] ?? INTENTS[DEFAULT_INTENT];
  if (!cfg) throw new Error(`Config has no intent "${intentId}" and no fallback "${DEFAULT_INTENT}"`);

  // No exclude-filter on primary: validateConfig() rejects that contradiction at
  // boot, so filtering here would be unreachable code masking a config error.
  // Within a tier, order by the registry's `priority` so a budget cut drops the
  // least useful context rather than whatever happened to be declared last.
  const byPriority = (a, bId) =>
    (CONTEXT_REGISTRY[a]?.priority ?? 100) - (CONTEXT_REGISTRY[bId]?.priority ?? 100);

  const primaryIds = expand(cfg.primary).sort(byPriority);
  const secondaryIds = expand(cfg.secondary).filter((id) => !primaryIds.includes(id)).sort(byPriority);

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

/**
 * What /debug returns: the internal view plus everything needed to audit the
 * decision. Built FROM the internal view so the shared fields have one source.
 */
export const toDebugView = (plan) => ({
  ...toInternalView(plan),
  intentScore: plan.intentScore,
  intentDecisive: plan.intentDecisive,
  matchedTerms: plan.matchedTerms,
  missingContext: plan.missingContextLabels,
  failedServices: plan.failedServices,
  confidence: plan.confidence,
  coverage: plan.coverage,
  confidenceReason: plan.confidenceReason,
  llmInvoked: false,
});
