#!/usr/bin/env node
/**
 * Walks the five sample questions from the brief through both endpoints and
 * prints a compact table. This is the fastest way for a reviewer to see that
 * intent routing, exclusion and confidence actually behave.
 *
 * Requires the server to be running (npm start) in another terminal.
 */

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

const QUESTIONS = [
  ['user_101', 'Should I consider changing my job this year?'],
  ['user_101', 'How does this month look for my relationship?'],
  ['user_101', 'What should I focus on for my health?'],
  ['user_101', 'What should I prioritize this week?'],
  ['user_202', "Can you summarize today's guidance?"],
  ['user_202', 'Should I invest my savings right now?'],
];

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

console.log('\n=== POST /debug/personalization (no LLM) ===\n');
for (const [userId, question] of QUESTIONS) {
  const { json } = await post('/debug/personalization', { userId, question });
  console.log(`Q: ${question}`);
  console.log(`   user=${userId} intent=${json.intent} confidence=${json.confidence} (coverage ${json.coverage})`);
  console.log(`   language=${json.language} tone=${json.tone} maxWords=${json.maxWords}`);
  console.log(`   selected: ${json.selectedContext.join(', ') || '(none)'}`);
  console.log(`   excluded: ${json.excludedContext.join(', ') || '(none)'}`);
  if (json.missingContext?.length) console.log(`   missing : ${json.missingContext.join(', ')}`);
  console.log();
}

console.log('=== POST /personalize (full pipeline) ===\n');
const [uid, q] = QUESTIONS[0];
const { json } = await post('/personalize', { userId: uid, question: q });
console.log(JSON.stringify(json, null, 2));
