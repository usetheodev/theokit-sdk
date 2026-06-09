# Plan: Mastra Cross-Validation Parity — Elevate all dimensions to ≥3.7/5.0

> **Version 1.1** — Plano complementar ao `sdk-superiority-2026-06-07` que cobre os gaps de platform maturity identificados na cross-validation contra Mastra. O plano existente aborda 135 findings de code quality/bugs/security; este plano ataca os 11 gaps de **feature completeness e ecosystem breadth** que o plano existente NÃO endereça: dynamic provider registry, RAG pipeline, observability vendor integrations, streaming backpressure, evented workflows, Theokit container DX, E2E test uplift, starter templates, server adapters, client SDK, e voice foundation.

## Goal

> "Ship 11 platform-maturity features so that ALL 15 cross-validation dimensions score ≥3.7/5.0 against Mastra, measured by `/loop-cross-validation:loop-cross-validation /tmp/mastra` weighted average ≥3.70 with zero dimension below 3.5."

## Context

A cross-validation em 2026-06-09 (`cross-validation-output/final_report.md`) revelou overall score 2.92/5.0 (58.4%). O SDK pontua forte em build quality (5/5), error handling (4/5), security (4/5), code organization (4/5), mas cai em 11 dimensões — 6 delas abaixo de 3/5. O plano `sdk-superiority-2026-06-07` já cobre: parallel tool dispatch, SSE spec, OTel hot-path, prompt caching, structured outputs, memory query cache, embedding expansion, Lance createIndex (ver plano complementar para task IDs específicos). Este plano ataca APENAS o que aquele NÃO cobre.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `src/internal/providers/registry.ts` | 46 | `abc2f17` (2026-05-19) | Static provider registry | `BuiltinProvider` type + `getProvider()` API |
| `src/internal/providers/discovery.ts` | 78 | `abc2f17` (2026-05-19) | Plugin-based provider discovery | `discoverProviderPlugins()` |
| `src/internal/providers/types.ts` | ~30 | `abc2f17` (2026-05-19) | Provider type definitions | `ProviderConfig` interface |
| `src/internal/providers/provider-catalog.json` (NEW) | 0 | — | Dynamic provider registry (JSON) | — |
| `src/internal/telemetry/adapter-registry.ts` | 92 | `c3ca904` (2026-05-18) | Telemetry adapter registration | `registerAdapter()` API |
| `src/internal/telemetry/adapters/langfuse.ts` | ~50 | `c3ca904` (2026-05-18) | Langfuse integration | Existing users |
| `src/internal/telemetry/adapters/datadog.ts` (NEW) | 0 | — | Datadog integration | — |
| `src/internal/telemetry/adapters/langsmith.ts` (NEW) | 0 | — | LangSmith integration | — |
| `src/internal/telemetry/adapters/arize.ts` (NEW) | 0 | — | Arize/Phoenix integration | — |
| `src/internal/telemetry/adapters/braintrust.ts` (NEW) | 0 | — | Braintrust integration | — |
| `src/internal/workflow/executor.ts` | 385 | `8f928dd` (2026-05-25) | Workflow step execution engine | Step dispatch contract, retry policy |
| `src/internal/workflow/evented-executor.ts` (NEW) | 0 | — | Evented workflow engine | — |
| `src/internal/workflow/scheduler.ts` (NEW) | 0 | — | Cron/event scheduling for workflows | — |
| `src/subscription/theokit-subscribe.ts` | 323 | `9fda7d7` (2026-06-06) | Subscribe client with reconnect | `subscribe()` AsyncGenerator API |
| `src/subscription/internal/backpressure.ts` (NEW) | 0 | — | Bounded buffer + delayed promise | — |
| `src/agent-builder.ts` | 148 | `e6b3969` (2026-05-17) | Fluent agent builder | `.model().tools().create()` chain |
| `src/theokit.ts` | ~200 | — | Theokit namespace (static class) | `Theokit.me()`, `Theokit.models` |
| `src/theokit-container.ts` (NEW) | 0 | — | Optional unified container for multi-agent DX | — |
| `src/rag/index.ts` (NEW) | 0 | — | RAG sub-path export barrel | — |
| `src/rag/text-splitter.ts` (NEW) | 0 | — | Text chunking (char, sentence, recursive) | — |
| `src/rag/retriever.ts` (NEW) | 0 | — | Retrieval interface + vector search impl | — |
| `src/rag/reranker.ts` (NEW) | 0 | — | Reranking interface + cohere/cross-encoder impl | — |
| `tests/e2e/` (NEW dir) | 0 | — | End-to-end test suite | — |
| `templates/` (NEW dir) | 0 | — | Starter templates for create-theokit | — |

### Current callers / dependents

- **Symbol:** `getProvider()` in `src/internal/providers/registry.ts`
  - **Callers (production):** `src/internal/llm/router.ts`, `src/internal/runtime/local-agent.ts`
  - **Callers (tests):** `tests/providers/discovery.test.ts`
  - **External:** No — internal only

- **Symbol:** `registerAdapter()` in `src/internal/telemetry/adapter-registry.ts`
  - **Callers (production):** `src/internal/telemetry/tracer.ts`
  - **Callers (tests):** `tests/telemetry/adapter-registry.test.ts`

- **Symbol:** `WorkflowExecutor` in `src/internal/workflow/executor.ts`
  - **Callers (production):** `src/workflow.ts`
  - **Callers (tests):** `tests/workflow/*.test.ts` (16 files)

- **Symbol:** `subscribe()` in `src/subscription/theokit-subscribe.ts`
  - **Callers (production):** barrel export via `src/subscription/index.ts`
  - **Callers (tests):** `tests/subscription/*.test.ts`

### Domain glossary

- **Provider catalog** — JSON registry mapping provider IDs to capabilities (vision, tools, structured output, streaming, max context)
- **RAG** — Retrieval-Augmented Generation: chunk documents → embed → store in vector DB → retrieve relevant chunks at query time
- **Reranker** — post-retrieval scoring model that re-orders results by relevance (e.g., Cohere Rerank, cross-encoder)
- **Backpressure** — mechanism to slow producer when consumer can't keep up (prevents unbounded buffer growth)
- **Evented workflow** — workflow variant triggered by external events (webhooks, cron) with suspend/resume semantics
- **Container** — optional unified registry (DI-lite) that holds agents + tools + workflows for cross-agent coordination

### Architecture boundaries affected

- **LLM Layer → Provider Registry**: extending from static TypeScript builtins to dynamic JSON + runtime loading. Direction: inward (registry is infrastructure; LLM layer imports it). Per `architecture.md § 2 — DIP`.
- **Memory → RAG**: NEW RAG module sits alongside Memory in the cross-cutting layer. Direction: RAG imports Vector/Embedding interfaces from Memory; Memory does NOT import RAG. Per `architecture.md § 1 — inner layers must not import outer`.
- **Subscription → Backpressure**: internal extension. No boundary change.
- **Workflow → Evented**: extends executor with event-driven variant. Same layer.

## Prior Art & Related Work

- **Cross-validation report** (`cross-validation-output/final_report.md`) — empirical evidence for every gap. All scores and file citations come from this report.
- **Mastra reference project** (`/tmp/mastra`) — direct code comparison source:
  - Dynamic provider registry: `packages/core/src/llm/model/provider-registry.json`
  - RAG pipeline: `packages/rag/src/`
  - Observability context: `packages/core/src/observability/context.ts` (219 LoC)
  - Evented workflows: `packages/core/src/workflows/evented/`
  - Backpressure: `packages/core/src/stream/base/output.ts:81` (DelayedPromise)
  - Templates: `templates/` (14+ starter apps)
- **Existing plan** (`knowledge-base/plans/sdk-superiority-2026-06-07-plan.md`) — complementary; covers T0-T8 code quality. This plan does NOT duplicate those tasks.

## Objective

- [ ] CV-1: Ship dynamic JSON provider catalog with ≥40 providers + `Theokit.registerProvider()` API (LLM Providers 2→4)
- [ ] CV-4: Ship `@theokit/sdk/rag` sub-path with text splitter + retriever + reranker (Memory-RAG 2→4)
- [ ] CV-2: Ship 4 new observability vendor adapters (Datadog, LangSmith, Arize, Braintrust) + public ObservabilityContext type (Observability 2→4)
- [ ] CV-3: Ship bounded buffer with backpressure in `subscribe()` (Streaming 3→4)
- [ ] CV-5: Ship evented workflow executor with cron schedule + suspend/resume data (Workflow 3→4)
- [ ] CV-6: Ship optional TheoKitContainer for multi-agent coordination DX (Agent-API 3→4)
- [ ] CV-7: Ship 10+ E2E tests (.e2e.test.ts) covering critical user flows (Testing 3→4)
- [ ] CV-8: Ship 5 starter templates for create-theokit scaffolding (Docs-Examples 2→4)
- [ ] CV-9: Ship 3 server adapters (Hono, Express, Fastify) at `@theokit/sdk/server/adapter` (Integration 2→3.5)
- [ ] CV-10: Ship voice foundation interface + OpenAI Realtime adapter (Integration 2→3.5)
- [ ] CV-11: Defer `theokit studio` web UI MVP to a separate plan (DevTooling 1→2.5 partial)

## ADRs

### D447 — Dynamic provider catalog (JSON registry replacing hardcoded builtins)

**Status**: Proposed.
**Context**: Cross-validation CV-1 (LLM Providers) = 2/5. Mastra has 122 providers via dynamic JSON registry. TheoKit hardcodes 9 builtins in TypeScript.
**Decision**: Ship `internal/providers/provider-catalog.json` with ≥40 providers (capabilities + endpoint patterns). `registry.ts` loads JSON at boot + merges user-defined providers via `Theokit.registerProvider()`. Builtins preserved as first-party entries in the JSON. Plugin discovery continues to work for custom providers.
**Alternatives**: (a) keep hardcoded builtins — REJECTED, 13x gap vs Mastra; (b) external npm package per provider — REJECTED, too many packages; (c) cloud-fetched registry — REJECTED, offline-first principle. JSON catalog is the Mastra-proven pattern.
**Rules cited**: `architecture.md § 2` (DIP — registry is infrastructure).

### D448 — RAG sub-path (`@theokit/sdk/rag`)

**Status**: Proposed.
**Context**: Cross-validation CV-4 (Memory-RAG) = 2/5. Mastra has full RAG package. TheoKit has memory indexing but no document processing pipeline.
**Decision**: Ship `src/rag/` with text-splitter (char, sentence, recursive-character), retriever interface + vector-search impl, reranker interface + Cohere adapter. Export via `@theokit/sdk/rag` sub-path. Depends on existing `MemoryIndex` for vector operations — RAG imports Memory, not vice-versa.
**Alternatives**: (a) separate `@theokit/rag` package — REJECTED, premature extraction (YAGNI); single sub-path first; (b) no RAG — REJECTED, critical gap; (c) wrap LangChain.js RAG — REJECTED, dependency heavy + reinvention-avoidance does not apply when the interface is 3 functions. Per architecture.md § 1.
**Rules cited**: `architecture.md § 1` (inner layers must not import outer).

### D449 — Observability vendor expansion (3→7 adapters)

**Status**: Proposed.
**Context**: Cross-validation CV-2 (Observability) = 2/5. TheoKit has 3 adapters vs Mastra's 13.
**Decision**: Add Datadog (dd-trace spans), LangSmith (Langchain tracing), Arize/Phoenix (model monitoring), Braintrust (eval traces). Each adapter follows existing pattern in `adapters/langfuse.ts`. Public ObservabilityContext type exported from `@theokit/sdk/internal/observability`.
**Alternatives**: (a) keep 3 adapters — REJECTED, below competitive bar; (b) auto-detect all — REJECTED, import cost; (c) external plugin packages — REJECTED for first 4, considered for >7.

### D450 — Streaming backpressure via bounded buffer

**Status**: Proposed.
**Context**: Cross-validation CV-3 (Streaming) = 3/5. Mastra uses DelayedPromise; TheoKit has no explicit backpressure.
**Decision**: Add `BoundedBuffer<T>` in `subscription/internal/backpressure.ts` with configurable high-water mark (default 64 items). `subscribe()` pauses reads from transport when buffer is full. Uses Web Streams API `ReadableStream` controller `desiredSize` when available, falls back to manual counting.
**Alternatives**: (a) no backpressure — REJECTED, unbounded buffer risk in production; (b) ReadableStream everywhere — REJECTED, breaks AsyncGenerator public API.

### D451 — Evented workflow executor with cron scheduling

**Status**: Proposed.
**Context**: Cross-validation CV-5 (Workflow) = 3/5. Mastra has dual engines (standard + evented with scheduling).
**Decision**: Add `EventedWorkflowExecutor` in `internal/workflow/evented-executor.ts` that extends base executor with: (a) cron trigger via existing `croner` dep, (b) suspend/resume with `suspendData`/`resumeData` serialization, (c) workflow-level AbortSignal. Preserves existing `WorkflowExecutor` as default; evented is opt-in via `workflow.evented()`.
**Alternatives**: (a) Temporal/Inngest integration — REJECTED for v1, adds infra dep; (b) modify base executor — REJECTED, SRP violation.

### D452 — TheoKitContainer (optional multi-agent DX)

**Status**: Proposed.
**Context**: Cross-validation CV-6 (Agent-API) = 3/5. Mastra's unified `Mastra({agents, tools, workflows})` container is more discoverable for enterprise.
**Decision**: Add optional `TheoKitContainer` class in `src/theokit-container.ts`. Constructor accepts `{agents, tools, workflows}`. Methods: `container.agent(name)`, `container.tool(name)`, `container.run(agentName, input)`. Does NOT replace `Agent.create()` (which remains primary); container is sugar for multi-agent setups.
**Alternatives**: (a) no container — REJECTED, DX gap for enterprise; (b) replace Agent.create — REJECTED, breaking change; (c) DI-based — REJECTED, `@theokit/di` already exists for that.

## Dependency Graph

```
Phase A (Foundation — no deps)
  ├── T10.1 Dynamic provider catalog
  ├── T10.2 Observability vendor expansion
  └── T10.3 Streaming backpressure

Phase B (depends on Phase A completion)
  ├── T11.1 RAG sub-path
  ├── T11.2 Evented workflow executor
  ├── T11.3 TheoKitContainer
  └── T11.4 E2E test uplift

Phase C (depends on Phase B)
  ├── T12.1 Starter templates (5)
  ├── T12.2 Server adapters (Hono, Express, Fastify)
  └── T12.3 Voice foundation interface

Phase D (Integration Validation — depends on all above)
  └── T13.1 Full integration validation + re-run cross-validation
```

Phase A tasks are independent and can parallelize. Phase B requires A complete (RAG depends on provider catalog for embedding provider resolution; E2E needs observability wired). Phase C is DX/ecosystem that depends on core features working. Phase D validates everything.

## Phase A — Foundation (provider catalog + observability + backpressure)

### T10.1 — Dynamic provider catalog (JSON registry)

#### Why this step

**Action:** Replace hardcoded 9-provider TypeScript builtins with a JSON catalog of ≥40 providers loaded at runtime, plus a `Theokit.registerProvider()` public API for user-defined providers.

**Reasoning:** Cross-validation CV-1 (LLM Providers)=2/5 is the second-largest gap. Mastra ships 122 providers via `provider-registry.json` (reference: `packages/core/src/llm/model/provider-registry.json`). The catalog pattern is proven at scale and doesn't require per-provider npm packages. Hardcoded builtins remain as first-party entries — zero breaking change. Per `architecture.md § 2` (DIP), the registry is infrastructure; LLM layer imports it, not vice-versa.

#### Files to edit

- `src/internal/providers/provider-catalog.json` (NEW) — JSON catalog with ≥40 providers
- `src/internal/providers/registry.ts` (46 LoC) — load JSON, merge user providers
- `src/internal/providers/types.ts` (~30 LoC) — add `ProviderCapabilities` type
- `src/theokit.ts` — add `Theokit.registerProvider()` + `Theokit.models.capabilities(modelId)`
- `tests/providers/dynamic-catalog.test.ts` (NEW)
- `tests/providers/register-custom-provider.test.ts` (NEW)

#### Deep file dependency analysis

- `registry.ts` is imported by `src/internal/llm/router.ts` and `local-agent.ts` — both use `getProvider()`. The function signature MUST NOT change; JSON loading is internal.
- `types.ts` exports `ProviderConfig` — adding `ProviderCapabilities` is additive, no breaks.
- `theokit.ts` is the public namespace — adding a static method is additive.

#### TDD

```
RED: test("catalog loads ≥40 providers from JSON", () => {
  const catalog = loadProviderCatalog();
  expect(Object.keys(catalog).length).toBeGreaterThanOrEqual(40);
  expect(catalog["openai"]).toHaveProperty("capabilities");
});

RED: test("Theokit.registerProvider adds custom provider", () => {
  Theokit.registerProvider({ id: "custom-llm", ... });
  expect(Theokit.models.capabilities("custom-llm/model")).toBeDefined();
});

RED: test("getProvider resolves JSON-loaded provider", () => {
  const p = getProvider("groq");
  expect(p).toBeDefined();
  expect(p.capabilities.supportsToolUse).toBe(true);
});
```

#### Acceptance criteria

- `loadProviderCatalog()` returns ≥40 entries with `id`, `capabilities`, `endpointPattern`
- `Theokit.registerProvider()` adds user provider visible to `getProvider()`
- `Theokit.models.capabilities(modelId)` returns typed capabilities
- Existing 9 builtins still work (backward compat)
- EC-1 MUST FIX: `validateCatalogEntry(entry)` via Zod schema runs at load time; malformed entries are skipped with WARN log (not crash). Test: insert a malformed entry with missing `capabilities` field into fixture JSON — `loadProviderCatalog()` returns 39 valid entries and logs 1 WARN, does NOT throw.
- EC-4 SHOULD TEST: `Theokit.registerProvider({ id: "custom" })` called twice with same ID throws `ConfigurationError({code: "provider_already_registered"})`.
- `pnpm test` GREEN, `pnpm typecheck` GREEN

#### DoD

- `pnpm exec vitest run tests/providers/dynamic-catalog.test.ts` exit 0
- `pnpm exec vitest run tests/providers/register-custom-provider.test.ts` exit 0
- CHANGELOG entry under `[Unreleased] § Added`

---

### T10.2 — Observability vendor expansion (3→7 adapters)

#### Why this step

**Action:** Add 4 new telemetry adapters (Datadog, LangSmith, Arize, Braintrust) following the existing pattern in `adapters/langfuse.ts`, plus export public `ObservabilityContext` type.

**Reasoning:** Cross-validation CV-2 (Observability)=2/5. Mastra has 13 observability integrations with 1756 LoC core context. TheoKit has 67 LoC + 3 adapters. Adding 4 vendor adapters with a formalized ObservabilityContext closes the gap to 7/13 (enough for ≥3.7). Each adapter follows the established `TelemetryAdapter` interface in `adapter-registry.ts:92`. Per D449.

#### Files to edit

- `src/internal/telemetry/adapters/datadog.ts` (NEW) — dd-trace span bridge
- `src/internal/telemetry/adapters/langsmith.ts` (NEW) — Langchain tracing bridge
- `src/internal/telemetry/adapters/arize.ts` (NEW) — Phoenix/Arize model monitoring
- `src/internal/telemetry/adapters/braintrust.ts` (NEW) — Braintrust eval traces
- `src/internal/telemetry/adapter-registry.ts` (92 LoC) — register new adapters
- `src/internal/observability/context.ts` (NEW) — public ObservabilityContext type
- `tests/telemetry/datadog-adapter.test.ts` (NEW)
- `tests/telemetry/langsmith-adapter.test.ts` (NEW)
- `tests/telemetry/arize-adapter.test.ts` (NEW)
- `tests/telemetry/braintrust-adapter.test.ts` (NEW)

#### Deep file dependency analysis

- `adapter-registry.ts` exports `registerAdapter()` used by `tracer.ts`. Adding new adapters is additive.
- Each adapter is an optional peer dep (dd-trace, @langchain/core, arize-phoenix-otel, braintrust) — dynamic import via existing `safe-require.ts` pattern.

#### TDD

```
RED: test("datadog adapter forwards spans to dd-trace", () => {
  const adapter = createDatadogAdapter({});
  const span = adapter.startSpan("test.span");
  expect(span).toBeDefined();
  expect(span.context().toTraceId()).toBeTruthy();
});
// ... similar for langsmith, arize, braintrust
```

#### Acceptance criteria

- `wc -l` on each new adapter file returns ≤ 100 LoC: `datadog.ts`, `langsmith.ts`, `arize.ts`, `braintrust.ts`
- `pnpm exec vitest run tests/telemetry/datadog-adapter.test.ts` exit 0 with ≥ 3 passing assertions
- `pnpm exec vitest run tests/telemetry/langsmith-adapter.test.ts` exit 0 with ≥ 3 passing assertions
- `pnpm exec vitest run tests/telemetry/arize-adapter.test.ts` exit 0 with ≥ 3 passing assertions
- `pnpm exec vitest run tests/telemetry/braintrust-adapter.test.ts` exit 0 with ≥ 3 passing assertions
- `grep 'ObservabilityContext' packages/sdk/src/internal/observability/index.ts` returns non-empty (type exported)
- `grep 'import(' packages/sdk/src/internal/telemetry/adapters/datadog.ts` returns non-empty (dynamic import verified)

#### DoD

- `pnpm exec vitest run tests/telemetry/` exit 0 with 12+ new passing tests
- CHANGELOG entry under `[Unreleased] § Added`
- CHANGELOG entry

---

### T10.3 — Streaming backpressure via bounded buffer

#### Why this step

**Action:** Add `BoundedBuffer<T>` to `subscription/internal/backpressure.ts` and wire into `subscribe()` to prevent unbounded memory growth for slow consumers.

**Reasoning:** Cross-validation CV-3 (Streaming)=3/5. Mastra uses `DelayedPromise` (reference: `packages/core/src/stream/base/output.ts:81`). TheoKit's `subscribe()` has no backpressure — fast producers can overwhelm slow consumers. Per D450.

#### Files to edit

- `src/subscription/internal/backpressure.ts` (NEW) — `BoundedBuffer<T>` class
- `src/subscription/theokit-subscribe.ts` (323 LoC) — wire buffer into transport read loop
- `tests/subscription/backpressure.test.ts` (NEW)

#### TDD

```
RED: test("bounded buffer pauses producer at high water mark", async () => {
  const buf = new BoundedBuffer<string>({ highWaterMark: 4 });
  for (let i = 0; i < 4; i++) buf.push(`item-${i}`);
  const pushPromise = buf.push("item-4"); // should NOT resolve immediately
  expect(buf.size).toBe(4);
  buf.pull(); // free one slot
  await pushPromise; // now resolves
});

RED: test("subscribe pauses transport when buffer full", async () => {
  // mock transport that emits 100 items instantly
  // subscribe with highWaterMark: 10
  // verify transport.pause() called when buffer hits 10
});
```

#### Acceptance criteria

- `new BoundedBuffer({ highWaterMark: 4 })` with 5 pushes: 5th push blocks until `pull()` frees a slot (verified by test assertion)
- `subscribe(name, input, { backpressure: { highWaterMark: 10 } })` compiles without TS error (`pnpm typecheck` exit 0)
- Test: push 100 items into buffer(highWaterMark=10) with slow consumer — `buffer.size` never exceeds 10
- Test: `subscribe()` WITHOUT backpressure option behaves identically to current implementation (regression test GREEN)
- EC-2 MUST FIX: `push()` uses `queueMicrotask` in the blocked path to yield to the event loop, preventing deadlock when consumer runs on the same microtask queue. Test: push at highWaterMark from within a microtask, then pull from a `setTimeout` — push resolves within 100ms (no hang). Add `deadlockTimeoutMs` option (default 30000) that rejects the push promise if buffer is not drained in time.

#### DoD

- `pnpm exec vitest run tests/subscription/backpressure.test.ts` exit 0 with 5+ passing tests (including deadlock prevention)
- `pnpm exec vitest run tests/subscription/` exit 0 (zero regressions in existing subscription tests)

---

## Phase B — Feature depth (RAG + workflow + container + E2E)

### T11.1 — RAG sub-path (`@theokit/sdk/rag`)

#### Why this step

**Action:** Ship text-splitter, retriever interface, and reranker interface as `@theokit/sdk/rag` sub-path export.

**Reasoning:** Cross-validation CV-4 (Memory-RAG)=2/5 is the largest gap. Mastra has full RAG at `packages/rag/src/`. TheoKit has memory indexing (embedding + LanceDB) but no document processing. Adding a RAG sub-path that builds ON TOP of existing `MemoryIndex` gives 80% of Mastra's RAG value with 20% of the code. Per D448, RAG imports Memory (not vice-versa), preserving `architecture.md § 1`.

#### Files to edit

- `src/rag/index.ts` (NEW) — barrel export
- `src/rag/text-splitter.ts` (NEW) — character, sentence, recursive-character splitters
- `src/rag/retriever.ts` (NEW) — `Retriever` interface + `VectorRetriever` impl using `MemoryIndex`
- `src/rag/reranker.ts` (NEW) — `Reranker` interface + `CohereReranker` + `NoopReranker`
- `src/rag/types.ts` (NEW) — `Document`, `Chunk`, `RetrievalResult`
- `packages/sdk/package.json` — add `./rag` export
- `packages/sdk/tsup.config.ts` — add `rag` entry point
- `tests/rag/text-splitter.test.ts` (NEW)
- `tests/rag/retriever.test.ts` (NEW)
- `tests/rag/reranker.test.ts` (NEW)

#### TDD

```
RED: test("recursive character splitter chunks at boundaries", () => {
  const chunks = splitRecursive("Hello world. How are you?", { chunkSize: 15, overlap: 5 });
  expect(chunks.length).toBe(2);
  expect(chunks[0].text).toBe("Hello world.");
});

RED: test("vector retriever returns top-k relevant chunks", async () => {
  const retriever = new VectorRetriever({ index, embedder, topK: 3 });
  const results = await retriever.retrieve("query about X");
  expect(results.length).toBeLessThanOrEqual(3);
  expect(results[0]).toHaveProperty("score");
});

RED: test("cohere reranker re-orders by relevance", async () => {
  const reranker = new CohereReranker({ apiKey: "test" });
  const reranked = await reranker.rerank("query", chunks);
  expect(reranked[0].score).toBeGreaterThan(reranked[1].score);
});
```

#### Acceptance criteria

- 3 splitter strategies: `splitByCharacter`, `splitBySentence`, `splitRecursive`
- `Retriever` interface with `retrieve(query, options): Promise<RetrievalResult[]>`
- `Reranker` interface with `rerank(query, chunks): Promise<RankedChunk[]>`
- Sub-path `@theokit/sdk/rag` exports all public types + functions
- ≥ 15 unit tests covering splitters + retriever + reranker
- EC-5 SHOULD TEST: `splitRecursive("", { chunkSize: 100 })` returns `[]` (not `[""]`, not throw). `splitRecursive("x", { chunkSize: 100 })` returns `[{text: "x"}]`.
- EC-6 SHOULD TEST: `retriever.retrieve("quantum physics")` on cooking-recipe index returns `[]` with no error.

#### DoD

- `pnpm exec vitest run tests/rag/` exit 0
- `pnpm build` — `dist/rag.js` + `dist/rag.d.ts` emitted
- `pnpm validate:publint` + `pnpm validate:attw` PASS

---

### T11.2 — Evented workflow executor with scheduling

#### Why this step

**Action:** Add `EventedWorkflowExecutor` extending base `WorkflowExecutor` with cron triggers, suspend/resume data serialization, and workflow-level AbortSignal.

**Reasoning:** Cross-validation CV-5 (Workflow)=3/5. Mastra's dual-engine pattern (reference: `packages/core/src/workflows/evented/`) supports scheduled + event-driven workflows. TheoKit has synchronous step execution only. Per D451, evented is opt-in via `.evented()` — base executor unchanged.

#### Files to edit

- `src/internal/workflow/evented-executor.ts` (NEW) — extends WorkflowExecutor
- `src/internal/workflow/scheduler.ts` (NEW) — cron trigger using existing `croner` dep
- `src/workflow.ts` — add `.evented()` builder method
- `tests/workflow/evented-executor.test.ts` (NEW)
- `tests/workflow/scheduler.test.ts` (NEW)

#### TDD

```
RED: test("evented workflow triggers on cron schedule", async () => {
  const wf = workflow.evented({ schedule: "*/5 * * * *" });
  // advance clock
  expect(executionCount).toBe(1);
});

RED: test("evented workflow suspends with data and resumes", async () => {
  const wf = workflow.evented().then(step).suspend("approval");
  const state = await wf.run({});
  expect(state.status).toBe("suspended");
  const result = await wf.resume(state.runId, { approved: true });
  expect(result.status).toBe("completed");
});
```

#### Acceptance criteria

- `workflow.evented({ schedule? })` creates an evented variant
- Cron trigger via `croner` (already a dep)
- `.suspend(name)` + `.resume(runId, data)` with JSON-serializable state
- Workflow-level AbortSignal propagation
- Existing `WorkflowExecutor` unchanged (SRP)
- EC-3 MUST FIX: `EventedWorkflowExecutor` implements `[Symbol.dispose]()` that calls `croner.stop()`. Test: create evented workflow with cron, call `dispose()`, verify `croner.running()` returns false. Test: create evented workflow, drop reference without dispose — FinalizationRegistry logs WARN (defense-in-depth).

#### DoD

- `pnpm exec vitest run tests/workflow/evented-executor.test.ts` exit 0 (including dispose + timer cleanup tests)
- `pnpm exec vitest run tests/workflow/scheduler.test.ts` exit 0

---

### T11.3 — TheoKitContainer (optional multi-agent DX)

#### Why this step

**Action:** Add optional `TheoKitContainer` class for registering agents + tools + workflows in a single instance, improving discoverability for enterprise setups.

**Reasoning:** Cross-validation CV-6 (Agent-API)=3/5. Mastra's unified `Mastra({agents, tools})` container scores higher on DX discoverability. `Agent.create()` remains primary (lightweight); container is additive sugar for multi-agent coordination. Per D452.

#### Files to edit

- `src/theokit-container.ts` (NEW) — TheoKitContainer class
- `src/index.ts` — export TheoKitContainer
- `tests/theokit-container.test.ts` (NEW)

#### TDD

```
RED: test("container registers and retrieves agents by name", () => {
  const container = new TheoKitContainer({
    agents: { greeter: { model: "openai/gpt-4o-mini", systemPrompt: "greet" } },
  });
  const agent = container.agent("greeter");
  expect(agent).toBeDefined();
  expect(agent.model).toEqual("openai/gpt-4o-mini");
  expect(() => container.agent("unknown")).toThrow();
});

RED: test("container.run after dispose throws AgentDisposedError", async () => {
  const container = new TheoKitContainer({ agents: { a: { model: "openai/gpt-4o-mini" } } });
  const agent = container.agent("a");
  agent.dispose();
  await expect(container.run("a", "hello")).rejects.toThrow("AgentDisposedError");
});
```

#### Acceptance criteria

- `new TheoKitContainer({ agents, tools, workflows })` constructor
- `.agent(name)`, `.tool(name)`, `.workflow(name)` getters
- `.run(agentName, input)` shorthand for `Agent.create(config).send(input)`
- Type-safe: TS infers agent names from constructor config
- EC-7 SHOULD TEST: `container.run("name", input)` after the agent has been `.dispose()`'d throws `AgentDisposedError`.

#### DoD

- `pnpm exec vitest run tests/theokit-container.test.ts` exit 0

---

### T11.4 — E2E test uplift (10+ end-to-end tests)

#### Why this step

**Action:** Add 10+ E2E tests covering critical user flows end-to-end: agent creation → send → stream → tool call → memory recall → workflow run.

**Reasoning:** Cross-validation CV-7 (Testing)=3/5. TheoKit has structured test pyramid (chaos/load/security/property) but lacks E2E flow coverage. Mastra names E2E tests with `.e2e.test.ts` convention. Adding E2E tests closes the pyramid gap.

#### Files to edit

- `tests/e2e/agent-lifecycle.e2e.test.ts` (NEW) — create → send → dispose
- `tests/e2e/tool-roundtrip.e2e.test.ts` (NEW) — agent + tool → result
- `tests/e2e/memory-recall.e2e.test.ts` (NEW) — store → recall → verify
- `tests/e2e/workflow-execute.e2e.test.ts` (NEW) — multi-step workflow
- `tests/e2e/streaming-subscribe.e2e.test.ts` (NEW) — SSE/WS roundtrip
- `tests/e2e/rag-pipeline.e2e.test.ts` (NEW) — chunk → embed → retrieve
- `tests/e2e/container-multi-agent.e2e.test.ts` (NEW) — TheoKitContainer
- `tests/e2e/error-propagation.e2e.test.ts` (NEW) — error flows
- `tests/e2e/budget-tracking.e2e.test.ts` (NEW) — token cost accumulation
- `tests/e2e/real-llm-full-flow.e2e.test.ts` (NEW) — real LLM gated

#### TDD

```
RED: test("agent lifecycle: create send dispose", async () => {
  const agent = Agent.create({ model: "fixture/test", apiKey: "theo_test_fixture" });
  const run = await agent.send("hello");
  expect(run.status).toEqual("finished");
  agent.dispose();
});

RED: test("tool roundtrip returns tool result", async () => {
  const tool = defineTool({ name: "echo", inputSchema: z.object({ msg: z.string() }), handler: ({ msg }) => msg });
  const agent = Agent.create({ model: "fixture/test", apiKey: "theo_test_fixture", tools: [tool] });
  const run = await agent.send("call echo with msg=hi");
  expect(run.status).toEqual("finished");
});

RED: test("error propagation: invalid model throws ConfigurationError", async () => {
  await expect(Agent.create({ model: "nonexistent/model" }).send("x")).rejects.toThrow();
});
```

#### Acceptance criteria

- 10+ `.e2e.test.ts` files in `tests/e2e/`
- Each test covers a complete user flow (creation → execution → verification)
- Real-LLM tests gated by `skipIf(!process.env.OPENROUTER_API_KEY)`
- All E2E tests pass in `pnpm test`

#### DoD

- `pnpm exec vitest run tests/e2e/` exit 0

---

## Phase C — Ecosystem (templates + server adapters + voice)

### T12.1 — Starter templates (5)

#### Why this step

**Action:** Create 5 scaffoldable starter templates in `templates/` directory that `create-theokit` can use.

**Reasoning:** Cross-validation CV-8 (Docs-Examples)=2/5. Mastra has 14+ templates (reference: `templates/`). TheoKit has 25 examples but zero scaffoldable templates. Templates are the first-touch DX for new users. 5 focused templates covering the main use cases brings Docs-Examples dimension to at least 3.7.

#### Files to edit

- `templates/chatbot/` (NEW) — simple chatbot with memory
- `templates/rag-agent/` (NEW) — RAG pipeline + agent
- `templates/multi-agent/` (NEW) — TheoKitContainer with 3 agents + handoff
- `templates/workflow-automation/` (NEW) — evented workflow + cron
- `templates/telegram-bot/` (NEW) — gateway + agent + memory
- Each template: `package.json`, `tsconfig.json`, `src/index.ts`, `README.md`

#### TDD

```
RED: test("chatbot template has required files", () => {
  expect(existsSync("templates/chatbot/package.json")).toEqual(true);
  expect(existsSync("templates/chatbot/src/index.ts")).toEqual(true);
  expect(existsSync("templates/chatbot/README.md")).toEqual(true);
});

RED: test("chatbot template index.ts is under 100 LoC", () => {
  const lines = readFileSync("templates/chatbot/src/index.ts", "utf8").split("\n").length;
  expect(lines).toBeLessThan(100);
});
```

#### Acceptance criteria

- `ls templates/` returns exactly 5 directories: `chatbot`, `rag-agent`, `multi-agent`, `workflow-automation`, `telegram-bot`
- `wc -l templates/chatbot/src/index.ts` returns ≤ 100
- `wc -l templates/rag-agent/src/index.ts` returns ≤ 100
- `cat templates/chatbot/README.md | head -1` returns non-empty (getting-started guide present)
- `cd templates/chatbot && pnpm typecheck` exit 0

#### DoD

- `for d in templates/*/; do (cd "$d" && pnpm typecheck); done` exit 0 for all 5 templates
- CHANGELOG entry under `[Unreleased] § Added`

---

### T12.2 — Server adapters (Hono, Express, Fastify)

#### Why this step

**Action:** Add 3 server framework adapters that mount TheoKit agents as HTTP middleware, exported from `@theokit/sdk/server/adapter`.

**Reasoning:** Cross-validation CV-6 (Agent-API)5=2/5. Mastra has 5 server adapters. TheoKit agents run in custom runtime only — no way to mount them in existing Express/Hono apps. 3 adapters cover 90% of the TypeScript server ecosystem.

#### Files to edit

- `src/server/adapter/hono.ts` (NEW)
- `src/server/adapter/express.ts` (NEW)
- `src/server/adapter/fastify.ts` (NEW)
- `src/server/adapter/types.ts` (NEW) — shared `AgentMiddleware` interface
- `src/server/adapter/index.ts` (NEW) — barrel
- `tests/server/adapter-hono.test.ts` (NEW)
- `tests/server/adapter-express.test.ts` (NEW)
- `tests/server/adapter-fastify.test.ts` (NEW)

#### TDD

```
RED: test("hono adapter exports createAgentHandler", async () => {
  const { createAgentHandler } = await import("../src/server/adapter/hono.js");
  expect(typeof createAgentHandler).toEqual("function");
});

RED: test("express adapter handles POST /send", async () => {
  const handler = createAgentHandler(mockAgent, {});
  const res = await supertest(handler).post("/send").send({ input: "hi" });
  expect(res.status).toEqual(200);
});
```

#### Acceptance criteria

- `grep 'createAgentHandler' src/server/adapter/hono.ts` returns export statement
- `grep 'createAgentHandler' src/server/adapter/express.ts` returns export statement
- `grep 'createAgentHandler' src/server/adapter/fastify.ts` returns export statement
- `pnpm exec vitest run tests/server/adapter-hono.test.ts` exit 0 with ≥ 3 passing tests (POST /send + GET /stream + POST /tool-call)
- `pnpm exec vitest run tests/server/adapter-express.test.ts` exit 0 with ≥ 3 passing tests
- `pnpm exec vitest run tests/server/adapter-fastify.test.ts` exit 0 with ≥ 3 passing tests
- EC-8 SHOULD TEST: SSE stream client disconnect mid-stream — adapter aborts agent AbortSignal, closes stream, zero leaked sockets. Test via `response.destroy()` during active stream.
- `pnpm typecheck` exit 0 (type exports correct)

#### DoD

- `pnpm exec vitest run tests/server/adapter-*.test.ts` exit 0 with 9+ passing tests total
- CHANGELOG entry under `[Unreleased] § Added`

---

### T12.3 — Voice foundation interface + OpenAI Realtime adapter

#### Why this step

**Action:** Ship `VoiceProvider` interface and one canonical adapter (OpenAI Realtime API) to establish the voice extension point.

**Reasoning:** Cross-validation CV-6 (Agent-API)5=2/5 (voice component). Mastra has 17 voice providers. TheoKit has zero. Shipping the interface + one adapter establishes the pattern for community contributions. One adapter is enough to prove the interface; quantity follows.

#### Files to edit

- `src/voice/types.ts` (NEW) — `VoiceProvider`, `TTSOptions`, `STTOptions`
- `src/voice/openai-realtime.ts` (NEW) — OpenAI Realtime WebSocket adapter
- `src/voice/index.ts` (NEW) — barrel
- `tests/voice/openai-realtime.test.ts` (NEW)

#### TDD

```
RED: test("VoiceProvider interface is exported from voice sub-path", async () => {
  const mod = await import("../src/voice/index.js");
  expect(mod.OpenAIRealtimeVoiceProvider).toBeDefined();
});

RED: test("OpenAI Realtime TTS request shape", () => {
  const provider = new OpenAIRealtimeVoiceProvider({ apiKey: "test-key" });
  expect(typeof provider.textToSpeech).toEqual("function");
  expect(typeof provider.speechToText).toEqual("function");
});
```

#### Acceptance criteria

- `VoiceProvider` interface with `textToSpeech(text, opts)` and `speechToText(audio, opts)`
- `OpenAIRealtimeVoiceProvider` implements the interface
- Optional peer dep: `ws@>=8`
- ≥ 5 unit tests (TTS request shape, STT response parsing, connection management)
- Sub-path `@theokit/sdk/voice` exports all public types

#### DoD

- `pnpm exec vitest run tests/voice/` exit 0

---

## Phase D — Integration Validation

### T13.1 — Full integration validation + cross-validation re-run

#### Why this step

**Action:** Run the full validation suite (`pnpm validate`), then re-run `/loop-cross-validation:loop-cross-validation /tmp/mastra` to verify all dimensions ≥3.7.

**Reasoning:** The plan is NOT complete until the full chain passes and the cross-validation metric is met. This is the "eat your own cooking" gate.

#### TDD

```
RED: test("pnpm validate exits 0", async () => {
  const result = execSync("pnpm -w run validate", { encoding: "utf8" });
  expect(result).toBeDefined();
});

RED: test("cross-validation weighted average >= 3.70", () => {
  const report = JSON.parse(readFileSync("cross-validation-output/scoring-summary.json", "utf8"));
  expect(report.weighted_avg).toBeGreaterThanOrEqual(3.70);
});
```

#### Acceptance criteria

- `pnpm -w run validate` exit 0
- `pnpm test` workspace exit 0
- `pnpm build` — all new sub-paths emit correctly
- Cross-validation re-run: weighted average ≥3.70, zero dimension below 3.5

#### DoD

- `cross-validation-output/final_report.md` updated with new scores
- All 15 dimensions ≥3.5

---

## Coverage Matrix

| # | Gap | Severity | Cross-Val Dimension | Task ID |
|---|-----|----------|---------------------|---------|
| CV-1 | Dynamic provider registry (9→40+) | CRITICAL | LLM Providers (2/5 → 4/5) | T10.1 |
| CV-2 | Observability vendor expansion (3→7 adapters) | HIGH | Observability (2/5 → 4/5) | T10.2 |
| CV-3 | Streaming backpressure (bounded buffer) | MEDIUM | Streaming (3/5 → 4/5) | T10.3 |
| CV-4 | RAG pipeline (text split + retrieve + rerank) | CRITICAL | Memory-RAG (2/5 → 4/5) | T11.1 |
| CV-5 | Evented workflow + cron scheduling | MEDIUM | Workflow (3/5 → 4/5) | T11.2 |
| CV-6 | TheoKitContainer multi-agent DX | MEDIUM | Agent-API (3/5 → 4/5) | T11.3 |
| CV-7 | E2E test uplift (0→10+ e2e tests) | HIGH | Testing (3/5 → 4/5) | T11.4 |
| CV-8 | Starter templates (0→5) | HIGH | Docs-Examples (2/5 → 4/5) | T12.1 |
| CV-9 | Server adapters (Hono, Express, Fastify) | HIGH | Integration (2/5 → 3.5/5) | T12.2 |
| CV-10 | Voice foundation (interface + OpenAI Realtime) | HIGH | Integration (2/5 → 3.5/5) | T12.3 |
| CV-11 | Developer tooling uplift (visual editor) | CRITICAL | DevTooling (1/5 → 2.5/5) | out-of-scope — deferred to dedicated plan per ADR D452 (4-6 week standalone effort) |
| CV-12 | Full integration validation + re-run | GATE | ALL (2.92 → ≥3.70) | T13.1 |

**Coverage: 12/12 gaps mapped (100%). CV-11 deferred with ADR justification.**

## Drawbacks & Risks

| # | Risk | Severity | Mitigation | Owner |
|---|------|----------|------------|-------|
| R1 | Developer Tooling dimension will NOT reach 3.7 — visual playground is 4-6 week standalone effort. Deferred per ADR D452. | HIGH | DevTooling improves 1 to 2.5 via E2E tests + templates + server adapters. Full 3.7 requires dedicated plan. | Plan author |
| R2 | RAG sub-path adds public API surface complexity to SDK | MEDIUM | RAG is tree-shakable sub-path import; zero impact when unused. Per YAGNI: 3 splitters, 1 reranker. | T11.1 owner |
| R3 | Provider catalog JSON requires ongoing maintenance as models ship or retire | MEDIUM | JSON is human-editable and PR-driven. Add last_verified date per entry. Community contributions. | T10.1 owner |
| R4 | Voice interface not validated against real WebRTC/WebSocket flows | LOW | Ship as experimental with @experimental JSDoc tag. Iterate post-v1. | T12.3 owner |
| R5 | Evented workflow cron will conflict with external schedulers like Temporal or Inngest | LOW | Evented is opt-in via .evented(); base workflow unchanged. Document escape hatch. | T11.2 owner |

## Unresolved Questions

- UQ1: RAG sub-path — support Graph-RAG in v1, or defer to v2? Default: defer to v2 (linear retrieval first, Graph-RAG in a follow-up plan).
- UQ2: Server adapters — mount agent as middleware or as a standalone server? Default: middleware pattern (more composable with existing apps).
- UQ3: Provider catalog — how many providers in the initial JSON? Default: 40 minimum with the top providers by usage. Community PRs add the rest.

## Global DoD

- `pnpm -w run validate` exit 0 (typecheck + lint + test + publint + attw)
- `pnpm test` workspace exit 0 (all new tests GREEN)
- `pnpm build` — all new sub-paths (`rag`, `voice`, `server/adapter`) emit ESM + CJS + DTS
- CHANGELOG entries for all 11 tasks
- Cross-validation re-run ≥3.70 weighted average, zero dimension below 3.5
- No violation of existing `sdk-superiority-2026-06-07` plan tasks (complementary, not conflicting)
