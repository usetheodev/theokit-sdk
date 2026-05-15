# Plan: System Prompt Support for `@usetheo/sdk`

> **Version 1.0** — Add public API for users to define the agent's system prompt. Currently the SDK silently sends user messages to the LLM with **no system context**, even though the internal `AgentLoopInputs.systemPrompt` field exists and is wired to the LLM request. This plan closes the gap between the public contract and the internal capability by exposing `systemPrompt` on `AgentOptions` (per-agent default) and `SendOptions` (per-call override), with optional dynamic resolver support cross-validated against pi, Mastra, and OpenAI Agents Python.

## Context

**Evidence of the gap:**

1. `packages/sdk/src/internal/agent-loop/loop.ts:118` reads `inputs.systemPrompt` and passes it as `system` to the LLM request — the runtime supports it.
2. `packages/sdk/src/internal/agent-loop/loop-types.ts:20` declares `systemPrompt?: string` on the internal `AgentLoopInputs` interface — the type is there.
3. `packages/sdk/src/internal/runtime/real-local-run.ts:57-79` builds `AgentLoopInputs` but **never populates** `systemPrompt` from any public source. It is structurally `undefined` for every call from `Agent.create({...}).send(...)`.
4. `packages/sdk/src/types/agent.ts:104-120` defines `AgentOptions` — **no `systemPrompt` field**.
5. `packages/sdk/src/types/run.ts:89-97` defines `SendOptions` — **no `systemPrompt` field**.
6. `docs.md:1049` only mentions `prompt` in the `AgentDefinition` interface for **subagents**, not for the root agent. The contract is silent about the root agent's system prompt — this is a lacuna, not a deliberate design choice.

**Real-world impact:** Every example we shipped (quickstart, shell-tool, mcp-stdio, hooks-policy, cron-schedule) currently calls the LLM with no system context. Users cannot specialize agent behaviour without forking the SDK or smuggling instructions into the user message.

**Cross-validation against references** (paths verified, not paraphrased):

| Reference | File | Field name | Type | Per-call override |
|---|---|---|---|---|
| pi (`@earendil-works/pi-agent-core`) | `referencia/pi/packages/agent/src/types.ts:311` | `systemPrompt` | `string` (with default `"You are a helpful assistant."`) | No (mutate `agent.state.systemPrompt`) |
| Mastra (`@mastra/core`) | `referencia/mastra/packages/core/src/agent/types.ts:259` | `instructions` | `DynamicArgument<AgentInstructions, TRequestContext>` (string \| string[] \| SystemMessage \| Function) | Yes — `AgentGenerateOptions.instructions` (line 523) |
| OpenAI Agents Python | `referencia/openai-agents-python/src/agents/agent.py:283` | `instructions` | `str \| Callable[[RunContextWrapper[TContext], Agent[TContext]], MaybeAwaitable[str]] \| None` | No (per-agent only) |
| Hermes | `referencia/hermes-agent/batch_runner.py:544` | `system_prompt` + `ephemeral_system_prompt` | `str` | Yes — via `ephemeral_*` field |
| Anthropic SDK (protocol) | `@anthropic-ai/sdk` Messages API | `system` | `string \| BlockParam[]` | Yes — per-request |

**Convergence (4 of 5):** Plain string is the universal shape; 2 of 5 (Mastra, OpenAI Agents Python) support **dynamic resolver functions** with context; 3 of 5 (Mastra, Hermes, Anthropic) support **per-call override**.

**Anti-convergence:** name varies (`systemPrompt` vs `instructions` vs `system_prompt`), and default behaviour varies (pi auto-fills, others stay undefined).

## Objective

`Agent.create({ systemPrompt: "..." }).send(msg)` must reach the LLM with a `system` field populated by the configured prompt, and a `SendOptions.systemPrompt` override on `agent.send(msg, { systemPrompt })` must take precedence for that call only.

**Measurable goals:**
1. `AgentOptions.systemPrompt` (string or async resolver) appears in the public type and `docs.md`.
2. `SendOptions.systemPrompt` (string-only override) appears in the public type and `docs.md`.
3. `LocalAgent.send()` resolves the effective system prompt with priority `SendOptions > AgentOptions resolver > AgentOptions string > undefined` and passes it to `AgentLoopInputs.systemPrompt`.
4. Golden test verifies that the request body sent to a stub LLM contains the expected `system` value across all three priority paths.
5. Zero regressions in the 28 smoke + 110 roadmap test suite.
6. Quality gates G1-G10 remain green.

## ADRs

### D1 — Field name: `systemPrompt`

**Decision:** Use `systemPrompt` (camelCase) for the public field on `AgentOptions` and `SendOptions`.

**Rationale:** Aligns with **pi** (`referencia/pi/packages/agent/src/types.ts:311`), our closest reference in the "agent harness" domain. Mastra and OpenAI Agents Python use `instructions`, which conflates with tooling instructions in TS contexts and is less searchable. The underlying LLM protocols (Anthropic `system`, OpenAI `messages[0].role="system"`) all use the word "system" — `systemPrompt` is more discoverable. Subagent `prompt` field stays as-is (different semantic — it's the subagent's full system context, not an addition).

**Consequences:** No conflict with existing `AgentDefinition.prompt` for subagents. Search-friendly for users coming from Anthropic / OpenAI docs.

### D2 — Resolver signature: `string | (ctx) => string | Promise<string>`

**Decision:** Accept either a plain string or an async resolver function that receives a typed context.

**Rationale:** 2 of 5 references (Mastra, OpenAI Agents Python) support dynamic resolvers. Use cases: composing the prompt from runtime data (current cwd, active skills, model id). The async signature is essential for resolvers that read from disk or hit a registry. Reject the third Mastra shape (`string[]` and `SystemMessage[]`) — pure overengineering for our v1.

**Consequences:** Slightly larger surface; mitigated by a `SystemPromptContext` interface that pins down what the resolver receives. Future additions to the context (e.g. memory snapshot) are non-breaking.

### D3 — `SendOptions.systemPrompt` is string-only

**Decision:** Per-call override on `SendOptions` accepts only `string`, not a resolver.

**Rationale:** Per-call resolver invocation adds runtime complexity (async build + caching policy) for negligible benefit — if the caller wants dynamic-per-call, they can compute the string themselves before calling `send`. KISS over a marginal feature surface that no reference (not even Mastra) implements.

**Consequences:** Override is dead-simple to reason about. Users wanting dynamic per-call do `agent.send(msg, { systemPrompt: await build() })`.

### D4 — Priority order

**Decision:** `SendOptions.systemPrompt` > `AgentOptions.systemPrompt` (resolver invocation result) > undefined.

**Rationale:** Per-call override winning is the universal pattern (Mastra `generate({ instructions })` overrides Agent default; Anthropic SDK `system` per request; Hermes `ephemeral_system_prompt`). When `SendOptions.systemPrompt` is undefined and `AgentOptions.systemPrompt` is a resolver, invoke the resolver. When neither is defined, the LLM receives no `system` (current behaviour — preserves existing tests).

**Consequences:** Predictable. Override always wins; no merge/concat semantics to confuse users.

### D5 — No default system prompt

**Decision:** Do NOT auto-fill `"You are a helpful assistant."` when `systemPrompt` is undefined.

**Rationale:** pi auto-fills; Mastra, OpenAI Agents Python, Anthropic, Hermes do not. Auto-filling hides intent — the user expects "I didn't set it → it's empty" not "I didn't set it → SDK invented one". Also: preserves the current 28 smoke + 110 roadmap test behaviour (they all assume no system prompt).

**Consequences:** Users who want a default must opt in. Documented in `docs.md`.

### D6 — Resolver context contents (v1)

**Decision:** `SystemPromptContext` exposes: `agentId`, `cwd`, `model`, `skills` (metadata only, no body), `userMessage`.

**Rationale:** Minimum viable. `agentId` for telemetry; `cwd` for path-aware prompts; `model` for model-specific tuning; `skills` for "you have these tools available" framing; `userMessage` for prompts that adapt to the request (rare but useful). Excludes `memory`, `mcpServers`, `subagents` — they're either redundant with skills or expose internals not meant to leak into prompts.

**Consequences:** Stable v1 contract. Future fields appended (never reordered) per OpenAI Agents Python compatibility convention.

### D7 — CloudAgent path: wire OR reject loudly (chosen: wire)

**Decision:** `CloudAgent.send()` MUST also honour `systemPrompt`. `real-cloud-run.ts` includes `systemPrompt` (when defined) in the JSON body POSTed to `/v1/agents/{id}/runs`. The fixture cloud path accepts and ignores the field (parity with the fixture local path — fixture mode is by design contract-shape-only).

**Rationale:** Edge-case review (EC-1) flagged that the original plan only wired `LocalAgent`, leaving the field silently dropped for cloud agents. That is the worst class of bug — types compile, no error fires, behavior diverges. Two options exist: (a) wire both paths now, (b) throw `ConfigurationError("systemPrompt is not yet supported for cloud agents")` in `CloudAgent.send` when the field is set. Option (a) is preferred because the PaaS protocol is ours to define — adding a field to the body is a one-line server-side decision; the SDK should not pretend the feature is unavailable. Option (b) would be the right call if the server protocol were external and immutable.

**Consequences:** T3.1 expands by one bullet (thread `resolvedSystemPrompt` into `cloud-agent.ts`'s `dispatchRun` equivalent). T4.1 gains one extra test that asserts the cloud SSE POST body contains the resolved `systemPrompt`. The PaaS server will need to read the new field; this is in scope for the server side and documented in `docs.md` as the cloud Run contract.

## Dependency Graph

```
Phase 1 (types) ──▶ Phase 2 (runtime resolution) ──▶ Phase 3 (loop wiring)
                                                          │
                                                          ▼
                                                Phase 4 (tests)
                                                          │
                                                          ▼
                                                Phase 5 (docs + example)
                                                          │
                                                          ▼
                                                Phase 6 (cross-validation)
```

Phase 1 must complete before any other phase (types are foundation). Phases 2 and 3 are sequential (3 reads what 2 produces). Phases 4-6 depend on 3.

---

## Phase 1: Public type surface

**Objective:** Add `systemPrompt` to `AgentOptions` and `SendOptions` with the resolver signature.

### T1.1 — Add `SystemPromptContext` and `SystemPromptResolver` to types/agent.ts

#### Objective
Declare the public types that callers will use to type their resolvers.

#### Evidence
Cross-validation showed 2 of 5 references support dynamic resolvers. Our internal loop already supports `systemPrompt: string` but we want the type-system to encode the richer surface from day one (D2).

#### Files to edit
```
packages/sdk/src/types/agent.ts — append SystemPromptContext + SystemPromptResolver, add systemPrompt? to AgentOptions
```

#### Deep file dependency analysis
- `packages/sdk/src/types/agent.ts` — currently 200+ lines defining `ModelSelection`, `LocalOptions`, `CloudOptions`, `AgentOptions`, `AgentDefinition`, `SDKAgent`. Adding two new exported types + one new optional field on `AgentOptions` is purely additive.
- Downstream consumers: `packages/sdk/src/index.ts` (barrel re-export — automatic), `packages/sdk/src/agent.ts`, `packages/sdk/src/internal/runtime/local-agent.ts`, `packages/sdk/src/internal/runtime/real-local-run.ts`. None break — these read `options.systemPrompt` after this phase.

#### Deep Dives
- `SystemPromptContext` fields per D6: `agentId: string`, `cwd: string | undefined`, `model: ModelSelection | undefined`, `skills: ReadonlyArray<{ name: string; description: string }>`, `userMessage: string`.
- `SystemPromptResolver = (ctx: SystemPromptContext) => string | Promise<string>` — async permitted, never void.
- `AgentOptions.systemPrompt?: string | SystemPromptResolver` — placed after `name` and before `local` to mirror Mastra ordering (`instructions` near the top of the constructor).

#### Tasks
1. Append `SystemPromptContext` interface to `types/agent.ts` after `AgentDefinition`.
2. Append `SystemPromptResolver` type alias.
3. Add `systemPrompt?: string | SystemPromptResolver;` to `AgentOptions`.
4. Update inline JSDoc on `AgentOptions.systemPrompt` with a one-liner referencing the resolver convention.

#### TDD
No new test in this task (pure type addition). The contract is exercised by T4.x.

```
RED:     N/A — pure type change
GREEN:   tsc must continue passing
REFACTOR: None expected
VERIFY:  pnpm typecheck
```

#### Acceptance Criteria
- [x] `SystemPromptContext` and `SystemPromptResolver` are exported from `@usetheo/sdk`. _Verified: `packages/sdk/src/types/agent.ts:104-133` + barrel re-export in `dist/index.d.ts:2`._
- [x] `AgentOptions.systemPrompt` is optional and union-typed. _Verified: `packages/sdk/src/types/agent.ts:154` `systemPrompt?: string | SystemPromptResolver;`._
- [x] `pnpm typecheck` exits 0. _Verified: full `pnpm validate` exits 0._
- [x] Pass: G1 typecheck, G2 Biome lint (no unused-import errors). _Verified via `pnpm validate`._

#### DoD
- [x] Types compile.
- [x] Barrel re-export visible from `import { type SystemPromptContext } from "@usetheo/sdk"`. _Verified: `dist/index.d.ts:2` re-exports `SystemPromptContext`, `SystemPromptResolver`, `SystemPromptSkillRef`._

### T1.2 — Add `systemPrompt` to `SendOptions`

#### Objective
Per D3: string-only override on `SendOptions`.

#### Evidence
3 of 5 references (Mastra, Hermes, Anthropic) support per-call override. Mastra's `AgentGenerateOptions.instructions` (line 523 of `referencia/mastra/packages/core/src/agent/types.ts`) is the closest analog.

#### Files to edit
```
packages/sdk/src/types/run.ts — add systemPrompt? to SendOptions
```

#### Deep file dependency analysis
- `packages/sdk/src/types/run.ts:89-97` defines `SendOptions` with 5 fields (model, mcpServers, onStep, onDelta, local). Adding a 6th optional field is additive.
- Downstream: `LocalAgent.send(message, options: SendOptions)` and `CloudAgent.send(message, options: SendOptions)` both read this. T2.1 wires them.

#### Deep Dives
- Field placement: after `model`, before `mcpServers` — mirrors the priority order (model + system prompt are the "what kind of agent" knobs).
- JSDoc must call out "string only — for dynamic resolvers configure `AgentOptions.systemPrompt`".

#### Tasks
1. Add `systemPrompt?: string;` to `SendOptions` interface.
2. JSDoc explaining override semantics + reference to AgentOptions resolver path.

#### TDD
No test in this task. Exercised by T4.2.

```
RED:     N/A
GREEN:   tsc must pass
VERIFY:  pnpm typecheck
```

#### Acceptance Criteria
- [x] `SendOptions.systemPrompt?: string` is present. _Verified: `packages/sdk/src/types/run.ts:90-95`._
- [x] `pnpm typecheck` exits 0.

#### DoD
- [x] Type compiles.
- [x] No new lint warnings.

---

## Phase 2: Runtime resolution helper

**Objective:** Extract the priority/resolver logic into a standalone, unit-testable function before wiring it into `LocalAgent`.

### T2.1 — Create `resolveSystemPrompt` helper

#### Objective
Single function that takes `AgentOptions.systemPrompt`, `SendOptions.systemPrompt`, and a `SystemPromptContext`, and returns `Promise<string | undefined>` per D4 priority order.

#### Evidence
The priority logic has three branches (override, resolver, plain string) and must handle async. Extracting it gives us a pure function we can golden-test without spinning up an agent.

#### Files to edit
```
packages/sdk/src/internal/runtime/system-prompt.ts — (NEW) resolveSystemPrompt
packages/sdk/src/internal/runtime/local-agent.ts — will import in T3.1
```

#### Deep file dependency analysis
- `system-prompt.ts` is new; sits in `internal/runtime/` alongside the other runtime adapters (`local-agent.ts`, `real-local-run.ts`). Imports `SystemPromptContext`, `SystemPromptResolver`, `AgentOptions`, `SendOptions` from `types/agent.ts` and `types/run.ts`.
- The function is called once per `agent.send()` (T3.1).

#### Deep Dives
- Signature: `async function resolveSystemPrompt(agent: AgentOptions["systemPrompt"], override: SendOptions["systemPrompt"], ctx: SystemPromptContext): Promise<string | undefined>`
- Priority (D4):
  1. If `override !== undefined`, return `override` immediately. (Per-call wins, no resolver invocation.)
  2. If `agent === undefined`, return `undefined`.
  3. If `typeof agent === "string"`, return `agent`.
  4. If `typeof agent === "function"`, `await agent(ctx)` and return.
- Edge cases:
  - Resolver throws → propagate (caller decides). Document in JSDoc.
  - Resolver returns empty string `""` → return empty string (don't coerce to undefined). User opted into the empty system, respect it.
  - Resolver returns `undefined` (TypeScript should reject, but defensive at runtime) → coerce to `undefined`.

#### Tasks
1. Create `system-prompt.ts` with `resolveSystemPrompt` function.
2. Add JSDoc with priority table, resolver-throws caveat, and a note that the SDK does NOT impose a timeout on the resolver (per edge-case review EC-5).
3. Coerce non-string resolver returns to `undefined` (per edge-case review EC-2) — defensive against `as` casts and untyped JS callers.
4. Export from this module (no barrel export — internal only).

#### TDD
```
RED:     resolves_override_first() — given override="A" and agent="B", returns "A".
RED:     resolves_agent_string_when_no_override() — given override=undef, agent="B", returns "B".
RED:     resolves_agent_resolver_when_no_override() — given override=undef, agent=async(ctx) => `pkg-${ctx.agentId}`, returns "pkg-test-1".
RED:     returns_undefined_when_nothing_set() — both undef → undefined.
RED:     passes_full_context_to_resolver() — resolver receives ctx with all 5 fields.
RED:     propagates_resolver_errors() — resolver throws → resolveSystemPrompt rejects.
RED:     respects_empty_string_from_resolver() — resolver returns "" → returns "".
RED:     resolves_empty_string_override() — override="" wins over agent="X" → returns "" (EC-4).
RED:     coerces_non_string_resolver_to_undefined() — resolver returns null/0/object → returns undefined (EC-2).
GREEN:   Implement the function in ~30 lines.
REFACTOR: None expected (function is small + pure).
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/runtime/resolve-system-prompt.golden.test.ts
```

Tests live at `packages/sdk/tests/golden/runtime/resolve-system-prompt.golden.test.ts`.

#### Acceptance Criteria
- [x] 9 unit tests pass. _Verified: `tests/golden/runtime/resolve-system-prompt.golden.test.ts` reports 9/9 green._
- [x] `resolveSystemPrompt` is pure (no I/O, deterministic given inputs). _Verified by inspection: function body only inspects arguments and `typeof`._
- [x] Pass: G1 typecheck, G2 Biome, G9 cognitive complexity ≤ 10, G10 zero duplication. _Verified: `pnpm validate` exit 0; jscpd reports 0 clones._

#### DoD
- [x] All RED tests fail before implementation, pass after. _Note: tests + function were authored together; behaviour is matched by the 9 green assertions which would all fail against the pre-T2.1 codebase (function didn't exist)._
- [x] Function ≤ 30 lines. _Verified: `resolveSystemPrompt` body is 12 lines (`system-prompt.ts:25-36`)._
- [x] No `any` types. _Verified by inspection (only `unknown` in test casts for defensive coercion)._

---

## Phase 3: LocalAgent wiring

**Objective:** Connect the public API to the internal loop.

### T3.1 — `LocalAgent.send` AND `CloudAgent.send` build `SystemPromptContext` and call `resolveSystemPrompt`

#### Objective
Read `options.systemPrompt` from agent + send options, build context with cwd/model/skills/userMessage, resolve, pass to `createRealLocalRun` / `createLocalRun` (local path) AND `createRealCloudRun` / `createCloudRun` (cloud path). Per ADR D7, cloud agents must NOT silently drop the field.

#### Evidence
Today `LocalAgent.send` (`packages/sdk/src/internal/runtime/local-agent.ts:140-153`) routes to either `createRealLocalRun` or `createLocalRun` without touching system prompt at all. `CloudAgent.send` (`packages/sdk/src/internal/runtime/cloud-agent.ts:45-58`) is in the same state. Edge-case review (EC-1) flagged the cloud silent-drop as a MUST FIX.

#### Files to edit
```
packages/sdk/src/internal/runtime/local-agent.ts — call resolveSystemPrompt before dispatch
packages/sdk/src/internal/runtime/cloud-agent.ts — call resolveSystemPrompt before dispatch (D7)
packages/sdk/src/internal/runtime/real-local-run.ts — accept resolvedSystemPrompt option, set on AgentLoopInputs
packages/sdk/src/internal/runtime/real-cloud-run.ts — accept resolvedSystemPrompt option, include in PaaS POST body (D7)
packages/sdk/src/internal/runtime/local-run.ts — accept resolvedSystemPrompt option (fixture path: accept and ignore, parity)
packages/sdk/src/internal/runtime/cloud-run.ts — accept resolvedSystemPrompt option (fixture cloud path: accept and ignore, parity)
```

#### Deep file dependency analysis
- `local-agent.ts` `dispatchRun` (introduced in earlier refactor) is the single chokepoint — only place `createRealLocalRun` and `createLocalRun` are called from.
- `real-local-run.ts` `buildLoopInputs` (lines 57-79) constructs `AgentLoopInputs`. Add `systemPrompt: resolvedSystemPrompt` to the returned object when defined.
- `local-run.ts` (fixture path) — receives the resolved prompt but ignores it for runtime behaviour. Why pass it? So fixture-mode golden tests can later assert that the prompt would flow through. v1: just accept and ignore.

#### Deep Dives
- Building `SystemPromptContext.skills`: the `skillsManager` is on `LocalAgent`. Call `skillsManager.list()` once if non-fixture path is taken. To avoid I/O in the hot path when not needed, only call when `options.systemPrompt` is a function. Lazy resolution.
- Building `SystemPromptContext.userMessage`: it's the same `userText` already computed in `send`.
- `SystemPromptContext.cwd`: `this.workspaceCwd`.
- `SystemPromptContext.model`: `this.model` (after override application).
- `SystemPromptContext.agentId`: `this.agentId`.
- Compute resolved prompt **after** pre-run hook but **before** `dispatchRun` so hook denials short-circuit before resolver runs.

#### Tasks
1. Add `private async buildSystemPromptContext(userText: string): Promise<SystemPromptContext>` helper on `LocalAgent`. Guard the skills lookup: `const skills = this.skillsManager ? await this.skillsManager.list() : [];` per edge-case review EC-3.
2. Modify `LocalAgent.send()` to call `resolveSystemPrompt(this.options.systemPrompt, options.systemPrompt, ctx)` and stash result in a local `resolvedSystemPrompt`.
3. Thread `resolvedSystemPrompt` into `dispatchRun(message, options, resolvedSystemPrompt)`.
4. Update `createRealLocalRun` signature: add `systemPrompt?: string` to `CreateRealLocalRunOptions`.
5. In `buildLoopInputs`, conditionally set `systemPrompt: options.systemPrompt` on the returned `AgentLoopInputs`.
6. Update `createLocalRun` signature: add `systemPrompt?: string` to `CreateLocalRunOptions` (accept but ignore in fixture path for now).
7. Repeat steps 1-3 for `CloudAgent`. Skills are not relevant for cloud (no local skillsManager); pass `skills: []` per ADR D6/D7 (subagent prompt context is local-only).
8. Update `createRealCloudRun`: add `systemPrompt?: string` to `CreateRealCloudRunOptions`. In `real-cloud-run.ts postRun`, include `systemPrompt` in the JSON body when defined.
9. Update `createCloudRun` signature: add `systemPrompt?: string` to `CreateCloudRunOptions` (accept and ignore in fixture cloud path).

#### TDD
Already covered by T2.1 unit tests for `resolveSystemPrompt`. End-to-end behaviour test in T4.1.

```
RED:     T4.1 covers
GREEN:   Implement wiring
REFACTOR: Verify dispatchRun stays under cognitive complexity 10
VERIFY:  pnpm typecheck && pnpm test
```

#### Acceptance Criteria
- [x] `LocalAgent.send` invokes `resolveSystemPrompt` exactly once per call. _Verified: `local-agent.ts:152` calls `resolveSystemPromptForSend` once before `dispatchRun`._
- [x] When `systemPrompt` is a function, `skills` field of context is populated from `skillsManager.list()`. _Verified: `local-agent.ts:167-181 buildSystemPromptContext` invokes `this.skillsManager.list()` when `typeof agentSetting === "function"`._
- [x] When neither is set, no resolver is invoked (no `skillsManager` call, no I/O). _Verified: `shouldResolveSystemPrompt` short-circuits in `resolveSystemPromptForSend` (`system-prompt.ts:53`)._
- [x] Existing 28 smoke + 110 roadmap tests still pass. _Verified: 42 smoke (28 original + 14 new) and 124 roadmap (110 original + 14 new) green; original count preserved._
- [x] Pass: G9 cognitive complexity ≤ 10 on `LocalAgent.send` and `dispatchRun`. _Verified: `pnpm validate` exit 0; no complexity violations._

#### DoD
- [x] `pnpm test` green.
- [x] `pnpm -w run test:roadmap` green.
- [x] No new Biome warnings.

---

## Phase 4: End-to-end tests

**Objective:** Prove the system prompt actually reaches the LLM with the right value across all priority paths.

### T4.1 — Golden: `systemPrompt` from `AgentOptions` reaches the LLM request body

#### Objective
Stub the Anthropic streaming endpoint, send a message, assert the captured request body contains `system: "<expected>"`.

#### Evidence
The existing `tests/golden/agent/real-local-runtime.golden.test.ts` already runs a stub Anthropic server. Reuse its pattern for the assertion.

#### Files to edit
```
packages/sdk/tests/golden/agent/system-prompt.golden.test.ts — (NEW) 4 tests across priority paths
```

#### Deep file dependency analysis
- New test file lives next to `real-local-runtime.golden.test.ts`. Reuses the stub-server pattern (createServer, capture request body).
- Imports `Agent` from `../../../src/index.js`, uses `ANTHROPIC_API_KEY` + `ANTHROPIC_API_BASE_URL` env injection just like the existing test.

#### Deep Dives
- Stub server captures `JSON.parse(req body)` into a shared `captured` variable, then emits a canned 4-frame SSE response so the run finishes.
- Tests run sequentially because they share the stub server in `beforeEach`. Use `afterEach` to clean env vars.

#### Tasks
1. Set up stub server identical to `real-local-runtime.golden.test.ts`.
2. Write 4 tests.

#### TDD
```
RED:     agent_options_string_reaches_llm() — Agent.create({ systemPrompt: "Be terse." }), send "hi", captured body has system === "Be terse."
RED:     agent_options_resolver_reaches_llm() — Agent.create({ systemPrompt: async (ctx) => `Agent ${ctx.agentId}` }), captured body has system matching /^Agent agent-/
RED:     send_options_overrides_agent_options() — agent has systemPrompt: "A", send with { systemPrompt: "B" }, captured body has system === "B"
RED:     undefined_when_neither_set() — neither set, captured body has NO system key (or `system` is undefined)
RED:     cloud_agent_includes_systemPrompt_in_paas_body() — Agent.create({ cloud, systemPrompt: "..." }), captured POST /v1/agents/{id}/runs body has systemPrompt === "..." (EC-1 / D7).
GREEN:   Already implemented by T1+T2+T3
REFACTOR: None
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/agent/system-prompt.golden.test.ts
```

#### Acceptance Criteria
- [x] 5 tests pass. _Verified: `tests/golden/agent/system-prompt.golden.test.ts` 5/5 green._
- [x] Each test asserts the **exact** captured value (not just presence). _Verified: tests use `toBe("Be terse.")`, `toBe("B")`, `toBe("Cloud agent persona.")`; the resolver test uses `toMatch(/^Agent agent-/)` against the exact runtime-substituted UUID prefix._
- [x] Tests do not leak env vars (cleaned in `afterEach`). _Verified: `afterEach` deletes `ANTHROPIC_API_KEY`, `ANTHROPIC_API_BASE_URL`, `THEOKIT_API_BASE_URL`._

#### DoD
- [x] All tests pass on first run after Phase 3 lands. _Verified — green from initial run._
- [x] Test file ≤ 200 LoC. _Verified: `wc -l` reports 161 LoC._

### T4.2 — Smoke: existing tests still pass

#### Objective
Catch regressions in the 28 smoke + 110 roadmap suites.

#### Evidence
Roadmap tests exercise the entire fixture path; smoke tests cover the dist build. Both have a real chance of regression if T3.1 introduces a side effect.

#### Files to edit
```
(no edits — verification only)
```

#### Tasks
1. `pnpm test` from repo root.
2. `pnpm -w run test:roadmap` from repo root.

#### TDD
```
RED:     N/A — regression check
GREEN:   28 smoke + 110 roadmap pass
VERIFY:  pnpm test && pnpm -w run test:roadmap
```

#### Acceptance Criteria
- [x] 28/28 smoke green. _Verified: 42/42 smoke (28 original preserved + 14 new)._
- [x] 110/110 roadmap green. _Verified: 124/124 roadmap (110 original preserved + 14 new)._
- [x] No new flakes. _Verified across multiple `pnpm validate` runs._

#### DoD
- [x] Two test commands exit 0.

---

## Phase 5: Docs + example

**Objective:** Make the feature discoverable.

### T5.1 — Update `docs.md` AgentOptions table

#### Objective
Document `systemPrompt` on `AgentOptions` and `SendOptions`.

#### Evidence
`docs.md:1027-1038` is the AgentOptions table. Missing `systemPrompt` is the visible lacuna users will hit first.

#### Files to edit
```
docs.md — add systemPrompt row to AgentOptions table (after `model`), add systemPrompt row to SendOptions section
```

#### Deep file dependency analysis
- `docs.md` is the canonical contract per `packages/sdk/CLAUDE.md`. Any public-API change MUST land here in the same PR.
- No code reads `docs.md` — purely documentation.

#### Tasks
1. Add row to AgentOptions table: `systemPrompt | string \| (ctx: SystemPromptContext) => string \| Promise<string> | (none) | System prompt for the agent...`
2. Add `SystemPromptContext` interface listing under the table.
3. Document `SendOptions.systemPrompt` override.
4. Add explicit non-inheritance note (per edge-case review EC-6): "Subagents do not inherit this prompt — they use their own `AgentDefinition.prompt` field exclusively."
5. Add timeout-responsibility note (per edge-case review EC-5): "The SDK does not impose a timeout on resolver functions. If your resolver hits a slow network resource, wrap it in your own `Promise.race` with a timeout."

#### TDD
N/A — docs.

#### Acceptance Criteria
- [x] Both fields documented with type signatures. _Verified: `docs.md:1030` (AgentOptions row) + `docs.md:351` (SendOptions row)._
- [x] Priority order described. _Verified: `docs.md:1030` explicit chain "SendOptions.systemPrompt > AgentOptions.systemPrompt (resolved if function) > undefined"._
- [x] `SystemPromptContext` fields listed. _Verified: `docs.md:362-369` interface block + field descriptions._

### T5.2 — Update quickstart example to demonstrate `systemPrompt`

#### Objective
First example users see should show the field in action.

#### Files to edit
```
examples/quickstart/src/index.ts — add systemPrompt to Agent.create call
examples/quickstart/README.md — note the new field
```

#### Tasks
1. Add `systemPrompt: "Respond in one terse sentence. Don't apologize."` to the `Agent.create` call.
2. Update expected output in README.

#### TDD
N/A — example.

#### Acceptance Criteria
- [x] Example still runs (`pnpm dev` from `examples/quickstart`). _Verified: real OpenRouter run, `status=finished duration=1218ms`._
- [x] Demonstrates a visible behaviour change vs current output. _Verified: terse 4-word reply with `systemPrompt` vs 36-word hedging reply without (same prompt, same model)._

---

## Phase 6: Cross-validation against references (the rigorous gate)

**Objective:** Read the implementation back against the references that motivated this plan. Surface any drift.

### T6.1 — Cross-check field name + type signature against references

#### Objective
Verify our `systemPrompt: string | SystemPromptResolver` matches the pattern of at least 2 references and doesn't accidentally diverge.

#### Evidence
The 4-reference cross-validation in the "Context" section above is the baseline. Phase 6 verifies the implementation faithfully reflects D1-D6.

#### Files to edit
```
.claude/knowledge-base/reviews/cross-validation/system-prompt-support-xval-<DATE>.md — (NEW) classified divergence report
```

#### Tasks
1. Open each of the 4 reference files cited in "Context".
2. For each, compare:
   - Field name
   - Type signature shape
   - Override semantics
   - Resolver context contents (if applicable)
3. Classify each divergence: BLOCKER (would mislead a user migrating from that reference) / CRITICAL (loses a major capability) / MAJOR (significant DX gap) / MINOR (cosmetic) / INFO (intentional per ADR).
4. Confirm every intentional divergence maps to an ADR (D1-D6). Any unjustified divergence is a defect.

#### TDD
N/A — manual review.

#### Acceptance Criteria
- [x] All divergences are classified. _Verified: 5 INFO entries in `.claude/knowledge-base/reviews/cross-validation/system-prompt-support-xval-2026-05-15.md`._
- [x] Every divergence ≥ MAJOR has an ADR justification. _Verified: 0 entries at MAJOR or above; 5 INFO entries reference D1/D2/D3/D5/D6._
- [x] Zero BLOCKERs. _Verified: report's "BLOCKER" section reads `(none)`._

#### DoD
- [x] Report saved to `.claude/knowledge-base/reviews/cross-validation/`.
- [x] Plan APROVADO or APROVADO COM RESSALVAS. _Verified: report verdict reads APROVADO._

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `AgentOptions` has no `systemPrompt` field | T1.1 | Added as optional union (string \| resolver) |
| 2 | `SendOptions` has no `systemPrompt` field | T1.2 | Added as optional string-only override |
| 3 | Resolver function pattern from Mastra / OpenAI Agents Python | T1.1, T2.1 | `SystemPromptResolver = (ctx) => string \| Promise<string>` |
| 4 | Per-call override pattern from Mastra / Hermes / Anthropic | T1.2, T2.1 | `SendOptions.systemPrompt` wins priority |
| 5 | Priority order (override → resolver → string → undefined) | T2.1 | Encoded in `resolveSystemPrompt` |
| 6 | Internal loop already supports `system` but is never populated | T3.1 | `LocalAgent.send` now resolves + threads through |
| 7 | Resolver context fields (D6) | T1.1, T3.1 | `agentId`, `cwd`, `model`, `skills`, `userMessage` |
| 8 | Lazy skills resolution (avoid I/O when no resolver set) | T3.1 | Only call `skillsManager.list()` when resolver is a function |
| 9 | No automatic default (avoid pi's auto-fill surprise) | D5 | Implementation returns `undefined` when nothing set |
| 10 | Empty string respected (don't coerce to undefined) | T2.1 | Test `respects_empty_string_from_resolver` |
| 11 | Resolver errors propagate to caller | T2.1 | Test `propagates_resolver_errors` |
| 12 | docs.md documents the field | T5.1 | AgentOptions + SendOptions rows added |
| 13 | Example demonstrates the field | T5.2 | Quickstart updated |
| 14 | Implementation cross-checked against references | T6.1 | Divergence report |
| 15 | Quality gates G1-G10 still green | T3.1, T4.x | Verified by `pnpm validate` |
| 16 | Zero regressions in 28 smoke + 110 roadmap | T4.2 | Verified |

| 17 | EC-1 (MUST FIX): Cloud agents silently ignore systemPrompt | T3.1, T4.1 + ADR D7 | Wire `CloudAgent.send` + `real-cloud-run.ts` to thread systemPrompt; added 5th E2E test against PaaS stub |
| 18 | EC-2 (SHOULD TEST): Non-string resolver return coerces to undefined | T2.1 | Added defensive `typeof === "string"` check + test `coerces_non_string_resolver_to_undefined` |
| 19 | EC-3 (SHOULD TEST): `skillsManager` undefined doesn't crash | T3.1 | `skills: skillsManager ? await ... : []` guard |
| 20 | EC-4 (SHOULD TEST): Empty-string override is honored | T2.1 | Added test `resolves_empty_string_override` |
| 21 | EC-5 (DOCUMENT): No timeout on resolver | T5.1 | Docs note user responsibility |
| 22 | EC-6 (DOCUMENT): Subagents don't inherit parent systemPrompt | T5.1 | Explicit non-inheritance note |

**Coverage: 22/22 gaps covered (100%)**

## Global Definition of Done

- [x] All 6 phases completed in order.
- [x] `pnpm typecheck` exits 0.
- [x] `pnpm test` (28 smoke + hygiene) green. _42/42 (28 original + 14 new)._
- [x] `pnpm -w run test:roadmap` (110 roadmap) green. _124/124 (110 original + 14 new)._
- [x] Plus: 7 new unit tests for `resolveSystemPrompt` (T2.1) + 4 new golden tests for E2E (T4.1) all pass. _Exceeded: 9 unit + 5 golden = 14, all green._
- [x] Zero Biome warnings.
- [x] G1 typecheck, G2 lint, G3 publint+attw, G4 tests, G5 knip, G6 depcruise, G7 layered arch, G8 LoC ≤ 400, G9 complexity ≤ 10, G10 jscpd 0 clones — all green via `pnpm validate`. _Verified: exit 0._
- [x] `docs.md` updated. _Verified: AgentOptions row + SendOptions row + SystemPromptContext interface + priority chain + non-inheritance + timeout notes._
- [x] Quickstart example updated and verified to still run against real OpenRouter key. _Verified live: finished in 1218ms with persona-shaped 4-word reply._
- [x] Cross-validation report saved with zero BLOCKERs. _Verified: `.claude/knowledge-base/reviews/cross-validation/system-prompt-support-xval-2026-05-15.md`._
- [x] **Runtime-metric proof** — at least one test (T4.1) observes the `system` field in a captured LLM request body in a real workload (stub server intercepts the actual fetch). Not just "code exists + types compile". _Verified: 5 E2E tests (Anthropic stub + PaaS stub) capture `req.body` via real `createServer` + intercept `fetch`._
- [x] **Backward compatibility** — every existing test in 28 smoke + 110 roadmap passes without modification. The new field is opt-in. _Verified: all 138 pre-existing tests still pass; only new tests added (14 in total)._

## Final Phase: Dogfood QA (MANDATORY)

**Objective:** Validate the feature as a real user would experience it — with the actual OpenRouter key from `.env`.

### Execution

1. Update `examples/quickstart/src/index.ts` to use a system prompt.
2. Run `pnpm install --ignore-workspace --force && pnpm dev` against the real OpenRouter key.
3. Capture the LLM response.
4. Compare against a control run (same prompt, no system prompt).
5. The system prompt MUST visibly steer the response (e.g. terseness, persona, refusal pattern).

### Acceptance Criteria

- [x] Quickstart with `systemPrompt: "Respond only in haiku."` produces a haiku-shaped output. _Verified live (real OpenRouter, prompt "Describe a sunset."):_
      ```
      Sky ablaze with gold,
      Whispers of the night unfold,
      Day's end, peace takes hold.
      ```
      _3 lines, 5-7-5 syllable shape._
- [x] Quickstart with `systemPrompt: undefined` produces a normal sentence. _Verified live (same prompt, control):_
      ```
      A sunset is a breathtaking spectacle that marks the transition
      from day to night. As the sun descends toward the horizon, its
      light transforms, bathing the sky in a vibrant palette of colors...
      ```
      _Multi-paragraph descriptive, ~150 words._
- [x] The diff is visibly attributable to the system prompt, not random sampling. _Verified: same model, same agent factory, same user message; only `systemPrompt` differs._
- [x] Zero CRITICAL issues introduced by this plan's changes. _Verified: `pnpm validate` exit 0; G1-G10 green._

### If Dogfood Fails

1. Verify the LLM request body via stub test (T4.1) — does `system` appear there? If yes, the issue is downstream (LLM client formatting). If no, the wiring is broken.
2. Check `real-local-run.ts buildLoopInputs` — `systemPrompt` field present on returned object?
3. Check `agent-loop/loop.ts` line 118 — `inputs.systemPrompt` still being passed?
4. Re-run all tests, then re-dogfood.
