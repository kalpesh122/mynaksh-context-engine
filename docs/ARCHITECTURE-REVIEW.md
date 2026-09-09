# Architectural review

A structural review of this codebase, done after it worked and was tested. It
records what holds up, what was changed as a result, and — the part that usually
goes unwritten — what was left alone on purpose.

## What holds up

**The dependency graph is acyclic and one-way.**

```
config/  lib/          (know nothing about anything above them)
   ^       ^
core/  ────┘           (knows config and lib; knows nothing about HTTP)
   ^
http/  server.js       (composition root; knows everything)
```

No module in `core/` imports from `http/`. No module in `config/` or `lib/`
imports from `core/`. That is why the engine is testable without a server and
the classifier is testable without a network — 62 tests run in ~250ms with no
mocking framework, because there is nothing to mock.

**The debug endpoint shares the real code path.** `/debug/personalization` is
`plan()` stopped one step early, not a parallel implementation. A debug view
computed separately would eventually disagree with production, which is worse
than having none. A test asserts the two agree.

**One decision, one place.** Intent lives in the classifier. Confidence lives in
`confidence.js`. Prompt wording lives in the prompt builder. Order of operations
lives in the orchestrator and nowhere else.

## Findings, and what was done

### 1. The configuration was not injectable — FIXED

The system was advertised as configuration-driven, and it was: you could edit
`personalization.config.js` and behaviour changed. But `intent-classifier.js`
and `personalization-engine.js` **imported that config at module scope**, which
made it a process-wide singleton.

Three things that cost:

- Two rule sets could not coexist. A/B testing a context mapping, or a
  per-tenant configuration, would have required a second deployment.
- Tests could not supply a configuration. The boot-validation test had to
  `Object.defineProperty` onto a module export to inject a contradiction — the
  smell that exposed the problem.
- "Configuration-driven" was true for *editing* and false for *composing*.

`classify(question, config)` and `buildPlan({ ..., config })` now take the rule
set as a parameter, defaulting to the shipped module. The composition root passes
the default; a test passes its own. There is now a test proving two configs
produce different context selection **in the same process**, and that using one
does not disturb the other.

### 2. Dev doubles lived in the production tree — FIXED

`fixtures.js` and `mock-upstream-server.js` sat in `src/services/` beside
`upstream-client.js`. Sample users and a fault-injecting fake server are not
production code and should not be importable from it. Moved to `mocks/`.

### 3. Unreachable defensive code masking a config error — FIXED (earlier)

The engine filtered out any context id listed as both `primary` and `exclude`.
Mutation testing showed that filter was unkillable: no test could distinguish
its presence. It was unreachable, and it was *hiding* the contradiction rather
than reporting it. `validateConfig()` now rejects such a config at boot and the
filter is gone.

### 4. The injection was half-done — FIXED (second pass)

Making `INTENTS` injectable in the first pass left `CONTEXT_REGISTRY` imported
at module scope. Intents *reference registry ids*, so the two are one
configuration unit; splitting them meant an injected config naming an unknown
context died as `TypeError: Cannot read properties of undefined (reading
'service')` — a 500 with nothing useful in it. `validateConfig()` guards the
shipped config at boot, but an injected one bypassed it entirely.

The registry is now part of the injected bundle, the config is **shallow-merged
over the defaults** so overriding the intents does not mean restating the
registry, and an unknown id fails as
`Unknown context id "saturn_transit" — not present in the context registry`.

Shallow, not deep, on purpose: a deep merge makes it ambiguous whether an
override replaces or extends a nested table. The cost is that replacing
`RESPONSE_SHAPING` means supplying it whole — so `pick()` now names the missing
table rather than failing as a property access on `undefined`.

*A fix that leaves a system half-wired is worse than the original state, because
the seam now looks supported.* This one only surfaced by re-reading the file
cold rather than re-reading the notes about it.

### 5. Dead exports — FIXED

`toInternalView` was exported and called only by a test. Rather than delete it —
the brief describes that exact shape — `toDebugView` is now built from it, so
the six shared fields have one source and both are live code.
`CONTEXT_IDS_BY_SERVICE` had no references at all and is gone.

## Left alone deliberately

Knowing what not to refactor is half of this.

### `buildPlan` returns a wide object with parallel id/label lists

`selectedContext` / `selectedContextLabels`, and the same for excluded and
missing. That is duplication, and it must be kept in sync.

**Left alone because** the two representations serve genuinely different
consumers: ids are the stable internal identity used by config and tests, labels
are the human strings the API contract requires in `sourcesUsed`. Deriving
labels at each call site would scatter `labelsFor()` through the codebase;
deriving ids from labels would make labels load-bearing, which is worse — a
copy-edit to "10th House" would silently change behaviour.

The honest fix is a small `ContextSelection` value object owning both
projections. At this size that is ceremony; past about twenty context items it
would earn its place.

### `CONTEXT_REGISTRY` carries `render`, coupling prompt wording to source definition

How a context item is *phrased for the model* lives in the same row as where it
comes from. Arguably prompt wording belongs with the prompt builder.

**Left alone because** the alternative is worse: a second registry keyed by the
same ids, which is exactly the drift the single-row design prevents. Prompt
phrasing is a property of the datum, not of the request, and every consumer
wants the same rendering. If per-intent phrasing were ever needed, `render`
would take the plan — a signature change, not a restructure.

### `server.js` does composition, boot validation, field validation and the route table

Four responsibilities in 150 lines.

**Left alone because** splitting the route table out of the composition root
buys indirection, not clarity, at four routes. The file reads top to bottom and
every dependency is visible in one place. At a dozen routes this stops being
true and `http/routes.js` becomes the right call.

### No schema validation library

Field checks are hand-rolled in `requireFields`.

**Left alone because** the input surface is two strings. A schema library would
be the project's only runtime dependency, for validation that is currently six
lines and fully tested. The moment the request body grows past a handful of
fields, that trade flips.

## What was added, and why it is architecture rather than features

**An eval harness (`evals/`).** The assignment is about how context is selected,
so selection needed to be *measured*, not just tested. Unit tests assert that
the code does what was written; the eval asserts that what was written is any
good. It scores intent accuracy, required-source recall and exclusion leaks
against a golden set, offline, and fails the build on a regression.

This is the addition that changed the design. On its first run it revealed that
`general` — the fallback — declares no exclusions, so *any* question falling
back to it received every context item, including ones a narrower intent would
have deliberately withheld. A health question was answered with finance guidance
attached. The most permissive route in the system was the one taken when the
system was least sure.

The fix is a routing rule, not a keyword patch: `general` is for *no* signal, not
*weak* signal. A clear winner with any signal at all routes to that intent and
reports low decisiveness, so confidence drops to MEDIUM and the caller can see
the system was unsure. Only a genuine tie widens.

**A prompt-context budget.** `general` expands to every registered context, so
the cost of the broadest question grew every time someone added a source.
`fitToBudget()` drops from the end of the selection — and because `buildPlan`
orders primary before secondary, "drop the last" means "drop the least
important". The ordering was already there for this; it now pays off.

One consequence worth stating: `sourcesUsed` reports what actually reached the
model, not what was selected. Claiming a source the budget dropped would make
the API response untrue.

## Where this would strain first

In rough order:

1. **Intent recall.** The deterministic classifier is the right call for a
   truthful debug endpoint, but it is English-only and keyword-driven. This is
   the first thing real users would break, and the fix is designed for: a
   low-scoring question escalates to a small model, with the result cached
   against a normalised question hash so `/debug` stays free.
2. **Cache is unbounded and per-instance.** Single-flight is in; an LRU bound
   and a shared store are not. At N instances you do N times the upstream work.
3. **The eval set is 14 cases.** Enough to catch regressions, not enough to
   trust a weight change. Per-intent breakdowns would stop a fix for health
   quietly costing finance.
4. **No circuit breaker.** A persistently failing service is retried on every
   request, adding latency to answers that will degrade anyway.
