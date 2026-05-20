# Plan: Batch Processing — `Agent.batch(prompts[], options)`

> **Version 1.1** (2026-05-20) — incorporates edge-case review: MUST FIX EC-A (pool sharing claim mismatch — wrap `withCredentialPool` in batchImpl + check ALS in router) + 5 SHOULD TEST (EC-B/C/D/E/F) + 4 DOCUMENT (EC-G/H/I/J).
>
> **Version 1.0** — Adds a `Agent.batch(prompts, options)` static helper to `@usetheo/sdk` that runs N prompts in parallel with bounded concurrency, isolated failure-per-prompt, optional streaming output, and an opt-in ShareGPT trajectory exporter. Ports the Hermes-Agent `batch_runner.py` primitive (1302 LoC Python multiprocessing CLI) into a thin TypeScript helper (~250 LoC) backed by an in-house async semaphore. Closes SDK Roadmap item #2 (score 8); opens the **eval + training-data generation** use case the SDK currently leaves to consumers reinventing it. Backward compatible — pure additive surface.

## Context

### What exists today

- `Agent.create(opts)` / `Agent.prompt(msg, opts)` (agent.ts:62/89) — single-shot semantics. Consumers calling them in a loop hit:
  - Sequential bottleneck (no parallelism)
  - No shared concurrency limit (`Promise.all([send×100])` floods rate-limits)
  - Manual error isolation (a single throw aborts the whole `Promise.all`)
  - No streaming output (`Promise.all` materializes all results in memory; 10k prompts = OOM)
- Existing patterns in the SDK that share this shape:
  - `Agent.streamObject` (agent.ts:198) — AsyncGenerator pattern, ADR D39
  - `Agent.generateObject` (agent.ts:176) — static one-shot, ADR D33
  - `withCwdMutex` (D9) — in-process serialization primitive

### What's broken or missing

- **Reinvention tax:** every consumer who wants to evaluate 100+ prompts writes their own semaphore + error handling + progress tracking. Telegram-pro's `/factstream` shows the pattern (one prompt at a time); scaling it for eval would require a wrapper.
- **No trajectory export:** the SDK produces `RunResult` (final text + usage) but no canonical conversion to fine-tuning-friendly formats (ShareGPT, OpenAI messages array).
- **Credential pool wasn't enough:** D123-D133 added same-provider key rotation. But running 1000 prompts still requires the consumer to manually orchestrate the parallelism. `Agent.batch` is the next layer up.

### Evidence motivating NOW (not later)

- **SDK Roadmap item #2 (score 8)** in CLAUDE.md (commit `d581c23` → `0a97794`). Listed as ~3 days work; quick win that opens a new use case category.
- **Hermes ships this as a flagship feature** — `referencia/hermes-agent/website/docs/user-guide/features/batch-processing.md` (227 lines) documents it publicly. Their `batch_runner.py` is 1302 LoC; the SDK port is thin (~250 LoC) because we drop the CLI/checkpoint/container-image complexity.
- **Credential pool foundation is in place** — `Agent.batch` becomes trivially correct under rate-limit pressure because each in-flight agent transparently rotates via `PoolAwareLlmClient` (D123-D133). Without pools, `Agent.batch(concurrency: 8)` would burn through one key fast; with pools, it spreads load automatically.
- **Eval / training-data is the next jobs-to-be-done** — the SDK has all primitives (agent loop, tools, memory, runUntil). Missing is the "run this 1000 times in parallel" affordance.

## Objective

**Done = a developer writes `await Agent.batch(prompts, { concurrency: 8, apiKey, model, local: {} })` and gets back `BatchResult[]` with per-prompt success/error, observable progress via callback, and the option to export each result as ShareGPT JSONL.**

Measurable goals:

1. New `Agent.batch(prompts, options)` static method on the existing `Agent` façade.
2. New `internal/runtime/async-semaphore.ts` primitive (~30 LoC) — N-permit async-aware semaphore, no external dependency.
3. New `types/batch.ts` — `BatchItem`, `BatchOptions`, `BatchResult`, `BatchProgress` public types.
4. New `trajectory-helpers.ts` — `toShareGptTrajectory(result)` opt-in transformation.
5. New module entry in `index.ts` re-exporting the batch surface.
6. ~30 new tests (unit + property + integration), 200+ fast-check runs.
7. 7 ADRs D134-D140.
8. CHANGELOG entry + CLAUDE.md SDK Roadmap row #2 → ✅ DONE.
9. Dogfood `/batch <topic>` command in telegram-pro showing 3-prompt parallel execution end-to-end.
10. Zero regression: existing 977 tests stay green.

## ADRs

| ID | Decision | Rationale | Consequences |
|---|---|---|---|
| **D134** | `Agent.batch(prompts, options)` is a static method on the façade (mirrors `Agent.prompt` / `Agent.streamObject` / `Agent.generateObject`) | The pattern is already established for static one-shot operations. Caller doesn't need to instantiate an agent — `Agent.batch` creates/disposes one agent per prompt internally. Consistent mental model: `Agent.prompt` is N=1; `Agent.batch` is N≥1. | **Enables:** discoverable on `Agent` namespace; consistent with existing facade. **Constrains:** caller cannot reuse a single agent across prompts — by design (D138 isolation). |
| **D135** | Async semaphore primitive lives in `internal/runtime/async-semaphore.ts`, written in-house (no `p-limit` / `p-queue` dep) | ~30 LoC for an `acquire(): Promise<release>` semantics. Adding a dependency for 30 lines violates the "Don't reinvent" rule's exception: when the implementation cost is smaller than the dependency-evaluation cost. Matches the SDK's zero-runtime-dep posture (only `zod` peer). Avoids `p-limit` quirks under fast-check property tests. | **Enables:** no extra dep on consumers; predictable behavior under load. **Constrains:** we own the primitive — but the contract is small (`acquire` returns a release fn). |
| **D136** | Default concurrency = 4 | Matches Hermes default (`--num_workers=4`). Empirically the sweet spot for free-tier provider rate limits without saturating any single key. Override via `options.concurrency`. | **Enables:** sensible default for first-time callers. **Constrains:** users with paid quotas might want higher — clearly documented. |
| **D137** | Failures isolated per prompt — `BatchResult.ok: false` returned, never throws | Batch processing semantics is "best-effort N runs". A single bad prompt should not lose 999 successful ones. Caller filters via `r.ok` after the batch resolves; `r.error` is a typed `TheokitAgentError`. | **Enables:** robust scaling — one rate-limited prompt doesn't poison the rest. **Constrains:** caller must check `ok` before reading `result` (TS narrows correctly via discriminated union). |
| **D138** | Each prompt gets a **fresh agent instance** (create → send → wait → dispose). **Credential pool is shared across all in-flight agents via `withCredentialPool` ALS wrap** (EC-A fix). | Isolation parity with Hermes for session state. Mirrors `Agent.prompt`'s lifecycle. Each agent has its own session id (no memory bleed), its own LocalAgent send-mutex (no cross-prompt serialization). **EC-A fix:** without explicit pool sharing, each `Agent.create()` would build its own `CredentialPool` instance from `options.providers.apiKeys` — 4 concurrent agents = 4 independent pools that each waste 3× rate-limit calls before learning a key is exhausted. Fix: `batchImpl` builds pools once from options, wraps `Promise.all` in `withCredentialPool(pools, ...)`; `router.ts:buildClient` first checks `currentCredentialPool(name)` ALS before constructing fresh. | **Enables:** clean isolation of session state + single pool instance shared by all batch agents (one 429 → all in-flight learn it). **Constrains:** ~5ms per-agent creation overhead × N prompts. Negligible at the typical 100-1000 prompt scale. |
| **D139** | ShareGPT trajectory export is **opt-in helper** (`toShareGptTrajectory(result)`), NOT default output format | The SDK's job is to RUN the batch and return `BatchResult[]`. Format conversion is a downstream concern; the caller picks (JSONL, NDJSON, OpenAI messages, ShareGPT, etc.). Auto-converting every result would bloat memory for callers who just want the final text. | **Enables:** SDK stays output-agnostic; helper imported only when needed. **Constrains:** caller writes one extra line `results.map(toShareGptTrajectory)` for fine-tuning use cases. |
| **D140** | `AbortSignal` cancels **pending** prompts (those not yet acquired by semaphore); in-flight ones continue to completion | Standard Node `AbortSignal` semantics. Hard timeout requires `Promise.race(batch, timeout)` from the caller. Cancelling in-flight HTTP would partially corrupt streams (same constraint as ADR D2 in `FallbackLlmClient`). Pending prompts return `{ ok: false, error: AbortError }`. | **Enables:** observable abortion via standard primitive. **Constrains:** caller cannot stop in-flight LLM requests mid-stream — documented. |

## Dependency Graph

```
Phase 0 (audit) ──▶ Phase 1 (semaphore primitive)
                       │
                       ▼
                  Phase 2 (Agent.batch core)
                       │
                       ├──▶ Phase 3 (trajectory helper, parallel)
                       │
                       ▼
                  Phase 4 (façade wiring + exports)
                       │
                       ▼
                  Phase 5 (tests: property + lint + integration)
                       │
                       ▼
                  Phase 6 (docs + 7 ADRs + CHANGELOG + roadmap)
                       │
                       ▼
                  Phase 7 (Dogfood QA — telegram-pro /batch probe)
```

- Phases 2 + 3 paralelizáveis após Phase 1 (independent modules).
- Phase 4 bloqueia em 2+3 (precisa de ambos para exportar).
- Phases 5-7 sequenciais.

---

## Phase 0: Foundation — Audit accessor surface

### T0.1 — Confirm Agent.prompt template + AgentOptions shape

#### Objective

Verify exactly where the new `Agent.batch` static method goes, confirm `AgentOptions` accepts everything we need (apiKey, model, local, providers, etc.), confirm `RunResult` shape that `BatchResult.result` will carry.

#### Evidence

- `agent.ts:89` `Agent.prompt(message, options)` — the canonical template (create → send → wait → dispose).
- `types/agent.ts:335-374` — `AgentOptions` already has everything: apiKey, model, local, cloud, providers, tools, telemetry, metadata.
- `types/run.ts` — `RunResult` is what `agent.send(msg).then(r => r.wait())` returns.

#### Files to edit

```
.claude/knowledge-base/plans/batch-processing-plan.md — confirm via grep, no code changes
```

#### Deep file dependency analysis

- Pure documentation.

#### Tasks

1. `grep -n "static async prompt\|static streamObject" packages/sdk/src/agent.ts` → confirm 4 static methods exist.
2. `grep -n "interface RunResult" packages/sdk/src/types/run.ts` → confirm the result shape.
3. `grep -n "BatchResult\|Agent.batch" packages/sdk/src/` → confirm no pre-existing collision.

#### TDD

```
N/A — audit only.
GREEN: confirmed via grep.
VERIFY: a second engineer reproduces the call graph from the grep commands.
```

#### Acceptance Criteria

- [ ] Static method pattern confirmed (`Agent.prompt` / `Agent.generateObject` / `Agent.streamObject` / `Agent.runUntil`).
- [ ] `AgentOptions` confirmed to carry everything needed; no extension required.
- [ ] No name collision (`Agent.batch` / `BatchResult` / `BatchOptions` not pre-existing).

#### DoD

- [ ] Audit results inline in this plan; no source changes.

---

## Phase 1: Async semaphore primitive

### T1.1 — Create `internal/runtime/async-semaphore.ts`

#### Objective

N-permit async semaphore. `acquire()` returns a release function. Used by `Agent.batch` to bound concurrent in-flight agents. Pure logic, no dependencies, ~30 LoC.

#### Evidence

- Hermes uses `multiprocessing.Pool(processes=num_workers)` — process-level. We use cooperative async in a single Node process (matches our event-loop semantics).
- Standard pattern (Edsger Dijkstra's counting semaphore). No external dep (D135).

#### Files to edit

```
packages/sdk/src/internal/runtime/async-semaphore.ts (NEW)
```

#### Deep file dependency analysis

- `async-semaphore.ts` (NEW) — leaf module, zero internal deps. Used only by `batch.ts` (Phase 2).

#### Deep Dives

**Implementation:**

```typescript
export interface AsyncSemaphore {
  /** Acquire a permit; returns the release function. */
  acquire(): Promise<() => void>;
  /** Current permits held in flight. */
  inFlight(): number;
  /** Total queue length (waiting + in-flight). */
  pending(): number;
}

export function createSemaphore(permits: number): AsyncSemaphore {
  if (!Number.isInteger(permits) || permits < 1) {
    throw new ConfigurationError(
      `async-semaphore: permits must be a positive integer, got ${permits}`,
      { code: "invalid_concurrency" },
    );
  }
  let active = 0;
  const queue: Array<() => void> = [];

  function tryGrant(): void {
    if (active < permits && queue.length > 0) {
      const resolve = queue.shift();
      if (resolve) {
        active += 1;
        resolve();
      }
    }
  }

  return {
    inFlight: () => active,
    pending: () => queue.length + active,
    async acquire() {
      await new Promise<void>((resolve) => {
        queue.push(resolve);
        tryGrant();
      });
      // returned release; idempotent (multi-call no-op via flag)
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
        tryGrant();
      };
    },
  };
}
```

**Invariants:**
- `active` never exceeds `permits`.
- `acquire()` resolves in FIFO order (queue is `shift`).
- Release is idempotent — calling it twice doesn't decrement twice (defense against caller bugs).
- `inFlight()` + queue length = `pending()` total.

**Edge cases:**
- **EC-1**: `permits: 0` → throw `ConfigurationError(code: "invalid_concurrency")`.
- **EC-2**: `permits: 1` → behaves like a mutex (FIFO serialization).
- **EC-3**: `permits: 100, prompts: 3` → all 3 acquire immediately; queue stays empty.
- **EC-4**: caller forgets to call release → permanent leak. Documented (caller responsibility), but `acquire` lifecycle is short-scoped in `Agent.batch` so this can't happen.

#### Tasks

1. Create `internal/runtime/async-semaphore.ts` per spec.
2. Export `createSemaphore` + `AsyncSemaphore` type.
3. Throw `ConfigurationError` from `errors.ts` on invalid permits.

#### TDD

```
RED:     test_semaphore_one_permit_serializes_two_acquires()
RED:     test_semaphore_n_permits_run_n_concurrently()
RED:     test_semaphore_fifo_order_under_load()
RED:     test_semaphore_release_idempotent()  — call release twice; active stays correct
RED:     test_semaphore_throws_on_zero_or_negative_permits()
RED:     test_semaphore_in_flight_count_matches_active()
RED:     test_semaphore_pending_includes_in_flight_and_queue()
GREEN:   Implement createSemaphore.
REFACTOR: None expected.
VERIFY:  pnpm vitest run tests/internal/runtime/async-semaphore.test.ts
```

#### Acceptance Criteria

- [ ] 7 RED tests GREEN
- [ ] File ≤80 LoC (G8 cap is 400, plenty of margin)
- [ ] Zero `any` types
- [ ] Biome G2 clean
- [ ] G9 cognitive complexity ≤10
- [ ] 100% line coverage (pure-logic file; easy to hit)

#### DoD

- [ ] `pnpm typecheck` + `pnpm vitest` GREEN
- [ ] CHANGELOG `[Unreleased]` Added entry

---

## Phase 2: `Agent.batch` core implementation

### T2.1 — Create `batch.ts` with `batchImpl` function

#### Objective

Core orchestration: take an array of prompts/items, fan out to N concurrent agents (semaphore-bounded), collect typed results, emit progress + per-result callbacks, honor AbortSignal.

#### Evidence

- Hermes `batch_runner.py:899` uses `Pool(processes=num_workers)` — same idea, different parallelism model.
- `Agent.prompt` (agent.ts:89) is the template for the per-prompt lifecycle.
- ADRs D134-D140 specify behavior.

#### Files to edit

```
packages/sdk/src/batch.ts (NEW)
packages/sdk/src/types/batch.ts (NEW)
```

#### Deep file dependency analysis

- `types/batch.ts` (NEW) — public types, leaf, zero deps.
- `batch.ts` (NEW) — depends on:
  - `types/batch.ts` (types)
  - `types/agent.ts` (`AgentOptions`)
  - `types/run.ts` (`RunResult`)
  - `internal/runtime/async-semaphore.ts` (T1.1)
  - `errors.ts` (`TheokitAgentError`, `ConfigurationError`)
  - Injected `create: (opts) => Promise<SDKAgent>` — same DI pattern as `streamObject` to keep `batch.ts` cycle-free from `agent.ts`.

#### Deep Dives

**Public types (`types/batch.ts`):**

```typescript
import type { AgentOptions } from "./agent.js";
import type { RunResult } from "./run.js";
import type { TheokitAgentError } from "../errors.js";

/**
 * Single prompt in a batch. Plain string is shorthand for `{ prompt }`.
 *
 * @public
 */
export interface BatchItem {
  prompt: string;
  /** Per-prompt system prompt override. */
  systemPrompt?: string;
  /** Caller-supplied metadata, round-tripped to `BatchResult.metadata`. */
  metadata?: Record<string, unknown>;
}

/**
 * Options accepted by `Agent.batch`. Extends `AgentOptions` — every prompt
 * gets an agent created with these options (D138 isolation), plus the
 * batch-specific knobs below.
 *
 * @public
 */
export interface BatchOptions extends AgentOptions {
  /** Maximum parallel agents. Default 4 (ADR D136). Must be a positive integer. */
  concurrency?: number;
  /** Optional caller-side filter — return `false` to discard the result from the output array. */
  filter?: (result: BatchResult) => boolean;
  /** Streaming callback fired once per completed prompt (success OR failure). */
  onResult?: (result: BatchResult) => void | Promise<void>;
  /** Progress callback fired after each result. */
  onProgress?: (progress: BatchProgress) => void;
  /** Cancel pending prompts (D140). In-flight prompts continue to completion. */
  signal?: AbortSignal;
}

/**
 * Discriminated union — check `ok` before reading `result` or `error`.
 *
 * @public
 */
export type BatchResult =
  | {
      ok: true;
      index: number;
      prompt: string;
      result: RunResult;
      metadata?: Record<string, unknown>;
      durationMs: number;
    }
  | {
      ok: false;
      index: number;
      prompt: string;
      error: TheokitAgentError;
      metadata?: Record<string, unknown>;
      durationMs: number;
    };

/**
 * Live progress snapshot.
 *
 * @public
 */
export interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  inFlight: number;
}
```

**Core implementation (`batch.ts`):**

```typescript
interface BatchDeps {
  create: (options: AgentOptions) => Promise<SDKAgent>;
}

export async function batchImpl(
  prompts: ReadonlyArray<string | BatchItem>,
  options: BatchOptions,
  deps: BatchDeps,
): Promise<BatchResult[]> {
  // EC-1: empty array → no work, no agents created.
  if (prompts.length === 0) return [];

  // EC-A fix: build credential pools ONCE from options and share via
  // AsyncLocalStorage so all in-flight agents see the same exhaustion
  // state. Without this, each Agent.create() builds its own pool from
  // identical apiKeys → 4× rate-limit wastage per concurrency window.
  const sharedPools = buildPoolsFromApiKeys(
    options.providers?.apiKeys,
    options.providers?.credentialPoolStrategy,
  );
  if (sharedPools.size > 0) {
    return withCredentialPool(sharedPools, () => runBatch(prompts, options, deps));
  }
  return runBatch(prompts, options, deps);
}

async function runBatch(
  prompts: ReadonlyArray<string | BatchItem>,
  options: BatchOptions,
  deps: BatchDeps,
): Promise<BatchResult[]> {

  const concurrency = options.concurrency ?? 4;
  // EC-2 fix lives in createSemaphore (throws on invalid).
  // EC-3: cap concurrency to prompts.length so we don't spin idle workers.
  const effective = Math.min(concurrency, prompts.length);
  const semaphore = createSemaphore(effective);
  const items = prompts.map(normalizeItem);
  const results: BatchResult[] = new Array(items.length);
  const counters = { completed: 0, failed: 0, inFlight: 0 };
  let aborted = false;

  // Abort hook: flips the flag; in-flight don't see it (D140) but pending do.
  const onAbort = (): void => {
    aborted = true;
  };
  options.signal?.addEventListener("abort", onAbort);

  try {
    await Promise.all(
      items.map(async (item, index) => {
        const release = await semaphore.acquire();
        try {
          // EC-7: aborted after acquire but before send → return AbortError.
          if (aborted) {
            results[index] = abortResult(item, index);
          } else {
            results[index] = await runOne(item, index, options, deps);
          }
        } finally {
          release();
        }
        // Stats + callbacks (safe-call'd — caller throw can't poison the batch)
        if (results[index].ok) counters.completed += 1;
        else counters.failed += 1;
        await safeCallResult(options.onResult, results[index]);
        safeCallProgress(options.onProgress, {
          total: items.length,
          completed: counters.completed,
          failed: counters.failed,
          inFlight: semaphore.inFlight(),
          pending: semaphore.pending() - semaphore.inFlight(),
        });
      }),
    );
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }

  // EC-5: filter is post-collection (after all callbacks fire).
  return options.filter ? results.filter(options.filter) : results;
}

async function runOne(
  item: BatchItem,
  index: number,
  options: BatchOptions,
  deps: BatchDeps,
): Promise<BatchResult> {
  const t0 = Date.now();
  const agentOpts: AgentOptions = {
    ...options,
    ...(item.systemPrompt !== undefined ? { systemPrompt: item.systemPrompt } : {}),
  };
  delete (agentOpts as { concurrency?: unknown }).concurrency;
  delete (agentOpts as { filter?: unknown }).filter;
  delete (agentOpts as { onResult?: unknown }).onResult;
  delete (agentOpts as { onProgress?: unknown }).onProgress;
  delete (agentOpts as { signal?: unknown }).signal;

  try {
    const agent = await deps.create(agentOpts);
    try {
      const run = await agent.send(item.prompt);
      const result = await run.wait();
      return {
        ok: true,
        index,
        prompt: item.prompt,
        result,
        ...(item.metadata !== undefined ? { metadata: item.metadata } : {}),
        durationMs: Date.now() - t0,
      };
    } finally {
      // EC-8: dispose failure → log warn, don't fail the result.
      try {
        await agent.dispose();
      } catch (disposeErr) {
        process.stderr.write(
          `[theokit-sdk] batch: agent.dispose failed for prompt ${index}: ${
            disposeErr instanceof Error ? disposeErr.message : String(disposeErr)
          }\n`,
        );
      }
    }
  } catch (err) {
    return {
      ok: false,
      index,
      prompt: item.prompt,
      error: toTheokitError(err),
      ...(item.metadata !== undefined ? { metadata: item.metadata } : {}),
      durationMs: Date.now() - t0,
    };
  }
}
```

**Invariants:**
- `results.length === prompts.length` always (preserving input order; filter applies post).
- Discriminated union: `ok: true` → `result` set; `ok: false` → `error` set.
- `durationMs` reflects total per-prompt wall-clock (create + send + wait + dispose).
- Pool inheritance (D131) is automatic — `Agent.create` consults `currentCredentialPool` via AsyncLocalStorage.

**Edge cases:**
- **EC-1**: `prompts: []` → return `[]` immediately, no agents created. ✓
- **EC-2**: `concurrency: 0` or negative → `createSemaphore` throws `ConfigurationError`.
- **EC-3**: `concurrency > prompts.length` → effective capped at `prompts.length`.
- **EC-4**: all prompts fail → return N results all `ok: false`; no throw.
- **EC-5**: `onResult` callback throws → catch + stderr warn; result still added to array.
- **EC-6**: `onProgress` callback throws → catch + stderr warn.
- **EC-7**: AbortSignal aborted during the batch → pending get `AbortError`; in-flight continue (D140).
- **EC-8**: `agent.dispose()` fails → stderr warn; result kept as `ok: true` (the prompt completed).
- **EC-9**: `CredentialPoolExhaustedError` (D133) bubbles up as `error` for that prompt — pool exhaustion is per-provider; the batch continues with whatever can be served.
- **EC-10**: `BatchItem.metadata` with circular ref → caller bug; metadata is passed by reference (no clone) so consumer's responsibility. Documented.

#### Tasks

1. Create `types/batch.ts` with 4 public interfaces.
2. Create `batch.ts` with `batchImpl(prompts, options, deps)` per spec.
3. Add `normalizeItem(promptOrItem)` helper.
4. Add `safeCallResult` + `safeCallProgress` callback wrappers.
5. Add `abortResult(item, index, signal?)` helper — EC-D: propagate `signal.reason` when set instead of synthetic AbortError.
6. Add `toTheokitError(unknown)` adapter — re-uses existing error mappers if available.
7. **EC-A fix:** Add `buildPoolsFromApiKeys(apiKeys, strategy)` helper that constructs `Map<string, CredentialPool>` from options.
8. **EC-A fix:** Wrap `runBatch` in `withCredentialPool(sharedPools, ...)` when `sharedPools.size > 0`.
9. **EC-A fix:** Update `router.ts:buildClient` to consult `currentCredentialPool(name)` FIRST — if set in ALS, use the shared pool; else fall back to options-derived per-agent pool (preserves backward compat outside batch).

#### TDD

```
RED:     test_batch_empty_array_returns_empty()
RED:     test_batch_runs_all_prompts_in_parallel()
RED:     test_batch_respects_concurrency_limit()
RED:     test_batch_isolates_failures_per_prompt()
RED:     test_batch_preserves_input_order_in_results()
RED:     test_batch_calls_onResult_per_completion()
RED:     test_batch_calls_onProgress_with_running_stats()
RED:     test_batch_caps_concurrency_to_prompts_length()
RED:     test_batch_throws_on_invalid_concurrency()
RED:     test_batch_aborts_pending_on_signal()
RED:     test_batch_onResult_throw_does_not_poison_batch()
RED:     test_batch_dispose_failure_does_not_fail_result()
RED:     test_batch_filter_applied_post_collection()
RED:     test_batch_passes_metadata_through()
RED:     test_batch_shares_credential_pool_across_concurrent_agents()  — EC-A: 4 agents see same pool exhaustion state
RED:     test_batch_pre_aborted_signal_returns_all_as_abort_errors()  — EC-C
RED:     test_batch_abort_preserves_signal_reason()  — EC-D: signal.reason propagated, not generic AbortError
RED:     test_batch_abort_during_semaphore_wait_returns_abort_for_pending()  — EC-E race
RED:     test_batch_slow_onResult_does_not_block_other_prompts_but_delays_resolution()  — EC-B
GREEN:   Implement batchImpl + helpers + buildPoolsFromApiKeys + withCredentialPool wrap.
REFACTOR: Extract `runOne` if batch.ts > 250 LoC. Also extract `runBatch` (post EC-A wrap).
VERIFY:  pnpm vitest run tests/batch.test.ts
```

#### Acceptance Criteria

- [ ] 14 RED tests GREEN
- [ ] File ≤300 LoC
- [ ] Zero `any` types (deletes via narrowing casts ok with `as { x?: unknown }` shape)
- [ ] Biome G2 clean
- [ ] G9 cognitive complexity ≤10 (use biome-ignore with justification if needed)
- [ ] Discriminated union shape verifiable via TS exhaustiveness check
- [ ] No new cycles in dep-cruise

#### DoD

- [ ] `pnpm typecheck` + `pnpm vitest` GREEN
- [ ] CHANGELOG entry

---

## Phase 3: ShareGPT trajectory exporter

### T3.1 — Create `trajectory-helpers.ts` with `toShareGptTrajectory`

#### Objective

Pure transformation: take a `BatchResult` (ok=true) and produce a ShareGPT-format object suitable for fine-tuning datasets. Opt-in helper (ADR D139) — never called by `Agent.batch` itself.

#### Evidence

- Hermes ships this format (`agent/trajectory.py` + `batch_runner.py:_convert_to_trajectory_format`).
- HuggingFace, Axolotl, LLaMA-Factory, and most fine-tuning toolchains consume ShareGPT.

#### Files to edit

```
packages/sdk/src/trajectory-helpers.ts (NEW)
packages/sdk/src/types/trajectory.ts (NEW)
```

#### Deep file dependency analysis

- `types/trajectory.ts` (NEW) — leaf types.
- `trajectory-helpers.ts` (NEW) — depends on `types/batch.ts` + `types/messages.ts` (existing SDKMessage types) + `types/trajectory.ts`. Pure function, no runtime deps.

#### Deep Dives

**Types:**

```typescript
// types/trajectory.ts
export interface ShareGptMessage {
  /** "human" for user, "gpt" for assistant, "tool" for tool result. */
  from: "human" | "gpt" | "tool" | "system";
  /** The message text. */
  value: string;
  /** Optional tool calls when from="gpt". */
  tool_calls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

export interface ShareGptTrajectory {
  conversations: ShareGptMessage[];
  metadata?: {
    model?: string;
    timestamp: string;
    durationMs: number;
    promptIndex: number;
  };
  completed: boolean;
  /** Token usage if available. */
  usage?: { inputTokens: number; outputTokens: number };
}
```

**Implementation (`trajectory-helpers.ts`):**

```typescript
/**
 * Convert a successful `BatchResult` to ShareGPT-format trajectory.
 * Reads `result.messages` (the conversation history persisted by the
 * agent) and maps each SDKMessage to a `{from, value}` entry.
 *
 * Skipped when `result.ok === false` — returns null.
 *
 * @public
 */
export function toShareGptTrajectory(result: BatchResult): ShareGptTrajectory | null {
  if (!result.ok) return null;
  const conversations: ShareGptMessage[] = [
    { from: "human", value: result.prompt },
  ];
  // Map SDKMessage events from result.result.messages (when present) into
  // gpt + tool entries. For minimal RunResult (no messages array), emit
  // a single gpt entry with the final text.
  const messages = (result.result as { messages?: unknown }).messages;
  if (Array.isArray(messages)) {
    for (const m of messages) {
      const mapped = mapSdkMessage(m);
      if (mapped !== null) conversations.push(mapped);
    }
  } else if (result.result.text !== undefined) {
    conversations.push({ from: "gpt", value: result.result.text });
  }
  return {
    conversations,
    metadata: {
      timestamp: new Date().toISOString(),
      durationMs: result.durationMs,
      promptIndex: result.index,
    },
    completed: true,
    ...(result.result.usage !== undefined ? { usage: result.result.usage } : {}),
  };
}
```

**Invariants:**
- Returns `null` for `ok: false` results (caller filters).
- `conversations[0]` is always the human prompt.
- Order preserved: matches SDKMessage emission order.

**Edge cases:**
- **EC-11**: `result.ok === false` → return null.
- **EC-12**: `result.result.messages` absent (minimal RunResult shape) → emit single gpt entry with final text.
- **EC-13**: empty assistant text + no tool calls → emit `{from: "gpt", value: ""}` (preserves turn).
- **EC-14**: tool_use without paired tool_result (interrupted) → emit gpt entry; skip orphan tool.

#### Tasks

1. Create `types/trajectory.ts` with `ShareGptMessage` + `ShareGptTrajectory`.
2. Create `trajectory-helpers.ts` with `toShareGptTrajectory(result)` + `mapSdkMessage(m)`.
3. Re-export from `index.ts`.

#### TDD

```
RED:     test_sharegpt_returns_null_for_failed_result()
RED:     test_sharegpt_first_conversation_is_human_prompt()
RED:     test_sharegpt_maps_assistant_text_to_gpt()
RED:     test_sharegpt_maps_tool_calls_to_tool_calls_field()
RED:     test_sharegpt_falls_back_to_final_text_when_no_messages()
RED:     test_sharegpt_metadata_carries_durationMs_and_promptIndex()
RED:     test_sharegpt_usage_present_when_available()
RED:     test_sharegpt_skips_malformed_message_entries()  — EC-F: malformed SDKMessage shape in messages array → skip without throw
GREEN:   Implement helper.
REFACTOR: None expected.
VERIFY:  pnpm vitest run tests/trajectory-helpers.test.ts
```

#### Acceptance Criteria

- [ ] 7 RED tests GREEN
- [ ] File ≤150 LoC
- [ ] Pure function — no I/O, no state
- [ ] 100% line coverage

#### DoD

- [ ] CHANGELOG entry

---

## Phase 4: Wire `Agent.batch` static method + exports

### T4.1 — Add `Agent.batch` to façade + re-export

#### Objective

Add `static async batch(prompts, options)` to the `Agent` class in `agent.ts`. Wire through `Agent.create` as the injected `create` dep. Re-export `BatchItem`/`BatchOptions`/`BatchResult`/`BatchProgress` from `index.ts`.

#### Evidence

- Existing static methods (`Agent.prompt`, `Agent.generateObject`, `Agent.streamObject`, `Agent.runUntil`) wire via the same pattern.

#### Files to edit

```
packages/sdk/src/agent.ts — add static batch method
packages/sdk/src/index.ts — re-export public batch surface + trajectory helper
packages/sdk/src/types/index.ts — re-export batch + trajectory types
```

#### Deep file dependency analysis

- `agent.ts` — adds 1 static method, ~10 LoC. Already imports `Agent` for the deps closure.
- `index.ts` — adds 2 public re-exports (batch helper + trajectory helper).
- `types/index.ts` — adds 2 type re-exports.

#### Deep Dives

**`agent.ts` addition:**

```typescript
/**
 * Run N prompts in parallel with bounded concurrency (ADR D134-D140).
 * Each prompt gets a fresh agent (`Agent.create` → `send` → `wait` → `dispose`).
 * Failures are isolated per-prompt; the batch never aborts on a single
 * failure. Pool inheritance is automatic when `apiKeys` is configured.
 *
 * @public
 */
static async batch(
  prompts: ReadonlyArray<string | import("./types/batch.js").BatchItem>,
  options: import("./types/batch.js").BatchOptions,
): Promise<import("./types/batch.js").BatchResult[]> {
  const { batchImpl } = await import("./batch.js");
  return batchImpl(prompts, options, { create: (opts) => Agent.create(opts) });
}
```

**`index.ts` re-exports:**

```typescript
export { toShareGptTrajectory } from "./trajectory-helpers.js";
```

**`types/index.ts` additions:**

```typescript
export type * from "./batch.js";
export type * from "./trajectory.js";
```

**Invariants:**
- `Agent.batch` is purely additive — does not modify any existing static method.
- Dynamic import of `batch.ts` keeps cold-start light (batch only loaded when invoked).
- Same pattern as `streamObject` / `generateObject` re: dynamic import.

#### Tasks

1. Add `static async batch(...)` to `Agent` class in `agent.ts`.
2. Re-export `toShareGptTrajectory` from `index.ts`.
3. Re-export `BatchItem`/`BatchOptions`/`BatchResult`/`BatchProgress` from `types/index.ts`.
4. Re-export `ShareGptMessage`/`ShareGptTrajectory` from `types/index.ts`.

#### TDD

```
RED:     test_agent_batch_static_method_exists_on_facade()
RED:     test_agent_batch_returns_results_in_input_order()
RED:     test_agent_batch_re_exports_visible_from_index()
GREEN:   Wire the static method + re-exports.
REFACTOR: None expected.
VERIFY:  pnpm vitest run tests/agent-batch.test.ts
```

#### Acceptance Criteria

- [ ] 3 RED tests GREEN
- [ ] Existing `tests/internal/llm/router.test.ts` etc. still pass — zero regression
- [ ] G6 dep-cruise: 0 new cycles
- [ ] G8: agent.ts stays ≤400 LoC (currently 482 — already-amortized via biome-ignore in places; new addition is 12 LoC of method body and may require small refactor)

#### DoD

- [ ] `pnpm validate` GREEN
- [ ] CHANGELOG entry
- [ ] `docs.md` updated with `Agent.batch` section + ShareGPT export

---

## Phase 5: Adversarial tests + lint gate + integration

### T5.1 — Property tests for semaphore + batch ordering

#### Objective

Adversarial property tests via `fast-check`. ≥200 runs per property — covers semaphore ordering, batch result-order preservation under random concurrency, and rate-limit interaction with credential pool.

#### Evidence

- Established pattern in `tests/internal/judge/parse-verdict.property.test.ts` (T5.1 in background-work block).
- `tests/internal/llm/credential-pool.property.test.ts` (T5.1 in credential-pools).

#### Files to edit

```
packages/sdk/tests/internal/runtime/async-semaphore.property.test.ts (NEW)
packages/sdk/tests/batch.property.test.ts (NEW)
```

#### Deep Dives

**Properties to verify:**

1. **Semaphore FIFO under randomized acquire/release timing**: N permits, M ≥ N acquires; first N grant immediately, remaining M-N wait in queue and grant in FIFO order.
2. **Batch result order preservation**: shuffled prompts of varying simulated durations still produce results in input order.
3. **Concurrency limit holds**: at any moment during the batch, `semaphore.inFlight() <= concurrency`.
4. **No prompt loss**: `results.length === prompts.length` regardless of random failures/successes.
5. **Filter discards exactly the prompts where filter returns false**.

#### Tasks

1. Write 5 properties × 200 runs each.

#### TDD

```
RED → GREEN: properties act as both the test and the spec.
VERIFY: pnpm vitest run tests/internal/runtime/async-semaphore.property.test.ts tests/batch.property.test.ts
```

#### Acceptance Criteria

- [ ] 5 properties × 200 runs each → 1000+ randomized assertions
- [ ] All GREEN, seed-stable, zero flakes

#### DoD

- [ ] CHANGELOG entry

---

### T5.2 — Integration test: `Agent.batch` with credential pool + fixture mode

#### Objective

End-to-end test: run 5 prompts via `Agent.batch` with fixture mode + 2-key credential pool. Verify all 5 complete, results in input order, pool entries used.

#### Files to edit

```
packages/sdk/tests/integration/batch-with-pool.test.ts (NEW)
```

#### Deep Dives

```typescript
it("Agent.batch with credential pool — 5 prompts complete, results in input order", async () => {
  const results = await Agent.batch(
    ["A", "B", "C", "D", "E"],
    {
      apiKey: "theo_test_pool",
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd: tmpdir },
      concurrency: 2,
      providers: { routes: [], apiKeys: { openai: ["theo_test_k1", "theo_test_k2"] } },
    },
  );
  expect(results.length).toBe(5);
  expect(results.map((r) => r.prompt)).toEqual(["A", "B", "C", "D", "E"]);
  expect(results.every((r) => r.ok)).toBe(true);
});
```

#### TDD

```
RED:     test_batch_with_pool_5_prompts_input_order()
RED:     test_batch_with_pool_some_failures_isolated()
RED:     test_batch_progress_callback_observes_n_completions()
GREEN:   Implement integration scenarios.
VERIFY:  pnpm vitest run tests/integration/batch-with-pool.test.ts
```

#### Acceptance Criteria

- [ ] 3 RED tests GREEN
- [ ] Pool entries observed in `requestCount` after batch completes

#### DoD

- [ ] CHANGELOG entry

---

## Phase 6: Docs + ADRs + CHANGELOG + roadmap

### T6.1 — Write 7 ADRs (D134-D140)

#### Files to edit

```
.claude/knowledge-base/adrs/D134-batch-static-method.md (NEW)
.claude/knowledge-base/adrs/D135-async-semaphore-in-house.md (NEW)
.claude/knowledge-base/adrs/D136-batch-default-concurrency-4.md (NEW)
.claude/knowledge-base/adrs/D137-batch-failures-isolated.md (NEW)
.claude/knowledge-base/adrs/D138-batch-fresh-agent-per-prompt.md (NEW)
.claude/knowledge-base/adrs/D139-sharegpt-opt-in-helper.md (NEW)
.claude/knowledge-base/adrs/D140-batch-abort-signal-pending-only.md (NEW)
```

#### DoD

- [ ] 7 ADRs with Context/Decision/Consequences (≤80 lines each)

### T6.2 — Public docs + CHANGELOG + CLAUDE.md roadmap

#### Files to edit

```
packages/sdk/docs.md — add "Batch Processing" section + example snippets
packages/sdk/CHANGELOG.md — Unreleased entry under v1.11 batch-processing
CLAUDE.md — Decided ADRs table D134-D140; SDK Roadmap row #2 → ✅ DONE
```

#### DoD

- [ ] `docs.md` documents `Agent.batch` API with 3 examples (simple, streaming, abort)
- [ ] CHANGELOG complete
- [ ] CLAUDE.md ADR table extended (D134-D140)
- [ ] CLAUDE.md SDK Roadmap row 2 marked done

---

## Phase 7: Dogfood QA (MANDATORY)

### T7.1 — Telegram-pro `/batch` probe

#### Objective

Add `/batch <topic>` command to telegram-pro that fans out 3 mini-prompts (e.g., "haiku about X", "joke about X", "fact about X") via `Agent.batch(concurrency: 3)` and replies with the 3 results + timing.

#### Files to edit

```
examples/telegram-pro/src/index.ts — add /batch command
.claude/skills/telegram-pro-dogfood/lib/dogfood.mjs — add scenario #32
```

#### Deep Dives

```typescript
bot.command("batch", async (ctx) => {
  const topic = (ctx.match ?? "robots").toString().trim();
  const { Agent } = await import("@usetheo/sdk");
  const t0 = Date.now();
  const results = await Agent.batch(
    [
      `Write a one-line haiku about ${topic}`,
      `Tell a one-line joke about ${topic}`,
      `Share one surprising fact about ${topic}`,
    ],
    {
      apiKey: API_KEY,
      local: { cwd: CWD },
      model: { id: "openai/gpt-4o-mini" },
      concurrency: 3,
    },
  );
  const dt = Date.now() - t0;
  const lines = results.map((r, i) =>
    r.ok ? `${i + 1}. ${r.result.text}` : `${i + 1}. ❌ ${r.error.message.slice(0, 60)}`,
  );
  await ctx.reply(`Batch (${dt}ms, 3 prompts parallel via Agent.batch):\n${lines.join("\n")}`);
});
```

#### Dogfood scenario:

```javascript
{
  text: "/batch jazz",
  expect: [/Batch \(\d+ms, 3 prompts parallel via Agent\.batch\)/i, /1\.|2\.|3\./],
  waitMs: 60000,
  retryOnError: true,
}
```

#### Acceptance Criteria

- [ ] `/batch <topic>` returns 3 lines, observable parallel execution
- [ ] Dogfood passes 32/32 (was 31/31 + new scenario)

### T7.2 — Full validate + push

#### Execution

```bash
pnpm -w run validate         # all hard gates
pnpm quality:report          # coverage + audit
cd examples/telegram-pro && pnpm tsx --env-file=.env src/index.ts &
node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs --user-id 7528967933
```

#### Acceptance Criteria

- [ ] `pnpm validate` exit 0
- [ ] Coverage ≥80% lines (S1)
- [ ] `pnpm audit` 0 high-severity (S4)
- [ ] Dogfood 32/32 PASS
- [ ] CI green on the push to main

---

## Documented edge cases (accepted risks)

Risks intentionally not coded around — self-correcting, by-design, or fix costs more than impact.

- **EC-G (Semaphore release responsibility)**: Caller must always call the returned release function (typically in a `finally`). `batchImpl` does this correctly; documented in `createSemaphore` JSDoc for external use of the primitive.
- **EC-H (Per-prompt agent creation cost ~5ms × N)**: Already accepted in ADR D138. Isolation parity with Hermes is worth the overhead. At typical 100-1000 prompt scale, total overhead is 500ms-5s — negligible vs LLM latency.
- **EC-I (`BatchItem.metadata` passed by reference)**: We don't `structuredClone` to avoid (a) cost on large metadata + (b) circular ref throws. Caller responsibility: do not mutate `metadata` while batch is in-flight. Documented in JSDoc of `BatchItem.metadata`.
- **EC-J (AbortSignal doesn't stop in-flight HTTP)**: Standard Node semantics + same constraint as ADRs D2 (FallbackLlmClient) + D117 (runUntil). For hard timeout, caller uses `Promise.race(Agent.batch(...), sleep(ms))`. Documented in ADR D140.

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Parallel execution with bounded concurrency | T1.1, T2.1 | AsyncSemaphore + batchImpl |
| 2 | Failure isolation per prompt | T2.1 | Try/catch per prompt → `BatchResult.ok: false` |
| 3 | Result order preserved | T2.1 | `results[index]` assignment by input index |
| 4 | Streaming output via callback | T2.1 | `onResult(result)` invoked per completion |
| 5 | Progress observability | T2.1 | `onProgress(stats)` after each result |
| 6 | AbortSignal support | T2.1 | Aborted flag — pending get AbortError, in-flight continue |
| 7 | ShareGPT trajectory export | T3.1 | `toShareGptTrajectory(result)` opt-in helper |
| 8 | Backward compat (existing static methods unchanged) | T4.1 | Purely additive `Agent.batch` |
| 9 | Type-safe discriminated union | T2.1 | `BatchResult = { ok: true ... } \| { ok: false ... }` |
| 10 | Credential pool inheritance | T2.1 (implicit) | Pool lives at provider level via D131 AsyncLocalStorage |
| 11 | No new dep | T1.1 | In-house AsyncSemaphore (D135) |
| 12 | Per-prompt metadata roundtrip | T2.1 | `BatchItem.metadata → BatchResult.metadata` |
| 13 | Runtime metric proof | T7.1 | `/batch` probe shows N parallel execs in real LLM call |
| 14 | EC-A: pool sharing across concurrent batch agents | T2.1 (steps 7-9) | `buildPoolsFromApiKeys` + `withCredentialPool` ALS wrap + `router.ts:buildClient` ALS consult |
| 15 | EC-B: slow onResult observable | T2.1 | TDD test asserts parallel execution + delayed total |
| 16 | EC-C: pre-aborted signal | T2.1 | TDD test before-batch abort returns all AbortError |
| 17 | EC-D: signal.reason propagated | T2.1 | TDD test preserves caller's reason |
| 18 | EC-E: race abort vs mid-acquire | T2.1 | TDD test |
| 19 | EC-F: malformed messages in ShareGPT | T3.1 | Defensive `mapSdkMessage` + TDD test |
| 20 | EC-G/H/I/J: documented accepted risks | (docs) | JSDoc + ADR notes |

**Coverage: 20/20 (100%)**

---

## Global Definition of Done

- [ ] All 7 phases completed
- [ ] All tests passing (977 → ~1010 expected including ~30 new tests + 1000+ property runs)
- [ ] Zero Biome warnings (G2)
- [ ] Zero TypeScript errors (G1)
- [ ] G5 (knip): no unused exports introduced
- [ ] G6 (dep-cruise): 0 new cycles
- [ ] G7 (layered arch): respected
- [ ] G8 (LoC ≤400): all new files compliant
- [ ] G9 (complexity ≤10): biome-ignore with justification if exceeded
- [ ] G10 (duplication): 0 clones
- [ ] G11 (docs.md sync): `Agent.batch` + `toShareGptTrajectory` documented
- [ ] S1 (coverage): ≥80% lines maintained
- [ ] S3 (no TODO/FIXME): clean
- [ ] S4 (audit): 0 high-severity
- [ ] Backward compatibility preserved (existing `Agent.create`/`prompt`/`streamObject`/`generateObject`/`runUntil` unchanged)
- [ ] **Dogfood telegram-pro PASS** — 32/32 scenarios, including `/batch <topic>` with visible 3-result parallel reply
- [ ] **Runtime-metric proof** — at least one log line confirming N parallel agents ran (e.g., timestamps showing 3 sends within 200ms of each other)

## Final Phase: Dogfood QA (MANDATORY)

### Execution

```bash
cd examples/telegram-pro && pnpm tsx --env-file=.env src/index.ts &
sleep 10
node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs --user-id 7528967933
```

### Acceptance Criteria

- [ ] Health score ≥70/100 (telegram-pro dogfood currently passes 31/31 = 100%)
- [ ] Zero CRITICAL issues introduced
- [ ] Zero HIGH issues in `/batch` or `Agent.batch` paths
- [ ] `/batch` produces 3 parallel results in <30s with timestamps observable

### If Dogfood Fails

1. Identify which failures are caused by this plan vs pre-existing
2. Fix all plan-caused failures
3. Re-run dogfood

---

> **Edge-Case Review status:** COMPLETE (2026-05-20). 10 edge cases incorporated in v1.1 (1 MUST FIX EC-A — pool sharing fix, 5 SHOULD TEST EC-B/C/D/E/F, 4 DOCUMENT EC-G/H/I/J). Coverage matrix expanded 13 → 20 items (100%).
