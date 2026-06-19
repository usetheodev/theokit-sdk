---
slug: m0-foundation-expose-primitives
created_at: 2026-06-19
goal: Expose five already-implemented internal primitives (isTransientError, concurrency, withRetry, safeFilenameForId, openSqliteResilient) as public/shared API surfaces so any agent builder reuses them instead of re-implementing, measured by each primitive being importable from its documented path with passing tests and zero new dead code.
---

# Plan: M0 Foundation — Expose Already-Existing Primitives

> **Version 1.0** — The TheoKit gap audit (gap-audit/THEOKIT_GAP_AUDIT.md) found that theocode re-implemented plumbing the SDK already has internally. This plan closes the five SDK-side M0 items by EXPOSING and DEDUPLICATING existing, tested internal code — not by inventing new behavior. Each primitive already exists `@internal`; the work is a public surface, a deterministic consolidation, and the wiring that proves no dead code is introduced. Theocode-side adoption (M0-6..M0-10) is a separate cycle gated on this SDK release.

## Goal

> "Enable any `@theokit/sdk` consumer to import five generic primitives — `isTransientError`, `createSemaphore`/`mapWithConcurrency`, `withRetry`, `safeFilenameForId`, `openSqliteResilient` — from a documented path, so that building an agent/code-assistant reuses battle-tested plumbing instead of re-implementing it, measured by `pnpm --filter @theokit/sdk test` green for the new test suites AND `pnpm quality:dead` reporting zero unallowlisted dead exports for the new surfaces."

## Context

The gap audit (workflow run 2026-06-19, report at `gap-audit/THEOKIT_GAP_AUDIT.md`) confirmed against source that theocode hand-rolled `retry.ts`, `concurrency.ts`, an `isTransientError`-via-regex, an id→filename helper, and a SQLite bootstrap — all of which exist (90% complete) inside `@theokit/sdk` as `@internal` code. The dominant anti-pattern is "internal primitive sealed": the logic is implemented and tested but not on a public barrel, so a third-party consumer cannot discover it (Unbreakable Rule 9 — don't reinvent — is being violated inside the ecosystem's own reference app). This plan exposes the five SDK-owned primitives. It is deliberately conservative: behavior is preserved; only the surface and call-site deduplication change.

## Baseline Context (deep review of current state)

Repository git HEAD at plan time: `9784eb2` (2026-06-19), branch `develop`.

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/errors.ts` | 692 | `9784eb2` (2026-06-19) | Error class hierarchy; `defaultRetriableForCode` (priv., line ~428); every subclass carries `isRetryable` | Public error classes + their `isRetryable` values MUST NOT change; `AgentRunErrorCode` union stable |
| `packages/sdk/src/index.ts` | n/a | `9784eb2` (2026-06-19) | Public barrel | Existing exports unchanged; only additions |
| `packages/sdk/src/path-safety.ts` | 28 | `9784eb2` (2026-06-19) | Public re-export barrel for path-guard | `sanitizeIdentifier`/`safePathJoin` signatures unchanged |
| `packages/sdk/src/internal/security/path-guard.ts` | 406 | `9784eb2` (2026-06-19) | Canonical path validation | `sanitizeIdentifier` grammar `^[a-z0-9][a-z0-9-_]*$` and throw-on-invalid behavior unchanged |
| `packages/sdk/src/internal/runtime/concurrency/async-semaphore.ts` | 65 | `9784eb2` (2026-06-19) | `createSemaphore`/`AsyncSemaphore` (FIFO, idempotent release) | acquire/release/inFlight/pending contract + FIFO ordering unchanged |
| `packages/sdk/src/concurrency.ts` (NEW) | 0 | — | Public barrel for concurrency subpath | — |
| `packages/sdk/src/internal/runtime/concurrency/map-with-concurrency.ts` (NEW) | 0 | — | Ordered bounded pool | — |
| `packages/sdk/src/internal/agent-loop/tool-dispatch.ts` | 443 | `9784eb2` (2026-06-19) | Tool dispatch; private `boundedParallel` clone (~lines 50-79) | external behavior (ordered results, error propagation) unchanged |
| `packages/sdk/src/internal/memory/adapters/openai-compatible.ts` | 320 | `9784eb2` (2026-06-19) | Embedding adapter; inline acquire/release pool (`runBatches` ~lines 186-198) | batch ordering + per-batch error behavior unchanged |
| `packages/sdk/src/retry.ts` (NEW) | 0 | — | Public barrel for retry subpath | — |
| `packages/sdk/src/internal/runtime/retry/with-retry.ts` (NEW) | 0 | — | Generic retry impl (sleep/rng injectable) | — |
| `packages/sdk/src/internal/memory/storage/session-summary-writer.ts` | 88 | `9784eb2` (2026-06-19) | Writes session summaries; private `sanitizeRunId` (line ~42, replace-collapse + slice 128) | session file is a regenerable cache; UUID runIds MUST map to identical filename post-change |
| `packages/sdk/src/internal/persistence/sqlite-wal.ts` | 70 | `9784eb2` (2026-06-19) | `applyWalWithFallback` (public via internal/persistence) | signature + warn-once behavior unchanged |
| `packages/sdk/src/internal/persistence/sqlite-open.ts` (NEW) | 0 | — | Generic resilient SQLite open | — |
| `packages/sdk/src/internal/persistence/index.ts` | 34 | `9784eb2` (2026-06-19) | Barrel for `@theokit/sdk/internal/persistence` | existing exports unchanged; only additions |
| `packages/sdk-memory/src/internal/index/index-db.ts` | 120 | `9784eb2` (2026-06-19) | `openMemoryDb` (loadDriver + isCorruptionError + renameAside) | corruption-recovery behavior (rename-aside `.corrupt-<ts>`, rebuild) preserved exactly; EC-7 test stays green |
| `packages/sdk/src/internal/memory/index-db.ts` | 120 | `9784eb2` (2026-06-19) | byte-identical copy of the above inside sdk | same as above |
| `packages/sdk/package.json` | n/a | `9784eb2` (2026-06-19) | Workspace package manifest (exports map) | existing exports unchanged; only additions |
| `packages/sdk/tsup.config.ts` | n/a | `9784eb2` (2026-06-19) | Build entries + DTS exceptions | existing entries unchanged; DTS-cycle exception pattern reused for `concurrency` |
| `packages/sdk/docs.md` | n/a | `9784eb2` (2026-06-19) | Canonical public API contract | additions only, reflecting new public surfaces |

### Current callers / dependents

- **Symbol:** `defaultRetriableForCode` in `errors.ts` — Callers (production): `errors.ts` `AgentRunError` ctor only. Private. External: no.
- **Symbol:** `createSemaphore` in `async-semaphore.ts` — Callers (production): `internal/task/registry.ts`. Callers (tests): `tests/internal/runtime/async-semaphore.test.ts`. External: no (internal path).
- **Symbol:** `boundedParallel` in `tool-dispatch.ts` (~line 50) — Callers (production): same file (~line 69). External: no.
- **Symbol:** `runBatches` inline pool in `openai-compatible.ts` (~line 188) — Callers (production): same file. External: no.
- **Symbol:** `withRetry` in `internal/workflow/retry-policy.ts` — Callers: `internal/workflow/step-fn.ts:45`, `step-agent.ts:85`. NOT touched by this plan (stays workflow-internal — see ADR-M0-3).
- **Symbol:** `sanitizeRunId` in `session-summary-writer.ts` (~line 42) — Callers (production): same file (~line 39). External: no.
- **Symbol:** `openMemoryDb` in `sdk-memory/.../index-db.ts` and `sdk/.../internal/memory/index-db.ts` — Callers: `index-manager.ts` in each package. External: no.
- **Symbol:** `applyWalWithFallback` — already public via `@theokit/sdk/internal/persistence`; consumed by both index-db copies. External: yes (sibling packages).

### Domain glossary

- **Subpath export** — a secondary entry in `package.json` `exports` (e.g. `@theokit/sdk/path-safety`) built by a dedicated `tsup` entry.
- **`@internal` subpath** — an export under `./internal/*` documented as semver-exempt, used by sibling packages (sdk-memory, sdk-cache); see existing `internal/persistence`.
- **Rename-aside** — corruption-recovery move of a SQLite file to `<path>.corrupt-<timestamp>` plus WAL/SHM siblings, then re-open fresh.
- **DTS-cycle exception** — `tsup` generates `.d.ts` for some subpaths via `tsc` (not rollup-plugin-dts) because a `types/agent.ts ↔ fork-agent.ts` import cycle trips rollup when a sub-entry reaches into `internal/runtime`.
- **WAL fallback** — `applyWalWithFallback` downgrades `journal_mode=WAL` to `DELETE` on filesystems that reject WAL, warn-once per label.

### Architecture boundaries affected

Per `rules/architecture.md`: this plan only PROMOTES inner (internal) code to the public surface (an outward move at the composition boundary) and DEDUPLICATES sibling internal call-sites. No inner layer gains a dependency on an outer layer. `openSqliteResilient` lives in `internal/persistence` (infrastructure), consumed by `sdk-memory` (also infrastructure) — same layer, no inversion violated. No domain code gains an infrastructure import.

## Prior Art & Related Work

- **Gap audit report** — `gap-audit/THEOKIT_GAP_AUDIT.md` §2 (master table rows: isTransientError, mapWithConcurrency, withRetry, safeFilenameForId, SQLite bootstrap) and §3.1 (the `@theokit/sdk` recommendations). This plan implements the `boundary=framework`, severity high/medium rows.
- **In-repo concurrency decision** — the existing in-house concurrency module (~30 LoC, deliberately no `p-limit`/`p-map`, recorded in the repo ADR log). This plan keeps the in-house choice; it promotes, not replaces.
- **Path-guard decisions** — the canonical path-guard module + `sanitizeIdentifier` grammar (recorded in the repo ADR log). `safeFilenameForId` reuses the grammar and adds a hash fallback for non-conforming ids.
- **WAL/persistence** — the existing `applyWalWithFallback` helper (recorded in the repo ADR log). `openSqliteResilient` builds on it.
- **Retry shapes** — the workflow retry policy (Temporal-shaped) and `internal/llm/retry.ts` (full-jitter, AWS Brooker 2015). The generic `withRetry` mirrors the jitter approach with injectable sleep/rng.
- **Existing subpath pattern** — `packages/sdk/package.json` `exports` (`./path-safety`, `./subscription`, `./internal/persistence`) and `tsup.config.ts` entries are the template for the two new subpaths.

## Objective

- [ ] `isTransientError(err)` importable from `@theokit/sdk`, returns the SDK's own retryability verdict
- [ ] `createSemaphore` + `mapWithConcurrency` importable from `@theokit/sdk/concurrency`; two internal clones deleted
- [ ] `withRetry` importable from `@theokit/sdk/retry` with deterministic (injectable sleep/rng) tests
- [ ] `safeFilenameForId` importable from `@theokit/sdk/path-safety`; `sanitizeRunId` migrated to it
- [ ] `openSqliteResilient` in `@theokit/sdk/internal/persistence`; both `index-db` copies consume it
- [ ] `docs.md` + `CHANGELOG.md` updated; zero new dead exports (`pnpm quality:dead`)

## ADRs

### ADR-M0-1 — `isTransientError` delegates to `TheokitAgentError.isRetryable`

- **Decision:** `isTransientError(err: unknown): boolean` returns `err instanceof TheokitAgentError ? err.isRetryable : false`. It does NOT inspect `err.message` with regex.
- **Rationale:** The retryability verdict already lives on every SDK error subclass (computed at construction, including `AgentRunError` via `defaultRetriableForCode`). A single source of truth avoids drift.
- **Alternatives considered:** (a) Re-implement a code/status/transport allow-set in the predicate — rejected: duplicates the verdict each error already carries, guaranteeing drift. (b) Match `err.message` substrings — rejected: brittle, the exact failure mode the theocode regex suffered.
- **Consequences:** Non-SDK errors return `false` (conservative); callers wrapping foreign errors must map them to SDK errors first. Enables `withRetry`'s default `isRetryable`.

### ADR-M0-2 — `mapWithConcurrency` is fail-fast and order-preserving

- **Decision:** `mapWithConcurrency<T,R>(items, concurrency, fn, opts?): Promise<R[]>` runs `fn` over `items` with a bounded ordered pool, rejecting on the first error (fail-fast), result array indexed to input. Backed by the promoted `createSemaphore`.
- **Rationale:** Matches the exact semantics of the two clones being deleted (`boundedParallel` and `runBatches` both propagate the first error via `Promise.all` and preserve order), so deduplication is behavior-preserving.
- **Alternatives considered:** (a) Result-type return `{ok,value}|{ok,error}` (collect-all) — rejected: would change the clones' fail-fast behavior, a behavior change outside this plan's "expose, don't alter" scope. (b) Leave clones in place and only expose `createSemaphore` — rejected: leaves the duplication the audit flagged.
- **Consequences:** Workflow's collect/fail-fast policy paths (`step-parallel.ts`) are NOT migrated (they have richer policy); documented as out of scope.

### ADR-M0-3 — Generic `withRetry` is a new surface; workflow retry stays separate

- **Decision:** Ship `withRetry` in a new `@theokit/sdk/retry` subpath with injectable `sleep` and `rng`; default `isRetryable` = `isTransientError`. The existing `internal/workflow/retry-policy.ts` `withRetry` is left untouched.
- **Rationale:** The workflow retry is coupled to `RetryPolicy` and runs in-process (real sleep acceptable). Refactoring it to delegate risks a behavior change to a tested path for no consumer benefit. KISS.
- **Alternatives considered:** (a) Make workflow `withRetry` delegate to the generic — rejected: breaking-change risk on a tested path, no upside. (b) Reuse `internal/llm/retry.ts` directly as the public API — rejected: it is credential-pool-specific (Retry-After hints), not general.
- **Consequences:** Two `withRetry` implementations coexist; the workflow one stays internal and undocumented as public. Acceptable per the rationale.

### ADR-M0-4 — `safeFilenameForId` is passthrough-or-hash

- **Decision:** `safeFilenameForId(id, { maxLen? = 128 }): string` returns the lowercased id when it matches the safe grammar `^[a-z0-9][a-z0-9_-]{0,maxLen-1}$`; otherwise returns a deterministic `node:crypto` sha256 hex token (e.g. `h-<16hex>`). It NEVER throws on a non-empty string.
- **Rationale:** The real consumer need (the theocode `plan-store`/`memory-store`) is "any opaque id → a valid filename, always". `sanitizeIdentifier` throws on non-conforming input, so it cannot serve this need. Passthrough keeps human-readable names when possible; the hash guarantees a valid, collision-resistant name otherwise.
- **Alternatives considered:** (a) Alias `sanitizeIdentifier` (throw-on-invalid) — rejected: does not solve the opaque-id case (the whole point). (b) Always hash — rejected: opaque filenames hurt debuggability. (c) Replace-collapse (the legacy `sanitizeRunId`) — rejected: lossy, collision-prone (`a!`/`a?` → `a_`).
- **Consequences:** Migrating `sanitizeRunId` changes filenames only for non-UUID runIds; UUID runIds (the production case, from `randomUUID`) pass through to the identical name. Session summaries are a regenerable cache (see Drawbacks). Empty string still throws (length invariant).

### ADR-M0-5 — `openSqliteResilient` lives in `internal/persistence`

- **Decision:** Extract the driver-load + corruption-detect + rename-aside + WAL apply logic into `openSqliteResilient({ filePath, onOpen?, label?, recoverCorrupt? = true })` in `internal/persistence`; both `index-db` copies (sdk-memory and sdk) consume it via `onOpen` for their PRAGMA/SCHEMA application.
- **Rationale:** `better-sqlite3` is already a peer (and dev) dependency of `@theokit/sdk`; `applyWalWithFallback` already lives in `internal/persistence`. Co-locating keeps native-binding discipline in one place and removes a byte-identical duplication across two files.
- **Alternatives considered:** (a) Keep it in `sdk-memory` — rejected: would force `@theokit/sdk` core to depend on `sdk-memory` (inversion violation). (b) Leave the duplication — rejected: two byte-identical copies drift.
- **Consequences:** Corruption-recovery semantics (rename-aside, not backup) are preserved exactly; documented as a known data-loss-on-corruption tradeoff (see Drawbacks). This is the highest-risk task — sequenced last (risky-last per `rules/cycle-implement.md`).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `safeFilenameForId` migration changes session-summary filenames for non-UUID runIds, orphaning old cache files | Medium | Session summaries are a regenerable cache (re-derived on next run); UUID runIds (production) pass through unchanged; documented in CHANGELOG | impl |
| `openSqliteResilient` corruption-recovery renames aside (no backup) — a corrupt DB's data is not preserved | Medium | Behavior is unchanged from today (already rename-aside); `.corrupt-<ts>` file kept for manual recovery; documented in ADR-M0-5 | impl |
| `concurrency` subpath DTS may trip the rollup-plugin-dts import cycle (reaches into `internal/runtime`) | Medium | Reuse the existing `tsc`-based DTS exception pattern (as `path-safety`/`subscription` do); verify with `attw` | impl |
| New public exports could be flagged as dead by `knip` (no internal importer for `isTransientError`/`withRetry`) | Low | Wire each with a real internal caller where natural, else add to docs.md as public API + knip allowlist with rationale (per no-stubs rule's documented-public-API exception) | impl |
| `mapWithConcurrency` deduplication subtly changes error timing/ordering in a clone | Low | Behavior-preserving by ADR-M0-2; existing batch/tool-dispatch tests must stay green; add ordering+abort tests | impl |

## Unresolved Questions

- Q1 — Does the `concurrency` subpath DTS need the `tsc` exception, or does it build cleanly via rollup? (Resolve empirically in T3 by attempting the default build first; fall back to the documented exception.) — MUST-FIX before merge.
- Q2 — For `safeFilenameForId` wiring, is `sanitizeRunId` migration sufficient to satisfy no-dead-code, or is a docs.md + knip allowlist entry also required for the public export? (Resolve in T2 by running `pnpm quality:dead`.) — MUST-FIX before merge.

## Dependencies

No new third-party dependency is added (Unbreakable Rule 9 honored — everything reuses existing in-house code or Node builtins).

| Dependency | Version | New? | Rule 9 justification |
|---|---|---|---|
| `node:crypto` | builtin (Node >=22.12) | No | Builtin; used for sha256 in `safeFilenameForId`; no external lib needed |
| `better-sqlite3` | `^12.0.0` (peer) + `^12.10.0` (dev) | No (already declared) | Existing optional peer dep; `openSqliteResilient` reuses it; no version change |

No CVE surface changes (no manifest dependency added or bumped).

## Dependency Graph

```
Phase 1 (M0-1 isTransientError) ──▶ Phase 4 (M0-3 withRetry, default isRetryable)
Phase 2 (M0-4 safeFilenameForId)   [independent]
Phase 3 (M0-2 concurrency)         [independent]
Phase 5 (M0-5 openSqliteResilient) [independent, risky-last]
```

Phase 1 blocks Phase 4. Phases 2, 3, 5 are independent. Sequenced 1→2→3→4→5 by ascending risk (cycle-implement risky-last discipline). Each phase is one atomic TDD task and one commit.

---

## Phase 1: M0-1 — Public `isTransientError`

**Objective:** Expose the SDK's existing retryability verdict as a public predicate.

### T1.1 — Add and export `isTransientError`

#### Objective
Add `isTransientError(err: unknown): boolean` to `errors.ts` and re-export from `index.ts`.

#### Why this step (action + reasoning)

1. **What this step does** — adds a one-expression predicate delegating to `TheokitAgentError.isRetryable`, and exports it from the public barrel.
2. **Why it is necessary now** — it is the lowest-risk item and the default `isRetryable` for `withRetry` (Phase 4 depends on it). Per ADR-M0-1, consolidating the verdict that already exists prevents the regex-drift that theocode's hand-rolled version suffered.

#### Evidence
`packages/sdk/src/errors.ts:428` defines private `defaultRetriableForCode`; every subclass sets `isRetryable` (e.g. `RateLimitError` true, `AuthenticationError` false). No public predicate exists (confirmed: `index.ts` error exports list has no `isTransientError`).

#### Files to edit
```
packages/sdk/src/errors.ts — add exported isTransientError after defaultRetriableForCode
packages/sdk/src/index.ts — re-export isTransientError
packages/sdk/tests/errors-is-transient.test.ts — RED tests added first (TDD)
packages/sdk/docs.md — document isTransientError under error utilities
packages/sdk/CHANGELOG.md — [Unreleased] Added entry
```

#### Deep file dependency analysis
- `errors.ts` (Baseline row: 692 LoC) — gains one exported function; no existing symbol changes. Downstream: `index.ts` re-exports it.
- `index.ts` — adds one name to the existing error export block.

#### Deep Dives
- Invariant (Baseline): public error classes and their `isRetryable` values unchanged — the predicate only READS them.
- Edge cases: `null`, `undefined`, plain `Error`, `string` → all `false`; every SDK subclass → its `isRetryable`.

#### Pseudo-code / Signatures
```pseudocode
export function isTransientError(err: unknown): boolean {
  return err instanceof TheokitAgentError && err.isRetryable === true;
}
# input: new RateLimitError("...") -> true
# input: new AuthenticationError("...") -> false
# input: null -> false
```

#### Tasks
1. Write RED tests enumerating each subclass + non-SDK inputs.
2. Add the predicate; export from index.
3. Document in docs.md; add CHANGELOG entry.

#### TDD
```
RED:  test_isTransientError_true_for_RateLimitError() — asserts true
RED:  test_isTransientError_true_for_NetworkError() — asserts true
RED:  test_isTransientError_true_for_AgentRunError_rate_limit_code() — asserts true
RED:  test_isTransientError_true_for_CredentialPoolExhaustedError() — asserts true
RED:  test_isTransientError_false_for_AuthenticationError() — asserts false
RED:  test_isTransientError_false_for_ConfigurationError() — asserts false
RED:  test_isTransientError_false_for_plain_Error_null_undefined_string() — asserts false for each
GREEN: implement the one-line predicate + export
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/errors-is-transient.test.ts
```

#### Acceptance Criteria
- [ ] `import { isTransientError } from "@theokit/sdk"` resolves (export present in `index.ts`)
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/errors-is-transient.test.ts` exits 0 with all 7 tests passing
- [ ] Pass: lint — `pnpm --filter @theokit/sdk exec biome check src/errors.ts src/index.ts` reports zero errors
- [ ] `docs.md` contains an `isTransientError` entry; `CHANGELOG.md` `[Unreleased]` has the Added line

#### DoD
- [ ] Tasks completed and validated
- [ ] `pnpm --filter @theokit/sdk test` green
- [ ] `pnpm --filter @theokit/sdk run typecheck` zero errors
- [ ] biome clean on changed files
- [ ] CHANGELOG updated (Unbreakable Rule 6)

---

## Phase 2: M0-4 — `safeFilenameForId`

**Objective:** Provide a total (never-throws) id→filename function and wire it via `sanitizeRunId`.

### T2.1 — Add `safeFilenameForId` and migrate `sanitizeRunId`

#### Objective
Add `safeFilenameForId` to `path-guard.ts`, export via `path-safety.ts`, and replace the private `sanitizeRunId` with it.

#### Why this step (action + reasoning)

1. **What this step does** — adds a passthrough-or-sha256 helper (ADR-M0-4) and migrates the one internal caller (`session-summary-writer`), giving the export a real caller (no-dead-code) and proving the migration.
2. **Why it is necessary now** — it is independent and low-medium risk; doing it early de-risks the wiring question (Q2) before the build-config-heavy Phase 3.

#### Evidence
`internal/security/path-guard.ts:385` `sanitizeIdentifier` THROWS on non-conforming input (grammar `^[a-z0-9][a-z0-9-_]*$`). `internal/memory/storage/session-summary-writer.ts:42` `sanitizeRunId` uses lossy replace-collapse + slice 128. Neither serves "any opaque id → always a valid filename".

#### Files to edit
```
packages/sdk/src/internal/security/path-guard.ts — add safeFilenameForId (uses node:crypto sha256)
packages/sdk/src/path-safety.ts — re-export safeFilenameForId
packages/sdk/src/internal/memory/storage/session-summary-writer.ts — replace sanitizeRunId with safeFilenameForId({maxLen:128})
packages/sdk/tests/path-safety-safe-filename.test.ts — RED tests added first (TDD)
packages/sdk/docs.md — document safeFilenameForId
packages/sdk/CHANGELOG.md — [Unreleased] Added + Changed entries
```

#### Deep file dependency analysis
- `path-guard.ts` (Baseline: 406 LoC) — gains `safeFilenameForId`; `sanitizeIdentifier` unchanged. Downstream: `path-safety.ts` re-exports.
- `session-summary-writer.ts` (Baseline: 88 LoC) — `sanitizeRunId` removed, call-site (line ~39) uses `safeFilenameForId`. Downstream: none (private path).

#### Deep Dives
- Algorithm: lowercase id; if matches `^[a-z0-9][a-z0-9_-]{0,maxLen-1}$` return it; else return `h-` + first 16 hex of `sha256(id)`.
- Invariant (Baseline): UUID runIds (from `randomUUID`, lowercase hex+dashes) MUST pass through to the identical filename → no data orphaning for production runIds.
- Edge cases: empty string throws (length invariant); leading dash → hash; unicode → hash; idempotent (`f(f(x))===f(x)` since hash output is conforming).

#### Pseudo-code / Signatures
```pseudocode
export function safeFilenameForId(id: string, opts?: { maxLen?: number }): string
  maxLen = opts?.maxLen ?? 128
  if id.length === 0 || id.length > maxLen*4: throw ConfigurationError(invalid_filename_id)
  lower = id.toLowerCase()
  if SAFE_GRAMMAR(maxLen).test(lower): return lower
  return "h-" + sha256hex(id).slice(0,16)
# input: "550e8400-e29b-41d4-a716-446655440000" -> passthrough (same)
# input: "user@example.com" -> "h-<16hex>"
# input: "" -> throws
```

#### Tasks
1. Write RED tests (passthrough UUID, hash for invalid, empty throws, idempotency, determinism).
2. Implement `safeFilenameForId`; export via `path-safety.ts`.
3. Replace `sanitizeRunId` call-site; delete the private function.
4. Run `pnpm quality:dead` to resolve Q2.

#### TDD
```
RED:  test_safeFilenameForId_passthrough_for_uuid() — asserts output === input lowercased
RED:  test_safeFilenameForId_hashes_id_with_at_sign() — asserts output matches /^h-[0-9a-f]{16}$/
RED:  test_safeFilenameForId_hashes_leading_dash_and_unicode() — asserts hash form
RED:  test_safeFilenameForId_is_deterministic() — asserts two calls equal
RED:  test_safeFilenameForId_is_idempotent() — asserts f(f(x)) === f(x)
RED:  test_safeFilenameForId_throws_on_empty_string() — asserts throws ConfigurationError
RED:  test_sessionSummary_filename_unchanged_for_uuid_runId() — asserts path identical to legacy for a UUID
GREEN: implement helper + migrate sanitizeRunId
REFACTOR: remove now-dead sanitizeRunId
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/path-safety-safe-filename.test.ts
```

#### Acceptance Criteria
- [ ] `import { safeFilenameForId } from "@theokit/sdk/path-safety"` resolves
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/path-safety-safe-filename.test.ts` exits 0 (7 tests pass)
- [ ] `pnpm quality:dead` reports no new dead export for `safeFilenameForId` (or it is allowlisted with rationale)
- [ ] Pass: lint — biome clean on the three changed src files
- [ ] `docs.md` + `CHANGELOG.md` updated (Added + Changed)

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` green
- [ ] typecheck zero errors; biome clean
- [ ] `sanitizeRunId` no longer present (grep returns nothing)
- [ ] CHANGELOG updated

---

## Phase 3: M0-2 — `@theokit/sdk/concurrency` subpath

**Objective:** Promote `createSemaphore`, add `mapWithConcurrency`, delete two internal clones.

### T3.1 — Concurrency subpath + dedup

#### Objective
Create the `concurrency` subpath exposing `createSemaphore`/`AsyncSemaphore`/`mapWithConcurrency`, and replace `boundedParallel` + `runBatches` with `mapWithConcurrency`.

#### Why this step (action + reasoning)

1. **What this step does** — adds an ordered fail-fast `mapWithConcurrency` over the existing semaphore, wires it into two existing clone call-sites (deleting the clones), and adds the build/export plumbing for a new subpath.
2. **Why it is necessary now** — the dedup gives the new export real internal callers (no-dead-code) and removes the duplication the audit flagged; it is independent of Phases 1/2.

#### Evidence
`internal/runtime/concurrency/async-semaphore.ts:1-65` is tested (`tests/internal/runtime/async-semaphore.test.ts`). Clones: `internal/agent-loop/tool-dispatch.ts:50-79` (`boundedParallel`), `internal/memory/adapters/openai-compatible.ts:186-198` (`runBatches`). Both order-preserving + fail-fast.

#### Files to edit
```
packages/sdk/src/internal/runtime/concurrency/map-with-concurrency.ts — NEW, mapWithConcurrency
packages/sdk/src/concurrency.ts — NEW public barrel
packages/sdk/src/internal/agent-loop/tool-dispatch.ts — replace boundedParallel with mapWithConcurrency
packages/sdk/src/internal/memory/adapters/openai-compatible.ts — replace runBatches pool with mapWithConcurrency
packages/sdk/package.json — add ./concurrency export
packages/sdk/tsup.config.ts — add concurrency entry (+ DTS exception if needed, Q1)
packages/sdk/tests/concurrency.test.ts — RED tests added first (TDD)
packages/sdk/docs.md — document the concurrency subpath
packages/sdk/CHANGELOG.md — [Unreleased] Added + Changed entries
```

#### Deep file dependency analysis
- `async-semaphore.ts` (Baseline: 65 LoC) — unchanged; re-exported.
- `map-with-concurrency.ts` (NEW) — uses `createSemaphore`.
- `tool-dispatch.ts` (Baseline: 443 LoC) — `boundedParallel` removed; its single caller (~line 69) uses `mapWithConcurrency`. Behavior preserved (ordered, fail-fast).
- `openai-compatible.ts` (Baseline: 320 LoC) — inline pool replaced; batch order + error behavior preserved.

#### Deep Dives
- Algorithm: acquire a permit per item, run `fn(item,i,signal)`, store at index `i`, release in `finally`; reject on first error (fail-fast); `Promise.all` of the per-item promises preserves order.
- Invariant (Baseline): tool-dispatch ordered results + error propagation; openai-compatible batch ordering — both unchanged.
- Edge cases: empty array → `[]`; concurrency<1 → `ConfigurationError` (reuse semaphore validation); aborted signal → no new work started.

#### Pseudo-code / Signatures
```pseudocode
export async function mapWithConcurrency<T,R>(
  items: ReadonlyArray<T>, concurrency: number,
  fn: (item:T, index:number, signal:AbortSignal)=>Promise<R>,
  opts?: { signal?: AbortSignal }): Promise<R[]>
  sem = createSemaphore(concurrency)   # throws if <1
  return Promise.all(items.map(async (item,i) => {
    const release = await sem.acquire()
    try { return await fn(item,i, opts?.signal ?? neverAbort) } finally { release() }
  }))
# input: ([1,2,3], 2, async n=>n*2) -> [2,4,6] (order preserved)
```

#### Tasks
1. Write RED tests (order under jitter, max-concurrency respected, empty array, invalid concurrency, abort, error propagation).
2. Implement `mapWithConcurrency`; create `concurrency.ts` barrel.
3. Add tsup entry + package.json export; attempt default DTS, fall back to `tsc` exception if rollup cycle trips (Q1).
4. Migrate `boundedParallel` and `runBatches`; delete the clones.
5. Run existing tool-dispatch + batch + adapter tests to confirm green.

#### TDD
```
RED:  test_mapWithConcurrency_preserves_order_under_jitter() — asserts [2,4,6,8,10]
RED:  test_mapWithConcurrency_respects_max_concurrency() — asserts peak in-flight <= N
RED:  test_mapWithConcurrency_empty_array_returns_empty() — asserts []
RED:  test_mapWithConcurrency_throws_on_invalid_concurrency() — asserts ConfigurationError
RED:  test_mapWithConcurrency_rejects_on_first_error() — asserts rejects with the error
RED:  test_mapWithConcurrency_stops_new_work_after_abort() — asserts started count bounded after abort
RED:  test_createSemaphore_reexported_from_concurrency_subpath() — asserts import works
GREEN: implement + wire dedup
REFACTOR: delete boundedParallel and runBatches private impls
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/concurrency.test.ts tests/batch.test.ts
```

#### Acceptance Criteria
- [ ] `import { createSemaphore, mapWithConcurrency } from "@theokit/sdk/concurrency"` resolves
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/concurrency.test.ts` exits 0 (7 tests pass)
- [ ] Pre-existing `tests/batch.test.ts` and tool-dispatch tests stay green
- [ ] `grep -rn "boundedParallel\|function runBatches" packages/sdk/src` returns nothing (clones deleted)
- [ ] `pnpm --filter @theokit/sdk run build` succeeds and `attw` passes for the new subpath
- [ ] `docs.md` + `CHANGELOG.md` updated

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` green
- [ ] typecheck + biome clean; build + attw green for `./concurrency`
- [ ] CHANGELOG updated

---

## Phase 4: M0-3 — `@theokit/sdk/retry` subpath

**Objective:** Ship a generic, deterministically-testable `withRetry`.

### T4.1 — Generic `withRetry`

#### Objective
Add `withRetry` in a new `retry` subpath with injectable `sleep`/`rng`, default `isRetryable = isTransientError`.

#### Why this step (action + reasoning)

1. **What this step does** — adds a generic retry wrapper (exponential backoff + full jitter) with injectable clock for deterministic tests, defaulting its retry predicate to `isTransientError` from Phase 1.
2. **Why it is necessary now** — it depends on Phase 1 (`isTransientError`); it gives consumers the retry primitive theocode hand-rolled. Per ADR-M0-3 the workflow retry is left untouched.

#### Evidence
`internal/workflow/retry-policy.ts:60` `withRetry(fn,policy,signal)` is `RetryPolicy`-coupled, uses real `setTimeout`. `internal/llm/retry.ts` is credential-pool-specific (Retry-After). Neither is a general, injectable-clock public surface; `rules/testing.md` requires injectable clock/RNG for determinism.

#### Files to edit
```
packages/sdk/src/internal/runtime/retry/with-retry.ts — NEW, generic withRetry
packages/sdk/src/retry.ts — NEW public barrel
packages/sdk/package.json — add ./retry export
packages/sdk/tsup.config.ts — add retry entry
packages/sdk/tests/retry.test.ts — RED tests added first (TDD)
packages/sdk/docs.md — document the retry subpath
packages/sdk/CHANGELOG.md — [Unreleased] Added entry
```

#### Deep file dependency analysis
- `with-retry.ts` (NEW) — imports `isTransientError` from `../../../errors.js` for the default predicate.
- `retry.ts` (NEW barrel) — re-exports `withRetry` + its option types.
- Wiring/caller: at least one real internal caller OR documented-public-API per no-stubs rule; candidate: none forced — documented public API + tests (resolve like Q2 via `quality:dead`).

#### Deep Dives
- Algorithm: attempt loop 1..retries+1; on throw, if `!isRetryable(err)` or last attempt → rethrow; else `await sleep(jitter(initialDelay*mult^(n-1), maxDelay, rng), signal)`.
- Invariant: deterministic when `sleep` and `rng` are injected (no real timers in tests, per `rules/testing.md`).
- Edge cases: retries=0 → single attempt; aborted signal mid-sleep → reject AbortError; non-retryable first error → no sleep.

#### Pseudo-code / Signatures
```pseudocode
export interface RetryOptions {
  retries?: number; isRetryable?: (e:unknown)=>boolean;
  initialDelayMs?: number; maxDelayMs?: number; backoffMultiplier?: number;
  rng?: ()=>number; sleep?: (ms:number, signal?:AbortSignal)=>Promise<void>;
  signal?: AbortSignal;
}
export async function withRetry<T>(fn:()=>Promise<T>, opts?:RetryOptions): Promise<T>
# default isRetryable = isTransientError; default sleep = setTimeout-based
```

#### Tasks
1. Write RED tests with a mock `sleep` (no real timers) and fixed `rng`.
2. Implement `withRetry`; create `retry.ts` barrel; add tsup entry + export.
3. Resolve no-dead-code (docs.md public API + `quality:dead`).

#### TDD
```
RED:  test_withRetry_succeeds_first_attempt_no_sleep() — asserts fn called once, sleep not called
RED:  test_withRetry_retries_until_success() — asserts attempts counted, returns value
RED:  test_withRetry_uses_injected_sleep_with_backoff() — asserts sleep called with [100,200] (mult=2, rng=1)
RED:  test_withRetry_rethrows_non_retryable_immediately() — asserts fn called once, error rethrown
RED:  test_withRetry_default_isRetryable_uses_isTransientError() — asserts RateLimitError retried, AuthenticationError not
RED:  test_withRetry_aborts_mid_sleep() — asserts rejects AbortError, fn not re-called
GREEN: implement withRetry + subpath
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/retry.test.ts
```

#### Acceptance Criteria
- [ ] `import { withRetry } from "@theokit/sdk/retry"` resolves
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/retry.test.ts` exits 0 (6 tests pass) using only mock sleep (no real timers)
- [ ] `pnpm quality:dead` reports no unallowlisted dead export for `withRetry`
- [ ] build + attw green for `./retry`
- [ ] `docs.md` + `CHANGELOG.md` updated

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` green
- [ ] typecheck + biome clean; build + attw green
- [ ] CHANGELOG updated

---

## Phase 5: M0-5 — `openSqliteResilient` (risky-last)

**Objective:** Extract resilient SQLite open to `internal/persistence`; dedup both `index-db` copies.

### T5.1 — Extract `openSqliteResilient` and wire both consumers

#### Objective
Move driver-load + corruption-recovery + WAL into `openSqliteResilient`; have both `index-db` copies consume it via `onOpen`.

#### Why this step (action + reasoning)

1. **What this step does** — extracts the existing, tested corruption-recovery logic into one generic function and makes the two byte-identical copies consume it.
2. **Why it is necessary now (last)** — it is the highest-risk item (native binding, data-loss-on-corruption semantics); sequenced last per `rules/cycle-implement.md` risky-last so earlier phases land first. Behavior is preserved (ADR-M0-5).

#### Evidence
`sdk-memory/src/internal/index/index-db.ts:54-105` holds `openMemoryDb`/`loadDriver`/`isCorruptionError`/`renameAside`; `sdk/src/internal/memory/index-db.ts` is byte-identical. `internal/persistence/sqlite-wal.ts:38` `applyWalWithFallback` already public. EC-7 corruption test exists at `sdk-memory/tests/index-db.test.ts:94`.

#### Files to edit
```
packages/sdk/src/internal/persistence/sqlite-open.ts — NEW openSqliteResilient
packages/sdk/src/internal/persistence/index.ts — export openSqliteResilient
packages/sdk-memory/src/internal/index/index-db.ts — consume openSqliteResilient via onOpen
packages/sdk/src/internal/memory/index-db.ts — consume openSqliteResilient via onOpen
packages/sdk/tests/internal/persistence/sqlite-open.test.ts — RED tests added first (TDD)
packages/sdk/docs.md — note under internal/persistence (semver-exempt)
packages/sdk/CHANGELOG.md + packages/sdk-memory/CHANGELOG.md — entries
```

#### Deep file dependency analysis
- `sqlite-open.ts` (NEW) — uses `applyWalWithFallback`; reproduces `isCorruptionError`/`renameAside` exactly.
- `index-db.ts` (both, Baseline: 120 LoC each) — `loadDriver`/`isCorruptionError`/`renameAside` removed; `openConcrete` becomes one `openSqliteResilient` call + `onOpen` applying PRAGMA/SCHEMA. Downstream: `index-manager.ts` in each package (unchanged interface).

#### Deep Dives
- Invariant (Baseline): corruption-recovery renames `<path>.corrupt-<ts>` + WAL/SHM siblings and rebuilds; EC-7 test MUST stay green for `openMemoryDb`.
- Edge cases: corrupt file + `recoverCorrupt:true` → rename-aside + fresh; `recoverCorrupt:false` → propagate; WAL unsupported → DELETE fallback warn-once; `onOpen` throws → propagate.

#### Pseudo-code / Signatures
```pseudocode
export interface OpenSqliteResilientOptions {
  filePath: string; onOpen?: (db)=>void|Promise<void>;
  label?: string; recoverCorrupt?: boolean;  # default true
}
export async function openSqliteResilient(opts): Promise<PragmaCapable>
  mkdir parent
  try { return await openConcrete(opts) }
  catch (e) { if recoverCorrupt && isCorruptionError(e) { renameAside(filePath); return openConcrete(opts) } throw e }
# openConcrete: loadDriver -> applyWalWithFallback -> await onOpen?(db) -> return db
```

#### Tasks
1. Write RED tests (normal open, EC-7 corruption recovery, recoverCorrupt:false propagates, onOpen error propagates, WAL fallback warn-once).
2. Implement `openSqliteResilient`; export from persistence index.
3. Migrate both `index-db` copies to consume it via `onOpen`.
4. Run the existing EC-7 test in sdk-memory to confirm green.

#### TDD
```
RED:  test_openSqliteResilient_opens_creates_parents_applies_wal() — asserts db opens, file exists
RED:  test_openSqliteResilient_recovers_corrupt_file_renames_aside() — asserts .corrupt-<ts> created, fresh db
RED:  test_openSqliteResilient_recoverCorrupt_false_propagates() — asserts throws
RED:  test_openSqliteResilient_onOpen_error_propagates() — asserts throws callback error
RED:  test_openSqliteResilient_runs_onOpen_after_wal() — asserts onOpen invoked once
GREEN: implement + migrate both index-db copies
REFACTOR: delete duplicated loadDriver/isCorruptionError/renameAside in both copies
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/internal/persistence/sqlite-open.test.ts && pnpm --filter @theokit/sdk-memory test
```

#### Acceptance Criteria
- [ ] `import { openSqliteResilient } from "@theokit/sdk/internal/persistence"` resolves
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/internal/persistence/sqlite-open.test.ts` exits 0 (5 tests; gracefully skipped if better-sqlite3 ABI unavailable, matching existing index-db test convention)
- [ ] Existing `sdk-memory` EC-7 corruption test stays green
- [ ] `grep -n "function renameAside\|function isCorruptionError\|function loadDriver" packages/sdk-memory/src packages/sdk/src/internal/memory` shows the dup removed (lives only in sqlite-open.ts)
- [ ] `CHANGELOG.md` (both packages) updated

#### DoD
- [ ] `pnpm test` green for both packages
- [ ] typecheck + biome clean
- [ ] CHANGELOG updated (both packages)

---

## Coverage Matrix

| # | Gap / Requirement (from gap-audit M0) | Task(s) | Resolution |
|---|---|---|---|
| 1 | M0-1 `isTransientError` not public | T1.1 | Exported predicate delegating to `isRetryable` |
| 2 | M0-2 `createSemaphore`/`mapWithConcurrency` internal + cloned | T3.1 | New `concurrency` subpath; 2 clones deleted |
| 3 | M0-3 generic `withRetry` missing | T4.1 | New `retry` subpath with injectable clock |
| 4 | M0-4 `safeFilenameForId` (divergent variants) | T2.1 | New helper + `sanitizeRunId` migrated |
| 5 | M0-5 `openSqliteResilient` (corruption-recovery locked in sdk-memory) | T5.1 | Extracted to `internal/persistence`; both copies dedup |

**Coverage: 5/5 gaps covered (100%)**

## Global Definition of Done

- [ ] All 5 phases completed
- [ ] `pnpm --filter @theokit/sdk test` (and `@theokit/sdk-memory test` for Phase 5) green
- [ ] `pnpm --filter @theokit/sdk run typecheck` zero errors
- [ ] `pnpm --filter @theokit/sdk exec biome check` zero errors on changed files
- [ ] File-size budget respected (per `rules/architecture.md`; all changed files ≤ 500 LoC)
- [ ] `CHANGELOG.md` updated under `[Unreleased]` for both packages (Unbreakable Rule 6)
- [ ] Backward compatibility preserved across public API (no existing export changed)
- [ ] `pnpm quality:dead` reports zero unallowlisted dead exports for the five new surfaces (no-stubs-no-mocks-no-wired rule)
- [ ] `docs.md` reflects every new public/internal surface (SDK source-of-truth rule)
- [ ] `pnpm --filter @theokit/sdk run build` + `attw` green for `./concurrency` and `./retry`
- [ ] Plan archived to `knowledge-base/plans/completed/` only AFTER `/review` returns `READY_TO_MERGE` and merge

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the changes in a real workload, not just isolated unit tests.

### Execution
```
pnpm --filter @theokit/sdk test
pnpm --filter @theokit/sdk-memory test
pnpm --filter @theokit/sdk run typecheck
pnpm --filter @theokit/sdk exec biome check
pnpm --filter @theokit/sdk run build
pnpm quality:dead
```

### Acceptance Criteria
- [ ] All suites green (sdk + sdk-memory)
- [ ] Zero type errors; zero biome errors on changed files
- [ ] Build + attw green for new subpaths
- [ ] `quality:dead` clean for new surfaces
- [ ] Wiring proof: the two deleted clones (boundedParallel/runBatches) and the migrated `sanitizeRunId` exercise `mapWithConcurrency`/`safeFilenameForId` in their existing tests (real caller, not just unit test)

### If Validation Fails
1. Separate plan-caused failures from pre-existing.
2. Fix all plan-caused failures; re-run the chain.
3. Pre-existing issues logged in the PR description, not blocking.
