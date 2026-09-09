#!/usr/bin/env node
/**
 * Scores context selection against the golden set and fails on regression.
 *
 * Runs entirely offline: no server, no LLM, no network — it exercises the same
 * buildPlan() the API calls, which is the point. Context selection is a pure
 * function of (question, config, available services), so it can be measured
 * like any other function instead of eyeballed through a chat window.
 *
 *   npm run eval                 report + exit non-zero on any hard failure
 *   npm run eval -- --threshold=0.9   also fail if recall drops below 0.9
 */

import { CASES } from './dataset.js';
import { buildPlan } from '../src/core/personalization-engine.js';
import { USERS, KUNDLIS, HOROSCOPES, panchangFor } from '../mocks/fixtures.js';

const services = {
  user: USERS.user_101, kundli: KUNDLIS.user_101,
  horoscope: HOROSCOPES.user_101, panchang: panchangFor(new Date('2026-08-01T00:00:00Z')),
};

const arg = (name, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : d;
};
const threshold = arg('threshold', 0);

const rows = [];
let intentHits = 0, includeWanted = 0, includeGot = 0, leaks = 0;

for (const c of CASES) {
  const plan = buildPlan({ question: c.q, user: USERS.user_101, services });
  const accepted = c.allowIntent ?? [c.intent];
  const intentOk = accepted.includes(plan.intent);

  const missing = c.mustInclude.filter((l) => !plan.selectedContextLabels.includes(l));
  const leaked = c.mustExclude.filter((l) => plan.selectedContextLabels.includes(l));

  intentHits += intentOk ? 1 : 0;
  includeWanted += c.mustInclude.length;
  includeGot += c.mustInclude.length - missing.length;
  leaks += leaked.length;

  rows.push({ q: c.q, want: accepted.join('|'), got: plan.intent, intentOk, missing, leaked,
              conf: plan.confidence, decisive: plan.intentDecisive, n: plan.selectedContextLabels.length });
}

const intentAcc = intentHits / CASES.length;
const recall = includeWanted === 0 ? 1 : includeGot / includeWanted;

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log('\nCONTEXT SELECTION EVAL\n');
console.log(pad('question', 46), pad('want', 16), pad('got', 13), pad('conf', 7), 'issues');
console.log('-'.repeat(110));
for (const r of rows) {
  const issues = [
    r.intentOk ? '' : 'WRONG INTENT',
    r.missing.length ? `missing: ${r.missing.join(', ')}` : '',
    r.leaked.length ? `LEAKED: ${r.leaked.join(', ')}` : '',
  ].filter(Boolean).join(' | ');
  console.log(pad(r.q, 46), pad(r.want, 16), pad(r.got, 13), pad(r.conf, 7), issues || 'ok');
}

console.log('\nSCORES');
console.log(`  intent accuracy        ${(intentAcc * 100).toFixed(1)}%  (${intentHits}/${CASES.length})`);
console.log(`  required-source recall ${(recall * 100).toFixed(1)}%  (${includeGot}/${includeWanted})`);
console.log(`  exclusion leaks        ${leaks}   <- must be 0`);

// A leak is a hard failure: excluded context reaching the model is the specific
// mistake this whole layer exists to prevent.
const failures = [];
if (leaks > 0) failures.push(`${leaks} exclusion leak(s)`);
if (rows.some((r) => !r.intentOk)) failures.push('intent regression');
if (recall < threshold) failures.push(`recall ${recall.toFixed(2)} below threshold ${threshold}`);

if (failures.length) {
  console.log(`\nFAIL: ${failures.join('; ')}\n`);
  process.exit(1);
}
console.log('\nPASS\n');
