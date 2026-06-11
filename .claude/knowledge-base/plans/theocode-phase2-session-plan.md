# Plan: TheoCode Phase 2 — Session Persistence & Lifecycle

> **Version 1.1** — Ships session CRUD, message persistence, context compaction, retry with backoff, overflow detection, run state management, and summary/title generation for the TheoCode coding agent. Phase 2 of the TheoCode roadmap. Informed by the OpenCode blueprint analysis of 22 session files (~7800 LoC) at `knowledge-base/reference/opencode/packages/opencode/src/session/`.

## Goal

> "Ship a `SessionManager` module in a new `packages/theocode/` package that persists coding agent sessions to SQLite, compacts context on overflow, retries on transient LLM errors, and generates session titles, measured by `pnpm --filter @theokit/theocode exec vitest run` exit 0 with 50+ tests covering CRUD, compaction, retry, and overflow."

## Context

TheoCode Phase 1 shipped 12 tool factories. Phase 2 adds session persistence — without it, every agent conversation is ephemeral (lost on process exit). OpenCode persists sessions via Drizzle ORM + Effect-TS (~7800 LoC across 22 files). TheoCode takes the KISS approach: raw `better-sqlite3` prepared statements (already a dep of sdk-memory), plain async/await (no Effect-TS), and 7 focused modules (~1200 LoC total vs OpenCode's 7800).

The key insight from the OpenCode blueprint: session management decomposes into 7 independent concerns that TheoKit already has partial foundations for.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/theocode/` (NEW package) | 0 | — | TheoCode application package | — |
| `packages/theocode/src/session/schema.ts` (NEW) | 0 | — | SQLite schema for sessions + messages | — |
| `packages/theocode/src/session/session-manager.ts` (NEW) | 0 | — | Session CRUD (create, load, list, delete, fork) | — |
| `packages/theocode/src/session/message-store.ts` (NEW) | 0 | — | Message persistence (append, list, prune) | — |
| `packages/theocode/src/session/compaction.ts` (NEW) | 0 | — | Context compaction (summarize + prune) | — |
| `packages/theocode/src/session/retry.ts` (NEW) | 0 | — | Retry with exponential backoff + Retry-After | — |
| `packages/theocode/src/session/overflow.ts` (NEW) | 0 | — | Overflow detection (token budget check) | — |
| `packages/theocode/src/session/run-state.ts` (NEW) | 0 | — | Run state machine (idle/busy/error) | — |
| `packages/theocode/src/session/summary.ts` (NEW) | 0 | — | Title/summary generation via LLM | — |
| `packages/theocode/src/session/index.ts` (NEW) | 0 | — | Session barrel export | — |

### Current callers / dependents

- **`autoSummarize()`** (`sdk/internal/runtime/auto-summarize.ts`) — TheoKit's existing compaction primitive. Reused by compaction module.
- **`compositeScore()`** (`sdk-memory/internal/composite-scorer.ts`) — scoring for session message relevance ranking.
- **`better-sqlite3`** — already a peer dep of sdk-memory. Reused for session SQLite.
- **Phase 1 tools** (12 factories in sdk-tools) — session manager provides context for tool execution (which session, which project root).

### Domain glossary

- **Session** — a persistent conversation between user and agent, with ID, title, timestamps, and associated messages
- **Message** — a single turn (user/assistant/system/tool) with role, content, token count, tool calls
- **Compaction** — reducing conversation context by summarizing old messages when token budget is exceeded
- **Overflow** — condition where total tokens exceed the model's context window minus a safety buffer
- **Run state** — the agent's current execution state (idle, busy, error, cancelled)
- **Retry-After** — HTTP header from LLM providers indicating when to retry after rate limiting

### Architecture boundaries affected

- **New package `@theokit/theocode`** — application-level code on top of `@theokit/sdk`. NOT an SDK package.
- **DIP (`architecture.md`)** — theocode depends on sdk (down), never the reverse. Session manager uses `Agent.create` + `defineTool` from SDK.

## Prior Art & Related Work

- **OpenCode blueprint** — `knowledge-base/discoveries/blueprints/opencode-clone-theokit-blueprint.md` Q3 (session lifecycle)
- **OpenCode `session.ts`** (1200 LoC) — CRUD via Drizzle + Effect. We simplify to raw SQLite.
- **OpenCode `compaction.ts`** (643 LoC) — summarize + prune. We reuse `autoSummarize()`.
- **OpenCode `overflow.ts`** (42 LoC) — token budget check. Simple math, portable as-is.
- **TheoKit `autoSummarize()`** — existing compaction primitive (proven, 11 tests).

## Objective

- [ ] Verify `SessionManager.create()` persists a new session to SQLite, confirmed by 8+ tests
- [ ] Verify `MessageStore.append()` persists messages with roles and token counts, confirmed by 8+ tests
- [ ] Verify `compactSession()` summarizes old messages when overflow detected, confirmed by 8+ tests
- [ ] Verify `retryWithBackoff()` retries on transient errors with exponential delay, confirmed by 6+ tests
- [ ] Verify `isOverflow()` detects when tokens exceed budget, confirmed by 4+ tests
- [ ] Verify `RunState` tracks idle/busy/error transitions, confirmed by 6+ tests
- [ ] Verify `generateTitle()` produces a title from conversation via LLM, confirmed by 4+ tests
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run` exit 0 with 50+ tests

## ADRs

### D1 — New `@theokit/theocode` package for application-level code

**Decision:** Session management lives in a NEW package `packages/theocode/`, not in `@theokit/sdk` or `@theokit/sdk-memory`.

**Rationale:** Per `architecture.md` layering: SDK is the framework; TheoCode is an application. Session persistence is application-specific (schema, lifecycle, UI integration). Per SRP: the SDK should not know about "sessions" — it provides `Agent.create`, tools, and memory primitives. Applications compose them.

**Alternatives considered:**
- **(A) Add session module to `@theokit/sdk`** — rejected: SDK scope creep. Sessions are an application concern.
- **(B) Add to `@theokit/sdk-memory`** — rejected: sdk-memory is about vector indexing + embedding, not conversation persistence.

**Consequences:** New workspace member. New package.json, tsconfig, vitest config. Depends on `@theokit/sdk` as peer dep.

### D2 — Raw `better-sqlite3` prepared statements, not Drizzle ORM

**Decision:** Use `better-sqlite3` directly with prepared statements. No ORM.

**Rationale:** Per KISS: 2 tables (sessions + messages) don't justify an ORM. Per YAGNI: Drizzle adds schema generation, migration tooling, query builder — we don't need any of that for 6 queries. OpenCode uses Drizzle because Effect-TS has a Drizzle integration layer; we use plain async/await.

**Alternatives considered:**
- **(A) Drizzle ORM** — rejected: 2 tables, 6 queries. ORM overhead is unjustified.
- **(B) TheoKit's `@theokit/orm`** — rejected: orm package is for domain entities, not session logs.

**Consequences:** Schema defined as SQL strings (same pattern as `sdk-memory/index-schema.ts`). Migrations via ALTER TABLE.

### D3 — Compaction reuses `autoSummarize()`, not reimplemented

**Decision:** `compactSession()` calls the existing `autoSummarize()` from `sdk/internal/runtime/auto-summarize.ts` when overflow is detected.

**Rationale:** Per DRY: `autoSummarize()` already implements fraction-based trigger + LLM summarization + keepNewest guard. Proven with 11 tests + real OpenRouter validation. No reason to rewrite.

**Alternatives considered:**
- **(A) Port OpenCode's compaction.ts (643 LoC)** — rejected: OpenCode's compaction uses Effect-TS generators, Drizzle queries, and custom summarization. Our `autoSummarize()` does the same thing in 70 LoC.

**Consequences:** TheoCode's compaction is ~30 LoC orchestration (detect overflow → call autoSummarize → persist summarized messages).

### D4 — Retry is a standalone utility, not tied to sessions

**Decision:** `retryWithBackoff(fn, opts)` is a generic retry utility (not session-specific) that handles exponential backoff + Retry-After headers + max attempts.

**Rationale:** Per SRP: retry logic is orthogonal to sessions. Per DRY: other parts of TheoCode (tool execution, LLM calls) will also need retry.

**Alternatives considered:**
- **(A) Retry embedded in session processor** — rejected: tight coupling. Other modules can't reuse it.

**Consequences:** Retry is importable independently. Session processor calls it around LLM calls.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| New package adds workspace complexity | Low | Follows same pattern as 27 existing packages. turbo.json already handles caching. | D1 |
| SQLite file locking on concurrent access | Medium | TheoCode is single-process. File lock via `better-sqlite3` WAL mode (already proven in sdk-memory). | D2 |
| Compaction may lose important context | Medium | `keepNewest` guard preserves last N messages. Full history archived to markdown (per autoSummarize). | D3 |

## Unresolved Questions

- Q1: Should sessions persist tool call results (full output) or just summaries? Start with summaries (per KISS), expand if needed.

## Dependency Graph

```
Phase 2a (Schema + CRUD) ──▶ Phase 2b (Messages + Overflow) ──▶ Phase 2c (Compaction + Retry + State + Summary) ──▶ Phase 2d (Validation)
```

Sequential: messages depend on schema, compaction depends on messages + overflow, etc.

---

## Phase 2a: Schema + Session CRUD

**Objective:** Create the theocode package with SQLite schema and session CRUD.

### T2.1 — Package scaffold + SQLite schema

#### Objective
Create `packages/theocode/` with package.json, tsconfig, vitest config, and SQLite schema for sessions + messages tables.

#### Why this step
1. **What:** Create the new package skeleton + schema.ts with 2 tables (sessions, messages).
2. **Why now:** Per ADR D1: application code lives in its own package. Schema is the foundation all other modules depend on.

#### Evidence
- OpenCode `session/schema.ts:1-25` — defines SessionID, MessageID, PartID via Effect Schema
- TheoKit `sdk-memory/internal/index-schema.ts` — existing SQLite schema pattern to follow

#### Files to edit
```
packages/theocode/package.json (NEW) — package manifest
packages/theocode/tsconfig.json (NEW) — extends base tsconfig
packages/theocode/vitest.config.ts (NEW) — vitest config
packages/theocode/src/session/schema.ts (NEW) — SQL schema strings
packages/theocode/src/session/db.ts (NEW) — openDb() helper
packages/theocode/tests/session/schema.test.ts (NEW) — schema tests
```

#### TDD
```
RED:     test_schema_creates_sessions_table() — verify sessions table exists after init
RED:     test_schema_creates_messages_table() — verify messages table exists
RED:     test_schema_sessions_has_required_columns() — id, title, created_at, updated_at, project_root
RED:     test_schema_messages_has_required_columns() — id, session_id, role, content, token_count, created_at
RED:     test_schema_foreign_key_enforced() — message with invalid session_id → constraint error
GREEN:   Implement schema + openDb
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/session/schema.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/session/schema.test.ts` and confirm exit 0 with 5+ tests passing
- [ ] Run `pnpm --filter @theokit/theocode exec tsc --noEmit` and confirm exit 0

#### DoD
- [ ] Run tests and confirm 5+ pass
- [ ] Run `pnpm --filter @theokit/theocode exec tsc --noEmit` and confirm exit 0

---

### T2.2 — SessionManager CRUD

#### Objective
Create SessionManager with create, load, list, delete, fork operations.

#### Files to edit
```
packages/theocode/src/session/session-manager.ts (NEW)
packages/theocode/src/session/index.ts (NEW)
packages/theocode/tests/session/session-manager.test.ts (NEW)
```

#### TDD
```
RED:     test_create_session_returns_id() — create → { id, title, created_at }
RED:     test_load_session_returns_data() — create then load → same data
RED:     test_list_sessions_returns_all() — create 3 → list returns 3
RED:     test_list_sessions_ordered_by_updated_at() — newest first
RED:     test_delete_session_removes_it() — delete → load returns null
RED:     test_delete_session_cascades_messages() — delete → messages gone
RED:     test_fork_session_copies_messages() — fork → new session with same messages (EC-1: batched INSERT of 500 per chunk)
RED:     test_load_nonexistent_returns_null() — load("fake") → null
GREEN:   Implement SessionManager
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/session/session-manager.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/session/session-manager.test.ts` and confirm exit 0 with 8+ tests passing

---

## Phase 2b: Messages + Overflow

**Objective:** Ship message persistence and overflow detection.

### T2.3 — MessageStore

#### Files to edit
```
packages/theocode/src/session/message-store.ts (NEW)
packages/theocode/tests/session/message-store.test.ts (NEW)
```

#### TDD
```
RED:     test_append_message_persists() — append user message → listBySession returns it
RED:     test_append_multiple_roles() — user, assistant, system, tool → all persisted
RED:     test_list_messages_ordered() — 3 messages → returned in chronological order
RED:     test_message_has_token_count() — append with tokenCount → persisted
RED:     test_message_has_tool_call_id() — tool result message with toolCallId → persisted
RED:     test_prune_oldest() — prune(n=2) → removes 2 oldest, keeps rest
RED:     test_count_tokens_for_session() — 3 messages with 100 tokens each → total 300
RED:     test_list_empty_session() — no messages → empty array
GREEN:   Implement MessageStore
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/session/message-store.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/session/message-store.test.ts` and confirm exit 0 with 8+ tests passing

---

### T2.4 — Overflow detection

#### Files to edit
```
packages/theocode/src/session/overflow.ts (NEW)
packages/theocode/tests/session/overflow.test.ts (NEW)
```

#### TDD
```
RED:     test_overflow_true_when_over_budget() — 9000/10000 tokens, buffer 2000 → overflow
RED:     test_overflow_false_when_under_budget() — 5000/10000 → no overflow
RED:     test_overflow_respects_buffer() — tokens = contextWindow - buffer → overflow (at boundary)
RED:     test_overflow_zero_context_returns_false() — 0 context window → false (unknown model)
GREEN:   Implement isOverflow
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/session/overflow.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/session/overflow.test.ts` and confirm exit 0 with 4+ tests passing

---

## Phase 2c: Compaction + Retry + State + Summary

**Objective:** Ship compaction, retry, run state, and title generation.

### T2.5 — Session compaction

#### Files to edit
```
packages/theocode/src/session/compaction.ts (NEW)
packages/theocode/tests/session/compaction.test.ts (NEW)
```

#### TDD
```
RED:     test_compact_summarizes_old_messages() — 10 messages, overflow → compacted to summary + last N
RED:     test_compact_keeps_newest() — keepNewest=3 → last 3 untouched
RED:     test_compact_skips_when_no_overflow() — under budget → no compaction
RED:     test_compact_persists_summary_message() — summary stored as system message in DB
RED:     test_compact_updates_session_timestamp() — session.updated_at bumped
RED:     test_compact_with_zero_messages() — 0 messages → no-op
RED:     test_compact_calls_llm() — verify callLlm invoked for summarization
RED:     test_compact_with_only_system_messages() — (EC-2) only system messages → no LLM call, messages unchanged
RED:     test_compact_fallback_on_llm_error() — LLM fails → messages unchanged
GREEN:   Implement compactSession (uses autoSummarize per ADR D3)
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/session/compaction.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/session/compaction.test.ts` and confirm exit 0 with 8+ tests passing

---

### T2.6 — Retry with backoff

#### Files to edit
```
packages/theocode/src/session/retry.ts (NEW)
packages/theocode/tests/session/retry.test.ts (NEW)
```

#### TDD
```
RED:     test_retry_succeeds_on_first_attempt() — fn succeeds → returns result, no delay
RED:     test_retry_succeeds_on_second_attempt() — fn fails once then succeeds → 1 retry
RED:     test_retry_exhausts_max_attempts() — fn always fails → throws after maxAttempts
RED:     test_retry_exponential_backoff() — delays double each attempt (100ms, 200ms, 400ms)
RED:     test_retry_respects_retry_after_header() — error with retryAfter → uses that delay
RED:     test_retry_non_retryable_throws_immediately() — non-transient error → no retry
RED:     test_retry_zero_max_attempts_throws() — (EC-3) maxAttempts=0 → throws immediately without calling fn
GREEN:   Implement retryWithBackoff (per ADR D4: standalone utility)
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/session/retry.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/session/retry.test.ts` and confirm exit 0 with 6+ tests passing

---

### T2.7 — Run state machine

#### Files to edit
```
packages/theocode/src/session/run-state.ts (NEW)
packages/theocode/tests/session/run-state.test.ts (NEW)
```

#### TDD
```
RED:     test_initial_state_is_idle() — new RunState → state === "idle"
RED:     test_transition_idle_to_busy() — start() → state === "busy"
RED:     test_transition_busy_to_idle() — complete() → state === "idle"
RED:     test_transition_busy_to_error() — fail(error) → state === "error"
RED:     test_cancel_from_busy() — cancel() → state === "idle"
RED:     test_cannot_start_when_busy() — start() twice → throws BusyError
RED:     test_can_restart_after_error() — (EC-4) fail() then start() → transitions to busy (recovery)
GREEN:   Implement RunState
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/session/run-state.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/session/run-state.test.ts` and confirm exit 0 with 6+ tests passing

---

### T2.8 — Title/summary generation

#### Files to edit
```
packages/theocode/src/session/summary.ts (NEW)
packages/theocode/tests/session/summary.test.ts (NEW)
```

#### TDD
```
RED:     test_generate_title_calls_llm() — verify LLM called with conversation context
RED:     test_generate_title_returns_string() — returns a title string
RED:     test_generate_title_updates_session() — title persisted in sessions table
RED:     test_generate_title_fallback_on_error() — LLM error → returns "Untitled Session"
GREEN:   Implement generateTitle
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/session/summary.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/session/summary.test.ts` and confirm exit 0 with 4+ tests passing

---

## Phase 2d: Integration Validation (MANDATORY)

**Objective:** Validate all session modules work together.

### Execution

```bash
pnpm --filter @theokit/theocode exec vitest run
pnpm --filter @theokit/theocode exec tsc --noEmit
pnpm -w run check
```

### Acceptance Criteria

- [ ] Run `pnpm --filter @theokit/theocode exec vitest run` and confirm exit 0 with 50+ tests passing
- [ ] Run `pnpm --filter @theokit/theocode exec tsc --noEmit` and confirm exit 0
- [ ] Run `pnpm -w run check` and confirm zero lint errors
- [ ] Verify CHANGELOG updated with Phase 2 entries under `[Unreleased] § Added`

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Session CRUD (create, load, list, delete, fork) | T2.1, T2.2 | `SessionManager` with SQLite persistence |
| 2 | Message persistence (append, list, prune, count tokens) | T2.3 | `MessageStore` with role + content + token count |
| 3 | Overflow detection (token budget check) | T2.4 | `isOverflow()` with configurable buffer |
| 4 | Context compaction (summarize + prune) | T2.5 | `compactSession()` reusing `autoSummarize()` (ADR D3) |
| 5 | Retry with backoff (exponential + Retry-After) | T2.6 | `retryWithBackoff()` standalone utility (ADR D4) |
| 6 | Run state machine (idle/busy/error/cancelled) | T2.7 | `RunState` class with transition guards |
| 7 | Title/summary generation via LLM | T2.8 | `generateTitle()` with fallback |
| 8 | SQLite schema (sessions + messages tables) | T2.1 | `schema.ts` with prepared statements |
| 9 | New `@theokit/theocode` package | T2.1 | ADR D1: application-level package |
| 10 | 50+ new tests | T2.1-T2.8 | 5+8+8+4+9+7+7+4 = 52 minimum + integration |
| 11 | TheoCode roadmap Phase 2 complete | T2.1-T2.8 | All 7 session modules + validation |
| 12 | EC-1: Fork batched INSERT (500/chunk) | T2.2 | Prevent SQLite lock on large session fork |
| 13 | EC-2: Compaction with only system messages | T2.5 | No-op when no user/assistant content |
| 14 | EC-3: Retry with zero maxAttempts | T2.6 | Throws immediately |
| 15 | EC-4: RunState error → busy recovery | T2.7 | Allows restart after error |
| 16 | EC-5: pnpm-workspace.yaml already covers packages/* | T2.1 | Documented: no change needed |

**Coverage: 16/16 gaps covered (100%)**

## Global Definition of Done

- [ ] Verify all phases completed
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run` and confirm all tests passing (50+)
- [ ] Run `pnpm --filter @theokit/theocode exec tsc --noEmit` and confirm zero type errors
- [ ] Run `pnpm -w run check` and confirm zero lint warnings
- [ ] Verify file-size budget respected (all files ≤ 500 LoC per `architecture.md`)
- [ ] Verify CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Verify 50+ new tests added across 8 test files
- [ ] Confirm plan archived to `knowledge-base/plans/completed/` after merge

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Full validation chain.

### Execution

```bash
pnpm --filter @theokit/theocode exec vitest run
pnpm --filter @theokit/theocode exec tsc --noEmit
pnpm -w run check
```

### Acceptance Criteria

- [ ] Run `pnpm --filter @theokit/theocode exec vitest run` and confirm exit 0 with 50+ tests
- [ ] Run `pnpm --filter @theokit/theocode exec tsc --noEmit` and confirm exit 0
- [ ] Run `pnpm -w run check` and confirm exit 0
