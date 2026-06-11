# Plan: TheoCode Redistribution — SDK as LEGO Pieces

> **Version 1.1** — Redistribute reusable building blocks from `@theokit/theocode` (a monolithic coding assistant) into the proper SDK packages (`@theokit/sdk-tools`, `@theokit/sdk`), delete redundant code that duplicates existing SDK features, and keep only application-layer code in theocode. This restores the SDK's core design principle: provide composable LEGO pieces for building any agent.
>
> **v1.1 changes:** Absorbed 7 edge cases from review (2026-06-11). EC-1: fix `nextId` module-level bug. EC-2: DirectoryGuard redundant with SDK path-guard — moved to Phase 3 deletions. EC-4: skill-loader.ts addressed. EC-5: run.ts caller check. EC-7: dependency type specified.

## Goal

> "Redistribute 6 reusable modules from `@theokit/theocode` into `@theokit/sdk-tools` and `@theokit/sdk`, delete 4 redundant modules that duplicate existing SDK features, measured by `pnpm validate` exit 0 with all 195+ tests still passing (relocated tests counted at their new package) and zero new cross-package import violations."

## Context

`@theokit/theocode` was built as a 5-phase coding assistant (tools, session, profiles, infra, TUI). During development, several **generic building blocks** (EventBus, PermissionEngine, PlanModeTool, TodolistTool, etc.) were implemented inside theocode instead of in the proper SDK packages. Additionally, some modules (TaskAgentTool, auto-summarize) **duplicate features that already exist in `@theokit/sdk`** (defineSubAgent, auto-summarize.ts).

This violates the SDK mantra: **"O objetivo do SDK e fornecer pecas de LEGO para construir qualquer agente."** A coding assistant is ONE possible assembly of the LEGO pieces — the pieces themselves must live in the SDK packages so any agent can use them.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/theocode/src/tools/plan-mode.ts` | 72 | `7ce9429` (2026-06-11) | Toggle plan/normal mode for agents | Public API: `createPlanModeTool()` |
| `packages/theocode/src/tools/todolist.ts` | 165 | `08624ec` (2026-06-11) | In-session task tracking | Public API: `createTodolistTool()` |
| `packages/theocode/src/tools/task-agent.ts` | 133 | `08624ec` (2026-06-11) | Delegate sub-tasks to child agents | **REDUNDANT** — SDK has `defineSubAgent` |
| `packages/theocode/src/tools/question.ts` | 59 | `7ce9429` (2026-06-11) | Ask clarifying questions to user | Public API: `createQuestionTool()` |
| `packages/theocode/src/tools/truncation.ts` | 56 | `7ce9429` (2026-06-11) | Smart output truncation | Public API: `truncateOutput()` |
| `packages/theocode/src/tools/invalid-repair.ts` | 49 | `7ce9429` (2026-06-11) | Auto-fix malformed tool calls | Internal agent-loop concern |
| `packages/theocode/src/tools/index.ts` | 20 | `08624ec` (2026-06-11) | Barrel export | Re-export from new locations |
| `packages/theocode/src/infra/event-bus.ts` | 53 | `f47ec1d` (2026-06-11) | Typed pub/sub | Public API: `EventBus<Events>` |
| `packages/theocode/src/infra/permissions.ts` | 33 | `f47ec1d` (2026-06-11) | First-match rule engine | Public API: `PermissionEngine` |
| `packages/theocode/src/infra/job-queue.ts` | 68 | `f47ec1d` (2026-06-11) | Background job tracking | Public API: `JobQueue` |
| `packages/theocode/src/infra/directory-guard.ts` | 53 | `f47ec1d` (2026-06-11) | Symlink escape prevention | **REDUNDANT** — SDK has `path-guard.ts` (EC-2) |
| `packages/theocode/src/tools/skill-loader.ts` | 119 | `7ce9429` (2026-06-11) | Load `.theokit/skills/` from filesystem | **STAYS in theocode** — application-specific (EC-4) |
| `packages/theocode/src/infra/formatter.ts` | 42 | `f47ec1d` (2026-06-11) | Code/diff/error formatting | Public API: `formatCode()`, etc. |
| `packages/theocode/src/session/summary.ts` | 28 | `f78ef9d` (2026-06-11) | LLM-based session summary | **REDUNDANT** — SDK has `auto-summarize.ts` |
| `packages/sdk-tools/src/index.ts` | ~60 | varies | Barrel export for tool factories | Must add new exports |
| `packages/sdk/src/index.ts` | ~200 | varies | Main SDK barrel | Must add new exports |
| `packages/sdk/src/a2a/subagent.ts` | 69 | varies | defineSubAgent factory | Existing — no change needed |
| `packages/sdk/src/internal/runtime/auto-summarize.ts` | 75 | varies | Session auto-summarization | Existing — no change needed |
| `examples/theocode-e2e/interactive.ts` | 220 | `08624ec` (2026-06-11) | Interactive REPL | Update imports to new locations |
| `examples/theocode-e2e/run.ts` | 308 | `a17745f` (2026-06-11) | E2E live test | Update imports to new locations |

### Current callers / dependents

- **`createPlanModeTool`**: `examples/theocode-e2e/run.ts:27`, `examples/theocode-e2e/interactive.ts:38`, `tests/tools/plan-mode.test.ts`
- **`createTodolistTool`**: `examples/theocode-e2e/interactive.ts:39`, `tests/tools/todolist.test.ts`
- **`createTaskAgentTool`**: `examples/theocode-e2e/interactive.ts:40` — **TO BE REPLACED by `defineSubAgent`**
- **`createQuestionTool`**: `examples/theocode-e2e/run.ts:27`, `tests/tools/question.test.ts`
- **`EventBus`**: `examples/theocode-e2e/run.ts:30`, `examples/theocode-e2e/interactive.ts`, `tests/infra/event-bus.test.ts`
- **`PermissionEngine`**: `examples/theocode-e2e/run.ts:30`, `tests/infra/permissions.test.ts`
- **`JobQueue`**: `examples/theocode-e2e/run.ts:30`, `tests/infra/job-queue.test.ts`

### Domain glossary

- **Tool factory** — a function like `createFooTool(opts)` that returns `{ name, description, inputSchema, handler }` — the standard shape for LLM-invocable tools in the SDK
- **Building block** — a composable primitive (EventBus, PermissionEngine) that any agent can use, not specific to a coding assistant
- **Application layer** — the theocode-specific assembly (TUI, profiles, session SQLite) that wires building blocks into a coding assistant

### Architecture boundaries affected

- **`@theokit/sdk-tools`** (domain: tool factories) — gains 4 new tool factories + 1 utility module
- **`@theokit/sdk`** (domain: core infrastructure) — gains EventBus, PermissionEngine, JobQueue, DirectoryGuard as public exports
- **`@theokit/theocode`** (application: coding assistant) — becomes a consumer of sdk-tools and sdk, re-exports for backward compat

## Prior Art & Related Work

- **OpenCode reference** (`.claude/knowledge-base/reference/opencode/`) — studied to identify what makes a coding agent complete. Confirms that plan mode, todo tracking, and task delegation are **generic agent patterns**, not coding-assistant-specific.
- **SDK existing features** (`packages/sdk/src/a2a/subagent.ts:1-69`) — `defineSubAgent` already provides declarative child agent delegation with depth tracking. Theocode's `createTaskAgentTool` is redundant.
- **SDK existing features** (`packages/sdk/src/internal/runtime/auto-summarize.ts:1-75`) — already provides session summarization with production guards. Theocode's `summary.ts` is redundant.

## Objective

- [ ] Move 4 tool factories (plan-mode, todolist, question, truncation) to `@theokit/sdk-tools` — fix todolist `nextId` module-level bug (EC-1)
- [ ] Move 3 infra modules (EventBus, PermissionEngine, JobQueue) + formatter to `@theokit/sdk` / `@theokit/sdk-tools`
- [ ] Delete `createTaskAgentTool` (replaced by existing `defineSubAgent`)
- [ ] Delete `summary.ts` (replaced by existing `auto-summarize.ts`)
- [ ] Delete `invalid-repair.ts` (agent-loop internal, not a tool) — verify `run.ts` callers first (EC-5)
- [ ] Delete `DirectoryGuard` (redundant with SDK's `path-guard.ts` per EC-2)
- [ ] Decide on `skill-loader.ts`: leave in theocode (loads `.theokit/skills/` — application-specific) (EC-4)
- [ ] Update all callers (examples, theocode re-exports) to import from new locations
- [ ] Add `@theokit/sdk-tools` and `@theokit/sdk` as `dependencies` (not peerDeps) in theocode `package.json` with `workspace:*` (EC-7)
- [ ] All 195+ tests still pass (monorepo total; theocode-specific count drops as expected per EC-6)
- [ ] `pnpm validate` exit 0

## ADRs

### D1 — Tool factories move to sdk-tools, not sdk

**Decision:** `createPlanModeTool`, `createTodolistTool`, `createQuestionTool`, `truncateOutput` move to `@theokit/sdk-tools`.

**Rationale:** Per `architecture.md § 3` (module cohesion), sdk-tools answers "what tool factories are available?" — these tools follow the exact same `{ name, description, inputSchema, handler }` pattern as the 12 existing tool factories. They are LEGO pieces for any agent.

**Alternatives considered:** Keep in theocode and re-export → rejected because it forces consumers to depend on a coding-assistant package to get generic tools.

**Consequences:** sdk-tools gains 4 exports; theocode re-exports for backward compat during transition.

### D2 — Infrastructure primitives move to sdk

**Decision:** `EventBus`, `PermissionEngine`, `JobQueue` move to `@theokit/sdk`. `formatCode/formatDiff/formatError` move to `@theokit/sdk-tools`. `DirectoryGuard` is deleted (redundant with SDK's `path-guard.ts` per EC-2).

**Rationale:** These are generic building blocks (LEGO pieces) usable by any agent — not specific to a coding assistant. Per `architecture.md § 1` (layered boundaries), they belong in the domain/infrastructure layer, not the application layer.

**Alternatives considered:** Create a separate `@theokit/sdk-infra` package → rejected per YAGNI — the SDK already has infrastructure exports; adding a package for 5 small modules is over-engineering.

**Consequences:** SDK public surface grows by 5 exports. No breaking change — these are new additions.

### D3 — Delete redundant task-agent, summary, invalid-repair

**Decision:** Remove `createTaskAgentTool` (133 LoC), `summary.ts` (28 LoC), `invalid-repair.ts` (49 LoC), `DirectoryGuard` (53 LoC) from theocode. Total: 263 LoC deleted.

**Rationale:** SDK already has `defineSubAgent` (subagent delegation with depth tracking), `auto-summarize.ts` (session summarization with production guards), `path-guard.ts` (symlink escape + sensitive file blocking), and tool dispatch handles invalid calls internally. Per DRY (CLAUDE.md § 12), duplicating knowledge across packages is a bomb.

**Alternatives considered:** Keep both and document the difference → rejected because the differences are trivial (imperative vs declarative) and maintaining two implementations of the same concept violates DRY.

**Consequences:** `examples/theocode-e2e/interactive.ts` switches from `createTaskAgentTool` to `defineSubAgent`. 133+28+49+53 = 263 LoC deleted.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Breaking imports for anyone importing from `@theokit/theocode/tools` | Medium | Theocode re-exports from new locations for 1 release cycle; deprecation warning in JSDoc | Developer |
| sdk-tools package grows — more public surface to maintain | Low | All 4 new tools follow the established pattern; no new concepts added | Developer |
| Risk of circular dependency if sdk-tools imports from sdk | Medium | Verify with `pnpm validate`; tool factories MUST NOT import sdk core (they are domain-level, sdk is infrastructure-level) | Developer |

## Unresolved Questions

- Q1 — Should `formatCode/formatDiff/formatError` be a separate sub-path export (`@theokit/sdk-tools/format`) or merged into the main barrel? Decision: main barrel for now (YAGNI on sub-paths until the barrel grows beyond 20 exports).

## Dependency Graph

```
Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4
(move tools)  (move infra)  (delete redundant)  (update callers + validate)
```

All phases are sequential — each depends on the previous.

---

## Phase 1: Move Tool Factories to sdk-tools

**Objective:** Relocate 4 tool factories + truncation utility from theocode to sdk-tools.

### T1.1 — Move createPlanModeTool to sdk-tools

#### Objective
Move `plan-mode.ts` and its test to `@theokit/sdk-tools`.

#### Why this step
1. **What:** Copy `plan-mode.ts` to `packages/sdk-tools/src/plan-mode.ts`, copy test to `packages/sdk-tools/tests/plan-mode.test.ts`, add to sdk-tools barrel.
2. **Why now:** This is a generic "planning vs execution" toggle usable by any agent — it does not depend on theocode's session, TUI, or profiles. Per D1, tool factories belong in sdk-tools.

#### Evidence
- `packages/theocode/src/tools/plan-mode.ts:32` — `createPlanModeTool()` returns standard `{ name, description, inputSchema, handler }` shape
- `packages/sdk-tools/src/read-file.ts:1` — existing tools follow the exact same pattern
- Zero imports from theocode internals — the module is self-contained

#### Files to edit
```
packages/sdk-tools/src/plan-mode.ts (NEW) — copy from theocode
packages/sdk-tools/tests/plan-mode.test.ts (NEW) — copy from theocode
packages/sdk-tools/src/index.ts — add export
```

#### Deep file dependency analysis
- `plan-mode.ts` has ZERO imports from other theocode modules — it is fully self-contained
- Callers: `examples/theocode-e2e/run.ts:27`, `examples/theocode-e2e/interactive.ts:38` — updated in Phase 4
- Test: `packages/theocode/tests/tools/plan-mode.test.ts` — copied to new location

#### Deep Dives
- The module tracks a mutable `mode` variable (normal|plan). This is stateful but acceptable for a tool factory (same pattern as sdk-tools' git-diff tool which tracks cwd state).
- No edge cases — the module is tiny (72 LoC) and already tested.

#### Tasks
1. Copy `packages/theocode/src/tools/plan-mode.ts` → `packages/sdk-tools/src/plan-mode.ts`
2. Copy `packages/theocode/tests/tools/plan-mode.test.ts` → `packages/sdk-tools/tests/plan-mode.test.ts`
3. Update test import path
4. Add `createPlanModeTool` to `packages/sdk-tools/src/index.ts` barrel

#### TDD
```
RED:     Existing plan-mode.test.ts tests (copied) — must pass in new location
GREEN:   Copy source file; adjust import path in test
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/plan-mode.test.ts
```

#### Acceptance Criteria
- [ ] `grep -r 'createPlanModeTool' packages/sdk-tools/src/index.ts` returns a match
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/plan-mode.test.ts` — 6 tests pass
- [ ] `npx biome check packages/sdk-tools/src/plan-mode.ts` exits 0

#### DoD
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run` — all tests green
- [ ] `pnpm typecheck` exits 0
- [ ] `npx biome check packages/sdk-tools/` exits 0

---

### T1.2 — Move createTodolistTool to sdk-tools

#### Objective
Move `todolist.ts` and its test to `@theokit/sdk-tools`.

#### Why this step
1. **What:** Copy todolist module + test to sdk-tools.
2. **Why now:** Task tracking is a generic agent capability (any agent doing multi-step work benefits). Per D1, it belongs in sdk-tools.

#### Evidence
- `packages/theocode/src/tools/todolist.ts:63` — self-contained, zero theocode imports
- 11 tests in `packages/theocode/tests/tools/todolist.test.ts`

#### Files to edit
```
packages/sdk-tools/src/todolist.ts (NEW) — copy from theocode
packages/sdk-tools/tests/todolist.test.ts (NEW) — copy from theocode
packages/sdk-tools/src/index.ts — add export
```

#### Deep file dependency analysis
- `todolist.ts` imports nothing from theocode — fully self-contained
- Uses internal helpers `ok()`, `fail()`, `requireId()`, `genId()` — all defined in the same file

#### Deep Dives
- Stateful tool (in-memory items array). Acceptable — state is per-tool-instance, not global.
- **EC-1 FIX**: `nextId` is currently module-level (shared across instances). MUST move `let nextId = 1` inside `createTodolistTool()` so each instance gets its own counter. Without this fix, two agents with separate todolists in the same process share a monotonic counter — IDs skip and collide semantically.

#### Tasks
1. Copy `todolist.ts` → `packages/sdk-tools/src/todolist.ts`
2. **EC-1 FIX**: Move `let nextId = 1` from module scope into `createTodolistTool()` body
3. Copy `todolist.test.ts` → `packages/sdk-tools/tests/todolist.test.ts`
4. Add test: `test_two_instances_have_independent_ids` — create two tools, add to each, verify IDs start from 1 independently
5. Update test import path
6. Add to barrel

#### TDD
```
RED:     11 existing todolist tests — must pass in new location
GREEN:   Copy source; adjust import
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/todolist.test.ts
```

#### Acceptance Criteria
- [ ] `grep -r 'createTodolistTool' packages/sdk-tools/src/index.ts` returns a match
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/todolist.test.ts` — 12 tests pass (11 existing + 1 new EC-1 test)
- [ ] `npx biome check packages/sdk-tools/src/todolist.ts` exits 0
- [ ] Two instances created in same test file have independent IDs starting from `todo-1` (EC-1 regression test)

#### DoD
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run` — all tests green
- [ ] `pnpm typecheck` exits 0

---

### T1.3 — Move createQuestionTool to sdk-tools

#### Objective
Move `question.ts` and its test to `@theokit/sdk-tools`.

#### Why this step
1. **What:** Copy question tool to sdk-tools.
2. **Why now:** Asking clarifying questions is a generic agent pattern. Per D1.

#### Evidence
- `packages/theocode/src/tools/question.ts:1` — self-contained, accepts `askUser` callback

#### Files to edit
```
packages/sdk-tools/src/question.ts (NEW)
packages/sdk-tools/tests/question.test.ts (NEW)
packages/sdk-tools/src/index.ts — add export
```

#### Deep file dependency analysis
- Zero theocode imports. Takes `{ askUser, timeoutMs }` options — pure dependency injection.

#### Tasks
1. Copy source + test
2. Update import path in test
3. Add to barrel

#### TDD
```
RED:     Existing question tests — must pass
GREEN:   Copy files
REFACTOR: None
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/question.test.ts
```

#### Acceptance Criteria
- [ ] `grep -r 'createQuestionTool' packages/sdk-tools/src/index.ts` returns a match
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/question.test.ts` — all tests pass
- [ ] `npx biome check packages/sdk-tools/src/question.ts` exits 0

#### DoD
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run` — all tests green
- [ ] `pnpm typecheck` exits 0

---

### T1.4 — Move truncateOutput to sdk-tools

#### Objective
Move `truncation.ts` and test to `@theokit/sdk-tools`.

#### Why this step
1. **What:** Copy truncation utility to sdk-tools.
2. **Why now:** Output truncation is needed by any tool that returns large output. Per D1.

#### Evidence
- `packages/theocode/src/tools/truncation.ts:1` — self-contained, no theocode imports

#### Files to edit
```
packages/sdk-tools/src/truncation.ts (NEW)
packages/sdk-tools/tests/truncation.test.ts (NEW)
packages/sdk-tools/src/index.ts — add export
```

#### Tasks
1. Copy source + test
2. Update import
3. Add to barrel

#### TDD
```
RED:     Existing truncation tests — must pass
GREEN:   Copy files
REFACTOR: None
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/truncation.test.ts
```

#### Acceptance Criteria
- [ ] `grep -r 'truncateOutput' packages/sdk-tools/src/index.ts` returns a match
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/truncation.test.ts` — all tests pass

#### DoD
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run` — all tests green
- [ ] `pnpm typecheck` exits 0

---

## Phase 2: Move Infrastructure to sdk

**Objective:** Relocate 5 generic building blocks from theocode/infra to `@theokit/sdk`.

### T2.1 — Move EventBus to sdk

#### Objective
Move `event-bus.ts` and test to `@theokit/sdk` as a public export.

#### Why this step
1. **What:** Copy EventBus to `packages/sdk/src/event-bus.ts`, export from barrel.
2. **Why now:** Typed pub/sub is a fundamental building block for any agent that needs internal communication. SDK has no equivalent (subscription-runtime is SSE/WS transport, not pub/sub). Per D2.

#### Evidence
- `packages/theocode/src/infra/event-bus.ts:1` — 53 LoC, zero theocode imports
- SDK has no `EventBus` class — verified by grep across `packages/sdk/src/`

#### Files to edit
```
packages/sdk/src/event-bus.ts (NEW)
packages/sdk/tests/event-bus.test.ts (NEW)
packages/sdk/src/index.ts — add export
```

#### Deep file dependency analysis
- Self-contained module using `Map<keyof Events, Set<handler>>`
- Error isolation per handler (try/catch in publish) — important invariant to preserve

#### Tasks
1. Copy source + test
2. Export from sdk barrel
3. Verify no circular deps

#### TDD
```
RED:     Existing event-bus tests — must pass
GREEN:   Copy files
REFACTOR: None
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/event-bus.test.ts
```

#### Acceptance Criteria
- [ ] `grep -r 'EventBus' packages/sdk/src/index.ts` returns a match
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/event-bus.test.ts` — all tests pass
- [ ] `pnpm typecheck` exits 0 (proves no circular deps)

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run` — all tests green
- [ ] `pnpm typecheck` exits 0

---

### T2.2 — Move PermissionEngine to sdk

#### Objective
Move `permissions.ts` to `@theokit/sdk` as a public export alongside existing security primitives.

#### Why this step
1. **What:** Copy PermissionEngine to `packages/sdk/src/permission-engine.ts`.
2. **Why now:** Rule-based tool access control complements the existing path-guard and HITL middleware. Any agent needs permission gating. Per D2.

#### Evidence
- `packages/theocode/src/infra/permissions.ts:1` — 33 LoC, self-contained
- SDK has `hitl-middleware.ts` (approval gating) but NO rule-based permission engine

#### Files to edit
```
packages/sdk/src/permission-engine.ts (NEW)
packages/sdk/tests/permission-engine.test.ts (NEW)
packages/sdk/src/index.ts — add export
```

#### Tasks
1. Copy source + test
2. Export from barrel

#### TDD
```
RED:     Existing permission tests — must pass
GREEN:   Copy files
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/permission-engine.test.ts
```

#### Acceptance Criteria
- [ ] `grep -r 'PermissionEngine' packages/sdk/src/index.ts` returns a match
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/permission-engine.test.ts` — all tests pass

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run` — all tests green
- [ ] `pnpm typecheck` exits 0

---

### T2.3 — Move JobQueue to sdk

#### Objective
Move `job-queue.ts` to `@theokit/sdk`.

#### Why this step
1. **What:** Background job tracking for any agent.
2. **Why now:** SDK has Task registry (5-state, observable) but no simple fire-and-forget JobQueue. Different use case. Per D2.

#### Evidence
- `packages/theocode/src/infra/job-queue.ts:1` — 68 LoC, self-contained

#### Files to edit
```
packages/sdk/src/job-queue.ts (NEW)
packages/sdk/tests/job-queue.test.ts (NEW)
packages/sdk/src/index.ts — add export
```

#### Tasks
1. Copy source + test
2. Export from barrel

#### TDD
```
RED:     Existing job-queue tests — must pass
GREEN:   Copy files
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/job-queue.test.ts
```

#### Acceptance Criteria
- [ ] `grep -r 'JobQueue' packages/sdk/src/index.ts` returns a match
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/job-queue.test.ts` — all tests pass

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run` — all tests green
- [ ] `pnpm typecheck` exits 0

---

### ~~T2.4 — REMOVED (EC-2)~~

> DirectoryGuard is redundant with SDK's `path-guard.ts` (407 LoC, `assertNoSymlinkEscape()` + `safePathJoin()`). Moved to Phase 3 as a deletion target instead of a move.

### T2.4 — Move formatter utilities to sdk-tools

#### Objective
Move `formatCode`, `formatDiff`, `formatError`, `formatFileList` to `@theokit/sdk-tools`.

#### Why this step
1. **What:** Output formatting helpers used by tool implementations.
2. **Why now:** Any tool author formatting code blocks or diffs benefits. Per D2. Goes to sdk-tools (not sdk) because they are tool-authoring utilities.

#### Evidence
- `packages/theocode/src/infra/formatter.ts:1` — 42 LoC, self-contained

#### Files to edit
```
packages/sdk-tools/src/formatter.ts (NEW)
packages/sdk-tools/tests/formatter.test.ts (NEW)
packages/sdk-tools/src/index.ts — add exports
```

#### Tasks
1. Copy source + test
2. Add to barrel

#### TDD
```
RED:     Existing formatter tests — must pass
GREEN:   Copy files
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/formatter.test.ts
```

#### Acceptance Criteria
- [ ] `grep -r 'formatCode' packages/sdk-tools/src/index.ts` returns a match
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/formatter.test.ts` — all tests pass

#### DoD
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run` — all tests green
- [ ] `pnpm typecheck` exits 0

---

## Phase 3: Delete Redundant Modules

**Objective:** Remove 3 modules from theocode that duplicate existing SDK features.

### T3.1 — Delete createTaskAgentTool, replace with defineSubAgent

#### Objective
Remove `task-agent.ts` from theocode and update `interactive.ts` to use SDK's `defineSubAgent`.

#### Why this step
1. **What:** Delete 133 LoC of redundant code. Update the REPL to use the existing SDK primitive.
2. **Why now:** Per D3 and DRY (CLAUDE.md § 12), two implementations of child-agent delegation is a maintenance bomb. `defineSubAgent` already handles depth tracking and tool-shape output.

#### Evidence
- `packages/sdk/src/a2a/subagent.ts:1-69` — existing `defineSubAgent(spec)` with `MaxDelegationDepthError`
- `packages/theocode/src/tools/task-agent.ts:1-133` — reimplements the same concept imperatively

#### Files to edit
```
packages/theocode/src/tools/task-agent.ts — DELETE
packages/theocode/src/tools/index.ts — remove export
examples/theocode-e2e/interactive.ts — replace createTaskAgentTool with defineSubAgent
```

#### Tasks
1. Delete `task-agent.ts`
2. Remove export from `tools/index.ts`
3. Update `interactive.ts` to use `import { defineSubAgent } from "@theokit/sdk"`
4. Verify REPL still works

#### TDD
```
RED:     N/A — deletion, no new tests needed
GREEN:   Delete file, update imports
REFACTOR: None
VERIFY:  pnpm typecheck && pnpm --filter @theokit/theocode exec vitest run
```

#### Acceptance Criteria
- [ ] `test ! -f packages/theocode/src/tools/task-agent.ts` — file does not exist
- [ ] `grep -r 'createTaskAgentTool' packages/ examples/ | wc -l` returns 0
- [ ] `grep -r 'defineSubAgent' examples/theocode-e2e/interactive.ts` returns a match
- [ ] `pnpm typecheck` exits 0

#### DoD
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm --filter @theokit/theocode exec vitest run` — all remaining tests green

---

### T3.2 — Delete redundant summary.ts

#### Objective
Remove `session/summary.ts` — SDK's `auto-summarize.ts` already does this better.

#### Why this step
1. **What:** Delete 28 LoC of redundant summarization code.
2. **Why now:** Per D3, SDK's version has production guards (EC-3, EC-8) that theocode's version lacks.

#### Evidence
- `packages/sdk/src/internal/runtime/auto-summarize.ts:1-75` — full implementation with guards
- `packages/theocode/src/session/summary.ts:1-28` — minimal duplicate

#### Files to edit
```
packages/theocode/src/session/summary.ts — DELETE
packages/theocode/src/session/index.ts — remove export
```

#### Tasks
1. Delete `summary.ts`
2. Remove from barrel
3. Verify no callers break

#### TDD
```
RED:     N/A — deletion
VERIFY:  pnpm --filter @theokit/theocode exec vitest run
```

#### Acceptance Criteria
- [ ] `test ! -f packages/theocode/src/session/summary.ts` — file does not exist
- [ ] `grep -r 'generateTitle\|summary' packages/theocode/src/session/index.ts` — no re-export of deleted symbol
- [ ] `pnpm --filter @theokit/theocode exec vitest run` exits 0

#### DoD
- [ ] `pnpm --filter @theokit/theocode exec vitest run` — all remaining tests green

---

### T3.3 — Delete invalid-repair.ts

#### Objective
Remove `invalid-repair.ts` — this is an internal agent-loop concern, not a user-facing tool.

#### Why this step
1. **What:** Delete 49 LoC. Invalid tool call repair belongs in the agent loop's tool dispatch, not as an exposed tool factory.
2. **Why now:** Per D3, it should not be in the public surface of any package.

#### Evidence
- `packages/theocode/src/tools/invalid-repair.ts:1-49` — only caller is the E2E test
- SDK's agent loop handles invalid tool calls internally

#### Files to edit
```
packages/theocode/src/tools/invalid-repair.ts — DELETE
packages/theocode/tests/tools/invalid-repair.test.ts — DELETE
packages/theocode/src/tools/index.ts — remove export
```

#### Tasks
1. **EC-5 PRE-CHECK**: `grep -rln 'createInvalidToolRepair\|invalid-repair' examples/ packages/theocode/` — remove ALL callers before deleting
2. Delete source + test
3. Remove from barrel

#### TDD
```
RED:     N/A — deletion
VERIFY:  pnpm --filter @theokit/theocode exec vitest run
```

#### Acceptance Criteria
- [ ] `test ! -f packages/theocode/src/tools/invalid-repair.ts` — file does not exist
- [ ] `test ! -f packages/theocode/tests/tools/invalid-repair.test.ts` — test file does not exist
- [ ] `grep -r 'createInvalidToolRepair\|invalid-repair' packages/ examples/ --include="*.ts" | wc -l` returns 0
- [ ] `pnpm --filter @theokit/theocode exec vitest run` exits 0

#### DoD
- [ ] `pnpm --filter @theokit/theocode exec vitest run` — all remaining tests green

---

### T3.4 — Delete DirectoryGuard (redundant with SDK path-guard — EC-2)

#### Objective
Remove `directory-guard.ts` — SDK's `path-guard.ts` already provides `assertNoSymlinkEscape()` + `safePathJoin()` with 407 LoC of production-grade symlink escape prevention.

#### Why this step
1. **What:** Delete 53 LoC of redundant symlink-escape code + its test.
2. **Why now:** Per EC-2, `DirectoryGuard.isAllowed()` duplicates `assertNoSymlinkEscape()` from SDK. Two symlink-escape modules in the same ecosystem confuses consumers ("which one do I use?"). The SDK version is more comprehensive (handles sensitive files, traversal patterns, not just symlinks).

#### Evidence
- `packages/sdk/src/internal/security/path-guard.ts:1-407` — comprehensive path security with `assertNoSymlinkEscape()`, `safePathJoin()`, approved directory lists
- `packages/theocode/src/infra/directory-guard.ts:28-49` — resolves symlinks via `realpathSync` + prefix check — subset of what path-guard does

#### Files to edit
```
packages/theocode/src/infra/directory-guard.ts — DELETE
packages/theocode/tests/infra/directory-guard.test.ts — DELETE
packages/theocode/src/infra/index.ts — remove export
```

#### Tasks
1. Delete source + test
2. Remove from infra barrel
3. Update any theocode callers to use SDK's `safePathJoin()` / `assertNoSymlinkEscape()` if needed

#### TDD
```
RED:     N/A — deletion
VERIFY:  pnpm --filter @theokit/theocode exec vitest run
```

#### Acceptance Criteria
- [ ] `test ! -f packages/theocode/src/infra/directory-guard.ts` — file does not exist
- [ ] `test ! -f packages/theocode/tests/infra/directory-guard.test.ts` — test file does not exist
- [ ] `grep -r 'DirectoryGuard' packages/theocode/src/ --include="*.ts" | wc -l` returns 0 (no source references)
- [ ] `pnpm --filter @theokit/theocode exec vitest run` exits 0

#### DoD
- [ ] `pnpm --filter @theokit/theocode exec vitest run` — all remaining tests green

---

## Phase 4: Update Callers and Validate

**Objective:** Update all imports, add backward-compat re-exports in theocode, run full validation.

### T4.1 — Update theocode barrel to re-export from new locations

#### Objective
Make `@theokit/theocode` re-export the moved modules from their new homes for backward compatibility.

#### Why this step
1. **What:** Update theocode's `tools/index.ts` and `infra/index.ts` to re-export from `@theokit/sdk-tools` and `@theokit/sdk`.
2. **Why now:** Consumers importing from theocode should not break. Per architecture.md § 1 (composition root), the wiring changes at the top.

#### Files to edit
```
packages/theocode/src/tools/index.ts — re-export from @theokit/sdk-tools
packages/theocode/src/infra/index.ts — re-export from @theokit/sdk
```

#### Tasks
1. Update tools barrel to re-export plan-mode, todolist, question, truncation from `@theokit/sdk-tools`
2. Update infra barrel to re-export EventBus, PermissionEngine, JobQueue, formatter from `@theokit/sdk` / `@theokit/sdk-tools` (NOT DirectoryGuard — deleted per EC-2)
3. **EC-7**: Add `@theokit/sdk-tools` and `@theokit/sdk` as `dependencies` (NOT `peerDependencies`) in `packages/theocode/package.json` using `"workspace:*"`. Re-exports require the dependency at runtime, not just dev-time.

#### TDD
```
RED:     Import theocode tools — should still resolve after source deletion
GREEN:   Re-export from new locations
TEST:    (EC-3) test_theocode_reexports_resolve — import createPlanModeTool from theocode barrel, assert it is a function
VERIFY:  pnpm typecheck && pnpm --filter @theokit/theocode exec vitest run
```

#### Acceptance Criteria
- [ ] `import { createPlanModeTool } from "@theokit/theocode/tools"` still works (EC-3)
- [ ] `import { EventBus } from "@theokit/theocode/infra"` still works
- [ ] Typecheck clean
- [ ] `@theokit/sdk-tools` and `@theokit/sdk` listed under `dependencies` (not peerDependencies) in theocode package.json (EC-7)

#### DoD
- [ ] All theocode tests pass
- [ ] `pnpm typecheck` clean

---

### T4.2 — Update examples to import from canonical locations

#### Objective
Update E2E examples to import from sdk-tools and sdk directly (not via theocode).

#### Why this step
1. **What:** Examples should demonstrate the LEGO pattern — import building blocks from their canonical packages.
2. **Why now:** Examples are documentation. They teach consumers the right way to compose.

#### Files to edit
```
examples/theocode-e2e/interactive.ts — update imports
examples/theocode-e2e/run.ts — update imports
examples/theocode-e2e/scenarios.ts — update imports
```

#### Tasks
1. Replace `import { createPlanModeTool } from "../../packages/theocode/..."` with `from "../../packages/sdk-tools/..."`
2. Replace `import { EventBus } from "../../packages/theocode/..."` with `from "../../packages/sdk/..."`
3. Replace `createTaskAgentTool` usage with `defineSubAgent`

#### TDD
```
RED:     Examples must compile
GREEN:   Update imports
VERIFY:  pnpm typecheck
```

#### Acceptance Criteria
- [ ] `grep -r 'theocode/src/tools/' examples/ --include="*.ts" | wc -l` returns 0 (no direct tool imports from theocode)
- [ ] `grep -r 'theocode/src/infra/' examples/ --include="*.ts" | wc -l` returns 0 (no direct infra imports from theocode)
- [ ] `grep -r 'sdk-tools/src/' examples/theocode-e2e/interactive.ts` returns matches (imports from canonical location)
- [ ] `pnpm typecheck` exits 0

#### DoD
- [ ] `pnpm typecheck` exits 0

---

### T4.3 — Delete original theocode source files (moved modules only)

#### Objective
Remove the original files from theocode that were copied to their new homes.

#### Why this step
1. **What:** Delete the source files (not the re-export barrels). The barrels re-export from the new locations.
2. **Why now:** With re-exports in place and tests passing from new locations, the originals are dead code.

#### Files to edit
```
packages/theocode/src/tools/plan-mode.ts — DELETE
packages/theocode/src/tools/todolist.ts — DELETE
packages/theocode/src/tools/question.ts — DELETE
packages/theocode/src/tools/truncation.ts — DELETE
packages/theocode/src/infra/event-bus.ts — DELETE
packages/theocode/src/infra/permissions.ts — DELETE
packages/theocode/src/infra/job-queue.ts — DELETE
packages/theocode/src/infra/formatter.ts — DELETE
(directory-guard.ts already deleted in T3.4)
```

#### Tasks
1. Delete all 9 source files
2. Delete corresponding test files from theocode (they live in sdk-tools/sdk now)
3. Verify re-exports in barrels still resolve (they import from package names, not relative paths)

#### TDD
```
RED:     N/A — deletion
VERIFY:  pnpm typecheck && pnpm --filter @theokit/theocode exec vitest run
```

#### Acceptance Criteria
- [ ] `find packages/theocode/src/tools/ -name "*.ts" ! -name "index.ts" ! -name "skill-loader.ts" | wc -l` returns 0 (only barrel + skill-loader remain)
- [ ] `find packages/theocode/src/infra/ -name "*.ts" ! -name "index.ts" ! -name "git.ts" ! -name "ide-bridge.ts" ! -name "image-handler.ts" ! -name "acp-bridge.ts" | wc -l` returns 0 (only barrel + app-specific remain)
- [ ] `pnpm typecheck` exits 0 (re-exports resolve)
- [ ] `pnpm --filter @theokit/theocode exec vitest run` exits 0

#### DoD
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm --filter @theokit/theocode exec vitest run` — remaining tests green

---

### T4.4 — Full validation

#### Objective
Run the complete validation chain to confirm zero regressions.

#### Why this step
1. **What:** `pnpm validate` — typecheck + build + test + lint across all packages.
2. **Why now:** Final gate before declaring the redistribution complete.

#### Files to edit
```
CHANGELOG.md — add redistribution entry
```

#### Tasks
1. Run `pnpm validate`
2. Fix any issues
3. Update CHANGELOG

#### TDD
```
VERIFY:  pnpm validate
```

#### Acceptance Criteria
- [ ] `pnpm validate` exit 0
- [ ] CHANGELOG updated under `[Unreleased]`
- [ ] Total test count across all packages >= 195

#### DoD
- [ ] Full validation green
- [ ] CHANGELOG entry present

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Tool factories locked in theocode | T1.1, T1.2, T1.3, T1.4 | Moved to sdk-tools |
| 2 | Infra primitives locked in theocode | T2.1, T2.2, T2.3, T2.4 | Moved to sdk / sdk-tools |
| 3 | Redundant createTaskAgentTool | T3.1 | Deleted; replaced by defineSubAgent |
| 4 | Redundant summary.ts | T3.2 | Deleted; SDK has auto-summarize |
| 5 | Redundant invalid-repair.ts | T3.3 | Deleted; agent-loop internal (EC-5: callers verified) |
| 6 | Redundant DirectoryGuard | T3.4 | Deleted; SDK has path-guard (EC-2) |
| 7 | Callers break after move | T4.1 | Re-exports in theocode barrels (EC-3: tested, EC-7: deps type) |
| 8 | Examples teach wrong pattern | T4.2 | Updated to import from canonical packages |
| 9 | Dead code in theocode after move | T4.3 | Original files deleted |
| 10 | Regression risk | T4.4 | Full pnpm validate (EC-6: theocode count drops, monorepo total >=195) |
| 11 | todolist nextId shared state | T1.2 | Fixed: moved inside factory (EC-1) |
| 12 | skill-loader.ts undecided | T4.2 | Decision: stays in theocode — `.theokit/skills/` loading is application-specific (EC-4). Verified in T4.2 that examples do NOT import skill-loader from sdk-tools. |

**Coverage: 12/12 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm test` green across all packages
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings — `pnpm check`
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] Backward compatibility preserved — theocode re-exports from new locations
- [ ] SDK mantra respected — sdk-tools and sdk contain LEGO pieces, theocode contains only application-layer code (session, profiles, TUI, skill-loader)
- [ ] Total test count >= 195 across monorepo (theocode-specific count drops ~45 as tests relocate — expected per EC-6)
- [ ] `nextId` scoped per instance in todolist (EC-1 verified by new test)
- [ ] No `DirectoryGuard` in repo — consumers use SDK's `safePathJoin()` (EC-2)

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the full monorepo after redistribution.

### Execution

```bash
pnpm typecheck                    # zero type errors
pnpm check                       # biome lint + format
pnpm test                        # all package tests
pnpm build                       # all packages build
pnpm validate                    # full validation chain
```

### Acceptance Criteria

- [ ] All test suites green
- [ ] Zero type errors
- [ ] Zero lint warnings
- [ ] `pnpm validate` exit 0
- [ ] No cross-package circular dependencies

### If Validation Fails

1. Identify which failures are from redistribution vs pre-existing
2. Fix redistribution-caused failures
3. Re-run validation
4. Pre-existing issues logged but do not block
