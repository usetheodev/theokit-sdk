---
slug: m4-provider-routing-apikey-fix
milestone_id: M4
created_at: 2026-07-03
goal: Route an explicitly-passed provider API key to its correct provider so `Agent.create({ apiKey: "sk-or-…", model: { id: "openai/gpt-4o-mini" } })` reaches OpenRouter (the SDK's own `openrouter-stream` real-LLM test goes from red to green).
---

# M4 — Provider-routing honors the explicit API key (Skills ↔ Harness unblock)

## Goal

Route an explicitly-passed provider API key to its correct provider so a consumer
calling `Agent.create({ apiKey: "sk-or-…", model: { id: "openai/gpt-4o-mini" } })`
reaches OpenRouter end-to-end. **Observable metric:** the SDK's own real-LLM test
`packages/sdk/tests/integration/real-llm/openrouter-stream.test.ts` transitions from
FAIL (`expected 0 to be greater than or equal to 1`) to PASS with a live
`OPENROUTER_API_KEY`, and `run.wait().status === "finished"`.

## Context

M4 (ROADMAP `theokit-tools/ROADMAP.md`) requires proving `theokit` (Skills) runs a
real agent on `@theokit/sdk` (Harness) against a real LLM (OpenRouter). DISCOVER
(blueprint `knowledge-base/discoveries/blueprints/m4-skills-harness-integration-blueprint.md`) established the integration
ALREADY EXISTS and is production-wired (`theokit` bridge `sdk-adapter.ts:547-569`
calls `Agent.getOrCreate()` + `agent.send()`), but the seam is BROKEN. Root cause,
isolated against both the installed `@theokit/sdk@2.9.0` AND the local dev SDK
`2.17.0` with a live OpenRouter key, is a **Harness bug — not a bridge bug**:

`agent.send()` fails with `run.wait().status === "error"` and the swallowed detail
`ConfigurationError: No provider client could be resolved (primary=openai). Set
ANTHROPIC_API_KEY or OPENAI_API_KEY / OPENROUTER_API_KEY` (`code: build_inputs_failed`).

The RAW SDK (no bridge) reproduces it identically, proving the defect is in the SDK.
A direct `fetch` to OpenRouter with the same key returns HTTP 200 "PONG" — the key is
live; the SDK short-circuits before any HTTP call (22ms, 0 events).

## Baseline Context

### Files that will be touched

| File | LoC today | Last touch | Why it exists |
|---|---|---|---|
| `packages/sdk/src/internal/runtime/local-agent/real-local-run.ts` | 439 | current | Builds `AgentLoopInputs`; `resolveRunProvider` (`:116-147`) picks `primary` provider + `effectiveModelId`; `buildLoopInputs` (`:150-260`) calls `resolveProviderChain`. THE bug site. |
| `packages/sdk/tests/internal/runtime/resolve-run-provider.test.ts` | 95 | current | Unit cover for `resolveRunProvider` (plugin-provider wiring). Extended with apiKey-prefix cases. |
| `packages/sdk/tests/integration/real-llm/openrouter-stream.test.ts` | 36 | current | Env-gated real-LLM OpenRouter test — currently FAILS. Becomes the integration RED→GREEN. |

### Current callers / dependents

- `resolveRunProvider` — called ONLY by `buildLoopInputs` (`real-local-run.ts:164`); covered by `resolve-run-provider.test.ts`. No cross-repo callers (internal symbol).
- `buildLoopInputs` — called by `RealLocalRun.buildInputs` (`real-local-run.ts:~350` via the `buildInputs` closure); exercised by every real-LLM integration test and the theokit bridge at runtime.
- `resolveProviderChain` (`internal/llm/router.ts:63`) — consumes `{ primary, apiKeys, fallback }`; `buildClient` reads `apiKeys[name]` pool then `resolveApiKey(profile.envVars)` (env). The single `AgentOptions.apiKey` is NOT threaded here today.

### Domain glossary

- **primary** — the provider name the router resolves a client for first.
- **effectiveModelId** — the model string actually sent to the provider; the vendor prefix is stripped when it names the provider (`anthropic/claude → claude`), kept when it is part of an aggregator slug (`openai/gpt-4o-mini` for OpenRouter).
- **KNOWN_PROVIDER_PREFIXES** — `api-key-validator.ts:34` — `sk-` → openai, `sk-ant-` → anthropic, `sk-or-` → openrouter.
- **ROUTING_PREFIXES** — `model-capabilities.ts:298` — `openrouter/`, `vertex/`, `bedrock/` are the ONLY model-id prefixes treated as routing directives today; other `vendor/` prefixes (`openai/`, `anthropic/`) are (incorrectly) inferred as the primary provider even under a conflicting key.

### Architecture boundaries affected

None crossed. `real-local-run.ts` (runtime/local-agent) already imports `getProviderProfile` (providers registry) and `resolveProviderChain` (llm/router). The fix stays inside the runtime layer; no new public API, no DIP boundary change.

## Prior Art & Related Work

- Internal blueprint: `knowledge-base/discoveries/blueprints/m4-skills-harness-integration-blueprint.md` (DISCOVER output; grep-backed).
- Existing contract encoded by `_helpers/real-llm-env.ts`: `DEFAULT_MODELS.openrouter = "openai/gpt-4o-mini"` — the SDK's own test suite ALREADY asserts that a bare `openai/gpt-4o-mini` + an OpenRouter key routes to OpenRouter. The implementation simply never honored it.
- Existing precedence code: `resolveRunProvider` already layers `routes[0].provider ?? modelPrefix ?? env-heuristic`. The fix inserts the key-prefix signal into this same ladder — no new pattern.

## ADRs

### ADR-1 — The explicit API key outranks the model prefix for choosing `primary`

**Decision:** insert apiKey-prefix inference into the `primary` precedence, ABOVE
model-prefix inference and BELOW an explicit `providers.routes[0].provider`:
`routes[0] ?? keyPrefix ?? modelPrefix ?? envHeuristic`.

**Rationale:** the API key is the ground-truth credential of which endpoint will be
called. A `sk-or-` key can ONLY call OpenRouter; inferring `openai` from the model
slug `openai/gpt-4o-mini` and then failing for lack of an OpenAI key is the bug.
KNOWN_PROVIDER_PREFIXES already encodes this mapping (`api-key-validator.ts:34`) — we
reuse it, we don't reinvent (Rule 9).

**Alternatives rejected:**
- *Require consumers to use the `openrouter/` routing prefix* (`openrouter/openai/gpt-4o-mini`). Rejected: it works today but contradicts the SDK's OWN test contract (`DEFAULT_MODELS.openrouter = "openai/gpt-4o-mini"`) and pushes a workaround onto every consumer (violates the no-workaround mandate). The Harness must honor the credential.
- *Env-heuristic only* (`detectPrimaryProvider`). Rejected: it already sits at the bottom of the ladder and is masked whenever the model has a vendor prefix — exactly the failing case.

### ADR-2 — Thread the explicitly-passed `apiKey` into the router pool for `primary`

**Decision:** in `buildLoopInputs`, merge `AgentOptions.apiKey` into the router's
`apiKeys[primary]` pool when that pool has no entry for `primary`, skipping the
fixture (`theo_test_`) and `"local"` mock sentinels.

**Rationale:** without this, `Agent.create({ apiKey })` "works" only when the matching
env var is ALSO set — the router reads `apiKeys[name]` then `env`, never the single
option. Threading the explicit credential makes the consumer contract honest (the key
you pass is the key that is used), regardless of ambient env. Same root cause as
ADR-1 (the passed key was ignored), so it is one fix, not scope creep.

**Alternatives rejected:**
- *Rely on env only.* Rejected: real-llm-validation + the theokit bridge happen to set env via dotenv, but a consumer passing only `apiKey` would silently fail — a latent honesty gap (Rule 8).
- *Overwrite an existing `providers.apiKeys[primary]` pool.* Rejected: explicit `providers.apiKeys` is the more-specific config and must win over the single-key convenience field.

## Dependency Graph

```
T1 (unit RED: primary + effectiveModelId) ─┐
T2 (unit RED: apiKey threading)            ─┼─→ T3 (fix resolveRunProvider + buildLoopInputs) ─→ T4 (integration real-LLM GREEN) ─→ T5 (M4 seam evidence)
```

T1 and T2 are independent unit REDs; T3 makes both GREEN; T4 is the env-gated real-LLM proof; T5 records the cross-repo seam evidence.

## Phase 1 — Fix provider routing (TDD)

### T1.1 — Unit RED: apiKey prefix selects primary + keeps aggregator slug

#### Why this step

`resolveRunProvider` is the single seam that chooses `primary`. A unit test that
pins "sk-or- key + openai/gpt-4o-mini model → primary=openrouter, effectiveModelId
unchanged" fails today (primary=openai, effectiveModelId stripped to gpt-4o-mini),
and deleting the fix later re-reddens it. No real key needed — pure function.

#### Files to edit
- `packages/sdk/tests/internal/runtime/resolve-run-provider.test.ts`

#### TDD
- `test_resolveRunProvider_openrouter_key_routes_to_openrouter_keeping_full_slug`: Given `agentOptions.apiKey = "sk-or-v1-test"` + `model.id = "openai/gpt-4o-mini"`, When `resolveRunProvider`, Then `primary === "openrouter"` AND `effectiveModelId === "openai/gpt-4o-mini"`.
- `test_resolveRunProvider_anthropic_key_and_model_strips_prefix`: Given `apiKey = "sk-ant-test"` + `model.id = "anthropic/claude-3-5-haiku-latest"`, Then `primary === "anthropic"` AND `effectiveModelId === "claude-3-5-haiku-latest"`.
- `test_resolveRunProvider_explicit_route_overrides_key`: Given `providers.routes[0].provider = "openai"` + `apiKey = "sk-or-test"`, Then `primary === "openai"` (explicit route wins).
- `test_resolveRunProvider_no_key_falls_back_to_model_prefix`: Given no `apiKey`, `model.id = "openai/gpt-4o-mini"`, Then `primary === "openai"` (unchanged legacy behavior).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- 4 new unit tests, all initially RED for the two behavior-changing cases.

#### DoD
- `npx vitest run packages/sdk/tests/internal/runtime/resolve-run-provider.test.ts` shows the new cases failing before T3.

### T2.1 — Unit RED: explicit apiKey threaded into the router pool

#### Why this step

The router reads `apiKeys[primary]` before env. A test proving the single
`AgentOptions.apiKey` lands in `apiKeys[primary]` (without env) guards ADR-2. Since
`buildLoopInputs` is not directly exported, assert via the observable seam: extract
the pool-merge into a pure helper `mergeExplicitApiKey` and unit-test it.

#### Files to edit
- `packages/sdk/tests/internal/runtime/resolve-run-provider.test.ts` (same file; add a `describe` block) — OR a sibling `mergeExplicitApiKey` test.

#### TDD
- `test_mergeExplicitApiKey_threads_single_key_for_primary`: Given `pools = undefined`, `primary = "openrouter"`, `apiKey = "sk-or-x"`, Then result `= { openrouter: ["sk-or-x"] }`.
- `test_mergeExplicitApiKey_existing_pool_wins`: Given `pools = { openrouter: ["sk-or-pool"] }`, `apiKey = "sk-or-single"`, Then result keeps `["sk-or-pool"]`.
- `test_mergeExplicitApiKey_skips_fixture_and_local`: Given `apiKey = "theo_test_x"` (or `"local"`), Then result `=== pools` (unchanged).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- 3 new unit tests for the pure helper, RED before T3 (helper does not yet exist).

#### DoD
- Vitest shows the helper cases failing (unresolved import) before T3.

### T3.1 — GREEN: fix `resolveRunProvider` + thread the key in `buildLoopInputs`

#### Why this step

Minimal code to pass T1 + T2. Walk the parsimony ladder: reuse
`KNOWN_PROVIDER_PREFIXES` mapping (no new dependency), add two small pure helpers,
adjust the existing precedence + stripping expression. No new module, no abstraction.

#### Files to edit
- `packages/sdk/src/internal/runtime/local-agent/real-local-run.ts`

Changes:
1. `inferProviderFromApiKey(apiKey)` — longest-prefix match (`sk-or-`, `sk-ant-`, `sk-`) guarded by `getProviderProfile(provider) !== undefined`; returns `undefined` for fixture/`local`/empty.
2. `resolveRunProvider`: `primary = routes[0] ?? inferProviderFromApiKey(apiKey) ?? modelInferredProvider ?? detectPrimaryProvider()`; `effectiveModelId = (modelInferredProvider !== undefined && modelInferredProvider === primary) ? parsedModel.name : (model.id ?? default)`.
3. `mergeExplicitApiKey(pools, primary, apiKey)` — pure helper per ADR-2; called in `buildLoopInputs` to compute the `apiKeys` passed to `resolveProviderChain`.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- All T1 + T2 unit tests GREEN.
- No change to `detectPrimaryProvider`, `parseModelId`, or `router.ts`.
- Function complexity within the Biome cap (≤10); file ≤400 SLOC (extract helpers keep it under).

#### DoD
- `npx vitest run packages/sdk/tests/internal/runtime/resolve-run-provider.test.ts` fully GREEN.
- `pnpm --filter @theokit/sdk typecheck` clean; Biome clean on the touched file.

## Phase 2 — Real-LLM validation + Skills↔Harness seam

### T4.1 — Integration GREEN: SDK's own OpenRouter real-LLM test passes

#### Why this step

The env-gated `openrouter-stream.test.ts` is the SDK's own contract for OpenRouter.
It fails today; after T3 it must pass with a live key — the observable metric of the
Goal. Also run the tools + structured real-LLM OpenRouter tests to prove no regression.

#### Files to edit
- (none — existing tests are the oracle)

#### Concurrency tests
(none — single-threaded)

#### Failure scenarios
- OpenRouter 5xx / network down: the run surfaces `run.wait().status === "error"` with `run.wait().error` populated (already the SDK's behavior) — the test asserts `["finished","running"]` so a transient error fails loudly, not silently.

#### Acceptance criteria
- Running `OPENROUTER_API_KEY=… npx vitest run packages/sdk/tests/integration/real-llm/openrouter-stream.test.ts` exits 0 and the test yields `events >= 1` AND `result.status === "finished"`.
- Running the live-key `openrouter-tools.test.ts` and `openrouter-structured.test.ts` both exit 0 (assert 0 failed tests) — proving no regression on the tool + structured paths.

#### DoD
- Evidence captured (model, event count, status) per `real-llm-validation.md`.

### T5.1 — Skills↔Harness seam evidence (DoD #1)

#### Why this step

M4's DoD #1 requires a `theokit` route/handler to invoke `Agent.create()+send()`
against a real LLM. The bridge already does this; with the Harness fixed AND the
local SDK linked/pinned, the seam must produce a real assistant turn. Record it.

#### Files to edit
- `theokit` `@theokit/sdk` pin — bump to the fixed local build (workspace link or published version), per ADR-2 of the blueprint. **Cross-repo — validated, not committed to `theokit-sdk`.**

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- Running a theokit real-LLM smoke (`packages/agents/tests/smoke/sdk-real-llm.test.ts` or the raw seam probe) against OpenRouter counts `events >= 1` of type `text_delta` AND asserts `done.usage.outputTokens > 0` AND a non-empty assistant `result` string.

#### DoD
- Evidence file recorded (model id + response text + status) under the dogfood evidence path per `real-llm-validation.md`. All temporary probe files (`m4-*probe.mjs`) are deleted (assert `git status` shows no `m4-*probe.mjs`) before commit.

## Coverage Matrix

| Requirement / gap | Task |
|---|---|
| sk-or- key + openai/gpt-4o-mini routes to OpenRouter | T1.1, T3.1 |
| vendor prefix stripped only when it names the primary | T1.1, T3.1 |
| explicit `providers.routes` still wins | T1.1, T3.1 |
| legacy no-key behavior unchanged | T1.1, T3.1 |
| explicit apiKey used without env | T2.1, T3.1 |
| fixture/local keys never threaded as credentials | T2.1, T3.1 |
| SDK OpenRouter real-LLM test GREEN | T4.1 |
| Skills↔Harness seam real-LLM evidence (DoD #1) | T5.1 |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Changing `primary` precedence regresses a provider that relied on model-prefix inference under a same-provider key | MEDIUM | T1.1 pins the legacy no-key and anthropic-key cases; full real-llm suite (openai + openrouter) run in T4.1 | implementer |
| `mergeExplicitApiKey` threads a non-credential sentinel (`local`, fixture) | LOW | Explicit guard + T2.1 negative case | implementer |
| Longest-prefix mis-order (`sk-` matching a `sk-or-` key) | MEDIUM | Ordered array `sk-or-` / `sk-ant-` before `sk-`; T1.1 covers sk-or- | implementer |

## Unresolved Questions

- Should the swallowed `build_inputs_failed` also be surfaced as a `{type:"error"}` **stream event** (not only on `run.wait().error`)? Out of scope for M4 (the DoD is met once the run succeeds); filed as a follow-up honesty issue against the Harness. Documented here so it is not silently dropped.

## Global DoD

- [ ] T1–T3 unit tests GREEN; real-LLM T4 GREEN with a live OpenRouter key.
- [ ] `pnpm --filter @theokit/sdk typecheck` clean; Biome clean; file ≤400 SLOC; complexity ≤10.
- [ ] CHANGELOG `[Unreleased]` updated (Fixed).
- [ ] `docs.md` note: an explicit `apiKey` selects its provider (sk-or-→OpenRouter) and is used without ambient env.
- [ ] No stray probe scripts committed; no secret in any committed file.
- [ ] Cross-repo seam evidence recorded per `real-llm-validation.md` (T5).

## Final Phase — Integration Validation

Run the full SDK gate (`pnpm --filter @theokit/sdk test` for the touched suites +
typecheck + Biome) and the env-gated real-LLM OpenRouter suite. The plan is complete
only when the SDK's own `openrouter-stream` test is GREEN and the Skills↔Harness seam
produces a real assistant turn with recorded evidence.
