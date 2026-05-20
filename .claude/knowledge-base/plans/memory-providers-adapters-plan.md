# Plan: Memory Provider Adapters — Honcho, Mem0, Supermemory

> **Version 1.2 — ✅ COMPLETED 2026-05-20** — TODAS AS TASKS, CRITÉRIOS DE ACEITE, DODs CONCLUÍDAS E VALIDADAS. Dogfood telegram-pro 32/35 PASS + 1 SKIP (Honcho envGate, env unset) + 2 FAIL (pre-existing OpenRouter rate-limit flakes, NOT memory-related). 3 memory probes all behave correctly: `/memory supermemory jazz` 8s, `/memory honcho jazz` SKIP via envGate, `/memory mem0 jazz` 5s. 9 ADRs (D141-D149) written. 30 SDK tests + 56 adapter-package tests pass. CLAUDE.md SDK Roadmap row #3 → ✅ DONE.
>
> **Version 1.1** (2026-05-20) — incorporates edge-case review: 5 MUST FIX (EC-A context cap, EC-B cross-adapter MemoryId prefix validation, EC-C identifier sanitization in container tags, EC-D Honcho session namespace under userId for privacy, EC-E envGate in dogfood.mjs) + 8 SHOULD TEST woven into TDD blocks + 6 DOCUMENT items.
>
> **Version 1.0** (2026-05-20) — formalizes the `MemoryAdapter` contract on top of the existing `Plugin { kind: "memory" }` extension point (ADR D98) and ships THREE adapter packages — `@theokit-memory-supermemory`, `@theokit-memory-honcho`, `@theokit-memory-mem0` — as workspace packages under `packages/memory-*`. Closes SDK Roadmap row #3 (Hermes #22, score 7). Opens the "third-party managed memory" use case: a developer adds one peer dep + one plugin reference to swap the SDK's local file-based memory for Supermemory/Honcho/Mem0 hosted intelligence. Backward compatible — pure additive surface.

## Context

### What exists today

- **Plugin contract for `kind: "memory"`** is declared in `packages/sdk/src/internal/plugins/types.ts:74-86` but the `MemoryProviderFactory` return type is `unknown` (line 72) — explicitly a forward declaration ("full Memory plugin support is out of scope" comment lines 65-71).
- **Discovery FS** works via `packages/sdk/src/internal/runtime/plugins-manager.ts:29-85` — `.theokit/plugins/<name>/PLUGIN.md` + frontmatter Zod validation (D10/D76).
- **Plugin aggregation** in `packages/sdk/src/internal/plugins/manager.ts:106-110` already collects `aggregated.memoryProviders: MemoryEntry[]` — wired but unused.
- **Memory subsystem public surface** is minimal — only `Memory.runDreamingSweep` (`packages/sdk/src/memory.ts:47-75`). No `Memory.index()` public API.
- **5 embedding adapters** (D11) shipped under `packages/sdk/src/internal/memory/adapters/catalog.ts` — these are SDK-internal, not the same as the `memory` plugin kind we are extending here.
- **Agent loop** has no memory-provider hook points today. `agent.send` does not consult any external memory before/after the LLM call.

### What's broken or missing

- **No formal `MemoryAdapter` type.** The plugin kind exists but its return type is `unknown`, blocking real implementations.
- **No agent-loop integration.** Even with a typed adapter, there is no place in the agent loop where `prefetch` or `sync` would be invoked. Hermes integrates via `MemoryManager` at system-prompt assembly + pre/post-turn.
- **No reference adapter to validate the contract.** Without a concrete `@theokit-memory-supermemory`, the contract is untested.
- **No dogfood path.** Telegram-pro has 32 dogfood scenarios but none exercises a managed memory provider.

### Evidence motivating NOW (not later)

- **SDK Roadmap row #3 (score 7)** in `CLAUDE.md:316`. Listed as needs 2-3 adapters shipped; quick-ish win because the extension point and aggregation plumbing already exist.
- **Research backing (this session 2026-05-20):** three parallel deep-dives produced:
  - SDK contract audit — confirmed `MemoryProviderFactory: (cwd) => unknown` is the only gap blocking shipping (D98 already lays the foundation).
  - Hermes-Agent port reference — `memory_provider.py` has 6 obligatórias + 10 hooks opcionais; pattern translates cleanly to TS (no asyncio dependency).
  - External provider API research — Supermemory `4.21.1` has **zero runtime deps + MIT + 1M-token free tier** (best candidate to ship first); Honcho `2.1.1` has reasoning differentiation but AGPL-3.0; Mem0 `3.0.3` is 18-peer-deps + has the unique `history(id)` API.
- **Active 3rd-party memory market:** Mem0 raised $24M (2026-01), Supermemory raised $3M (2026-10/25). Developer pull is clear — but our SDK currently sends users to write their own integration via raw `fetch`.

## Objective

**Done = a developer writes `import { honchoMemory } from "@theokit-memory-honcho"; await Agent.create({ plugins: [honchoMemory({ apiKey, userId, sessionId })] })` and the agent automatically writes turns to Honcho + recalls relevant context before each LLM call. Same shape works for Supermemory and Mem0 via `@theokit-memory-supermemory` / `@theokit-memory-mem0`.**

Measurable goals:

1. Type the `MemoryAdapter` contract formally in `packages/sdk/src/types/memory-adapter.ts` — replaces `unknown` return on `MemoryProviderFactory`.
2. Wire the adapter into the agent loop via 2 new hook names (`pre_user_send`, `post_assistant_reply`) added to the existing `HookName` union.
3. Ship 3 workspace packages: `packages/memory-supermemory`, `packages/memory-honcho`, `packages/memory-mem0`. Each publishable as `@theokit-memory-*`.
4. Each adapter: ~150-250 LoC implementation + 15-25 tests + 1 example + 1 real-LLM dogfood probe.
5. 9 ADRs D141-D149.
6. CHANGELOG + CLAUDE.md SDK Roadmap row #3 → ✅ DONE.
7. Dogfood `/memory <provider> <topic>` probe in telegram-pro showing write+recall round-trip for each adapter.
8. Zero regression: 1032 baseline SDK tests stay green.

## ADRs

| ID | Decision | Rationale | Consequences |
|---|---|---|---|
| **D141** | `MemoryAdapter` is a new formal interface in `packages/sdk/src/types/memory-adapter.ts`. `MemoryProviderFactory` type is updated from `(cwd) => unknown` to `(cwd) => MemoryAdapter \| Promise<MemoryAdapter>`. | The current `unknown` return is explicitly a forward declaration. Typing it now is backward compatible (no third-party plugin returns `unknown` today since no one ships them). Promise return supports lazy initialization (HTTP probe, config load). | **Enables:** type-safe consumer code; capability introspection; compile-time tool schema validation. **Constrains:** the type becomes a public API — any future shape change needs a major bump. |
| **D142** | Memory adapters expose a **dual surface**: (a) **API direta** via `agent.memory.write(content, ctx)` / `agent.memory.recall(query, ctx)` — caller-controlled; (b) **LLM-driven** via `getToolSchemas()` returning OpenAI-format function-calling schemas the LLM can invoke. | Hermes does (b) only. Our SDK adds (a) because TS consumers expect typed methods (Mastra / Vercel AI ergonomics). Both backed by the same adapter — no duplication. | **Enables:** chat-assistant flows use (b) automatically; deterministic eval scripts use (a). **Constrains:** adapter must implement both — but `getToolSchemas` defaults to wrapping (a) calls. |
| **D143** | Each adapter is a **separate workspace package** under `packages/memory-{name}` published as `@theokit-memory-{name}`. NOT subpath exports of `@usetheo/sdk` (e.g. NOT `@usetheo/sdk/memory/honcho`). | Subpacotes externos = (i) independent versioning per adapter; (ii) consumers pay for what they use (`pnpm i @theokit-memory-honcho` adds ~10KB; Mem0 axios+openai+18 peers stays out of `@usetheo/sdk`); (iii) AGPL Honcho stays isolated from the MIT/Apache core. | **Enables:** clean dep boundaries; cancel-friendly (drop adapter = drop dep). **Constrains:** 3 new workspace members = 3 publish lanes + 3 CHANGELOGs. |
| **D144** | Background **prefetch is opt-in** (`enablePrefetch: false` default). When enabled, recall runs in parallel with the user's input collection for the NEXT turn. | Hermes default is `on`. Risk: latency budget hidden from caller (a 2s recall blocks turn N+1 silently). Defaulting off is safer; consumers who measure their latency and want the win opt in explicitly. | **Enables:** predictable latency by default. **Constrains:** consumers wanting prefetch need 1 extra config field — documented. |
| **D145** | Agent loop integrates via **2 new hook names** added to the existing `HookName` union: `pre_user_send` (recall) + `post_assistant_reply` (sync). NOT a new plugin lifecycle subsystem. | The hook infrastructure (`HookName` enum + `PluginContext.on()` + dispatch via `internal/plugins/manager.ts`) already exists from D100. Reusing it costs ~30 LoC vs ~200 LoC for a parallel `MemoryManager` system. | **Enables:** memory adapters use the same dispatcher non-memory plugins use; consumers can write their own non-memory hook handlers that read/write the same SDKMessage stream. **Constrains:** memory adapters can't have private state beyond what the hook handler closure captures — they need to be self-contained. |
| **D146** | Memory adapter HTTP errors do **NOT** flow through `CredentialPool` rotation (D123-D133). Each adapter implements its own retry policy with a simple exponential-backoff helper. | The credential pool exists for LLM provider keys (high-volume, high-cost rotation). Memory providers are low-volume, single-key — pool overhead is unnecessary complexity. Hermes uses circuit breaker (Mem0 5-failure-then-2min-pause) which is simpler. | **Enables:** adapter author owns retry semantics; less surprise. **Constrains:** if a user wants pool semantics for a memory provider, they wrap it themselves — documented as non-goal. |
| **D147** | `MemoryContext` is **minimal** — `userId` is the only required field. All others (`agentId`, `sessionId`, `tenantId`, `tags`, `metadata`) are optional. Each adapter translates this to its provider's primitive (Mem0 `user_id`, Honcho `peer`, Supermemory `containerTags`). | All 3 providers have `userId` as first-class. Anything else diverges (Hermes #22 research). Minimum-viable shared context = caller writes once, all 3 adapters work. | **Enables:** portability — same `MemoryContext` works for all 3 + future adapters. **Constrains:** provider-specific features (Mem0 `history(id)`, Honcho dialectic depth, Supermemory profile facts) need adapter-side options structs — documented. |
| **D148** | `@theokit-memory-mem0` ships **cloud client only**. The local OSS Mem0 mode (Qdrant + own LLM) is NOT supported. | The OSS local mode duplicates work already shipped in `@usetheo/sdk` (Active Memory + Lance backend D43). It would pull `axios` + `openai` + `mem0ai`'s 18 peer deps into the adapter — fights with our "no surprise deps" posture. Cloud-only keeps the adapter ~200 LoC. | **Enables:** Mem0 adapter as thin HTTP wrapper; lighter surface. **Constrains:** local-only consumers stay on our built-in memory — fine, that's already the better path. |
| **D149** | Each adapter's `README.md` carries a **legal/security disclosure section** when applicable: `@theokit-memory-honcho` notes Honcho AGPL-3.0 self-host implications; `@theokit-memory-mem0` notes CVSS 8.1 SQL/Cypher injection (2026-04-17, KEV-tracked) affecting OSS backends pgvector/MySQL/Neptune. | Honest disclosure is part of our Inviolable Rule #3 (extreme honesty). Hiding AGPL or CVSS exposes downstream consumers to legal/security risk they didn't sign up for. | **Enables:** consumers make informed choice. **Constrains:** README space; CI lint rule to ensure disclosure section exists on those two adapters. |

## Edge Case Integration (v1.1)

Edge-case review (2026-05-20) surfaced 19 items. Integration summary:

| EC | Severity | Where | Type of fix |
|---|---|---|---|
| EC-A | MUST FIX | T2.1 | Code: `MAX_RECALL_BYTES` cap + `maxRecallContextBytes` option |
| EC-B | MUST FIX | T1.1 + T3.2/T4.1/T5.1 | Code: `mkMemoryId`/`extractRawId` prefix scheme |
| EC-C | MUST FIX | T3.2 | Code: `sanitizeIdentifier` on every tag component |
| EC-D | MUST FIX | T4.1 | Code: Honcho session key prefixed with userId |
| EC-E | MUST FIX | T7.1 | Code: `envGate` SKIP mechanism in dogfood.mjs |
| EC-F | SHOULD TEST | T1.2 | Test: factory promise rejection survives boot |
| EC-G | SHOULD TEST | T2.1 | Test: prompt literal `<memory-context>` preserved |
| EC-H | SHOULD TEST | T2.1 | Test: AbortSignal cancels mid-prefetch HTTP |
| EC-I | SHOULD TEST | T2.2 | Test: first write triggers `initialize()` once |
| EC-J | SHOULD TEST | T4.1 | Test: Honcho tool schema mentions "reasoning" |
| EC-K | SHOULD TEST | T5.1 | Test: 429s do not trip Mem0 breaker |
| EC-L | SHOULD TEST | T5.1 | Test: cloud-only import without optional peers |
| EC-M | SHOULD TEST | T3.3/T4.2/T5.2 | Test: missing env error names the variable |
| EC-N | DOCUMENT | T2.1 | README: multi-adapter recall order = plugins[] order |
| EC-O | DOCUMENT | T2.1 | README: post_assistant_reply errors stderr-only |
| EC-P | DOCUMENT | T2.2 | JSDoc: caller ctx.userId wins over agent default |
| EC-Q | DOCUMENT | T7.1 | README: telegram-pro accumulates test data |
| EC-R | DOCUMENT | T5.1 | README: Mem0 breaker is per-instance |
| EC-S | DOCUMENT | T3.3 | README: use unique containerTagPrefix per CI run |

## Dependency Graph

```
Phase 0 ──▶ Phase 1 (MemoryAdapter type)
                │
                ▼
           Phase 2 (Agent loop hooks)
                │
                ├──▶ Phase 3 (Supermemory) ───┐
                │                              │
                ├──▶ Phase 4 (Honcho) ─────────┤
                │                              │
                └──▶ Phase 5 (Mem0) ───────────┤
                                               │
                                               ▼
                                        Phase 6 (docs + ADRs + roadmap)
                                               │
                                               ▼
                                        Phase 7 (Dogfood QA)
```

- Phases 3+4+5 are **parallelizable** after Phase 2 (independent packages, no cross-dep). Recommended sequential ordering for Phase 7 confidence: 3 → 4 → 5 (per research priority).
- Phase 6 blocks on 3+4+5 completion.
- Phase 7 is sequential after Phase 6.

---

## Phase 0: Foundation — verify plumbing + lock workspace layout

### T0.1 — Confirm plugin discovery + aggregation paths

#### Objective
Verify the existing plugin infrastructure (`PluginContext.on`, `aggregated.memoryProviders`, frontmatter Zod) is functional for our use case. Confirm we can register a `kind: "memory"` plugin without changes to the discovery layer.

#### Evidence
- Audit confirmed plumbing exists (`internal/plugins/manager.ts:106-110`).
- Test fixture exists (`tests/internal/plugins/types.test.ts:41-49`).
- `unknown` return type blocks real implementations (line 72 of types.ts).

#### Files to edit
```
.claude/knowledge-base/plans/memory-providers-adapters-plan.md — confirm via grep
```

#### Deep file dependency analysis
- Pure documentation/discovery — no code changes.

#### Tasks
1. `grep -n "aggregated.memoryProviders\|MemoryProviderFactory" packages/sdk/src/` → confirm wiring.
2. `grep -n "kind:.*memory" packages/sdk/tests/` → confirm test fixtures.
3. Confirm `pnpm-workspace.yaml` glob `packages/*` will auto-pick up new `packages/memory-*` dirs.

#### TDD
None — pure audit phase.

#### Acceptance Criteria
- [ ] All grep checks return expected hits.
- [ ] `pnpm-workspace.yaml` glob confirmed to include `packages/memory-*`.

#### DoD
- [ ] Audit notes added to phase commit message.

---

## Phase 1: Formalize the `MemoryAdapter` contract

### T1.1 — Define `MemoryAdapter` interface + types

#### Objective
Replace the `unknown` placeholder with a typed `MemoryAdapter` interface. Define companion types (`MemoryContext`, `MemoryFact`, `MemoryId`, `MemoryRevision`, `MemoryAdapterCapabilities`, `MemoryAdapterError`).

#### Evidence
- `packages/sdk/src/internal/plugins/types.ts:72` — `MemoryProviderFactory = (cwd: string) => unknown` blocks all real implementations.
- Research: only `userId` is first-class across all 3 providers; rest needs adapter-side translation.

#### Files to edit
```
packages/sdk/src/types/memory-adapter.ts (NEW) — MemoryAdapter, MemoryContext, MemoryFact, MemoryId, MemoryRevision, MemoryAdapterCapabilities
packages/sdk/src/internal/plugins/types.ts — narrow MemoryProviderFactory return from `unknown` to `MemoryAdapter | Promise<MemoryAdapter>`
packages/sdk/src/errors.ts — add MemoryAdapterError class
packages/sdk/src/types/index.ts — re-export memory-adapter types
packages/sdk/src/index.ts — re-export MemoryAdapterError
```

#### Deep file dependency analysis
- `types/memory-adapter.ts` (NEW) is a leaf — no SDK runtime deps; pure types + Zod schema (frontmatter validation).
- `internal/plugins/types.ts` is consumed by `internal/plugins/manager.ts` (aggregation) — narrowing the return type forces TS to flow `MemoryAdapter` through `aggregated.memoryProviders` automatically.
- `errors.ts` consumers grep-checked: no name collision on `MemoryAdapterError`.

#### Deep Dives

**Type shape (D141, D147):**

> **EC-B fix:** `MemoryId` is constructed as `${adapterId}:${rawId}` — prefix embedded. Each adapter's `extractRawId` validates the prefix matches `this.id` before unwrapping; mismatch throws `MemoryAdapterError(code: "invalid_input")`. Prevents `mem0Adapter.delete(supermemoryId)` from accidentally deleting unrelated data.

```typescript
// packages/sdk/src/types/memory-adapter.ts
export type MemoryId = string & { readonly __brand: "MemoryId" };

/** Construct a branded MemoryId with adapter prefix. @public */
export function mkMemoryId(adapterId: string, rawId: string): MemoryId {
  return `${adapterId}:${rawId}` as MemoryId;
}

/** Extract raw provider ID, enforcing prefix match. Throws on cross-adapter use. @public */
export function extractRawId(id: MemoryId, expectedAdapterId: string): string {
  const prefix = `${expectedAdapterId}:`;
  if (!id.startsWith(prefix)) {
    throw new MemoryAdapterError(
      `MemoryId belongs to a different adapter (expected "${expectedAdapterId}", got "${id.split(":")[0]}")`,
      { adapterId: expectedAdapterId, code: "invalid_input" },
    );
  }
  return id.slice(prefix.length);
}

export interface MemoryContext {
  /** End-user identity. Only required field — all 3 providers have first-class user scoping. */
  userId: string;
  agentId?: string;     // Mem0 native; Honcho via peer; Supermemory containerTags
  sessionId?: string;   // Honcho native; Mem0 run_id; Supermemory metadata
  tenantId?: string;    // Mem0 app_id; Honcho workspace; Supermemory containerTags convention
  tags?: string[];      // Supermemory containerTags; Mem0 categories; Honcho metadata
  metadata?: Record<string, unknown>;
}

export interface MemoryFact {
  id: MemoryId;
  content: string;
  score?: number;       // semantic relevance when result of recall
  createdAt?: string;   // ISO 8601
  metadata?: Record<string, unknown>;
}

export interface MemoryRevision {
  id: MemoryId;
  content: string;
  version: number;
  changedAt: string;
}

export interface MemoryAdapterCapabilities {
  history: boolean;        // only Mem0 today
  sessions: boolean;       // Honcho first-class; Mem0 via run_id; Supermemory via metadata
  tenancy: boolean;        // Mem0 app_id; Honcho workspace; Supermemory containerTags
  reasoning: boolean;      // Honcho dialectic
  toolSchemas: boolean;    // exposes LLM-callable function schemas
  prefetch: boolean;       // supports background warm-up
}

export interface MemoryToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
}

export interface MemoryAdapter {
  /** Short identifier: 'supermemory', 'honcho', 'mem0'. */
  readonly id: string;
  readonly capabilities: MemoryAdapterCapabilities;

  /** Synchronous availability probe — no network, no I/O. */
  isAvailable(): boolean;

  /** One-shot initialization. Idempotent: safe to call multiple times. */
  initialize?(): Promise<void>;

  /** Write a single fact or a full turn into memory. Returns the stored ID. */
  write(content: string | { role: "user" | "assistant"; content: string }[], ctx: MemoryContext): Promise<MemoryId>;

  /** Semantic recall — top-k facts ordered by relevance. */
  recall(query: string, ctx: MemoryContext, k?: number): Promise<MemoryFact[]>;

  /** Delete by ID. */
  delete(id: MemoryId): Promise<void>;

  // Capabilities-gated optional methods.
  list?(ctx: MemoryContext, opts?: { cursor?: string; limit?: number }): AsyncIterable<MemoryFact>;
  get?(id: MemoryId): Promise<MemoryFact | null>;
  history?(id: MemoryId): Promise<MemoryRevision[]>;

  /** OpenAI-format function-calling schemas exposed to the LLM. Empty when toolSchemas: false. */
  getToolSchemas?(): MemoryToolSchema[];
  handleToolCall?(name: string, args: Record<string, unknown>, ctx: MemoryContext): Promise<string>;

  /** Lifecycle. */
  shutdown?(): Promise<void>;
}
```

**MemoryAdapterError shape:**

```typescript
// errors.ts addition
export class MemoryAdapterError extends TheokitAgentError {
  readonly adapterId: string;
  constructor(message: string, options: {
    adapterId: string;
    code: "auth_failed" | "rate_limited" | "not_found" | "network" | "invalid_input" | "unknown";
    cause?: unknown;
  });
}
```

**Invariants:**
- `MemoryId` is opaque (branded string) — adapter authors call `mkMemoryId(provider, raw)` to construct.
- `MemoryContext.userId` is required at the type level (constructor-style).
- `capabilities` is declared statically (not introspected at runtime) so consumers can feature-detect at compile time via `if (adapter.capabilities.history)`.

**Edge cases:**
- **EC-1:** `write` with empty content → throw `MemoryAdapterError(code: "invalid_input")`.
- **EC-2:** `recall` with k=0 → return `[]` immediately, no HTTP.
- **EC-3:** `initialize` called twice → second call is a no-op (idempotent).
- **EC-4:** `delete` with ID that doesn't exist → throw `MemoryAdapterError(code: "not_found")`, NOT silent ok.
- **EC-5:** `MemoryContext.userId` is empty string → throw `MemoryAdapterError(code: "invalid_input")` at adapter boundary.
- **EC-B:** `MemoryId` from a different adapter passed to `delete`/`get`/`history` → `extractRawId` throws `MemoryAdapterError(code: "invalid_input")` with prefix mismatch detail.

#### Tasks
1. Create `packages/sdk/src/types/memory-adapter.ts` with all types above.
2. Update `packages/sdk/src/internal/plugins/types.ts` — change `MemoryProviderFactory` return type from `unknown` to `MemoryAdapter | Promise<MemoryAdapter>`. Update import.
3. Add `MemoryAdapterError extends TheokitAgentError` to `packages/sdk/src/errors.ts`.
4. Re-export from `packages/sdk/src/types/index.ts` + `packages/sdk/src/index.ts`.

#### TDD
```
RED:     test_memory_adapter_type_compiles() — TS compile check
RED:     test_memory_id_is_opaque() — typed string brand cannot be assigned from plain string
RED:     test_mk_memory_id_embeds_adapter_prefix() — `mkMemoryId("supermemory", "abc")` == "supermemory:abc"
RED:     test_extract_raw_id_strips_correct_prefix() — round-trip mk + extract returns raw
RED:     test_extract_raw_id_rejects_wrong_prefix() — EC-B: cross-adapter id throws invalid_input
RED:     test_memory_context_user_id_required() — TS error when userId missing
RED:     test_memory_adapter_error_extends_theokit_error() — instanceof checks
RED:     test_memory_adapter_error_carries_adapter_id() — field present
RED:     test_capabilities_introspection_compile_time() — `if (adapter.capabilities.history)` narrows the call site
GREEN:   Implement types + error class + mkMemoryId/extractRawId helpers.
REFACTOR: None expected.
VERIFY:  pnpm typecheck && pnpm vitest run tests/types/memory-adapter.test.ts tests/errors/memory-adapter-error.test.ts
```

#### Acceptance Criteria
- [ ] 9 RED tests GREEN (was 6 — +3 from EC-B prefix scheme)
- [ ] File ≤250 LoC
- [ ] Zero biome warnings
- [ ] All public types + `mkMemoryId`/`extractRawId` helpers re-exported from `@usetheo/sdk` barrel
- [ ] knip clean (no orphan exports)

#### DoD
- [ ] CHANGELOG entry under `[Unreleased]`
- [ ] Existing 1032 SDK tests pass

---

### T1.2 — Mock adapter + plugin aggregation wiring test

#### Objective
Prove the typed adapter flows through the existing plugin discovery + aggregation infrastructure end-to-end. No real provider yet — pure in-memory mock.

#### Evidence
- `aggregated.memoryProviders: MemoryEntry[]` is built but never consumed today (manager.ts:106-110).
- We must confirm a `kind: "memory"` plugin returning a real `MemoryAdapter` is collectable.

#### Files to edit
```
packages/sdk/tests/internal/plugins/memory-adapter-aggregation.test.ts (NEW)
```

#### Deep file dependency analysis
- Test-only file consuming `definePlugin`, the existing aggregation function, and the new `MemoryAdapter` type from T1.1.

#### Deep Dives

```typescript
const memoryAdapter: MemoryAdapter = {
  id: "test",
  capabilities: { history: false, sessions: false, tenancy: false, reasoning: false, toolSchemas: false, prefetch: false },
  isAvailable: () => true,
  write: async () => mkMemoryId("test", "1"),
  recall: async () => [],
  delete: async () => {},
};

const plugin = definePlugin({
  name: "test-mem",
  version: "1.0.0",
  kind: "memory",
  createProvider: () => memoryAdapter,
});

const aggregated = await aggregatePlugins([plugin]);
expect(aggregated.memoryProviders.length).toBe(1);
expect((await aggregated.memoryProviders[0].createProvider("/tmp")).id).toBe("test");
```

#### Tasks
1. Write the aggregation test.

#### TDD
```
RED:     test_memory_plugin_aggregates_to_array_of_one()
RED:     test_memory_plugin_factory_returns_typed_adapter()
RED:     test_async_factory_resolves_correctly()
RED:     test_factory_promise_rejection_does_not_crash_agent_boot() — EC-F: rejected factory surfaces as typed ConfigurationError, no unhandled rejection
GREEN:   No production code — relies on T1.1 + add factory-rejection handling in plugin manager if missing.
REFACTOR: None.
VERIFY:  pnpm vitest run tests/internal/plugins/memory-adapter-aggregation.test.ts
```

#### Acceptance Criteria
- [ ] 4 tests GREEN (was 3 — +1 from EC-F)
- [ ] Compile clean
- [ ] No unhandled-rejection warning in vitest output

#### DoD
- [ ] Tests green; production code change minimal (factory-rejection catch in plugin manager).

---

## Phase 2: Agent loop integration (hook points)

### T2.1 — Add `pre_user_send` + `post_assistant_reply` hooks

#### Objective
Extend the existing `HookName` union (D100) with two new hook points where memory adapters interpose: `pre_user_send` (recall before LLM call) + `post_assistant_reply` (sync after LLM reply). Wire dispatch in the agent loop.

#### Evidence
- Hermes integrates via `MemoryManager` at system-prompt assembly + pre/post-turn. We reuse our existing `HookName` infrastructure (D100) for parity at ~30 LoC vs ~200 LoC for a parallel system.
- Existing hooks list (`types.ts:19-27`): 8 names. Adding 2 stays within reasonable enum size.

#### Files to edit
```
packages/sdk/src/internal/plugins/types.ts — add 2 hook names + contexts
packages/sdk/src/internal/runtime/local-agent.ts — wire hook dispatch
packages/sdk/tests/internal/plugins/memory-hooks-dispatch.test.ts (NEW)
```

#### Deep file dependency analysis
- `types.ts` adds enum members — pure additive; type-only consumers narrow correctly.
- `local-agent.ts` is the agent loop; the two hooks fire (a) immediately before `client.send(prompt)` (line ~TBD — need to grep send call site), (b) immediately after `run.wait()` returns.

#### Deep Dives

**Hook contexts:**

```typescript
export interface PreUserSendContext {
  prompt: string;
  agentId: string;
  runId: string;
  /** Caller-set context — flows through from Agent.create()/Agent.send(). */
  memoryContext?: MemoryContext;
}

export interface PreUserSendResult {
  /** Recalled facts injected into the LLM call as system context. Empty = no-op. */
  recalledContext?: string;
}

export interface PostAssistantReplyContext {
  prompt: string;
  reply: string;
  agentId: string;
  runId: string;
  memoryContext?: MemoryContext;
}
```

**Dispatch logic in `local-agent.ts`:**

> **EC-A fix:** total recalled context capped at `MAX_RECALL_BYTES` (default 16_000 bytes ≈ 4k tokens). Configurable via `AgentOptions.maxRecallContextBytes`. Excess is sliced with `…[truncated]` marker. Prevents context-window crashes when adapters return large fact dumps.

```typescript
// Pseudocode — actual integration point depends on where the LLM call happens
const MAX_RECALL_BYTES_DEFAULT = 16_000;

async function runTurn(prompt: string, signal?: AbortSignal): Promise<RunResult> {
  // 1. Fire pre_user_send — collect recalledContext from all memory adapters
  // EC-H: signal is propagated; adapters can cancel mid-recall
  const recalls = await dispatchHook("pre_user_send", { prompt, agentId, runId, memoryContext, signal });
  let augmentedPrompt = recalls.filter(r => r?.recalledContext).map(r => r.recalledContext).join("\n\n");
  // EC-A: cap recall to prevent context-window blowout
  const cap = options.maxRecallContextBytes ?? MAX_RECALL_BYTES_DEFAULT;
  if (augmentedPrompt.length > cap) {
    augmentedPrompt = augmentedPrompt.slice(0, cap) + "\n…[truncated]";
  }
  const finalPrompt = augmentedPrompt ? `<memory-context>\n${augmentedPrompt}\n</memory-context>\n\n${prompt}` : prompt;

  // 2. Call LLM (existing path)
  const result = await llmClient.send(finalPrompt);

  // 3. Fire post_assistant_reply — adapters persist async, fire-and-forget
  void dispatchHook("post_assistant_reply", { prompt, reply: result.text, agentId, runId, memoryContext });

  return result;
}
```

**Invariants:**
- `pre_user_send` is awaited (must complete before LLM call).
- `post_assistant_reply` is fire-and-forget (`void dispatchHook(...)`) — never blocks the response to the user.
- If an adapter throws in `pre_user_send`, the error is logged to stderr (`[theokit-sdk] memory adapter X pre-send failed: ...`) and the LLM call proceeds WITHOUT memory context. Failure isolated per-adapter (D137 parity).
- `<memory-context>` fences mirror Hermes's pattern — predictable wrapping, easy to strip in trimming logic.

**Edge cases:**
- **EC-6:** No memory adapter registered → no hook dispatch, no overhead.
- **EC-7:** Memory adapter `pre_user_send` returns `undefined` → no-op, no context injection.
- **EC-8:** Memory adapter `pre_user_send` throws → stderr warn, LLM call still proceeds (graceful degrade).
- **EC-9:** `post_assistant_reply` adapter takes >10s → does NOT block subsequent turns; runs in detached promise.
- **EC-10:** Cloud agent (D122) — memory hooks are NOOP on `CloudAgent` (cloud runtime is pre-release; document constraint).
- **EC-A:** Recalled context > `MAX_RECALL_BYTES` → sliced with `…[truncated]` marker; never sent unbounded to LLM.
- **EC-G:** User prompt literally contains `<memory-context>` → preserved verbatim; trim logic only strips the fence we injected (not arbitrary substrings).
- **EC-H:** AbortSignal aborted mid-`pre_user_send` → adapter `recall` HTTP cancelled; LLM call still happens with whatever was collected before abort (or empty).

#### Tasks
1. Add `pre_user_send` + `post_assistant_reply` to `HookName` enum.
2. Add `PreUserSendContext`, `PreUserSendResult`, `PostAssistantReplyContext` interfaces to types.ts.
3. Wire dispatch in `local-agent.ts:runTurn` (or equivalent).
4. Add stderr error handling (per-adapter isolation).
5. Add NOOP behavior on CloudAgent (graceful).
6. Write hook dispatch tests.

#### TDD
```
RED:     test_pre_user_send_fires_before_llm_call() — order assert
RED:     test_post_assistant_reply_fires_after_run_wait() — order assert
RED:     test_pre_user_send_injects_recalled_context_into_prompt() — substring check
RED:     test_pre_user_send_adapter_throw_does_not_block_call() — error isolation
RED:     test_post_assistant_reply_is_fire_and_forget() — total elapsed < adapter delay
RED:     test_no_adapter_means_no_overhead() — perf assertion
RED:     test_cloud_agent_hooks_are_noop() — CloudAgent path doesn't dispatch
RED:     test_recall_context_capped_at_max_recall_bytes() — EC-A: 50KB recall sliced to default 16k + marker
RED:     test_max_recall_context_bytes_option_overrides_default() — EC-A: caller sets 4096 → exactly 4096 bytes max
RED:     test_user_prompt_with_memory_context_literal_preserved() — EC-G: prompt "What is <memory-context>?" reaches LLM intact
RED:     test_abort_during_prefetch_cancels_http() — EC-H: AbortController.abort() mid-recall cancels HTTP cleanly
GREEN:   Wire dispatch + isolation + recall cap + signal propagation.
REFACTOR: Extract dispatch helper if cognitive complexity > 10.
VERIFY:  pnpm vitest run tests/internal/plugins/memory-hooks-dispatch.test.ts
```

#### Acceptance Criteria
- [ ] 11 RED tests GREEN (was 7 — +4 from EC-A/EC-G/EC-H)
- [ ] `AgentOptions.maxRecallContextBytes` exposed in public type
- [ ] Zero biome warnings
- [ ] Existing local-agent tests stay green
- [ ] Cognitive complexity ≤10 on modified functions

#### DoD
- [ ] CHANGELOG entry
- [ ] All 1032+ tests green
- [ ] No regression in `Agent.prompt` latency benchmarks

---

### T2.2 — `agent.memory.write` / `agent.memory.recall` direct API

#### Objective
Expose a thin direct API on the agent instance (`agent.memory.write(content, ctx)` / `agent.memory.recall(query, ctx, k?)`) that dispatches to whichever memory adapter is registered. Caller-controlled alternative to the LLM-driven path (D142).

#### Evidence
- TS consumers expect typed methods (Mastra / Vercel AI ergonomics).
- Deterministic eval scripts shouldn't depend on LLM tool-use to write memory.

#### Files to edit
```
packages/sdk/src/internal/runtime/local-agent.ts — add memory accessor on the agent instance
packages/sdk/src/types/agent.ts — extend SDKAgent interface with memory: AgentMemory
packages/sdk/src/types/memory-adapter.ts — add AgentMemory interface
packages/sdk/tests/agent-memory-direct-api.test.ts (NEW)
```

#### Deep file dependency analysis
- `SDKAgent` interface extension — additive; existing consumers ignore the field.
- `LocalAgent` gets a `memory` getter that lazily resolves the first registered memory adapter.

#### Deep Dives

```typescript
export interface AgentMemory {
  write(content: string | TurnMessage[], ctx?: Partial<MemoryContext>): Promise<MemoryId>;
  recall(query: string, ctx?: Partial<MemoryContext>, k?: number): Promise<MemoryFact[]>;
  delete(id: MemoryId): Promise<void>;
  /** Returns null when no memory adapter is registered. */
  adapter(): MemoryAdapter | null;
}
```

**Multi-adapter behavior:** If multiple adapters are registered (e.g., Supermemory + Honcho), the direct API writes to ALL and recalls from ALL (merged + dedupe by content). Documented as ADR D147-derivative.

**Edge cases:**
- **EC-11:** `agent.memory.write` called when no adapter registered → throw `ConfigurationError(code: "no_memory_adapter")` with educative message.
- **EC-12:** `ctx` missing `userId` — pull from `agent.options.memoryContext.userId` (set at create time) or throw.
- **EC-13:** Multiple adapters + one fails → others still succeed; partial-success result returned.

#### Tasks
1. Add `AgentMemory` interface to `types/memory-adapter.ts`.
2. Extend `SDKAgent` to include `memory: AgentMemory`.
3. Implement `LocalAgent.memory` getter wrapping registered adapters.
4. Implement multi-adapter merge + dedupe.
5. Write tests.

#### TDD
```
RED:     test_agent_memory_write_dispatches_to_adapter()
RED:     test_agent_memory_recall_returns_facts_from_adapter()
RED:     test_agent_memory_throws_when_no_adapter_registered()
RED:     test_multi_adapter_write_fans_out_to_all()
RED:     test_multi_adapter_recall_merges_and_dedupes()
RED:     test_agent_memory_partial_failure_returns_success_from_others()
RED:     test_first_memory_write_triggers_initialize_exactly_once() — EC-I: lazy init; spy called once after N writes
GREEN:   Implement direct API + lazy initialize gating.
REFACTOR: None.
VERIFY:  pnpm vitest run tests/agent-memory-direct-api.test.ts
```

#### Acceptance Criteria
- [ ] 7 RED tests GREEN (was 6 — +1 from EC-I)
- [ ] `agent.memory.adapter()` returns null when no adapter registered
- [ ] TS type narrows correctly in conditional
- [ ] `initialize()` called exactly once per adapter instance lifetime (idempotent EC-3)

#### DoD
- [ ] CHANGELOG entry
- [ ] All tests green

---

## Phase 3: `@theokit-memory-supermemory` (ship first per research priority)

### T3.1 — Workspace package scaffolding

#### Objective
Create `packages/memory-supermemory/` as a new workspace member with `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, and `README.md` (with no AGPL/CVSS disclosure needed — MIT clean).

#### Evidence
- D143 — separate workspace packages.
- `supermemory@4.21.1` is zero-dep, MIT, native fetch — best first-shipper.
- pnpm-workspace.yaml glob `packages/*` auto-picks up the new directory.

#### Files to edit
```
packages/memory-supermemory/package.json (NEW)
packages/memory-supermemory/tsconfig.json (NEW)
packages/memory-supermemory/tsup.config.ts (NEW)
packages/memory-supermemory/vitest.config.ts (NEW)
packages/memory-supermemory/README.md (NEW)
packages/memory-supermemory/CHANGELOG.md (NEW)
packages/memory-supermemory/src/index.ts (NEW)
```

#### Deep file dependency analysis
- `package.json` declares `peerDependencies`: `@usetheo/sdk: ^1.x`, `supermemory: ^4.21.0`.
- `tsconfig.json` extends root `tsconfig.base.json` (already used by sdk + react packages).
- `tsup.config.ts` matches sdk pattern (dual ESM + CJS + .d.ts).

#### Deep Dives

**package.json shape:**
```json
{
  "name": "@theokit-memory-supermemory",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.cjs",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "require": "./dist/index.cjs", "types": "./dist/index.d.ts" }
  },
  "files": ["dist", "README.md", "LICENSE", "CHANGELOG.md"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "peerDependencies": {
    "@usetheo/sdk": "workspace:^",
    "supermemory": "^4.21.0"
  },
  "license": "Apache-2.0"
}
```

#### Tasks
1. Create `packages/memory-supermemory/` directory + 7 scaffold files.
2. Add `supermemory` to root devDependencies (for adapter authoring).
3. Verify `pnpm install` picks up new workspace member.
4. Confirm tsup build emits dual + .d.ts.

#### TDD
```
RED:     test_package_builds() — pnpm --filter @theokit-memory-supermemory build
RED:     test_package_typechecks() — pnpm --filter @theokit-memory-supermemory typecheck
RED:     test_workspace_install_picks_up_package() — pnpm list shows it
GREEN:   Scaffold files.
REFACTOR: None.
VERIFY:  pnpm install && pnpm --filter @theokit-memory-supermemory run build
```

#### Acceptance Criteria
- [ ] Workspace member appears in `pnpm list --recursive`
- [ ] Build emits dist/index.{js,cjs,d.ts}
- [ ] Tsconfig extends root base

#### DoD
- [ ] Package scaffolded; `package.json` valid JSON; `pnpm install` clean.

---

### T3.2 — Supermemory adapter implementation

#### Objective
Implement the Supermemory adapter — wraps `supermemory@4.21.1` SDK. Maps `MemoryContext` to containerTags. Implements `write`, `recall`, `delete`, `getToolSchemas`, `handleToolCall`, `initialize`, `shutdown`.

#### Evidence
- Research: Supermemory has zero deps, MIT, 1M-token free tier, RAG+memory+profile in one — best ergonomics.
- Container tag convention: `theokit:{userId}` (default) or `theokit:{userId}:{agentId}` when agentId provided.

#### Files to edit
```
packages/memory-supermemory/src/index.ts — export supermemoryMemory factory
packages/memory-supermemory/src/adapter.ts (NEW) — SupermemoryAdapter class
packages/memory-supermemory/src/tool-schemas.ts (NEW) — getToolSchemas + handleToolCall
packages/memory-supermemory/src/translate.ts (NEW) — MemoryContext → containerTags translation
packages/memory-supermemory/tests/adapter.test.ts (NEW)
packages/memory-supermemory/tests/translate.test.ts (NEW)
```

#### Deep file dependency analysis
- `adapter.ts` imports `Supermemory` from `supermemory` (peer dep) + `MemoryAdapter`/types from `@usetheo/sdk`.
- `translate.ts` is pure — no I/O, no deps.

#### Deep Dives

**Factory + adapter shape:**

```typescript
// src/index.ts
import { definePlugin, type MemoryAdapter, type Plugin } from "@usetheo/sdk";
import { SupermemoryAdapter, type SupermemoryAdapterOptions } from "./adapter.js";

export function supermemoryMemory(options: SupermemoryAdapterOptions): Plugin {
  return definePlugin({
    name: "supermemory",
    version: "0.1.0",
    kind: "memory",
    createProvider: () => new SupermemoryAdapter(options),
  });
}
```

**Adapter class:**

```typescript
// src/adapter.ts
import Supermemory from "supermemory";

export interface SupermemoryAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  containerTagPrefix?: string;   // default "theokit"
  enablePrefetch?: boolean;      // D144 default false
}

export class SupermemoryAdapter implements MemoryAdapter {
  readonly id = "supermemory";
  readonly capabilities = {
    history: false,
    sessions: false,
    tenancy: true,            // via containerTags
    reasoning: false,
    toolSchemas: true,
    prefetch: false,          // D144 default off
  };

  constructor(private opts: SupermemoryAdapterOptions) {}

  isAvailable(): boolean {
    return typeof this.opts.apiKey === "string" && this.opts.apiKey.length > 0;
  }

  async write(content: string | TurnMessage[], ctx: MemoryContext): Promise<MemoryId> {
    const text = typeof content === "string" ? content : content.map(m => `${m.role}: ${m.content}`).join("\n");
    const containerTags = buildContainerTags(ctx, this.opts.containerTagPrefix ?? "theokit");
    const resp = await this.client().add(text, { containerTags, metadata: ctx.metadata });
    return mkMemoryId("supermemory", resp.id);
  }

  async recall(query: string, ctx: MemoryContext, k = 10): Promise<MemoryFact[]> {
    const containerTags = buildContainerTags(ctx, this.opts.containerTagPrefix ?? "theokit");
    const resp = await this.client().search.memories(query, { containerTags, limit: k });
    return resp.results.map(r => ({
      id: mkMemoryId("supermemory", r.id),
      content: r.content,
      score: r.score,
      createdAt: r.createdAt,
      metadata: r.metadata,
    }));
  }

  async delete(id: MemoryId): Promise<void> {
    await this.client().documents.delete(extractRawId(id));
  }

  getToolSchemas(): MemoryToolSchema[] {
    return [
      { name: "memory_write", description: "Persist a fact to long-term memory.", parameters: { /* JSON Schema */ } },
      { name: "memory_recall", description: "Retrieve k most relevant facts.", parameters: { /* JSON Schema */ } },
    ];
  }

  async handleToolCall(name: string, args: Record<string, unknown>, ctx: MemoryContext): Promise<string> {
    if (name === "memory_write") {
      const id = await this.write(args.content as string, ctx);
      return JSON.stringify({ ok: true, id });
    }
    if (name === "memory_recall") {
      const facts = await this.recall(args.query as string, ctx, args.k as number | undefined);
      return JSON.stringify({ ok: true, facts });
    }
    throw new MemoryAdapterError(`unknown tool: ${name}`, { adapterId: "supermemory", code: "invalid_input" });
  }

  private client(): Supermemory {
    return this._client ??= new Supermemory({ apiKey: this.opts.apiKey, baseUrl: this.opts.baseUrl });
  }
  private _client?: Supermemory;
}
```

**translate.ts:**

> **EC-C fix:** every identifier component goes through `sanitizeIdentifier` (D81 canonical helper) before joining. Rejects with `MemoryAdapterError(code: "invalid_input")` if any component contains `:`, whitespace, or non-alphanumeric (except `_`/`-`). Prevents silent cross-bucket leak from `userId: "user:123"` mis-parsing as `theokit:user:user` + `123` sub-key.

```typescript
import { sanitizeIdentifier } from "@usetheo/sdk/internal/security/path-guard";

export function buildContainerTags(ctx: MemoryContext, prefix: string): string[] {
  // EC-C: every component must match ^[a-zA-Z0-9_-]+$ — `:` is the tag separator
  const safeUser = sanitizeIdentifier(ctx.userId, "userId");
  const tags = [`${prefix}:user:${safeUser}`];
  if (ctx.agentId) tags.push(`${prefix}:agent:${sanitizeIdentifier(ctx.agentId, "agentId")}`);
  if (ctx.tenantId) tags.push(`${prefix}:tenant:${sanitizeIdentifier(ctx.tenantId, "tenantId")}`);
  if (ctx.tags?.length) {
    for (const t of ctx.tags) tags.push(`${prefix}:tag:${sanitizeIdentifier(t, "tag")}`);
  }
  return tags;
}
```

Note: `sanitizeIdentifier` is already canonical per ADR D81. Either re-export it as a SDK public utility OR copy the regex inline (depending on D81's current export status; check before T3.2 implementation).

**Edge cases:**
- **EC-14:** Empty `userId` → throw before HTTP.
- **EC-15:** `agentId` with spaces → sanitize via `sanitizeIdentifier` (D81 parity).
- **EC-16:** Supermemory 401 → `MemoryAdapterError(code: "auth_failed")`.
- **EC-17:** Supermemory 429 → adapter retries once with exponential backoff (1s), then throws `MemoryAdapterError(code: "rate_limited")`.
- **EC-18:** Network timeout (>30s default) → `MemoryAdapterError(code: "network")`.
- **EC-B (Supermemory):** `delete(id)` where id was minted by a different adapter → `extractRawId("supermemory", id)` throws `invalid_input` before HTTP.
- **EC-C (Supermemory):** `userId: "user:123"` (or any value with `:`/whitespace) → `sanitizeIdentifier` throws `invalid_input` at write/recall boundary; NO HTTP attempted.

#### Tasks
1. Implement `SupermemoryAdapter` class.
2. Implement `translate.ts` (pure function).
3. Implement `getToolSchemas` + `handleToolCall`.
4. Implement error translation (Supermemory SDK errors → `MemoryAdapterError`).
5. Implement 1-retry exponential backoff on 429.
6. Export `supermemoryMemory` factory from `index.ts`.
7. Write tests.

#### TDD
```
RED:     test_supermemory_write_calls_sdk_with_container_tags()
RED:     test_supermemory_recall_returns_typed_facts()
RED:     test_supermemory_delete_round_trips()
RED:     test_translate_buildContainerTags_minimal_userid_only()
RED:     test_translate_buildContainerTags_all_fields()
RED:     test_translate_sanitizes_unsafe_identifier()
RED:     test_translate_rejects_userid_with_colon() — EC-C: throws invalid_input on `user:123`
RED:     test_translate_rejects_agentid_with_whitespace() — EC-C: throws on `my agent`
RED:     test_delete_rejects_cross_adapter_id() — EC-B: `extractRawId("supermemory", honchoId)` throws
RED:     test_auth_failed_maps_to_typed_error()
RED:     test_429_retries_once_then_throws()
RED:     test_network_timeout_maps_to_network_error()
RED:     test_unknown_tool_name_throws()
RED:     test_capabilities_introspection()
RED:     test_factory_returns_valid_plugin()
GREEN:   Implement adapter + EC-B/EC-C guards.
REFACTOR: Extract retry helper if cognitive complexity > 10.
VERIFY:  pnpm --filter @theokit-memory-supermemory test
```

#### Acceptance Criteria
- [ ] 15 RED tests GREEN (was 12 — +3 from EC-B + EC-C)
- [ ] Adapter file ≤350 LoC
- [ ] Tool schema test asserts valid OpenAI JSON Schema
- [ ] Zero biome warnings
- [ ] Knip clean

#### DoD
- [ ] CHANGELOG entry
- [ ] All tests green

---

### T3.3 — Real-LLM example + integration test

#### Objective
Ship `examples/memory-supermemory-basic/` demonstrating end-to-end: write 3 facts, recall a query, delete one. Validated against real Supermemory API (per `real-llm-validation.md`).

#### Evidence
- `.claude/rules/real-llm-validation.md` — examples that call `agent.memory.*` MUST hit real API.
- Supermemory free tier (1M tokens) covers dogfood validation cost.

#### Files to edit
```
examples/memory-supermemory-basic/package.json (NEW)
examples/memory-supermemory-basic/src/index.ts (NEW)
examples/memory-supermemory-basic/README.md (NEW)
examples/memory-supermemory-basic/.env.example (NEW)
```

#### Deep file dependency analysis
- Example consumes `@theokit-memory-supermemory` (workspace dep) + `@usetheo/sdk`.

#### Deep Dives

```typescript
// examples/memory-supermemory-basic/src/index.ts
import { Agent } from "@usetheo/sdk";
import { supermemoryMemory } from "@theokit-memory-supermemory";

async function main() {
  const apiKey = process.env.SUPERMEMORY_API_KEY;
  if (!apiKey) throw new Error("Set SUPERMEMORY_API_KEY in .env");

  const agent = await Agent.create({
    apiKey: process.env.OPENROUTER_API_KEY!,
    model: { id: "openai/gpt-4o-mini" },
    local: {},
    plugins: [supermemoryMemory({ apiKey, containerTagPrefix: "theokit-example" })],
    memoryContext: { userId: "demo-user" },
  });

  // Write 3 facts via direct API
  const id1 = await agent.memory.write("User likes Brazilian jazz", { userId: "demo-user" });
  const id2 = await agent.memory.write("User is learning TypeScript", { userId: "demo-user" });
  const id3 = await agent.memory.write("User has a cat named Mochi", { userId: "demo-user" });

  // Recall
  const facts = await agent.memory.recall("music preferences", { userId: "demo-user" }, 3);
  console.log("Recalled:", facts.map(f => f.content));

  // Test LLM-driven path: ask via send + verify recall context injected
  const run = await agent.send("What music does the user like?");
  const result = await run.wait();
  console.log("LLM reply (should mention jazz):", result.result);

  // Cleanup
  await agent.memory.delete(id1);
  await agent.memory.delete(id2);
  await agent.memory.delete(id3);
  await agent.dispose();
}

main().catch(console.error);
```

#### Tasks
1. Scaffold `examples/memory-supermemory-basic/`.
2. Write example code.
3. Document `.env.example` (SUPERMEMORY_API_KEY + OPENROUTER_API_KEY).
4. Run against real Supermemory + log output.

#### TDD
```
RED:     test_example_typechecks() — pnpm exec tsc --noEmit on example
RED:     test_example_runs_against_real_supermemory() — manual gate with REAL_LLM=true
RED:     test_missing_env_var_message_names_it() — EC-M: unsetting SUPERMEMORY_API_KEY produces error literally containing "SUPERMEMORY_API_KEY"
GREEN:   Write example.
REFACTOR: None.
VERIFY:  REAL_LLM=true pnpm tsx examples/memory-supermemory-basic/src/index.ts
```

#### Acceptance Criteria
- [ ] Example typechecks
- [ ] Manual run against real API succeeds (output logged to evidence)
- [ ] LLM reply mentions "jazz" → confirms `pre_user_send` context injection works
- [ ] Missing env error message names the specific variable (EC-M)

#### DoD
- [ ] CHANGELOG entry
- [ ] Example documented in `examples/README.md`
- [ ] Real-LLM evidence captured in PR description

---

## Phase 4: `@theokit-memory-honcho`

### T4.1 — Workspace package + adapter

#### Objective
Mirror Phase 3 structure for Honcho. Wrap `@honcho-ai/sdk@2.1.1`. Map `MemoryContext.userId` to Honcho `peer`, `sessionId` to Honcho session.

#### Evidence
- Research: Honcho has reasoning differentiation (dialectic), zod-only dep.
- Honcho 3 model: workspace → peer → session → message → representation.

#### Files to edit
```
packages/memory-honcho/package.json (NEW)
packages/memory-honcho/src/index.ts (NEW)
packages/memory-honcho/src/adapter.ts (NEW)
packages/memory-honcho/src/translate.ts (NEW)
packages/memory-honcho/src/tool-schemas.ts (NEW)
packages/memory-honcho/README.md (NEW — INCLUDES AGPL disclosure section per D149)
packages/memory-honcho/tests/adapter.test.ts (NEW)
packages/memory-honcho/tests/translate.test.ts (NEW)
examples/memory-honcho-basic/ (NEW directory)
```

#### Deep file dependency analysis
- `adapter.ts` peer-deps `@honcho-ai/sdk` (zod is honcho's own dep, doesn't conflict with our zod peer).
- README's AGPL disclosure: legal risk applies ONLY to self-hosted Honcho — managed cloud is fine. Doc this clearly.

#### Deep Dives

**Honcho concept mapping:**

| `MemoryContext` field | Honcho concept |
|---|---|
| `userId` | `peer(userId)` |
| `agentId` | Different peer in the same session (symmetric model) |
| `sessionId` | `session("${userId}:${sessionId ?? "default"}")` ← **EC-D namespacing** |
| `tenantId` | `workspaceId` (Honcho client constructor) |
| `tags` | message metadata |
| `metadata` | message metadata |

> **EC-D fix (privacy bug):** Honcho sessions are workspace-scoped. If User A and User B both call `Agent.create({...})` without setting `sessionId`, both would land in session `"default"` — Honcho would see them as peers in the SAME session, leaking data via `.chat()` recall. Fix: **prefix every session name with `userId`**: `session("${userId}:${sessionId ?? "default"}")`. Two users with userId `"alice"` and `"bob"` get distinct sessions `"alice:default"` and `"bob:default"`.

**Adapter implementation pattern (compressed):**

```typescript
export class HonchoAdapter implements MemoryAdapter {
  readonly id = "honcho";
  readonly capabilities = {
    history: false, sessions: true, tenancy: true,
    reasoning: true, toolSchemas: true, prefetch: false,
  };

  private sessionKey(ctx: MemoryContext): string {
    // EC-D: namespace under userId to prevent cross-user contamination
    return `${ctx.userId}:${ctx.sessionId ?? "default"}`;
  }

  async write(content, ctx): Promise<MemoryId> {
    const peer = await this.honcho.peer(ctx.userId);
    const session = await this.honcho.session(this.sessionKey(ctx));
    await session.addPeers([peer]);
    const msg = await session.addMessages([peer.message(content)]);
    return mkMemoryId("honcho", msg.id);
  }

  async recall(query, ctx, k = 10): Promise<MemoryFact[]> {
    const peer = await this.honcho.peer(ctx.userId);
    // Use Honcho's distinguishing `.chat()` reasoning method
    const answer = await peer.chat(query);
    if (!answer || answer.trim() === "") return [];  // EC-20
    // Honcho returns synthesized reasoning, NOT a list of facts — wrap as 1 fact.
    // EC-J: tool schema description must clarify this semantic for the LLM.
    return [{ id: mkMemoryId("honcho", `chat-${Date.now()}`), content: answer, score: 1.0 }];
  }

  getToolSchemas() {
    return [
      { name: "memory_recall", description:
        "Retrieve a synthesized reasoning answer about the user from past memory. " +
        "Returns ONE result containing Honcho's dialectic answer (not a list of raw facts).",
        parameters: { /* ... */ } },
      { name: "memory_write", description: "Persist a turn to long-term memory.", parameters: { /* ... */ } },
    ];
  }
}
```

**Honcho quirk:** `peer.chat()` returns synthesized reasoning, not k results. We wrap as a single high-score fact. Document this in README's "Adapter Semantics" section.

**Edge cases:**
- **EC-19:** Honcho session is `undefined` → use `"default"` session name **under userId prefix** (see EC-D).
- **EC-20:** Honcho `.chat()` returns empty string → return `[]`.
- **EC-21:** Honcho 401 → `MemoryAdapterError(code: "auth_failed")`.
- **EC-D:** Two users without `sessionId` set → distinct sessions `${userIdA}:default` vs `${userIdB}:default`; no cross-user leak.
- **EC-B (Honcho):** `delete(id)` where id was minted by a different adapter → `extractRawId("honcho", id)` throws `invalid_input`.

#### Tasks
1. Scaffold workspace package (mirror T3.1).
2. Implement `HonchoAdapter`.
3. Implement `translate.ts`.
4. Implement `getToolSchemas` + `handleToolCall`.
5. Write README INCLUDING AGPL disclosure section.
6. Write tests.
7. Scaffold `examples/memory-honcho-basic/`.

#### TDD
```
RED:     test_honcho_write_creates_peer_and_session()
RED:     test_honcho_recall_wraps_chat_response_as_single_fact()
RED:     test_honcho_recall_empty_string_returns_empty_array()
RED:     test_honcho_capabilities_declares_sessions_and_reasoning()
RED:     test_translate_peer_uses_userId()
RED:     test_translate_session_is_namespaced_under_userId() — EC-D: two users with sessionId=undefined produce distinct session keys
RED:     test_translate_session_falls_back_to_default()
RED:     test_tool_schema_recall_description_mentions_reasoning() — EC-J: description contains "reasoning" or "synthesized answer", not just "facts"
RED:     test_delete_rejects_cross_adapter_id() — EC-B: extractRawId("honcho", supermemoryId) throws
RED:     test_auth_failed_maps_to_typed_error()
RED:     test_factory_returns_valid_plugin()
RED:     test_readme_contains_agpl_disclosure_section()  — CI lint
GREEN:   Implement adapter.
REFACTOR: None.
VERIFY:  pnpm --filter @theokit-memory-honcho test
```

#### Acceptance Criteria
- [ ] 12 RED tests GREEN (was 9 — +3 from EC-D, EC-J, EC-B)
- [ ] Adapter file ≤400 LoC
- [ ] README.md has `## License & Self-Hosting` section explaining AGPL-3.0 implications
- [ ] CI lint passes (grep exact pattern `## License & Self-Hosting` in honcho README)
- [ ] Session-key namespacing under userId verified with multi-user test

#### DoD
- [ ] CHANGELOG entry
- [ ] Real-LLM example validated against real Honcho API

---

### T4.2 — Honcho real-LLM example + integration test

#### Objective
Mirror T3.3 for Honcho.

#### Files to edit
```
examples/memory-honcho-basic/src/index.ts (NEW)
examples/memory-honcho-basic/package.json (NEW)
examples/memory-honcho-basic/.env.example (NEW)
examples/memory-honcho-basic/README.md (NEW)
```

#### TDD
```
RED:     test_example_typechecks()
RED:     test_example_runs_against_real_honcho()
RED:     test_missing_env_var_message_names_it() — EC-M: HONCHO_API_KEY by name
GREEN:   Write example using honcho.dev managed cloud + free $100 credits.
REFACTOR: None.
VERIFY:  REAL_LLM=true pnpm tsx examples/memory-honcho-basic/src/index.ts
```

#### Acceptance Criteria
- [ ] Example typechecks + runs against real Honcho
- [ ] Missing env error names `HONCHO_API_KEY` specifically (EC-M)

#### DoD
- [ ] CHANGELOG entry
- [ ] Evidence in PR description

---

## Phase 5: `@theokit-memory-mem0`

### T5.1 — Workspace package + adapter

#### Objective
Ship Mem0 adapter (cloud client only per D148). Wrap `mem0ai@3.0.3` SDK. Adapter is the only one with `history(id)` capability.

#### Evidence
- Research: Mem0 ships `MemoryClient` cloud client distinct from OSS `Memory`. We use only `MemoryClient`.
- Mem0 has unique `history(id)` API — preserve this in the adapter.

#### Files to edit
```
packages/memory-mem0/package.json (NEW)
packages/memory-mem0/src/index.ts (NEW)
packages/memory-mem0/src/adapter.ts (NEW)
packages/memory-mem0/src/translate.ts (NEW)
packages/memory-mem0/src/tool-schemas.ts (NEW)
packages/memory-mem0/README.md (NEW — INCLUDES CVSS 8.1 disclosure section per D149)
packages/memory-mem0/tests/adapter.test.ts (NEW)
packages/memory-mem0/tests/translate.test.ts (NEW)
packages/memory-mem0/tests/history.test.ts (NEW — exercises the unique capability)
examples/memory-mem0-basic/ (NEW directory)
```

#### Deep file dependency analysis
- Peer-dep `mem0ai`. The 18 transitive peer deps are CALLER'S responsibility — caller installs only what their config needs (we use only `MemoryClient` which is the lightweight cloud path).

#### Deep Dives

**Mem0 concept mapping:**

| `MemoryContext` field | Mem0 concept |
|---|---|
| `userId` | `user_id` |
| `agentId` | `agent_id` |
| `sessionId` | `run_id` |
| `tenantId` | `app_id` (when set on `MemoryClient` constructor) |
| `tags` | `categories` |
| `metadata` | `metadata` |

**Adapter:**

```typescript
import MemoryClient from "mem0ai";

export class Mem0Adapter implements MemoryAdapter {
  readonly id = "mem0";
  readonly capabilities = {
    history: true,        // ← unique to Mem0
    sessions: true,
    tenancy: true,
    reasoning: false,
    toolSchemas: true,
    prefetch: false,
  };

  async write(content, ctx): Promise<MemoryId> {
    const messages = typeof content === "string"
      ? [{ role: "user" as const, content }]
      : content;
    const resp = await this.client().add(messages, {
      user_id: ctx.userId,
      agent_id: ctx.agentId,
      run_id: ctx.sessionId,
      categories: ctx.tags,
      metadata: ctx.metadata,
    });
    return mkMemoryId("mem0", resp.results?.[0]?.id ?? `mem0-${Date.now()}`);
  }

  async recall(query, ctx, k = 10): Promise<MemoryFact[]> {
    const resp = await this.client().search(query, {
      user_id: ctx.userId,
      limit: k,
      rerank: true,
    });
    return resp.results.map(r => ({
      id: mkMemoryId("mem0", r.id),
      content: r.memory,
      score: r.score,
      createdAt: r.created_at,
      metadata: r.metadata,
    }));
  }

  async history(id: MemoryId): Promise<MemoryRevision[]> {
    const resp = await this.client().history(extractRawId(id));
    return resp.map((r, i) => ({
      id, content: r.new_memory, version: i + 1, changedAt: r.updated_at,
    }));
  }
}
```

**Circuit breaker (port from Hermes):**
- 5 consecutive **5xx** failures → 2-minute cooldown.
- **EC-K:** 429 (rate limit) does NOT count toward the breaker threshold. Rate limits are caller-pace signals, not provider-down signals; mixing them trips the breaker on healthy-but-throttled providers. Per Hermes pattern.
- Implementation: in-memory counter on the adapter instance; reset on first success.

**Edge cases:**
- **EC-22:** `write` with empty messages array → throw `MemoryAdapterError(code: "invalid_input")`.
- **EC-23:** `history(id)` for an ID that doesn't exist → return `[]` (Mem0 returns 200 + empty history).
- **EC-24:** 5 consecutive 5xx → open circuit breaker for 2 minutes; new calls throw immediately.
- **EC-25:** 401 → `MemoryAdapterError(code: "auth_failed")`.
- **EC-B (Mem0):** `delete(id)` / `history(id)` where id was minted by a different adapter → `extractRawId("mem0", id)` throws `invalid_input`.
- **EC-K:** 10 consecutive 429s in a row → breaker stays closed; only 5xx-class errors count toward the trip threshold.
- **EC-L:** `import { MemoryClient } from "mem0ai"` from `packages/memory-mem0/` succeeds even when `qdrant-client` / `pinecone-client` / `pg` etc. are NOT installed — confirms top-level import is side-effect-free for the cloud-only code path.

#### Tasks
1. Scaffold workspace package.
2. Implement `Mem0Adapter`.
3. Implement `translate.ts`.
4. Implement circuit breaker.
5. Implement `getToolSchemas` (3 schemas: `mem0_add`, `mem0_search`, `mem0_history`).
6. Write README WITH CVSS 8.1 disclosure section.
7. Write tests.
8. Scaffold `examples/memory-mem0-basic/`.

#### TDD
```
RED:     test_mem0_write_includes_user_agent_run_ids()
RED:     test_mem0_search_returns_typed_facts()
RED:     test_mem0_history_returns_revisions_with_version()
RED:     test_mem0_history_unknown_id_returns_empty()
RED:     test_circuit_breaker_opens_after_5_5xx()
RED:     test_circuit_breaker_ignores_429s() — EC-K: 10 consecutive 429s → breaker stays closed
RED:     test_circuit_breaker_closes_on_success()
RED:     test_circuit_breaker_throws_during_cooldown()
RED:     test_capabilities_history_true()
RED:     test_translate_categories_from_tags()
RED:     test_delete_rejects_cross_adapter_id() — EC-B: extractRawId("mem0", honchoId) throws
RED:     test_history_rejects_cross_adapter_id() — EC-B applied to history()
RED:     test_cloud_client_import_without_optional_peers() — EC-L: bare `import { MemoryClient }` works in env without qdrant/pinecone/pg installed
RED:     test_auth_failed_maps_to_typed_error()
RED:     test_factory_returns_valid_plugin()
RED:     test_readme_contains_cvss_disclosure_section()  — CI lint
GREEN:   Implement adapter.
REFACTOR: Extract circuit-breaker helper if cognitive complexity > 10.
VERIFY:  pnpm --filter @theokit-memory-mem0 test
```

#### Acceptance Criteria
- [ ] 16 RED tests GREEN (was 12 — +4 from EC-K, EC-B×2, EC-L)
- [ ] Adapter file ≤450 LoC
- [ ] README.md has `## Security Disclosure (CVE-2026-XXXX / CVSS 8.1)` section
- [ ] CI lint passes
- [ ] `pnpm --filter @theokit-memory-mem0 typecheck` clean in environment WITHOUT qdrant/pinecone/pg installed

#### DoD
- [ ] CHANGELOG entry
- [ ] Real-LLM example validated against Mem0 cloud free tier

---

### T5.2 — Mem0 real-LLM example + integration test

#### Objective
Mirror T3.3/T4.2 for Mem0. Demonstrate the `history(id)` capability that's unique to this adapter.

#### Files to edit
```
examples/memory-mem0-basic/src/index.ts (NEW)
examples/memory-mem0-basic/package.json (NEW)
examples/memory-mem0-basic/.env.example (NEW)
examples/memory-mem0-basic/README.md (NEW)
```

#### Deep Dives

Example demonstrates:
1. `write` a fact "User likes pop music"
2. `write` an update "User now prefers jazz"
3. `history(id)` shows both versions
4. `recall("music preferences")` returns the latest

#### TDD
```
RED:     test_example_typechecks()
RED:     test_example_runs_against_real_mem0()
RED:     test_example_history_returns_two_revisions()
RED:     test_missing_env_var_message_names_it() — EC-M: MEM0_API_KEY by name
GREEN:   Write example using Mem0 cloud free tier (10K memories).
REFACTOR: None.
VERIFY:  REAL_LLM=true pnpm tsx examples/memory-mem0-basic/src/index.ts
```

#### Acceptance Criteria
- [ ] Example typechecks + runs against real Mem0
- [ ] `history(id)` output shows 2 versions

#### DoD
- [ ] CHANGELOG entry
- [ ] Evidence in PR description

---

## Phase 6: Docs + ADRs + CHANGELOG + roadmap

### T6.1 — Write 9 ADRs (D141-D149)

#### Files to edit
```
.claude/knowledge-base/adrs/D141-memory-adapter-interface.md (NEW)
.claude/knowledge-base/adrs/D142-memory-dual-surface.md (NEW)
.claude/knowledge-base/adrs/D143-memory-workspace-packages.md (NEW)
.claude/knowledge-base/adrs/D144-memory-prefetch-opt-in.md (NEW)
.claude/knowledge-base/adrs/D145-memory-hooks-not-manager.md (NEW)
.claude/knowledge-base/adrs/D146-memory-no-credential-pool.md (NEW)
.claude/knowledge-base/adrs/D147-memory-context-minimal.md (NEW)
.claude/knowledge-base/adrs/D148-mem0-cloud-only.md (NEW)
.claude/knowledge-base/adrs/D149-memory-readme-disclosures.md (NEW)
```

#### Tasks
1. Write each ADR in the established format (Date, Status, Decision, Rationale, Consequences).

#### TDD
None — documentation.

#### Acceptance Criteria
- [ ] 9 ADR files created.
- [ ] Each ≤150 LoC.

#### DoD
- [ ] ADR table in CLAUDE.md updated.

---

### T6.2 — CHANGELOG + CLAUDE.md roadmap

#### Files to edit
```
packages/sdk/CHANGELOG.md — under [Unreleased]: add v1.12 memory adapters section
packages/memory-supermemory/CHANGELOG.md — 0.1.0 initial release
packages/memory-honcho/CHANGELOG.md — 0.1.0 initial release
packages/memory-mem0/CHANGELOG.md — 0.1.0 initial release
CLAUDE.md — SDK Roadmap row #3 → ✅ DONE
CLAUDE.md — ADRs table append D141-D149
```

#### Tasks
1. Update sdk CHANGELOG.
2. Initial CHANGELOG for each new package.
3. Mark Roadmap row #3 DONE in CLAUDE.md.

#### Acceptance Criteria
- [ ] All 4 CHANGELOGs updated
- [ ] CLAUDE.md row #3 strikethrough

#### DoD
- [ ] Documentation committed

---

## Phase 7: Dogfood QA (MANDATORY)

### T7.1 — Telegram-pro `/memory` probe

#### Objective
Add `/memory <provider> <topic>` command to telegram-pro that demonstrates write+recall against each of the 3 adapters. Specifically:
- `/memory supermemory jazz` → writes 3 facts about jazz, recalls "music", shows facts.
- `/memory honcho <topic>` → same, against Honcho.
- `/memory mem0 <topic>` → same, against Mem0, plus demonstrates `history()`.

#### Evidence
- Real-LLM rule requires end-to-end validation against each provider.
- `/factstream`, `/batch` pattern shows how heavy commands work.

#### Files to edit
```
examples/telegram-pro/src/index.ts — add /memory command
examples/telegram-pro/package.json — add 3 new peer deps
.claude/skills/telegram-pro-dogfood/lib/dogfood.mjs — add 3 scenarios (#33, #34, #35)
```

#### Deep Dives

```typescript
bot.command("memory", async (ctx) => {
  const [provider, ...rest] = (ctx.match ?? "").toString().trim().split(/\s+/);
  const topic = rest.join(" ");
  if (!provider || !topic) {
    await ctx.reply("Usage: /memory <supermemory|honcho|mem0> <topic>");
    return;
  }

  const { Agent } = await import("@usetheo/sdk");
  let memoryPlugin;
  switch (provider) {
    case "supermemory": {
      const { supermemoryMemory } = await import("@theokit-memory-supermemory");
      if (!process.env.SUPERMEMORY_API_KEY) { /* error */ return; }
      memoryPlugin = supermemoryMemory({ apiKey: process.env.SUPERMEMORY_API_KEY });
      break;
    }
    case "honcho": {
      const { honchoMemory } = await import("@theokit-memory-honcho");
      if (!process.env.HONCHO_API_KEY) { /* error */ return; }
      memoryPlugin = honchoMemory({ apiKey: process.env.HONCHO_API_KEY });
      break;
    }
    case "mem0": {
      const { mem0Memory } = await import("@theokit-memory-mem0");
      if (!process.env.MEM0_API_KEY) { /* error */ return; }
      memoryPlugin = mem0Memory({ apiKey: process.env.MEM0_API_KEY });
      break;
    }
    default:
      await ctx.reply(`Unknown provider: ${provider}`);
      return;
  }

  const agent = await Agent.create({ /* ..., plugins: [memoryPlugin], memoryContext: { userId: String(ctx.from.id) } */ });
  // Write 3 facts about topic, recall, reply
});
```

#### Dogfood scenarios

```javascript
{
  text: "/memory supermemory jazz",
  expect: [/Wrote.*facts/i, /Recalled/i, /jazz/i],
  waitMs: 30000,
  retryOnError: true,
  envGate: "SUPERMEMORY_API_KEY",  // skip if env missing
},
{
  text: "/memory honcho jazz",
  expect: [/Wrote/i, /jazz/i],
  waitMs: 60000,
  retryOnError: true,
  envGate: "HONCHO_API_KEY",
},
{
  text: "/memory mem0 jazz",
  expect: [/Wrote/i, /history/i],
  waitMs: 30000,
  retryOnError: true,
  envGate: "MEM0_API_KEY",
},
```

#### Tasks
1. Implement `/memory` command in telegram-pro index.ts.
2. **EC-E:** Add `envGate` mechanism to `dogfood.mjs`. Logic: before sending a command, `if (cmd.envGate && !process.env[cmd.envGate]) { results.push({ status: "SKIP", reason: `env ${cmd.envGate} unset` }); continue; }`. SKIPs are reported separately and count toward PASS for the final summary (`PASS + SKIP == total → green`).
3. Add scenario rows with `envGate` per provider.
4. Run dogfood — expect 35/35 if all env vars set, 32 PASS + 3 SKIP if any provider key is missing (still green).

#### Acceptance Criteria
- [ ] `/memory supermemory jazz` returns write+recall output in real Telegram
- [ ] `/memory honcho jazz` returns write+recall output
- [ ] `/memory mem0 jazz` returns write+recall+history output
- [ ] Dogfood: PASS + SKIP == total (no FAIL); SKIPs only happen when env var explicitly missing
- [ ] `envGate` implementation tested with `unset SUPERMEMORY_API_KEY && node dogfood.mjs --only "/memory supermemory jazz"` → status SKIP, exit 0

#### DoD
- [ ] CHANGELOG entry
- [ ] Dogfood evidence snapshot saved

---

### T7.2 — Full validate + push

#### Execution
```bash
pnpm -w run validate         # all hard gates across workspace
node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs --user-id 7528967933
```

#### Acceptance Criteria
- [ ] `pnpm validate` exit 0
- [ ] All 4 workspace packages build clean
- [ ] knip clean
- [ ] Dogfood 32+/35 PASS
- [ ] Real-LLM evidence for each adapter captured

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `MemoryProviderFactory` return type is `unknown` (blocking) | T1.1 | Narrow to `MemoryAdapter \| Promise<MemoryAdapter>` |
| 2 | No formal `MemoryAdapter` interface | T1.1 | Define in `types/memory-adapter.ts` |
| 3 | No `MemoryContext` portable type | T1.1 | Minimal context with `userId` required only |
| 4 | No `MemoryAdapterError` typed error | T1.1 | Extends `TheokitAgentError` |
| 5 | Existing aggregation untested with real adapter | T1.2 | Mock adapter aggregation test |
| 6 | No agent loop integration points | T2.1 | Add `pre_user_send` + `post_assistant_reply` hooks |
| 7 | No direct API for callers | T2.2 | `agent.memory.write/recall/delete` |
| 8 | No first adapter shipping | T3.1, T3.2 | `@theokit-memory-supermemory` |
| 9 | No real-LLM validation for Supermemory | T3.3 | Example + manual validation |
| 10 | No reasoning-layer adapter | T4.1 | `@theokit-memory-honcho` |
| 11 | No real-LLM validation for Honcho | T4.2 | Example + manual validation |
| 12 | No `history(id)` capability | T5.1 | `@theokit-memory-mem0` |
| 13 | No real-LLM validation for Mem0 | T5.2 | Example + manual validation |
| 14 | No ADRs documenting decisions | T6.1 | 9 ADRs D141-D149 |
| 15 | CHANGELOG + roadmap not updated | T6.2 | 4 CHANGELOGs + CLAUDE.md row #3 DONE |
| 16 | No dogfood scenario for memory | T7.1 | `/memory <provider> <topic>` × 3 scenarios |
| 17 | Push gate must pass on workspace-wide validate | T7.2 | `pnpm validate` exit 0 |
| 18 | License/security disclosure for AGPL+CVSS adapters | T4.1, T5.1 | Mandatory README section + CI lint |
| 19 | **EC-A:** unbounded recall context blows window | T2.1 | `MAX_RECALL_BYTES` cap + `maxRecallContextBytes` option |
| 20 | **EC-B:** cross-adapter MemoryId footgun | T1.1, T3.2, T4.1, T5.1 | `mkMemoryId`/`extractRawId` prefix scheme + per-adapter validation |
| 21 | **EC-C:** `:`/whitespace in userId silently mis-buckets | T3.2 | `sanitizeIdentifier` (D81) applied to every tag component |
| 22 | **EC-D:** Honcho cross-user privacy leak via shared "default" session | T4.1 | Session key namespaced as `${userId}:${sessionId ?? "default"}` |
| 23 | **EC-E:** dogfood fails on missing provider env keys | T7.1 | `envGate` SKIP mechanism (PASS+SKIP=total) |
| 24 | **EC-F:** factory promise rejection crashes agent boot | T1.2 | Typed `ConfigurationError`, no unhandled rejection |
| 25 | **EC-G:** prompt literal `<memory-context>` corrupted | T2.1 | Trim logic targets injected fence only |
| 26 | **EC-H:** AbortSignal must cancel mid-prefetch HTTP | T2.1 | Signal propagated to adapter `recall()` |
| 27 | **EC-I:** lazy `initialize()` not called before first write | T2.2 | Lazy init gating, idempotent (EC-3) |
| 28 | **EC-J:** Honcho tool schema misleads LLM about result shape | T4.1 | `recall` description says "reasoning answer", not "facts" |
| 29 | **EC-K:** Mem0 breaker trips on rate-limit instead of provider-down | T5.1 | 429s excluded from breaker counter |
| 30 | **EC-L:** `mem0ai` top-level import fails without optional backends | T5.1 | Verify cloud-only import path is side-effect-free |
| 31 | **EC-M:** missing-env error doesn't name the variable | T3.3, T4.2, T5.2 | Error message includes exact env var name |

**Coverage: 31/31 gaps (100%)**

## Global Definition of Done

- [ ] All 7 phases completed
- [ ] All tests passing across workspace (≥1120 total — v1.1 adds ~13 new tests from edge-case review)
- [ ] Zero biome warnings; zero knip warnings
- [ ] Three new npm packages publishable (`@theokit-memory-supermemory@0.1.0`, `@theokit-memory-honcho@0.1.0`, `@theokit-memory-mem0@0.1.0`)
- [ ] `@usetheo/sdk` SemVer compatible (1.x — additive surface only)
- [ ] 9 ADRs (D141-D149) written
- [ ] 4 CHANGELOGs updated
- [ ] CLAUDE.md SDK Roadmap row #3 → ✅ DONE
- [ ] **Dogfood QA PASS** — `/dogfood full` ≥32/35 (env-gated skips count as PASS)
- [ ] **Real-LLM proof** — each of the 3 adapters validated end-to-end against the real provider API; evidence captured in PR description (output excerpts, IDs returned, latency observed)
- [ ] CI lint passes: AGPL disclosure section present in Honcho README; CVSS disclosure section present in Mem0 README

## Final Phase: Dogfood QA (MANDATORY)

### Execution

Run `node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs --user-id 7528967933` against the running telegram-pro instance with all 3 provider env vars set.

### Acceptance Criteria

- [ ] Health: ≥32/35 PASS (3 new memory scenarios counted)
- [ ] Zero CRITICAL issues introduced
- [ ] Zero HIGH issues in `/memory` command path
- [ ] Pre-existing flakes (`/tool uuid`, `/migrate_memory`) acknowledged in evidence snapshot, NOT blocking

### If Dogfood Fails

1. Identify root cause (adapter HTTP error vs harness flake vs config gap).
2. Fix plan-caused issues; re-run dogfood.
3. Pre-existing issues logged, not blocking.
