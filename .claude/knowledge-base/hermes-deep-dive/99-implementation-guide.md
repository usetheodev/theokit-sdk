# 99 — TypeScript SDK v1.3 Implementation Guide

> Final synthesis. Reads top-down: dependency order of the 9 features,
> ADR proposals D59-D67, TDD strategy per feature, examples that prove
> each feature, migration impact on v1.2 users, LoC estimates, timeline,
> and risks. This is what feeds into `/to-plan` to produce
> `.claude/knowledge-base/plans/sdk-v1.3-hermes-class-features-plan.md`.

## Executive summary

v1.3 ships 9 Hermes-class features inside `@usetheo/sdk`, behind a
single npm package. Implementation order is dictated by dependency
graph: state persistence + tool registry first (cross-cutting), then
provider plugins (replaces hardcoded v1.2 providers), then the seven
feature domains in parallel where possible. Estimated **~12 weeks of
focused work for N=1 senior developer**; ~6 weeks with two developers
splitting the parallelizable bottom half.

Critical foundations that must land before any of the 9 features:
1. **`getTheokitHome()` + profile isolation** (doc 10) — every other feature uses it
2. **Atomic write + file lock helpers** (doc 10) — cron, kanban, skills, checkpoints all use them
3. **SessionDB + FTS5** (doc 04) — goals, cross-session search depend
4. **Tool registry + `defineTool`** (doc 11) — already in v1.2 (D24); we extend it
5. **Plugin loader** (doc 12) — provider plugins live here
6. **Background review fork** (doc 03 partial) — autonomous skills depend

Then the 9 features. Then 5 cross-cutting hardenings (security, testing).

## Feature catalog and order

| # | Feature | Doc | LoC est | Risk | Phase |
|---|---|---|---|---|---|
| - | Foundations (state, tool registry, plugin loader) | 10, 11, 12 | 1500 | low | 1 |
| 7 | Provider plugins (ProviderProfile ABC) | 07 | 1500 | medium | 2 |
| 4 | Cross-session FTS5 (SessionDB) | 04 | 2000 | low | 2 |
| 8 | Checkpoints v2 | 08 | 1800 | medium | 3 |
| 9 | `no_agent` cron mode | 09 | 800 | low | 3 |
| 6 | 7 execution backends | 06 | 4000 | high | 3 |
| 5 | Dialectic user modeling (Honcho) | 05 | 1200 | medium | 4 |
| 3 | Autonomous skills (Curator + bg review) | 03 | 2500 | high | 4 |
| 2 | `Agent.runUntil(goal)` (Ralph loop) | 02 | 600 | low | 4 |
| 1 | Multi-agent Kanban | 01 | 4500 | very high | 5 |
| - | Security hardening + redaction | 13 | 600 | medium | 6 |
| - | Testing strategy + property tests | 14 | 1000 | low | 6 |

**Total LoC estimate: ~22,000 production + ~12,000 test.** Compare to current SDK: ~10k production + 86 test files. v1.3 roughly doubles the SDK.

## Dependency graph

```
                        ┌──────────────────────────────────────┐
                        │ Foundations (10, 11, 12)             │
                        │ - getTheokitHome / atomic-write / lock│
                        │ - tool registry (extends D24)         │
                        │ - plugin loader (new)                 │
                        └──────────────────────────────────────┘
                                       │
                ┌──────────────────────┼──────────────────────┐
                │                      │                      │
       ┌────────▼──────────┐   ┌──────▼──────────┐   ┌───────▼─────────────┐
       │ Provider plugins  │   │ SessionDB+FTS5  │   │ Plugin loader (12)  │
       │ (07)              │   │ (04)            │   │ (already in foundn) │
       │ Migrate OpenAI/   │   │                 │   │                     │
       │ Anthropic/Gemini  │   └─────┬───────────┘   └─────────┬───────────┘
       │ to plugins        │         │                         │
       └─────┬─────────────┘         │                         │
             │                       │                         │
             ▼                       ▼                         │
       ┌─────────────────┐   ┌───────────────────┐             │
       │ Execution       │   │ Cross-session     │             │
       │ backends (06)   │   │ search (04        │             │
       │                 │   │ extension)        │             │
       └─────────────────┘   └───────────────────┘             │
                                                               │
       ┌──────────────────────────────────────┐                │
       │ Checkpoints v2 (08)                  │                │
       │ - independent of providers           │                │
       └──────────────────────────────────────┘                │
                                                               │
       ┌──────────────────────────────────────┐                │
       │ no_agent cron (09)                   │                │
       │ - already partially in v1.2 (D7,D8)  │                │
       └──────────────────────────────────────┘                │
                                                               │
                ┌────────────────────────────────────┐         │
                │ Background review fork (03)        │         │
                │ - depends on SessionDB             │         │
                │ - depends on tool registry         │         │
                └────────────────────────────────────┘         │
                                       │                       │
                ┌──────────────────────┼──────────────────────┐│
                │                      │                      ││
        ┌───────▼─────────┐   ┌────────▼─────────┐  ┌─────────▼────────┐
        │ Curator (03)    │   │ Dialectic (05)   │  │ Goal/Ralph (02)  │
        │                 │   │ Honcho adapter   │  │                  │
        └─────────────────┘   └──────────────────┘  └──────────────────┘
                                       │
                                       ▼
                            ┌──────────────────────┐
                            │ Kanban (01)          │
                            │ - heaviest feature   │
                            │ - depends on tool    │
                            │   registry + bg fork │
                            └──────────────────────┘
```

The kanban feature lands last because it composes most of the prior pieces: tool registry (worker toolset), background review fork (worker spawning pattern), SessionDB (worker context), atomic writes (jobs.json analog), file locks (heartbeat).

## ADR proposals (D59–D67)

Each ADR follows the format in `theokit-sdk/.claude/knowledge-base/adrs/`.

### D59 — Kanban backend = SQLite with WAL + DELETE fallback

- **Decision**: Use `better-sqlite3` with WAL mode for the kanban board. Fall back to DELETE on NFS/SMB/FUSE (mirroring Hermes' `apply_wal_with_fallback`). One shared DB per board; default board at `~/.theokit/kanban.db`; named boards at `~/.theokit/kanban/boards/<slug>/kanban.db`.
- **Rationale**: Mirrors Hermes' atomic guarantees (doc 01 AD-1). `better-sqlite3` synchronous + WAL gives us the same CAS semantics with no extra deps. NFS fallback is non-optional for users with home dirs on shared filesystems.
- **Consequences**: Adds `better-sqlite3` as required peer dep when kanban is used. Synchronous nature means all kanban operations are blocking — acceptable for our use case (one orchestrator, one worker pool).

### D60 — `Agent.runUntil(goal)` returns AsyncIterable

- **Decision**: `Agent.runUntil(goal, options?)` returns `AsyncIterable<GoalEvent>` with discriminated event kinds (`turn_start`, `agent_response`, `judge_verdict`, `continuation`, `status_change`). Caller can pause/clear via separate methods on Agent.
- **Rationale**: AsyncIterable is the idiomatic TypeScript pattern for streaming-with-control. Discriminated events let consumers filter without parsing strings. Per doc 02 AD-2: continuation prompts go as user messages (cache-preserving).
- **Consequences**: Users get a generator-style API. Existing `agent.send` API unchanged.

### D61 — ProviderProfile is a discriminated type, not an ABC

- **Decision**: `ProviderProfile` is a TypeScript interface (typed data), not an abstract class. Providers register via `defineProvider(profile)` which returns a typed `ProviderPlugin` with `kind: "model-provider"`. Lazy discovery scans `~/.theokit/plugins/model-providers/<name>/` on first request.
- **Rationale**: TypeScript favors interfaces over abstract base classes for data-shape contracts. Lazy discovery matches Hermes pattern (doc 07 AD-2).
- **Consequences**: Migration of v1.2's hardcoded OpenAI/Anthropic/Gemini/OpenRouter to plugins in the same release. v1.2 user-facing API (`Agent.create({ provider, apiKey })`) unchanged.

### D62 — Execution backends as separate npm packages

- **Decision**: Each of the 7 backends ships as a separate `@usetheo/sdk-backend-<name>` peer-dep package. Core ships only the `local` backend by default. Users install `@usetheo/sdk-backend-docker` if they want Docker.
- **Rationale**: 4925 LoC across 7 backends is too heavy for a core install. Most users will use one or two backends. Per-package installs keep the core small and let backend-specific deps (`dockerode`, `modal`, `@daytonaio/sdk`, etc.) stay opt-in.
- **Consequences**: Slightly more friction on user setup ("install the backend package you want"). Cleaner footprint.

### D63 — Memory providers as community packages, only Honcho official

- **Decision**: We ship one official memory-provider adapter (`@usetheo/sdk-memory-honcho`) and define the `MemoryProvider` interface in core. Hindsight, Mem0, Supermemory, ByteRover, RetainDB are community-maintained.
- **Rationale**: Hermes has 8 in-tree providers but closed the policy in May 2026 (AGENTS.md:515-525). Greenfield TheoKit starts with the lesson learned: one reference implementation, rest as plugins.
- **Consequences**: Faster surface stabilization. Community grows the ecosystem.

### D64 — Background review fork = AsyncLocalStorage tool whitelist

- **Decision**: The forked agent's tool whitelist is enforced via Node's `AsyncLocalStorage` (the JS equivalent of Python's thread-local). Non-whitelisted tool calls return structured `tool_error` with the deny reason.
- **Rationale**: Mirrors Hermes' per-thread whitelist pattern (doc 03 AD-3). `AsyncLocalStorage` is the right primitive — concurrent forks don't bleed whitelists into each other.
- **Consequences**: Background review forks can be invoked safely in parallel (e.g. multiple users in a gateway).

### D65 — Curator runs in-process, opt-in 7-day timer

- **Decision**: `Skills.startCurator({ intervalHours: 168, minIdleHours: 2 })` spawns an in-process timer. Default OFF. Users opt in. SDK consumers running outside long-lived processes (Vercel serverless) call `Skills.runCurator()` manually.
- **Rationale**: Long-lived timer in Node is fine for daemons; doesn't fit serverless. Two activation modes cover both.
- **Consequences**: Users in serverless need their own scheduling (cron job from outside). Document clearly.

### D66 — Checkpoints v2 shell out to `git`

- **Decision**: Checkpoint implementation shells out to the system `git` binary instead of using `simple-git` or `isomorphic-git`. Lazy probe via `which` package — if git missing, checkpoints silently disabled (mirrors Hermes AD-10).
- **Rationale**: System git is universal, fast, and reliable. Wrapping libraries add deps and abstraction overhead. The CLI surface is the contract anyway.
- **Consequences**: One more system dependency (git). Document in README.

### D67 — Kanban dispatcher runs in-process OR as a CLI sidecar

- **Decision**: Two activation modes for the dispatcher: (a) in-process via `kanban.startDispatcher()`, (b) standalone via `npx @usetheo/sdk kanban dispatch`. Default to in-process for typical Node service users.
- **Rationale**: Hermes runs the dispatcher in the gateway by default; sidecar for standalone (per AGENTS.md:817-820). Mirroring this gives us both shapes for free.
- **Consequences**: Users in serverless environments use the CLI sidecar plus their own cron. In-process works for long-running services.

## Phased rollout

### Phase 1 — Foundations (weeks 1–2)

**Goal**: Set up the shared primitives every feature uses.

- `packages/sdk/src/internal/paths.ts` — `getTheokitHome()`, `getProfilesRoot()`, `applyProfileOverride()`
- `packages/sdk/src/internal/persistence/atomic-write.ts` — `atomicWriteJson(path, data)`
- `packages/sdk/src/internal/persistence/file-lock.ts` — `withFileLock(path, fn)` via `proper-lockfile`
- `packages/sdk/src/internal/persistence/jittered-retry.ts` — for SQLite WAL contention
- `packages/sdk/src/internal/persistence/schema-version.ts` — migration runner
- Extend `defineTool` (D24) with `emoji`, `requiresEnv`, `checkFn`, `maxResultSizeChars`, `dynamicSchema`
- `packages/sdk/src/internal/plugins/manager.ts` — PluginManager with lazy discovery
- `packages/sdk/src/internal/plugins/context.ts` — PluginContext (registerTool, registerCommand, etc.)
- `packages/sdk/vitest.setup.ts` — autouse hermetic isolation

**RED tests first**:
- `tests/internal/paths.test.ts` — profile isolation, env var resolution
- `tests/internal/atomic-write.test.ts` — crash-mid-write doesn't corrupt
- `tests/internal/file-lock.test.ts` — concurrent contention
- `tests/internal/plugins.test.ts` — registry + lifecycle hooks

**Exit criteria**: All foundation tests pass. ESLint rule banning `os.homedir() + "/.theokit"` literals.

### Phase 2 — Provider plugins + SessionDB (weeks 3–4)

**Goal**: Migrate the 4 hardcoded providers to plugins. Stand up the SQLite + FTS5 layer.

Provider plugins (doc 07):
- `ProviderProfile` type
- `defineProvider(profile)` factory
- `ProviderRegistry` with lazy discovery
- `agent/transports/`: ChatCompletionsTransport, AnthropicTransport, OpenAIResponsesTransport, BedrockTransport
- Migration: `src/internal/providers/builtin/{openai,anthropic,gemini,openrouter}.ts`

SessionDB (doc 04):
- `packages/sdk/src/internal/session-db/connection.ts` — open with WAL + DELETE fallback
- Schema + FTS5 default + trigram tables, triggers
- `_sanitizeFts5Query` — 6-step port
- `searchMessages` — default + trigram routing
- Memory.searchAllSessions wrapper with LLM summarization

**RED tests**:
- Provider migration: existing v1.2 callers still work
- SessionDB: WAL fallback, schema migration, FTS5 sanitization
- Real-LLM: Anthropic call goes through AnthropicTransport correctly

**Exit criteria**: All Phase 1 tests still pass. Hardcoded providers fully removed. `Memory.searchAllSessions` works.

### Phase 3 — Checkpoints + cron + execution backends (weeks 5–6)

**Goal**: Three independent features in parallel.

Checkpoints v2 (doc 08):
- Single shared store at `~/.theokit/checkpoints/store/`
- `ensure`, `list`, `restore`, `prune`
- Auto-prune (orphan + stale + size cap)

`no_agent` cron (doc 09):
- Extend existing `Cron` namespace (D7, D8) with `noAgent: true` option
- Empty stdout = silent
- Non-zero exit = always deliver

Execution backends (doc 06):
- `ExecutionEnvironment` ABC
- `local` in-core
- `docker`, `ssh`, `singularity`, `modal`, `daytona`, `vercel-sandbox` as separate packages
- Session snapshot, CWD marker, interrupt handling, timeout enforcement

**RED tests**:
- Checkpoint: ensure dedup, list ordering, restore correctness, prune behavior
- Cron: noAgent validation, empty stdout silent, non-zero exit alert
- Backends: each backend's spawn + cleanup + snapshot

**Exit criteria**: All three features pass real-LLM validation per `.claude/rules/real-llm-validation.md`.

### Phase 4 — Goals + dialectic + autonomous skills (weeks 7–9)

**Goal**: The three "smart" features that depend on background review fork.

Background review fork (doc 03 prerequisite):
- `_spawnBackgroundReview(messagesSnapshot, reviewMemory, reviewSkills)`
- Forks Agent with parent runtime + cached system prompt
- Per-AsyncLocalStorage tool whitelist
- Auto-deny dangerous commands

Goals (doc 02):
- `GoalManager` class
- `GoalState` persisted in SessionDB.state_meta
- Judge call via auxiliary LLM
- `Agent.runUntil(goal)` AsyncIterable

Dialectic user model (doc 05):
- `MemoryProvider` interface in core
- `@usetheo/sdk-memory-honcho` separate package

Autonomous skills (doc 03):
- `Skills` namespace
- `applyAutomaticTransitions`
- `runCurator` (with snapshot, auto + LLM passes)
- `Skills.startCurator` for the periodic timer
- `.usage.json` sidecar with cross-process locking

**RED tests**:
- Fork: prompt cache parity (byte-equal system prompt), runtime inheritance, whitelist enforcement
- Goal: judge parse failures, auto-pause after 3 consecutive, max_turns enforcement
- Honcho: lifecycle hook invocation, dialectic cache + cadence
- Curator: transitions, snapshot, LLM pass

**Exit criteria**: Real-LLM tests for each. Existing v1.2 examples for memory/cron still work.

### Phase 5 — Kanban (weeks 10–11)

**Goal**: The hardest feature. Build last because it composes everything else.

- `Kanban` namespace
- Schema + migrations
- `claimTask` + `heartbeat` + `releaseStaleClaims` + `reclaimTask` (CAS)
- `completeTask` with hallucination gate (`_verifyCreatedCards`)
- `_recordTaskFailure` (consecutive_failures circuit breaker)
- `Dispatcher.tick` + `startDispatcher`
- Worker tools (`kanban_show`, `kanban_complete`, `kanban_block`, `kanban_heartbeat`, `kanban_comment`, `kanban_create`, `kanban_link`)
- Multi-board support
- `enforceMaxRuntime` with SIGTERM/SIGKILL escalation

**RED tests** (port Hermes' stress tests):
- `tests/stress/test_concurrency_reclaim_race.py` → `kanban.reclaim-race.test.ts`
- `tests/stress/test_concurrency_parent_gate.py` → `kanban.parent-gate.test.ts`
- `tests/stress/test_property_fuzzing.py` → `kanban.property.test.ts` (using fast-check)
- `tests/stress/test_atypical_scenarios.py` → `kanban.edge-cases.test.ts`
- `tests/stress/test_subprocess_e2e.py` → `kanban.subprocess.test.ts`

**Exit criteria**: All concurrency tests pass. Real-LLM E2E: spawn 3 workers, each completes a task, hallucination gate trips on phantom card claim.

### Phase 6 — Security hardening + docs (week 12)

**Goal**: Final pass. Mirror Hermes' 12 v0.13 P0/P1 closures.

Security (doc 13):
- `Security.redact(text)` with full prefix pattern list
- `Security.checkUrlForSecrets`, `Security.isProtectedPath`
- Frozen redaction state at module load (no runtime disable)

Testing (doc 14):
- Property tests for kanban invariants
- Real-LLM validation suite
- Coverage report wired to CI (metric, not gate)

Documentation:
- Update `docs.md` with all v1.3 additions
- Per-feature user guides
- Migration guide for v1.2 users
- Examples directory (one per feature)

**Exit criteria**: All real-LLM tests pass per `.claude/rules/real-llm-validation.md`. CHANGELOG.md complete. `docs.md` reflects every new public API.

## Examples to ship

One per feature, minimum. Reuses Hermes' example patterns adapted to TypeScript:

| Example | Demonstrates |
|---|---|
| `examples/kanban-quickstart/` | Orchestrator + 1 worker + 1 task |
| `examples/kanban-multi-board/` | Two boards isolated |
| `examples/kanban-hallucination-gate/` | Hallucination gate trips |
| `examples/goal-quickstart/` | runUntil + judge |
| `examples/goal-with-criteria/` | /subgoal pattern |
| `examples/autonomous-skills/` | Background review creates a skill |
| `examples/curator-weekly/` | Curator periodic run |
| `examples/cross-session-search/` | searchAllSessions |
| `examples/cross-session-cjk/` | CJK trigram search |
| `examples/dialectic-honcho/` | Honcho integration |
| `examples/backend-docker/` | Docker backend |
| `examples/backend-modal/` | Modal backend |
| `examples/backend-vercel-sandbox/` | Vercel Sandbox |
| `examples/provider-plugin-custom/` | User-defined provider plugin |
| `examples/checkpoint-restore/` | Edit + restore |
| `examples/cron-no-agent-watchdog/` | Bash watchdog cron |

## Migration impact on v1.2 users

| Change | Impact |
|---|---|
| Hardcoded providers → plugins | Invisible. v1.2 `Agent.create({ provider, apiKey })` API unchanged. |
| `Cron` now supports `noAgent: true` | Additive. Existing agent jobs unaffected. |
| New `Kanban`, `Skills`, `Checkpoint` namespaces | Additive. No breaking changes. |
| `Agent.runUntil(goal)` | New method. Existing `agent.send` unchanged. |
| `Memory.searchAllSessions` | New method. Built-in memory unchanged. |
| `ExecutionEnvironment` peer-dep split | Users who used the local-only execution path (current v1.2 default) keep working. Users who want other backends install the appropriate peer dep. |
| `THEOKIT_HOME` env var | Backwards-compat: defaults to `~/.theokit/`. v1.2 users with state in a different location set the env var. |

**Breaking changes: none in public API.** Internal refactors (provider routing, tool registry extensions) are invisible.

## Timeline

| Phase | Weeks | Person-weeks | Description |
|---|---|---|---|
| 1 | 1–2 | 2 | Foundations |
| 2 | 3–4 | 2 | Provider plugins + SessionDB |
| 3 | 5–6 | 2 | Checkpoints + cron + backends |
| 4 | 7–9 | 3 | Goals + dialectic + autonomous skills |
| 5 | 10–11 | 2 | Kanban |
| 6 | 12 | 1 | Security + docs |
| **Total** | **12 weeks** | **12 person-weeks** | |

With two developers splitting Phases 3 and 4 in parallel: 8–9 weeks elapsed time, ~12 person-weeks of effort.

## Risks called out

### Highest

- **Kanban** (doc 01) — two attempts in two Hermes releases. v0.12 first attempt was reverted. v0.13 has multiple in-flight fix PRs. The hardest distributed-coordination work in the SDK. Mitigation: port Hermes' stress test suite verbatim *first*, before writing implementation. Property-based testing with `fast-check`.

- **Execution backends** (doc 06) — 4925 LoC across 7 backends. Each has its own SDK quirks (Modal `Sandbox.create.aio`, Daytona `get/list` migration, Vercel Sandbox very new). Per-package split (D62) helps isolate. Mitigation: ship `local` first; others incrementally.

- **Autonomous skills + Curator** (doc 03) — fragile across releases (v0.12 to v0.13 changes). The background review fork has 12 distinct failure modes documented (TUI deadlock, prompt cache miss, agent provenance leak, etc.). Mitigation: implement strictly to the Hermes spec; do NOT improve until v1.4.

### Medium

- **Provider plugins** (doc 07) — migration of hardcoded providers can subtly break v1.2 callers. Comprehensive regression suite required.

- **Honcho adapter** (doc 05) — depends on a third-party SDK that may change. Pin a specific version.

- **Cron with workdir** (doc 09) — security concern with arbitrary workdir + script paths. Validate at create time.

- **Security redaction** (doc 13) — v0.12-v0.13 round trip shows this is hard to get right. False positives corrupt content; false negatives leak secrets. Mitigation: extensive test coverage including the `code_file` edge case.

### Low

- **Goal/runUntil** (doc 02) — single file, well-bounded primitive.

- **Cross-session FTS5** (doc 04) — mature SQLite usage. Lowest engineering risk.

- **no_agent cron** (doc 09) — small extension on top of D7/D8.

- **Checkpoints v2** (doc 08) — single file, well-bounded, shell-out to git.

## Open questions for human review

These cannot be resolved by reading source alone. They came up across all 16 prior docs. Listed in order of urgency:

1. **DEFAULT_FAILURE_LIMIT for Kanban**: 2 (per `kanban_db.py:2887`) or 5 (per AGENTS.md:828-830)? AGENTS.md is likely stale. Verify before locking the SDK default.
2. **Kanban scope for v1.3**: full worker lifecycle (heartbeat/reclaim/zombie/hallucination) or simpler single-process board? Hermes shipped only the full version.
3. **`workflow_template_id` / `step_key` columns**: v2 forward-compat, currently unused. Ship them for future-proofing or omit?
4. **Cron `noAgent`**: env var inheritance from agent context? Hermes' implementation is opaque — script gets its own clean env.
5. **Provider plugin migration**: in same v1.3 release or separate? Hermes shipped the ABC and migrations together; recommend same release.
6. **Active Memory dialectic mode**: wrap Honcho SDK (peer dep) or reimplement? Recommend wrap.
7. **Singularity backend**: AGENTS.md mentions it; release notes don't elaborate. Confirm it's actually implemented (file exists) before promising.
8. **Codex `_parent_api_mode == "codex_app_server"` downgrade**: TheoKit doesn't have Codex/ChatGPT auth. Any equivalent path we'd miss?
9. **Per-user vs per-profile peer scoping**: gateway use case where one agent serves many users. Honcho handles it via per-user peer_id. Our SDK API: `Agent.create({ userId })` plumbed through to provider.
10. **Schema version compat**: Hermes is at SCHEMA_VERSION 11. Start fresh at 1 for TheoKit (incompatible DBs, easier maintenance)? Recommend yes.
11. **`state_meta` table**: internal-only or public? Hermes uses for goals + future state. Recommend internal.
12. **Provider package naming**: `@usetheo/sdk-backend-docker` or `@usetheo/backend-docker`? Keep `sdk-` prefix for consistency.
13. **Backend bundle vs peer-deps split**: D62 says split. Confirm with user.
14. **Migration assistance from Hermes**: do we offer `theokit migrate-from-hermes`? Probably yes but out of v1.3 scope.

## What this guide produces

When this doc is fed to `/to-plan sdk-v1.3-hermes-class-features`, the resulting plan should:

- Have 6 phases mapping 1-to-1 to the above.
- Have task breakdowns per ADR (D59-D67).
- Reference the 16 deep-dive docs as the spec sources of truth.
- Include the migration impact statement verbatim.
- Include the open questions list for human decision before phase 1 starts.

## References

Every doc in `.claude/knowledge-base/hermes-deep-dive/`:

- `00-orientation.md` — codebase reality + 12-release diary
- `01-kanban.md` — heaviest doc, 80+ citations, 12 ADs, 13 failure modes
- `02-runUntil-goal.md` — `/goal` Ralph loop
- `03-autonomous-skills.md` — Curator + background review fork
- `04-cross-session-fts5.md` — SQLite + FTS5 + trigram + LLM summarization
- `05-dialectic-user-model.md` — Honcho + MemoryProvider ABC
- `06-execution-backends.md` — 7 backends + unified spawn-per-call
- `07-provider-plugins.md` — ProviderProfile + Transport ABC
- `08-checkpoints-v2.md` — single shared shadow git store
- `09-no-agent-cron.md` — script-only cron mode
- `10-state-persistence.md` — `~/.hermes/` cross-cutting layout
- `11-tool-registry.md` — registration + toolsets + check_fn cache
- `12-plugin-loader.md` — PluginManager + lifecycle hooks
- `13-security-redaction.md` — redact + 12 P0/P1 closures
- `14-testing-strategy.md` — run_tests.sh + conftest + change-detector ban

All citations in those docs point to `referencia/hermes-agent/` source paths. The deep-dive is internally consistent: any claim has a primary-source citation and a TypeScript translation.
