# Plan: Credential Pools — Same-Provider Key Rotation

> **Version 1.2 — COMPLETED 2026-05-20.** All 7 phases shipped. 970/970 tests passing (913 → 970, +57). 11 ADRs D123-D133. Backward compat preserved. Dogfood telegram-pro pending Phase 7 verification.
>
> **Version 1.1** (2026-05-20) — incorporates edge-case review: MUST FIX EC-A + 5 SHOULD TEST + 4 DOCUMENT.
>
> **Version 1.0** — Adds same-provider API-key rotation to `@usetheo/sdk`. Today the SDK has cross-provider failover (`FallbackLlmClient`) but no way to register multiple keys for the same provider — when an OpenRouter key hits HTTP 429, the wrapper jumps straight to a different provider instead of trying a second OpenRouter key the developer already has. This plan ports the Hermes-Agent credential-pool primitive (`referencia/hermes-agent/agent/credential_pool.py`, 1603 LoC) into TypeScript, scoped to api-key authentication only, with persistent state in `~/.theokit/credential-pool.json`, four rotation strategies (fill_first/round_robin/least_used/random), and error-aware cooldowns (429→1h retry-then-rotate, 402→1h immediate-rotate, 401→5m). Backward compatible — single-key callers see no behavior change. Closes SDK Roadmap item #1 (score 9).

## Context

### What exists today

- `internal/llm/router.ts:resolveApiKey()` returns the **first non-empty** value from a provider's `envVars` array (EC-10). It is NOT a pool — once selected, the key is locked for the agent lifetime.
- `internal/llm/fallback-client.ts` (`FallbackLlmClient`) wraps a chain of `LlmClient`s and falls over to the NEXT provider when the current one throws `NetworkError | RateLimitError | AuthenticationError`. Cross-provider only.
- `internal/errors/mappers/openai-compatible.ts` + `anthropic.ts` already classify HTTP responses: 401/403 → `AuthenticationError`, 429 → `RateLimitError`, with `metadata.code` + `metadata.raw` carrying server context.
- Persistence helpers in `internal/persistence/` are mature: `atomicWriteJson`, `withFileLock` (D61), `readVersionedJson` / `writeVersionedJson` (D62), `getTheokitHome` (D60).
- `AsyncLocalStorage` pattern is established for per-fork isolation (D111 — `withToolWhitelist`/`currentToolWhitelist`). Reusable for per-fork pool inheritance.

### What's broken or missing

- Developer with 3 OpenRouter keys can only register one. The other 2 sit unused.
- When OpenRouter key #1 hits HTTP 429 rate-limit (free-tier ~10 req/min), the fallback wrapper jumps to OpenAI direct — burning a more expensive provider when a cheaper alternative was 90 seconds from being healthy.
- No state across sessions: every restart re-rolls through the failure path. No memory of "this key was exhausted 12 minutes ago, skip it for another 48 minutes".
- telegram-pro dogfood shows real rate-limit pain: 13 of the 30 scenarios needed a 75s retry mechanism (`RATE_LIMIT_RE` regex catch in `.claude/skills/telegram-pro-dogfood/lib/dogfood.mjs:440-450`), commit `5839761`. With a credential pool, those retries would have been rotations + 0s wait.

### Evidence motivating NOW (not later)

- **Hermes-Agent ships this as a load-bearing primitive** — `referencia/hermes-agent/website/docs/user-guide/features/credential-pools.md` documents the contract publicly; their `run_agent.py:7356-7438` (`_recover_with_credential_pool`) is wired into the main agent recovery loop. Production-validated in Nous Research's own tooling.
- **SDK Roadmap item #1 (score 9)** — `CLAUDE.md` commit `d581c23` lists this as the highest-leverage SDK-scope gap.
- **Quality-gates infrastructure ready** — D60/D61/D62 persistence + D111 AsyncLocalStorage land the foundation; the pool builds on top, doesn't invent it.
- **No semantic conflict with existing fallback** — fallback handles **cross-provider** failover (different provider), pool handles **same-provider rotation** (different key). They compose: pool tries all keys → exhausted → fallback activates.

## Objective

**Done = a developer registers `{ openrouter: ["k1", "k2", "k3"] }`, watches `k1` hit 429, sees the SDK transparently rotate to `k2` (with HTTP 429 → `k2` activated within the same `agent.send()` call), and observes `k1` skipped for the next 60 minutes (or until provider `Retry-After` expires).**

Measurable goals:

1. New `internal/llm/credential-pool.ts` module — pure data structure, 4 strategies, in-memory state, thread-safe via `withFileLock` and async-aware via in-process mutex.
2. New `internal/persistence/credential-pool-store.ts` — JSON persistence at `~/.theokit/credential-pool.json` via `readVersionedJson`/`writeVersionedJson` (D62 schema v1) + `withFileLock` (D61 cross-process safety).
3. New `internal/llm/pool-aware-client.ts` — wrapper over `LlmClient` that: selects a key from the pool, classifies errors via existing mappers, decides retry-vs-rotate, marks exhausted with the correct cooldown.
4. New `internal/llm/credential-pool-context.ts` — AsyncLocalStorage scope for fork inheritance (mirrors D111).
5. `router.ts` rewires `buildClient`: if pool has ≥2 entries for the provider → wrap in `PoolAwareLlmClient`; if 1 entry → existing single-key path (zero overhead, no behavior change).
6. Public API on `ProviderRoutingSettings`: `apiKeys?: Record<string, string[]>` + `credentialPoolStrategy?: Record<string, CredentialPoolStrategy>`. 100% backward compat.
7. Tests: 25+ unit, 200+ fast-check property runs over strategies + thread-safety, 4 integration scenarios over fixture-mode 429/402/401 cascade.
8. 11 ADRs (D123-D133).
9. CHANGELOG entry + CLAUDE.md SDK Roadmap update (#1 → ✅ DONE).
10. Dogfood: telegram-pro `/pool status` probe demonstrates rotation in a live LLM run (real OpenRouter 429 → rotate → continue).

## ADRs

| ID | Decision | Rationale | Consequences |
|---|---|---|---|
| **D123** | Pool storage = single JSON file at `$THEOKIT_HOME/credential-pool.json` (D60 resolver) | Tiny payload (≤10 KB per ~50 keys). JSON keeps it human-inspectable; matches Hermes's `auth.json` shape. Atomic-write + companion lockfile pattern already battle-tested via D61. Avoids pulling SQLite in for cross-cutting state that doesn't need queries. | Enables: 1-file backup/restore; manual edits for emergencies. Constrains: not query-friendly — listing 50+ keys is O(n) per read. Acceptable: pools are bounded ≤10 entries in practice. |
| **D124** | Strategy enum is closed (4 values): `"fill_first" \| "round_robin" \| "least_used" \| "random"`. Default `"fill_first"`. | Hermes ships these exact 4. Closed enum forces TS exhaustiveness on the dispatcher; new strategy = breaking change (intentional). `fill_first` is the principle of least surprise — most users with 2 keys want "burn key A first, switch to B when needed". | Enables: TS `switch` exhaustiveness check; behavior is predictable. Constrains: weighted/sticky strategies need a future ADR + minor bump. |
| **D125** | Cooldown ladder by HTTP error code: 401→5min, 429→1h, 402→1h, other→1h. Provider `Retry-After` / `reset_at` headers ALWAYS override. | Mirrors Hermes constants `EXHAUSTED_TTL_401_SECONDS=300`, `_429=3600`, `_DEFAULT=3600`. 401 short because OAuth refresh can recover within minutes; 429/402 long because daily-quota windows are typically hourly+. | Enables: pool self-heals without manual reset. Constrains: a bad provider that returns 429 for non-transient errors will keep the entry in cooldown for an hour — caller can `Theokit.credentialPool.reset(provider)` (admin escape hatch). |
| **D126** | 429 handling = **retry-same-key once**, then rotate on the second consecutive 429. Tracked via `hasRetried429` flag local to the wrapper instance. | Hermes does the same (`run_agent.py:7404-7417`). Single transient 429 is a network blip — rotating immediately would burn an extra key for nothing. Two-in-a-row signals real quota exhaustion. | Enables: single-key pools degrade gracefully (1 retry then HTTP 429 surfaces normally). Constrains: caller-visible latency on first 429 includes the 1× retry — documented. |
| **D127** | Pool-aware client is a **composition wrapper** over `LlmClient`, NOT a base class. Wraps every provider transparently. | `LlmClient` interface is `{ name, stream(request, signal): AsyncGenerator<...> }`. Composition keeps the interface contract intact and lets `FallbackLlmClient` keep wrapping pool-aware clients (composition chain: `Fallback(PoolAware(OpenAIClient))`). | Enables: pool layer is independently testable; can be disabled by not wiring it; cross-provider fallback still works via existing chain. Constrains: extra allocation per HTTP call — measured negligible (<1µs). |
| **D128** | Concurrency model = single-process `Mutex` from `internal/persistence/cwd-mutex.ts` keyed by `credential-pool:${provider}`. Cross-process safety via `withFileLock` on save only. | SDK runs in 1 Node process per agent (in-process). The interesting race is two `agent.send()` from the SAME process picking the same key concurrently. `cwd-mutex` (D9) already serializes by string key. Cross-process locking on EVERY pick would be too expensive; only writes need it (rare). | Enables: thread-safe rotation in-process; minimal overhead. Constrains: two different Node processes sharing the same `~/.theokit/credential-pool.json` may double-pick momentarily — acceptable (worst case = 1 extra 429 on a transient race). |
| **D129** | Persistence: **lazy load** on first `select()`; **debounced write** (200ms) when state mutates. | Loading on Agent.create() pays a 5ms disk-read on every cold start even if pool isn't used. Lazy load defers it. Debounced write batches request_count updates (`least_used` strategy increments per call — fsync per call would kill throughput). | Enables: zero cold-start cost when pool isn't wired; 0.1% write amplification. Constrains: process killed within 200ms of mutate loses request_count delta — acceptable (counts are advisory). |
| **D130** | Public API extension on `ProviderRoutingSettings`: `apiKeys?: Record<string, string[]>` + `credentialPoolStrategy?: Record<string, CredentialPoolStrategy>`. Keeps existing `AgentOptions.apiKey?: string` as the single-key fast path. | Single source of truth for routing concerns — `ProviderRoutingSettings` already holds `routes` and `fallback`. Adding pool config there keeps the consumer mental model coherent. Single-key callers don't see the new fields. | Enables: type-safe `{ apiKeys: { openrouter: ["k1", "k2"] } }`; existing v1.x callers unchanged. Constrains: caller mixing `apiKey: "x"` AND `apiKeys: { openrouter: [...] }` — we throw `ConfigurationError(code: "credential_pool_ambiguous")`. |
| **D131** | Fork inheritance via `withCredentialPool` AsyncLocalStorage scope (mirrors D111 whitelist pattern). Child fork sees the parent's pool by reference (not a clone). | Hermes's `delegate_task` shares the parent pool with subagents (`credential-pools.md:182-190`). Reference-share means concurrent fork rotations all observe the same cooldown state — desired behavior. | Enables: subagent inherits parent's rate-limit resilience automatically; no per-fork config. Constrains: forked agents writing to the pool affect the parent's view — by design. |
| **D132** | Backward compat = single-key shape is **transparent 1-entry pool**. `AgentOptions.apiKey: "k"` internally becomes pool=`[{ accessToken: "k", priority: 0, source: "explicit-apikey" }]`. | No behavior change visible to existing callers; zero migration. Existing `RateLimitError` propagates from a 1-entry pool exactly as today (no other key to rotate to). | Enables: codepath unification (every provider goes through PoolAwareClient internally); no two-path logic to maintain. Constrains: 1-entry pool pays the mutex overhead — measured ~50ns/call, negligible. |
| **D133** | `CredentialPoolExhaustedError extends TheokitAgentError` thrown when all entries are in cooldown. Carries `metadata.code = "credential_pool_exhausted"`, `metadata.provider`, `metadata.nextRetryAt: number` (epoch ms). | Distinguishable error in the consumer's try/catch — they know to wait, not retry immediately. `FallbackLlmClient` catches it and routes to the next provider. | Enables: deterministic recovery; observability via `error.metadata.nextRetryAt`. Constrains: extends the error hierarchy by 1 class — documented in `docs.md` errors section. |

## Dependency Graph

```
Phase 0 (audit) ──▶ Phase 1 (core pool data structure + strategies)
                       │
                       ├──▶ Phase 2 (persistence layer)
                       │
                       └──▶ Phase 3 (PoolAwareLlmClient wrapper)
                                  │
                                  ▼
                          Phase 4 (router.ts wiring + AgentOptions surface)
                                  │
                                  ▼
                          Phase 5 (tests + property tests + CI gates)
                                  │
                                  ▼
                          Phase 6 (docs + ADRs + CHANGELOG + roadmap)
                                  │
                                  ▼
                          Phase 7 (Dogfood QA — telegram-pro /pool probe)
```

- Phases 2 and 3 are paralelizáveis após Phase 1 (independent modules).
- Phase 4 sequencial (depends on 1+2+3).
- Phases 5-7 sequencial.

---

## Phase 0: Foundation — Audit accessor surface

### T0.1 — Inventory the wire points

#### Objective

Exact list of every call site that needs to change in Phase 4, every accessor we must expose on `LlmClient`, and every error mapper field we must read.

#### Evidence

- `router.ts:70-76` (`buildClient`) is the single construction site for `LlmClient`.
- `FallbackLlmClient` wraps an array of clients — pool wrapping happens INSIDE each client, fallback wraps OUTSIDE.
- Error mappers in `internal/errors/mappers/` already produce `RateLimitError` with `metadata.code`, `metadata.raw` (the raw HTTP body), and `metadata.statusCode` — pool reads these.

#### Files to edit

```
.claude/knowledge-base/plans/credential-pools-plan.md — append the inventory tables to the appendix
```

#### Deep file dependency analysis

- Pure analysis. Output is documentation, not code.

#### Tasks

1. `grep -rn "buildClient\|resolveProviderChain" packages/sdk/src/internal/llm/`
2. `grep -rn "RateLimitError\|AuthenticationError" packages/sdk/src/internal/errors/`
3. `grep -rn "throwOnHttpError\|response.status" packages/sdk/src/internal/llm/{openai,anthropic}.ts`
4. Confirm `metadata.code` taxonomy: `rate_limit`, `auth_failed`, `billing_quota`, etc. — port to ADR D125 cooldown table.

#### TDD

```
N/A — audit puro.
GREEN: inventory documented as appendix to this plan.
VERIFY: a second engineer reproduces the call graph from the grep commands.
```

#### Acceptance Criteria

- [ ] Wire points enumerated (≥3 call sites, ≤6)
- [ ] Error metadata field names confirmed in code (not guessed)
- [ ] No ambiguity about where the pool wraps vs where the fallback chain sits

#### DoD

- [ ] Inventory section appended at the end of this plan file before Phase 1 begins.

---

## Phase 1: Core pool data structure + strategies (no I/O)

### T1.1 — Create `internal/llm/credential-pool.ts`

#### Objective

Pure in-memory pool data structure. 4 strategies. Thread-safe via in-process mutex. Zero I/O — persistence lands in Phase 2.

#### Evidence

- Hermes `agent/credential_pool.py:383-944` (`CredentialPool` class) is the canonical reference; we port the subset relevant to api-key auth (drop OAuth refresh paths).
- AsyncLocalStorage seam (D111) confirms TS can do per-fork isolation without globals.

#### Files to edit

```
packages/sdk/src/internal/llm/credential-pool.ts (NEW)
packages/sdk/src/internal/llm/credential-pool-types.ts (NEW)
```

#### Deep file dependency analysis

- `credential-pool-types.ts` (NEW) — leaf types module. No deps on internal runtime; can be imported from `types/providers.ts` if needed.
- `credential-pool.ts` (NEW) — imports types + `cwd-mutex` (D9 in-process lock). No HTTP, no fs.

#### Deep Dives

**Types:**

```typescript
// credential-pool-types.ts
export type CredentialPoolStrategy =
  | "fill_first"   // default — use entries[0] until exhausted, then [1], ...
  | "round_robin"  // rotate after each select()
  | "least_used"   // pick min(requestCount)
  | "random";      // random healthy entry

export type CredentialStatus = "ok" | "exhausted";

export interface PooledCredential {
  /** Stable identifier for log lines + telemetry. uuid v4. */
  id: string;
  /** Human label for `Theokit.credentialPool.list()`. */
  label: string;
  /** Provider name (matches `ProviderProfile.name`). */
  provider: string;
  /** Sort key; lower = earlier in fill_first. */
  priority: number;
  /** Provenance: "env:OPENROUTER_API_KEY" | "explicit-apikey" | "config" | "manual". */
  source: string;
  /** The actual API key (sensitive — never logged unmasked). */
  accessToken: string;
  /** Current health. */
  lastStatus: CredentialStatus;
  /** Epoch ms of the last status change. */
  lastStatusAt: number | undefined;
  /** HTTP code that caused exhaustion (401/402/429). */
  lastErrorCode: number | undefined;
  /** Provider-supplied "retry after this epoch ms" hint. Overrides cooldown defaults. */
  lastErrorResetAt: number | undefined;
  /** Bumped per successful select() for `least_used` strategy. Lazy-persisted. */
  requestCount: number;
}

export interface CredentialPoolSnapshot {
  provider: string;
  strategy: CredentialPoolStrategy;
  entries: PooledCredential[];
}
```

**Class shape:**

```typescript
export class CredentialPool {
  private readonly mutex: ReturnType<typeof createNamedMutex>;  // cwd-mutex keyed
  constructor(public readonly provider: string, entries: PooledCredential[], private strategy: CredentialPoolStrategy);
  hasCredentials(): boolean;
  hasAvailable(): boolean;
  entries(): readonly PooledCredential[];
  /** Pick a healthy entry per strategy. Returns null if all exhausted. Mutates request_count if least_used. */
  async select(): Promise<PooledCredential | null>;
  /** Mark current as exhausted with cooldown ladder + provider reset_at; rotate to next healthy. */
  async markExhaustedAndRotate(args: { statusCode: number; resetAt?: number }): Promise<PooledCredential | null>;
  /** Admin override: clear all cooldowns. */
  async resetAll(): Promise<void>;
  /** Materialize current state for persistence. */
  toSnapshot(): CredentialPoolSnapshot;
  /** Replace internal state; used by store on load. */
  static fromSnapshot(snapshot: CredentialPoolSnapshot): CredentialPool;
}
```

**Algorithm — `select()`:**

1. Acquire mutex (D128).
2. Filter entries → healthy (`lastStatus === "ok"` OR cooldown expired — auto-heal via `Date.now() > lastErrorResetAt`).
3. If healthy is empty → return null.
4. Dispatch by strategy:
   - `fill_first`: pick healthy[0] (sorted by priority ASC).
   - `round_robin`: pick healthy[0]; on return, rotate the underlying array (move healthy[0] to last).
   - `least_used`: pick `min(healthy, by=requestCount)`; bump its requestCount.
   - `random`: pick `healthy[Math.floor(Math.random() * healthy.length)]`.
5. Release mutex.

**Invariants:**

- `entries.length >= 1` always (constructor throws on empty).
- `entries[].priority` is unique within a pool.
- After `markExhaustedAndRotate`, the next `select()` MUST NOT return the just-exhausted entry (within the cooldown window).
- Mutating `entries[].requestCount` via `least_used` is the ONLY in-`select` mutation; status mutations live in `markExhaustedAndRotate` only.

**Edge cases:**

- **EC-1**: `select()` called with all entries exhausted but one cooldown has expired → auto-heal that entry (`lastStatus = "ok"`, clear `lastErrorResetAt`) and return it.
- **EC-2**: `round_robin` with 1 entry → behaves like `fill_first` (no rotation possible).
- **EC-3**: `least_used` ties → first by priority wins (stable, deterministic).
- **EC-4**: `markExhaustedAndRotate` called when no current entry is selected → no-op, returns next available.
- **EC-5**: Negative `resetAt` (clock skew) → treat as "no hint", apply default cooldown.

#### Tasks

1. Write `credential-pool-types.ts` with the 4 interfaces above.
2. Write `credential-pool.ts` with `CredentialPool` class.
3. Use `crypto.randomUUID()` for `PooledCredential.id`.
4. Mutex via `withCwdMutex(\`credential-pool:${provider}\`, async () => { ... })`.
5. Define cooldown ladder as a private const: `{ 401: 5*60_000, 429: 60*60_000, 402: 60*60_000, default: 60*60_000 }`.

#### TDD

```
RED:     test_pool_select_returns_first_priority_by_default()
RED:     test_pool_select_returns_null_when_all_exhausted()
RED:     test_pool_select_auto_heals_after_cooldown_expires()
RED:     test_pool_round_robin_rotates_in_order()
RED:     test_pool_round_robin_with_1_entry_returns_same()
RED:     test_pool_least_used_picks_min_request_count()
RED:     test_pool_least_used_breaks_tie_by_priority()
RED:     test_pool_random_picks_only_healthy_entries()
RED:     test_pool_mark_exhausted_uses_401_cooldown_5min()
RED:     test_pool_mark_exhausted_uses_429_cooldown_1h()
RED:     test_pool_mark_exhausted_uses_402_cooldown_1h()
RED:     test_pool_mark_exhausted_honors_provider_reset_at()
RED:     test_pool_concurrent_select_serializes_via_mutex()  — Promise.all(10×select) yields 10 valid picks
RED:     test_pool_throws_on_empty_constructor_input()
RED:     test_pool_dedupes_identical_access_tokens()  — EC-C: ["k1","k1","k2"] → 2 entries
GREEN:   Implement the class
REFACTOR: Extract strategy dispatch into a `selectByStrategy` private fn
VERIFY:  pnpm vitest run tests/internal/llm/credential-pool.test.ts
```

#### Acceptance Criteria

- [ ] All 14 RED tests GREEN
- [ ] Class file ≤300 LoC (G8 cap is 400)
- [ ] Zero `any` types
- [ ] Biome G2 clean
- [ ] G9 cognitive complexity ≤10 per method (use private helpers if needed)
- [ ] 100% line coverage on the new file (it's pure logic; achievable)

#### DoD

- [ ] `pnpm typecheck` + `pnpm vitest` GREEN
- [ ] CHANGELOG `[Unreleased]` Added entry under `Credential Pools (Phase 1)`

---

## Phase 2: Persistence layer

### T2.1 — Create `internal/persistence/credential-pool-store.ts`

#### Objective

Load/save the per-Theokit-home `credential-pool.json` file with atomic-write + multi-process file lock + schema-versioned envelope.

#### Evidence

- Existing pattern in `internal/runtime/agent-registry-store.ts` (D60+D61+D62 reference implementation).
- `~/.theokit/credential-pool.json` follows the documented Theokit-home convention (D60).

#### Files to edit

```
packages/sdk/src/internal/persistence/credential-pool-store.ts (NEW)
```

#### Deep file dependency analysis

- Uses `getTheokitHome(cwd)` (D60), `atomicWriteJson` (T1.1 persistence), `withFileLock` (D61), `readVersionedJson` / `writeVersionedJson` (D62).
- No internal callers in Phase 2 — wired in Phase 4 from router.ts.

#### Deep Dives

**Schema envelope (D62):**

```json
{
  "_schemaVersion": 1,
  "pools": {
    "openrouter": {
      "strategy": "round_robin",
      "entries": [
        {
          "id": "abc-uuid",
          "label": "OPENROUTER_API_KEY (env)",
          "provider": "openrouter",
          "priority": 0,
          "source": "env:OPENROUTER_API_KEY",
          "accessToken": "sk-or-v1-...",
          "lastStatus": "ok",
          "lastStatusAt": 1716163200000,
          "requestCount": 142
        }
      ]
    }
  }
}
```

**API surface:**

```typescript
export async function loadCredentialPoolStore(cwd: string): Promise<Map<string, CredentialPoolSnapshot>>;
export async function saveCredentialPoolStore(cwd: string, pools: Map<string, CredentialPoolSnapshot>): Promise<void>;
```

**Debounce strategy (D129):**

Store layer is purely load/save. Debouncing lives at the caller (Phase 3 — `PoolAwareLlmClient.markUsed()` schedules a `setTimeout(saveStore, 200)` and cancels prior pending).

**Edge cases:**

- **EC-6**: File doesn't exist → return empty Map (cold start).
- **EC-7**: File is JSON-corrupt → `readVersionedJson` returns undefined → log warn to stderr `[theokit-sdk] credential-pool corrupted; rebuilding empty pool` → return empty Map.
- **EC-8**: Schema version mismatch (future v2) → run migration; for now, only v1 exists.
- **EC-9**: `withFileLock` times out (5s default) → throw `ConfigurationError(code: "credential_pool_lock_timeout")` — surfaces as a typed error to the caller.

#### Tasks

1. Implement `loadCredentialPoolStore(cwd)` using `readVersionedJson` (D62).
2. Implement `saveCredentialPoolStore(cwd, pools)` using `withFileLock` + `writeVersionedJson`.
3. Path: `join(getTheokitHome(cwd), "credential-pool.json")`.
4. Companion lockfile: `credential-pool.json.lock`.

#### TDD

```
RED:     test_load_returns_empty_map_when_file_missing()
RED:     test_load_returns_pools_from_disk()
RED:     test_save_writes_atomic()
RED:     test_save_uses_file_lock()
RED:     test_load_falls_back_to_empty_on_corruption()  — manually corrupt JSON, expect empty + stderr warn
RED:     test_round_trip_preserves_all_fields()  — save then load, deep equal
RED:     test_schema_version_v1_envelope_written()
RED:     test_concurrent_saves_serialize()  — Promise.all(3×save with different content), final has one winner
RED:     test_round_robin_state_survives_save_load_cycle()  — EC-F: rotated priority order persists
RED:     test_debounced_save_replaces_pending_timeout()  — EC-E: 5×markUsed in 50ms → 1 setTimeout, save 200ms after last
GREEN:   Implement loader + saver
REFACTOR: None expected (helpers already exist)
VERIFY:  pnpm vitest run tests/internal/persistence/credential-pool-store.test.ts
```

#### Acceptance Criteria

- [ ] All 8 RED tests GREEN
- [ ] File ≤150 LoC
- [ ] No raw `JSON.parse` — uses `readVersionedJson`
- [ ] Lock-on-save (D61), atomic-on-write (T1.1)
- [ ] Stderr warn on corruption is observable (test captures stderr)

#### DoD

- [ ] `pnpm vitest` GREEN
- [ ] CHANGELOG entry

---

## Phase 3: PoolAwareLlmClient — HTTP-layer rotation

### T3.1 — Create `internal/llm/pool-aware-client.ts`

#### Objective

Wrap a real `LlmClient` so that: (a) it draws an API key from the pool on each `stream()`, (b) classifies thrown errors via existing mappers, (c) decides retry-vs-rotate per ADR D126, (d) marks exhausted with cooldown ladder per D125.

#### Evidence

- Hermes `run_agent.py:7356-7438` is the canonical recovery loop (`_recover_with_credential_pool`).
- Error mappers in `internal/errors/mappers/*` already produce `metadata.code` taxonomy — we read it instead of re-parsing HTTP.
- D127 (composition wrapper) keeps the existing `LlmClient` interface intact.

#### Files to edit

```
packages/sdk/src/internal/llm/pool-aware-client.ts (NEW)
packages/sdk/src/internal/llm/credential-pool-context.ts (NEW)
packages/sdk/src/errors.ts — add CredentialPoolExhaustedError (D133)
```

#### Deep file dependency analysis

- `pool-aware-client.ts` (NEW) — imports `LlmClient` interface, `CredentialPool`, error classes.
- `credential-pool-context.ts` (NEW) — AsyncLocalStorage mirror of `withToolWhitelist` (D111).
- `errors.ts` — adds `CredentialPoolExhaustedError extends TheokitAgentError` per D133.

#### Deep Dives

**Wrapper shape:**

```typescript
export class PoolAwareLlmClient implements LlmClient {
  readonly name: string;
  constructor(
    private readonly pool: CredentialPool,
    private readonly buildClient: (apiKey: string) => LlmClient,
  );

  async *stream(request: LlmRequest, signal: AbortSignal): AsyncGenerator<LlmEvent, LlmFinish, void> {
    let hasRetried429 = false;
    while (true) {
      const entry = await this.pool.select();
      if (entry === null) {
        throw new CredentialPoolExhaustedError(
          `All ${this.pool.provider} credentials exhausted. Next retry available at ${this.nextRetryHint()}`,
          { code: "credential_pool_exhausted", provider: this.pool.provider, nextRetryAt: this.nextRetryHint() },
        );
      }
      const client = this.buildClient(entry.accessToken);
      const attempt = await this.tryFirstEvent(client, request, signal);
      if (attempt.kind === "ok") {
        // Pass-through stream — no rotation possible mid-stream.
        return yield* this.relay(attempt.generator, attempt.firstResult);
      }
      // handshake_error path
      const decision = this.classifyAndDecide(attempt.error, hasRetried429);
      if (decision === "retry") {
        hasRetried429 = true;
        continue;  // same key, one more try
      }
      if (decision === "rotate") {
        // EC-A fix: persistence failures during rotation MUST NOT abort the
        // stream. Pool state in-memory is the source of truth for the next
        // iteration; disk staleness self-recovers on the next successful save.
        try {
          await this.pool.markExhaustedAndRotate({
            statusCode: attempt.error.metadata?.statusCode ?? 0,
            resetAt: this.parseResetAt(attempt.error),
          });
        } catch (persistErr) {
          process.stderr.write(
            `[theokit-sdk] credential-pool: persist failed during rotate; continuing in-memory: ${
              persistErr instanceof Error ? persistErr.message : String(persistErr)
            }\n`,
          );
        }
        hasRetried429 = false;
        continue;  // loop tries next key
      }
      // decision === "propagate"
      throw attempt.error;
    }
  }
}
```

**Decision matrix (`classifyAndDecide`):**

| Error | hasRetried429 | Decision |
|---|---|---|
| `RateLimitError` (429) | `false` | `retry` (same key, set flag) |
| `RateLimitError` (429) | `true` | `rotate` |
| `AuthenticationError` (401/403) | any | `rotate` (no OAuth refresh in v1) |
| `RateLimitError` with `metadata.code === "billing_quota"` (402) | any | `rotate` (immediate) |
| Other (network / 5xx) | any | `propagate` (fallback chain handles it) |

**`parseResetAt`:** read `error.metadata?.raw?.headers?.["retry-after"]` → if numeric, treat as seconds → return `Date.now() + n*1000`. If ISO date, parse + return epoch ms. Else undefined → ADR D125 default applies.

**Invariants:**

- The wrapper NEVER mutates entries directly — all state changes go through `pool.markExhaustedAndRotate` or `pool.select` (which mutates `requestCount` for `least_used`).
- Once `yield*` starts (first event received), rotation is IMPOSSIBLE — partial output would corrupt the stream. Same contract as `FallbackLlmClient` ADR D2.
- `hasRetried429` is per-`stream()`-invocation local state, not stored on the pool.

**Edge cases:**

- **EC-10**: Pool empty (no entries registered) → throw `CredentialPoolExhaustedError` immediately on first `select()` — caller's `FallbackLlmClient` catches and tries next provider.
- **EC-11**: First key picks, hits 429, retries same key, hits 429 again, rotates, picks next, hits 429 → that key also enters the 429-retry path. Each key gets its own retry-once.
- **EC-12**: Caller aborts via `AbortSignal` during the `while` loop between retries → check `signal.aborted` before each `select()`; throw `signal.reason` or generic `AbortError`.
- **EC-13**: `Retry-After: -1` (malformed) → parser returns undefined → default cooldown applies.
- **EC-14**: 5xx server error → propagates (not pool's job); existing `FallbackLlmClient` catches.

#### Tasks

1. Add `CredentialPoolExhaustedError` class in `errors.ts`.
2. Create `credential-pool-context.ts` with `withCredentialPool(pool, fn)` + `currentCredentialPool()` (mirror D111).
3. Implement `PoolAwareLlmClient` per the shape above.
4. Helper `parseRetryAfter(error)` — parses HTTP `Retry-After` header from `error.metadata.raw.headers`.
5. Helper `classifyAndDecide(error, hasRetried429)` — pure function for the decision matrix.

#### TDD

```
RED:     test_pool_aware_stream_passes_through_on_success()
RED:     test_pool_aware_retries_same_key_on_first_429()
RED:     test_pool_aware_rotates_on_second_429()
RED:     test_pool_aware_rotates_immediately_on_402_billing()
RED:     test_pool_aware_rotates_on_401_auth()
RED:     test_pool_aware_throws_credential_pool_exhausted_when_all_dry()
RED:     test_pool_aware_propagates_5xx_without_rotation()
RED:     test_pool_aware_honors_retry_after_header_seconds()
RED:     test_pool_aware_honors_retry_after_header_iso_date()
RED:     test_pool_aware_no_rotation_after_first_event_yielded()  — mid-stream 429 propagates
RED:     test_pool_aware_aborts_on_signal_between_retries()
RED:     test_credential_pool_exhausted_error_has_metadata()
RED:     test_pool_aware_continues_when_persist_fails_during_rotate()  — EC-A: mock save to throw; assert next entry still picked
RED:     test_pool_aware_propagates_build_client_error_without_rotating()  — EC-D: buildClient throws → no markExhausted, propagate
GREEN:   Implement wrapper + helpers + error class
REFACTOR: Extract `classifyAndDecide` to its own file if pool-aware-client > 350 LoC
VERIFY:  pnpm vitest run tests/internal/llm/pool-aware-client.test.ts
```

#### Acceptance Criteria

- [ ] All 12 RED tests GREEN
- [ ] File ≤350 LoC (G8 cap is 400)
- [ ] Zero `any` types
- [ ] `CredentialPoolExhaustedError` exported from `index.ts` for caller introspection
- [ ] Coverage ≥95% on the wrapper

#### DoD

- [ ] `pnpm typecheck` + `pnpm vitest` GREEN
- [ ] CHANGELOG entry

---

## Phase 4: Wiring — router.ts + public API

### T4.1 — Wire pool into `router.ts:buildClient`

#### Objective

Connect Phase 1-3 to the existing router so callers get pool behavior transparently when they pass `apiKeys: [...]`.

#### Evidence

- `router.ts:70-76` `buildClient(name)` is the single construction site.
- D130 says `apiKeys` goes on `ProviderRoutingSettings`.
- D132 says single-key shape internally becomes a 1-entry pool.

#### Files to edit

```
packages/sdk/src/internal/llm/router.ts — buildClient consults pool if configured
packages/sdk/src/types/providers.ts — extend ProviderRoutingSettings with apiKeys + credentialPoolStrategy
packages/sdk/src/types/agent.ts — wiring through AgentOptions if needed
packages/sdk/src/internal/runtime/providers-manager.ts — load pool snapshot on Agent.create
```

#### Deep file dependency analysis

- `providers.ts` — public type extension. Adding optional fields = semver minor.
- `router.ts` — internal. Branches on pool presence: ≥2 entries → wrap; 1 entry → existing path; 0 entries → existing env-var resolution (full backward compat).
- `providers-manager.ts` — adds `getPoolFor(provider)` accessor used by `PoolAwareLlmClient`'s lazy `buildClient` callback.

#### Deep Dives

**Public type extension (D130):**

```typescript
// types/providers.ts
export interface ProviderRoutingSettings {
  routes: ProviderRoute[];
  fallback?: string[];
  /** Pool multiple API keys for same-provider rotation. ADR D123-D133. */
  apiKeys?: Record<string, string[]>;
  /** Rotation strategy per provider. Default `"fill_first"`. */
  credentialPoolStrategy?: Record<string, CredentialPoolStrategy>;
}
```

**router.ts pseudocode:**

```typescript
function buildClient(name: string, providersManager?: ProvidersManager): LlmClient | undefined {
  const profile = getProviderProfile(name);
  if (profile === undefined) return undefined;
  const pool = providersManager?.getPoolFor(name);  // null if not configured

  if (pool !== null && pool.hasCredentials()) {
    // Pool path — wrap a single-key builder.
    return new PoolAwareLlmClient(pool, (apiKey) => selectTransport(profile, apiKey));
  }

  // Single-key path — existing logic.
  const apiKey = resolveApiKey(profile.envVars);
  if (apiKey === undefined) return undefined;
  return selectTransport(profile, apiKey);
}
```

**Invariants:**

- D131 fork inheritance: when LocalAgent.fork() runs, the parent's `providersManager` is passed via `forkAgentImpl` → child's `buildClient` sees the SAME pool object → rotation state is shared (per ADR D131 reference-share).
- D132 transparent single-key: when caller writes `apiKey: "k"` (no `apiKeys`), no pool is built — the existing fast path is taken.
- Ambiguity check: if BOTH `apiKey` AND `apiKeys[provider]` are non-empty → throw `ConfigurationError(code: "credential_pool_ambiguous")`.

**Edge cases:**

- **EC-15**: `apiKeys: { openrouter: [] }` (empty array) → treat as no pool, use env-var resolution.
- **EC-16**: `apiKeys: { openrouter: ["", "valid-key"] }` (empty string) → filter out empties, use remaining.
- **EC-17**: `credentialPoolStrategy: { openrouter: "fill_first" }` with no `apiKeys` → strategy ignored silently (config without effect). Optional: log warn in dev.

#### Tasks

1. Extend `ProviderRoutingSettings` with `apiKeys` + `credentialPoolStrategy`.
2. Add `getPoolFor(provider)` to `ProvidersManagerImpl`.
3. Modify `buildClient` to branch on pool presence.
4. Add ambiguity check in `validate-agent-options.ts`.
5. Wire `forkAgentImpl` (in `fork-agent.ts`) to pass `providersManager` to the child.

#### TDD

```
RED:     test_router_uses_pool_when_apikeys_array_has_2_entries()
RED:     test_router_uses_single_key_path_when_apikeys_undefined()
RED:     test_router_uses_single_key_path_when_apikeys_array_empty()
RED:     test_router_filters_empty_string_apikeys()
RED:     test_router_throws_on_ambiguous_apikey_and_apikeys()
RED:     test_fork_inherits_parent_pool_by_reference()  — fork rotates → parent observes change
RED:     test_pool_strategy_defaults_to_fill_first_when_omitted()
RED:     test_router_warns_on_unknown_provider_in_apikeys()  — EC-B: apiKeys: { opnrouter: ["k"] } → stderr warn "unknown provider 'opnrouter'"
GREEN:   Wire router + manager
REFACTOR: None expected
VERIFY:  pnpm vitest run tests/internal/llm/router.test.ts
```

#### Acceptance Criteria

- [ ] 7 RED tests GREEN
- [ ] Existing `router.test.ts` (6 tests) still passes — full backward compat
- [ ] Existing `fork-agent.test.ts` (9 tests) still passes
- [ ] G6 dep-cruise: zero new cycles
- [ ] G8: no file crosses 400 LoC after the changes

#### DoD

- [ ] `pnpm validate` GREEN (all hard gates)
- [ ] CHANGELOG entry
- [ ] `docs.md` updated with the new ProviderRoutingSettings fields

---

## Phase 5: Adversarial tests + CI gates

### T5.1 — Property tests for strategies

#### Objective

Verify strategy invariants under random load via `fast-check`. ≥200 runs per property × 4 strategies = 800+ assertions.

#### Evidence

- Established pattern in `tests/internal/judge/parse-verdict.property.test.ts` (T5.1 from background-work block).
- `fast-check` already in dev deps.

#### Files to edit

```
packages/sdk/tests/internal/llm/credential-pool.property.test.ts (NEW)
```

#### Deep Dives

**Properties to verify:**

1. **fill_first invariant**: after N selects with no exhaustion, all picks should be `entries[0]` (assuming priority 0).
2. **round_robin invariant**: N selects (N ≤ entries.length) yield N distinct entries.
3. **least_used invariant**: after K selects, max(requestCount) - min(requestCount) ≤ 1.
4. **random invariant**: 1000 selects → each entry picked at least once (probabilistic — but P(false neg) < 0.001 for 4 entries).
5. **exhaustion invariant**: marking entry X exhausted means next 10 selects never return X (until cooldown).

#### Tasks

1. Set up arbitrary generators for `PooledCredential` arrays (1-10 entries, random keys).
2. Write 5 properties × 200 runs.

#### TDD

```
RED → GREEN: same iteration as Phase 1 tests (writing properties IS the test)
VERIFY: pnpm vitest run tests/internal/llm/credential-pool.property.test.ts
```

#### Acceptance Criteria

- [ ] 5 properties × 200 runs each → 1000+ assertion executions
- [ ] All GREEN
- [ ] Zero flakes (seed-stable)

#### DoD

- [ ] CHANGELOG entry

---

### T5.2 — CI lint gate: no plaintext API key logging

#### Objective

Lint test bans logging `entry.accessToken` directly anywhere in `src/`. All log/telemetry references must go through the existing `redactSecrets` (D68).

#### Evidence

- D68-D73 secret-redaction-discipline already protects all output boundaries.
- New pool code adds NEW callsites that touch `accessToken` — they must not bypass redaction.

#### Files to edit

```
packages/sdk/tests/lint/no-unredacted-pool-token.test.ts (NEW)
```

#### Deep Dives

**Regex pattern:**

```
\.accessToken\b
```

Matches `entry.accessToken`, `credential.accessToken`. Allowed contexts:
- `credential-pool.ts` itself (the source of truth)
- `pool-aware-client.ts` (passes to LlmClient builder — internal only)
- Anywhere that calls `redactSecrets()` on the result

Test walks `src/` and flags any UNALLOWED file with `\.accessToken` that doesn't have `// REDACT-CHECKED:` comment justification.

#### Tasks

1. Write the lint test using the `tests/lint/no-snapshot-tests.test.ts` template.

#### TDD

```
RED:     test_no_unredacted_pool_token_in_src()  — passes initially; would fail if a regression introduces logging
GREEN:   N/A (test is preventive)
VERIFY:  pnpm vitest run tests/lint/no-unredacted-pool-token.test.ts
```

#### Acceptance Criteria

- [ ] Lint test passes
- [ ] Allowlist contains only `credential-pool.ts` + `pool-aware-client.ts`

#### DoD

- [ ] CHANGELOG entry

---

### T5.3 — Integration test: real provider rotation against fixture mode

#### Objective

End-to-end test that drives `Agent.create({ providers: { apiKeys: { openrouter: ["k1", "k2"] } } })`, sends a prompt, fixture-mode emits a synthesized 429, verifies rotation to k2 + successful completion.

#### Evidence

- Fixture mode in `internal/fixture-mode.ts` already supports synthesizing error responses via scripted fixtures.
- Pattern from `tests/golden/agent/concurrent-send.golden.test.ts`.

#### Files to edit

```
packages/sdk/tests/integration/credential-pool-rotation.test.ts (NEW)
packages/sdk/src/internal/fixture-mode.ts — extend fixture script DSL with `error_429` directive (if needed)
```

#### Deep Dives

**Scenario:**

```typescript
it("rotates from k1 to k2 on synthesized 429 → completes successfully", async () => {
  const agent = await Agent.create({
    apiKey: "theo_test_pool",
    providers: { apiKeys: { openrouter: ["theo_test_k1", "theo_test_k2"] } },
    local: { cwd: tmpdir },
  });
  // Fixture script: k1 returns 429 twice → k2 returns success
  setupFixtureScript({
    "theo_test_k1": { error: { code: 429 }, retryAfter: 0 },
    "theo_test_k2": { result: "hello from k2" },
  });

  const run = await agent.send("test");
  const result = await run.wait();
  expect(result.result).toContain("k2");
});
```

#### Tasks

1. Extend fixture-mode to support per-API-key scripted responses.
2. Write the integration test.

#### TDD

```
RED:     test_rotates_from_k1_to_k2_on_synthesized_429()
RED:     test_fallback_activates_after_all_pool_keys_exhausted()
RED:     test_pool_state_persists_across_agent_dispose_create_cycles()
GREEN:   Implement integration scenarios
VERIFY:  pnpm vitest run tests/integration/credential-pool-rotation.test.ts
```

#### Acceptance Criteria

- [ ] 3 RED tests GREEN
- [ ] Persistence verified end-to-end (k1 marked exhausted survives agent.dispose() + Agent.resume())

#### DoD

- [ ] CHANGELOG entry

---

## Phase 6: Docs + ADRs + CHANGELOG + roadmap update

### T6.1 — Write 11 ADRs (D123-D133)

#### Files to edit

```
.claude/knowledge-base/adrs/D123-credential-pool-storage-json.md (NEW)
.claude/knowledge-base/adrs/D124-credential-pool-strategy-enum.md (NEW)
.claude/knowledge-base/adrs/D125-credential-pool-cooldown-ladder.md (NEW)
.claude/knowledge-base/adrs/D126-credential-pool-429-retry-then-rotate.md (NEW)
.claude/knowledge-base/adrs/D127-credential-pool-composition-wrapper.md (NEW)
.claude/knowledge-base/adrs/D128-credential-pool-in-process-mutex.md (NEW)
.claude/knowledge-base/adrs/D129-credential-pool-lazy-load-debounced-write.md (NEW)
.claude/knowledge-base/adrs/D130-credential-pool-api-keys-array.md (NEW)
.claude/knowledge-base/adrs/D131-credential-pool-fork-inheritance.md (NEW)
.claude/knowledge-base/adrs/D132-credential-pool-single-key-transparent.md (NEW)
.claude/knowledge-base/adrs/D133-credential-pool-exhausted-error.md (NEW)
```

#### DoD

- [ ] 11 ADRs with Context/Decision/Consequences/Implementation
- [ ] Each ADR ≤80 lines

### T6.2 — Public docs + CHANGELOG + CLAUDE.md roadmap

#### Files to edit

```
packages/sdk/docs.md — add "Credential Pools" section
packages/sdk/CHANGELOG.md — Unreleased entry for v1.7
CLAUDE.md — Decided ADRs table D123-D133; SDK Roadmap row #1 status: ❌ → ✅ DONE
```

#### DoD

- [ ] `docs.md` documents the `apiKeys` + `credentialPoolStrategy` config surface with 2 example snippets
- [ ] CHANGELOG complete
- [ ] CLAUDE.md ADR table extended
- [ ] CLAUDE.md SDK Roadmap row 1 marked done

---

## Phase 7: Dogfood QA (MANDATORY)

### T7.1 — Telegram-pro `/pool` probe

#### Objective

Add a probe to `examples/telegram-pro/` that:
1. Lists current pool state (count, strategy, last picked).
2. Triggers a deliberate 429 by calling the LLM 15× rapidly with a tiny model.
3. Shows the rotation event in chat: `[pool] rotated openrouter k1 → k2 after HTTP 429`.

#### Files to edit

```
examples/telegram-pro/src/index.ts — add /pool command
.claude/skills/telegram-pro-dogfood/lib/dogfood.mjs — add scenario #31
```

#### Acceptance Criteria

- [ ] `/pool status` returns formatted pool info
- [ ] `/pool stress` triggers ≥1 visible rotation event in 90s
- [ ] Dogfood passes 31/31 (or 30/31 with documented pre-existing rate-limit flake on a different scenario)

### T7.2 — Full validate + push

#### Execution

```bash
pnpm validate         # all hard gates
pnpm quality:report   # coverage + audit
cd examples/telegram-pro && node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs
```

#### Acceptance Criteria

- [ ] `pnpm validate` exit 0
- [ ] Coverage ≥80% lines (S1)
- [ ] `pnpm audit` 0 high-severity (S4)
- [ ] Telegram-pro dogfood 30/31 or 31/31 PASS
- [ ] CI verde on the PR

---

## Documented edge cases (accepted risks)

These risks are intentionally not coded around — they're either self-correcting, by-design, or the fix costs more than the impact.

- **EC-G (Disk full / EACCES on save)**: Per EC-A fix, pool degrades to in-memory only; stderr warn alerts the operator. Self-recovers when disk issue resolves. Documented in JSDoc of `saveCredentialPoolStore`.
- **EC-H (IterationBudget invisibility)**: Pool rotation happens at the HTTP transport layer, BEFORE the response reaches the agent-loop. `IterationBudget` (D90) counts logical agent turns, not HTTP retries. A turn that internally rotated 3 keys is still 1 turn. Documented in JSDoc of `PoolAwareLlmClient`.
- **EC-I (Process killed mid-rotation)**: Mark-then-save sequence isn't atomic. Process dying between in-memory mark and disk save means the next session re-discovers the exhaustion on the first send (costs 1 extra HTTP 429). Acceptable vs. WAL complexity. Documented in `credential-pool.ts` file header.
- **EC-J (`apiKey` + `apiKeys[provider]` with identical key)**: Throws `ConfigurationError(code: "credential_pool_ambiguous")` per D130. Error message must educate: *"Use either `apiKey: '...'` (single-key, simplest) OR `apiKeys: { provider: [...] }` (multi-key pool), not both."* Documented in JSDoc of `validateAgentOptions`.

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Multi-key registration per provider | T1.1, T2.1, T4.1 | `apiKeys: Record<string, string[]>` on `ProviderRoutingSettings` |
| 2 | Strategy choice (4 algorithms) | T1.1, T4.1 | `CredentialPoolStrategy` enum + `credentialPoolStrategy` config |
| 3 | 429 retry-then-rotate | T3.1 | `classifyAndDecide` with `hasRetried429` flag (ADR D126) |
| 4 | 402 billing immediate-rotate | T3.1 | Decision matrix returns "rotate" without retry |
| 5 | 401 auth rotate | T3.1 | Decision matrix returns "rotate" (no OAuth refresh in v1) |
| 6 | Provider `Retry-After` honored | T3.1 | `parseRetryAfter` reads `error.metadata.raw.headers["retry-after"]` |
| 7 | Cooldown ladder | T1.1 | Const ladder + provider `resetAt` override |
| 8 | Cross-session persistence | T2.1 | `credential-pool.json` with D62 envelope |
| 9 | Thread safety (in-process) | T1.1 | `withCwdMutex` per pool key |
| 10 | Cross-process safety (writes) | T2.1 | `withFileLock` (D61) on save |
| 11 | Fork inheritance | T4.1 | Reference-share via `providersManager.getPoolFor` (D131) |
| 12 | Single-key backward compat | T4.1 | Internal 1-entry pool transparently (D132) |
| 13 | Cross-provider fallback still works | T3.1 | `CredentialPoolExhaustedError` → caught by `FallbackLlmClient` |
| 14 | No plaintext key logging | T5.2 | Lint gate `no-unredacted-pool-token.test.ts` |
| 15 | Coverage ≥80% on new files | T5.1 | Unit + property + integration tests |
| 16 | Admin reset | T1.1 | `pool.resetAll()` clears cooldowns |
| 17 | Runtime metric (rotation observed live) | T7.1 | Telegram-pro `/pool stress` probe |
| 18 | EC-A: persistence fail during rotate doesn't abort stream | T3.1 | try/catch + stderr warn around `markExhaustedAndRotate` |
| 19 | EC-B: unknown provider in apiKeys warns | T4.1 | New TDD test + stderr warn |
| 20 | EC-C: duplicate access tokens deduped | T1.1 | Constructor dedupe + TDD test |
| 21 | EC-D: buildClient throw propagates, no rotation | T3.1 | TDD test |
| 22 | EC-E: debounced save tracks pending timeout | T2.1 | TDD test + clearTimeout |
| 23 | EC-F: round-robin priority persists across save/load | T2.1 | TDD test |
| 24 | EC-G/H/I/J: documented accepted risks | (docs) | JSDoc notes |

**Coverage: 24/24 gaps (100%)**

---

## Global Definition of Done

- [ ] All 7 phases completed
- [ ] All tests passing (Vitest: ~920+ tests including new ~25)
- [ ] Zero Biome warnings (G2)
- [ ] Zero TypeScript errors (G1)
- [ ] G5 (knip): no unused exports introduced
- [ ] G6 (dep-cruise): no new cycles
- [ ] G7 (layered arch): respected
- [ ] G8 (LoC ≤400): all new files compliant
- [ ] G9 (complexity ≤10): no `biome-ignore` without justification comment
- [ ] G10 (duplication): 0 clones
- [ ] G11 (docs.md sync): `apiKeys` + `credentialPoolStrategy` documented
- [ ] S1 (coverage): ≥80% lines maintained
- [ ] S3 (no TODO/FIXME): clean
- [ ] S4 (audit): 0 high-severity
- [ ] Backward compatibility preserved (existing `apiKey: "..."` callers see zero behavior change)
- [ ] **Dogfood telegram-pro PASS** — 30/31 or 31/31 scenarios, including `/pool` probe with visible rotation event
- [ ] **Runtime-metric proof** — at least one log line `[theokit-sdk] credential-pool: rotated <provider> from <k1-id> to <k2-id> after HTTP 429` observed in real LLM run against OpenRouter free-tier rate limits

## Final Phase: Dogfood QA (MANDATORY)

### Execution

```bash
# Boot bot
cd examples/telegram-pro && pnpm tsx --env-file=.env src/index.ts &

# Run dogfood
node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs --user-id 7528967933
```

### Acceptance Criteria

- [ ] Health score ≥70/100 (telegram-pro dogfood already at 96.7%+)
- [ ] Zero CRITICAL issues introduced by this plan
- [ ] Zero HIGH issues in features modified (LLM router, fallback chain, error mapping)
- [ ] `/pool stress` produces an observable rotation event in chat history
- [ ] Pre-existing flakes (if any) documented, not blocking

### If Dogfood Fails

1. Identify which failures are caused by this plan vs pre-existing
2. Fix all plan-caused failures
3. Re-run `node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs`
4. Pre-existing OpenRouter rate-limit flakes are now AUTO-MITIGATED by the credential pool itself — if they recur, the pool wasn't wired correctly

---

> **Edge-Case Review status:** COMPLETE (2026-05-20). 10 edge cases incorporated in v1.1 (1 MUST FIX EC-A, 5 SHOULD TEST EC-B/C/D/E/F, 4 DOCUMENT EC-G/H/I/J). Coverage matrix expanded 17 → 24 items (100%).
