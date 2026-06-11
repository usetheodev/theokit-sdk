# Plan: Close Top 5 DeepAgents Parity Gaps

> **Version 1.1** — Implements 5 features identified by the cross-validation against deepagents (score 3.92→4.3 projected): sandbox isolation backend, integrated subagent delegation, built-in coding tools export, HITL interrupt middleware, and auto-summarization trigger. Each gap is a self-contained phase with its own tests and acceptance criteria.

## Goal

> "Ship 5 new SDK capabilities (sandbox backend protocol, subagent delegation via tool, `@theokit/sdk/tools` public export, HITL interrupt middleware, auto-summarization trigger) so that `pnpm typecheck && pnpm test` exit 0 with 50+ new tests covering the 5 gaps, measured by cross-validation score rising from 3.92 to ≥4.2/5.0."

## Context

The 2026-06-10 cross-validation against LangChain's DeepAgents scored theokit-sdk at 3.92/5.0. The report identified 8 gaps; the user selected the top 5 by impact. Each gap has a concrete reference implementation in deepagents with file:line evidence. TheoKit already has partial foundations for 3 of the 5 gaps (A2A message bus for subagent delegation, sdk-tools for coding tools, compression pipeline for summarization).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/sandbox/types.ts` (NEW) | 0 | — | Sandbox backend protocol types | — |
| `packages/sdk/src/sandbox/index.ts` (NEW) | 0 | — | Sandbox module barrel | — |
| `packages/sdk/src/sandbox/docker-sandbox.ts` (NEW) | 0 | — | Docker sandbox implementation | — |
| `packages/sdk/src/a2a/message-bus.ts` | 78 | `427373b` (2026-06-09) | In-process message routing | Keep existing `send`/`request` API |
| `packages/sdk/src/a2a/subagent.ts` (NEW) | 0 | — | Subagent spec + delegation | — |
| `packages/sdk/src/a2a/types.ts` | 16 | `427373b` (2026-06-09) | A2A message types | Extend, don't break |
| `packages/sdk-tools/src/index.ts` | ~30 | latest | Tools barrel | Add all tool exports |
| `packages/sdk/src/internal/runtime/hitl-middleware.ts` (NEW) | 0 | — | HITL interrupt middleware | — |
| `packages/sdk/src/internal/runtime/hooks-executor.ts` | ~150 | latest | Shell hook executor | Extend with HITL event |
| `packages/sdk/src/internal/runtime/auto-summarize.ts` (NEW) | 0 | — | Auto-trigger summarization | — |
| `packages/sdk/src/internal/runtime/compression-summarizer.ts` | ~80 | `0b7c87b` (2026-06-09) | Core compression logic | Reuse `compressConversationWindow` |
| `packages/sdk/package.json` | ~120 | `d7ba1c4` (2026-06-10) | SDK manifest | Add `./sandbox`, `./tools` exports |
| `tests/sandbox/sandbox-protocol.test.ts` (NEW) | 0 | — | — | — |
| `tests/a2a/subagent-delegation.test.ts` (NEW) | 0 | — | — | — |
| `tests/tools/tools-export.test.ts` (NEW) | 0 | — | — | — |
| `tests/hitl/hitl-middleware.test.ts` (NEW) | 0 | — | — | — |
| `tests/internal/runtime/auto-summarize.test.ts` (NEW) | 0 | — | — | — |

### Current callers / dependents

- **`MessageBus`** — exported from `@theokit/sdk/a2a`; used in `tests/a2a/` (2 test files); no production callers yet
- **`compressConversationWindow`** — internal; called by agent loop compression pipeline; 6 test files
- **`createReadFileTool` / `createGitDiffTool` etc.** — exported from `@theokit/sdk-tools`; used in `tests/` (7 test files); not in SDK barrel
- **Hook system** (`hooks-executor.ts`) — internal; called by agent loop; shell-based pre/post tool events

### Domain glossary

- **SandboxBackend** — pluggable execution environment (Docker container, VM, cloud sandbox) that isolates tool execution from the host OS
- **SubAgent spec** — declarative config for a child agent that inherits parent context (model, tools, permissions) and is invocable as a tool
- **HITL** — Human-In-The-Loop: pausing agent execution before a dangerous tool call, waiting for human approval, then resuming
- **Auto-summarization** — automatic conversation compaction triggered when token usage exceeds a threshold

### Architecture boundaries affected

- **New public sub-path exports:** `@theokit/sdk/sandbox` (types + protocol), `@theokit/sdk/tools` (re-export from sdk-tools)
- **DIP boundary (per `architecture.md`):** `SandboxBackend` is a domain interface; `DockerSandbox` is an infrastructure adapter
- **Internal runtime layer:** HITL middleware + auto-summarize live in `internal/runtime/` alongside existing hooks and compression

## Prior Art & Related Work

- **DeepAgents `SandboxBackendProtocol`** — `libs/deepagents/deepagents/backends/protocol.py`: defines `execute()`, `upload_files()`, all file operations derived from these two primitives
- **DeepAgents `SubAgent` TypedDict** — `libs/deepagents/deepagents/middleware/subagents.py`: declarative subagent specs with automatic tool registration
- **DeepAgents `SummarizationMiddleware`** — `libs/deepagents/deepagents/middleware/summarization.py`: fraction-based trigger (85% context window)
- **Existing TheoKit compression pipeline** — `internal/runtime/compression-*.ts`: model registry + config resolution + `compressConversationWindow` (reusable)

## Objective

- [ ] Verify `SandboxBackend` interface defined with `execute()` + `readFile()` + `writeFile()` at `@theokit/sdk/sandbox`
- [ ] Verify `DockerSandbox` adapter passes 8+ sandbox protocol tests
- [ ] Verify `defineSubAgent()` creates a callable tool from an agent spec, confirmed by 8+ delegation tests
- [ ] Verify `@theokit/sdk-tools` barrel re-exported via `@theokit/sdk/tools` sub-path, confirmed by import test
- [ ] Verify HITL middleware pauses execution and waits for approval callback, confirmed by 8+ tests
- [ ] Verify auto-summarization triggers at configurable threshold, confirmed by 6+ tests
- [ ] Run `pnpm typecheck && pnpm test` exit 0 with 50+ new tests

## ADRs

### D1 — SandboxBackend as domain interface with 2-primitive protocol

**Decision:** Define `SandboxBackend` with only `execute(command): Promise<ExecuteResult>` and `uploadFile(path, content): Promise<void>` as abstract methods. All higher-level ops (`readFile`, `writeFile`, `glob`, `grep`) are derived methods on the base class.

**Rationale:** Per DIP (`architecture.md`): domain defines contract, infrastructure implements. DeepAgents proves this works — their `BaseSandbox` derives 6 operations from `execute()` + `upload_files()`. Per KISS: 2 abstract methods means new backends (Firecracker, E2B, cloud) only need to implement 2 methods.

**Alternatives considered:**
- **(A) Flat interface with 8 methods** — rejected: every new backend would need to implement all 8, most of which are boilerplate shell wrappers around `execute`.

**Consequences:** Backend authors implement only `execute` + `uploadFile`. Derived methods are tested once at the base class level.

### D2 — SubAgent as declarative spec auto-registered as tool

**Decision:** `defineSubAgent(spec: SubAgentSpec): CustomTool` returns a tool that, when invoked by the LLM, creates a child agent with the spec's config and sends the input as a message.

**Rationale:** Per KISS: a subagent IS a tool from the parent agent's perspective. DeepAgents proves this pattern — `task(agent_name, input)` is just a tool call. TheoKit already has `defineTool` for typed tools; `defineSubAgent` is sugar on top.

**Alternatives considered:**
- **(A) Middleware-based delegation** — rejected: TheoKit doesn't have a middleware stack (hooks are shell-based, not composable). Building a full middleware system for one feature violates YAGNI.

**Consequences:** SubAgents inherit parent model by default; overridable via spec. No automatic permission inheritance (KISS — add when needed).

### D3 — HITL as async callback middleware, not shell hook

**Decision:** HITL is a new middleware type (`HitlMiddleware`) that intercepts `preToolUse` events, yields control to a caller-provided `approve(toolName, input): Promise<boolean>` callback, and resumes or aborts based on the result.

**Rationale:** Shell hooks (`hooks-executor.ts`) are one-shot subprocess calls — they can't pause and wait for human input over HTTP/WebSocket. HITL requires an async approval flow. Per SRP: shell hooks handle automation; HITL handles human approval — different concerns.

**Alternatives considered:**
- **(A) Extend shell hook system with stdin/stdout IPC** — rejected: breaks the fire-and-forget subprocess model; introduces deadlock risk.

**Consequences:** HITL is opt-in via `Agent.create({ hitl: { tools: ["execute", "writeFile"], approve: async (name, input) => ... } })`. Not a breaking change.

### D4 — Auto-summarization reuses existing compression pipeline

**Decision:** Auto-summarization is a thin trigger layer that calls the existing `compressConversationWindow()` when token usage exceeds a configurable fraction of the model's context window.

**Rationale:** Per DRY: the compression logic already exists and is tested. The only missing piece is the trigger. Per YAGNI: DeepAgents has 2 middleware layers (auto + manual tool); we only need the auto-trigger for now.

**Alternatives considered:**
- **(A) Build new summarization from scratch** — rejected: `compressConversationWindow` already works, has 6 tests, and handles failure gracefully.

**Consequences:** Reuses `resolveCompressionConfig`, `compressConversationWindow`, and the model registry. New code is ~50 LoC trigger + config.

### D5 — Export sdk-tools via SDK sub-path, not duplicate

**Decision:** Add `@theokit/sdk/tools` sub-path export that re-exports from `@theokit/sdk-tools`. No code duplication.

**Rationale:** Per DRY: the tools already exist in sdk-tools with full test coverage. Re-exporting via a sub-path gives consumers a single install (`@theokit/sdk`) for the common case. Per the existing pattern: SDK already re-exports `@theokit/sdk-memory` via optional peer routing.

**Alternatives considered:**
- **(A) Copy tool files into SDK source** — rejected: violates DRY, creates maintenance burden.

**Consequences:** `@theokit/sdk-tools` becomes a required (not optional) dependency of the SDK for the `./tools` sub-path.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Docker dependency for sandbox — not all environments have Docker | Medium | `DockerSandbox` is optional; `LocalSandbox` (no isolation) is the default. Tests use a mock sandbox. | Phase 1 |
| SubAgent tool risk: infinite recursion (agent calls subagent calls parent) | High | Max delegation depth = 3 (configurable). Throw `MaxDelegationDepthError` at limit. | Phase 2 |
| HITL `approve` callback risk: hangs forever if consumer forgets to respond | Medium | Default timeout of 5 minutes; configurable via `hitl.timeoutMs`. Timeout = reject. | Phase 4 |
| Auto-summarization risk: loses important context | Medium | Keep the newest N messages untouched (configurable `keep` parameter). Archive full history to markdown file. | Phase 5 |

## Unresolved Questions

- Q1: For `DockerSandbox`, use `dockerode` (npm) or shell out to `docker exec`? Shell is simpler (KISS) but `dockerode` is more reliable for streaming. Defer to implementation — start with shell, upgrade if needed.

## Dependency Graph

```
Phase 1 (Sandbox) ──▶ Phase 3 (Tools export — depends on sandbox types for shell tool upgrade)
Phase 2 (Subagents) ──▶ (independent)
Phase 4 (HITL) ──▶ (independent)
Phase 5 (Summarization) ──▶ (independent — reuses existing compression)
Phase 6 (Integration Validation) ◀── all above
```

Phases 2, 4, 5 can run in parallel. Phase 3 depends on Phase 1 (sandbox types inform tool hardening).

---

## Phase 1: Sandbox Isolation Backend

**Objective:** Ship `@theokit/sdk/sandbox` sub-path with `SandboxBackend` protocol + `DockerSandbox` adapter + `LocalSandbox` (no-op passthrough).

### T1.1 — Define SandboxBackend protocol types

#### Objective
Define the `SandboxBackend` interface and result types.

#### Why this step
1. **What:** Create `sandbox/types.ts` with `SandboxBackend` abstract class, `ExecuteResult`, `SandboxConfig`.
2. **Why now:** All downstream work (Docker adapter, tool integration, HITL) depends on this contract. Per ADR D1: 2 abstract methods, derived ops on base class.

#### Evidence
- DeepAgents `SandboxBackendProtocol` at `libs/deepagents/deepagents/backends/protocol.py:1` — `execute()` + `upload_files()` pattern proven
- No sandbox types exist in theokit-sdk today (grep confirmed)

#### Files to edit
```
packages/sdk/src/sandbox/types.ts (NEW) — SandboxBackend abstract class + result types
packages/sdk/src/sandbox/local-sandbox.ts (NEW) — LocalSandbox (subprocess, no isolation)
packages/sdk/src/sandbox/docker-sandbox.ts (NEW) — DockerSandbox (container isolation)
packages/sdk/src/sandbox/index.ts (NEW) — barrel export
packages/sdk/package.json — add "./sandbox" sub-path export
tests/sandbox/sandbox-protocol.test.ts (NEW) — protocol conformance tests
```

#### Deep file dependency analysis
- `sandbox/types.ts`: new file, no existing callers. Will be consumed by `docker-sandbox.ts`, `local-sandbox.ts`, and potentially `shell-tool.ts` (future integration).
- `package.json`: adding `"./sandbox"` export alongside existing `"./a2a"`, `"./rag"` etc.

#### Deep Dives

**SandboxBackend abstract class:**
```typescript
export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface SandboxConfig {
  workDir?: string;
  timeoutMs?: number;  // default 30_000
  maxOutputBytes?: number;  // default 5MB
}

export abstract class SandboxBackend {
  abstract execute(command: string, opts?: { timeoutMs?: number }): Promise<ExecuteResult>;
  abstract uploadFile(path: string, content: string | Buffer): Promise<void>;

  // Derived (implemented once, all backends get them for free)
  async readFile(path: string): Promise<string> { ... }
  async writeFile(path: string, content: string): Promise<void> { ... }
  async glob(pattern: string, cwd?: string): Promise<string[]> { ... }
  async grep(pattern: string, path?: string): Promise<string[]> { ... }
  async listDir(path: string): Promise<string[]> { ... }

  [Symbol.asyncDispose]?(): Promise<void>;  // cleanup (stop container, etc.)
}
```

**LocalSandbox:** delegates to `child_process.execFile` with split args (NOT `exec` with a string — EC-1 command injection guard). `LocalSandbox` is NOT a security boundary — document explicitly. Reject commands containing shell metacharacters (`;`, `&&`, `|`, `$()`) with `SandboxSecurityError`.
**DockerSandbox:** `docker exec` in a pre-started container. Throw `SandboxNotAvailableError` when container is not running (EC-5).

#### Tasks
1. Create `sandbox/types.ts` with abstract class + types
2. Create `sandbox/local-sandbox.ts` — subprocess implementation
3. Create `sandbox/docker-sandbox.ts` — Docker shell-out implementation
4. Create `sandbox/index.ts` barrel
5. Add `"./sandbox"` to `package.json` exports
6. Write protocol conformance tests (using `LocalSandbox`)

#### TDD
```
RED:     test_execute_returns_stdout_stderr_exitcode() — LocalSandbox.execute("echo hello") returns {stdout:"hello\n", exitCode:0}
RED:     test_execute_timeout() — LocalSandbox.execute("sleep 10", {timeoutMs: 100}) returns {timedOut: true}
RED:     test_read_file_returns_content() — LocalSandbox.readFile reads a temp file
RED:     test_write_file_creates_file() — LocalSandbox.writeFile + readFile roundtrip
RED:     test_glob_matches_pattern() — LocalSandbox.glob("*.ts") in temp dir
RED:     test_grep_finds_pattern() — LocalSandbox.grep("hello") in temp file
RED:     test_upload_file() — LocalSandbox.uploadFile writes content
RED:     test_max_output_truncation() — large output capped at maxOutputBytes
RED:     test_execute_rejects_shell_metacharacters() — (EC-1) LocalSandbox.execute("echo hello; rm -rf /") throws SandboxSecurityError
RED:     test_docker_sandbox_throws_when_container_stopped() — (EC-5) DockerSandbox.execute when container not running throws SandboxNotAvailableError
GREEN:   Implement LocalSandbox
REFACTOR: Extract shared test fixtures
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/sandbox/
```

#### Acceptance Criteria
- [ ] Verify `SandboxBackend` abstract class has exactly 2 abstract methods (`execute`, `uploadFile`)
- [ ] Verify `LocalSandbox` passes all 8 protocol tests
- [ ] Verify `DockerSandbox` compiles (runtime test env-gated behind `DOCKER_AVAILABLE`)
- [ ] Run `pnpm --filter @theokit/sdk exec tsc --noEmit` and confirm exit 0
- [ ] Verify `import { SandboxBackend } from "@theokit/sdk/sandbox"` resolves

#### DoD
- [ ] Run `pnpm --filter @theokit/sdk exec vitest run tests/sandbox/` and confirm 8+ tests pass
- [ ] Run `pnpm --filter @theokit/sdk exec tsc --noEmit` and confirm exit 0

---

## Phase 2: Integrated Subagent Delegation

**Objective:** Ship `defineSubAgent(spec)` that returns a `CustomTool` invoking a child agent.

### T2.1 — SubAgent spec + delegation tool

#### Objective
Create `defineSubAgent()` factory that wraps agent creation in a callable tool.

#### Why this step
1. **What:** Create `a2a/subagent.ts` with `SubAgentSpec` type and `defineSubAgent(spec): CustomTool` factory.
2. **Why now:** Per ADR D2: subagent-as-tool is the simplest pattern. Reuses existing `Agent.create` + `defineTool`. DeepAgents proves this at `middleware/subagents.py`.

#### Evidence
- `a2a/message-bus.ts:78 LoC` — existing A2A foundation (message routing)
- DeepAgents `SubAgent` TypedDict at `middleware/subagents.py:1` — `name`, `description`, `system_prompt`, `tools`, `model`

#### Files to edit
```
packages/sdk/src/a2a/subagent.ts (NEW) — defineSubAgent factory
packages/sdk/src/a2a/types.ts — add SubAgentSpec type
packages/sdk/src/a2a/index.ts — re-export defineSubAgent
tests/a2a/subagent-delegation.test.ts (NEW) — delegation tests
```

#### Deep file dependency analysis
- `a2a/types.ts`: currently 16 LoC with `A2AMessage` + `MessageHandler`. Adding `SubAgentSpec` interface (~15 LoC).
- `a2a/subagent.ts`: new file. Imports `Agent` from SDK barrel + `defineTool`. Returns `CustomTool`.
- `a2a/index.ts`: currently exports `MessageBus`, `AgentMailbox`, types. Add `defineSubAgent`, `SubAgentSpec`.

#### Deep Dives

```typescript
export interface SubAgentSpec {
  name: string;        // tool name for LLM
  description: string; // tool description for LLM
  instructions: string; // system prompt for child agent
  model?: string;       // override parent model (default: inherit)
  tools?: CustomTool[]; // child's tools (default: none)
  maxDelegationDepth?: number; // default: 3
}

export function defineSubAgent(spec: SubAgentSpec, _parentDepth = 0): CustomTool {
  const currentDepth = _parentDepth + 1;
  const maxDepth = spec.maxDelegationDepth ?? 3;
  if (currentDepth > maxDepth) throw new MaxDelegationDepthError(currentDepth, maxDepth);

  return defineTool({
    name: spec.name,
    description: spec.description,
    inputSchema: z.object({ input: z.string().describe("Task for the subagent") }),
    handler: async ({ input }) => {
      // EC-2: track delegation depth — child subagents inherit incremented depth
      const childTools = (spec.tools ?? []).map(t =>
        t._subagentSpec ? defineSubAgent(t._subagentSpec, currentDepth) : t
      );
      const agent = await Agent.create({
        model: spec.model,
        instructions: spec.instructions,
        tools: childTools,
      });
      try {
        const result = await agent.send(input);
        return result.finalText ?? "(no response)";
      } finally {
        agent.dispose();
      }
    },
  });
}
```

#### Tasks
1. Add `SubAgentSpec` to `a2a/types.ts`
2. Create `a2a/subagent.ts` with `defineSubAgent()`
3. Export from `a2a/index.ts`
4. Write delegation tests

#### TDD
```
RED:     test_define_subagent_returns_custom_tool() — defineSubAgent({...}) returns object with name, handler, inputSchema
RED:     test_subagent_tool_creates_child_agent() — mock Agent.create, verify called with spec config
RED:     test_subagent_tool_sends_input_to_child() — verify agent.send called with handler input
RED:     test_subagent_tool_returns_final_text() — verify handler returns agent result
RED:     test_subagent_disposes_child_on_completion() — verify agent.dispose called
RED:     test_subagent_disposes_child_on_error() — verify dispose even when send throws
RED:     test_subagent_inherits_model_when_not_specified() — verify no model override
RED:     test_subagent_uses_custom_model_when_specified() — verify model override applied
RED:     test_subagent_throws_at_max_delegation_depth() — (EC-2) depth 4 with max=3 throws MaxDelegationDepthError
RED:     test_subagent_with_empty_input() — (EC-6) handler receives { input: "" } without crashing
GREEN:   Implement defineSubAgent
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/a2a/subagent-delegation.test.ts
```

#### Acceptance Criteria
- [ ] Verify `defineSubAgent({name, description, instructions})` returns a valid `CustomTool`
- [ ] Verify `Agent.create` mock called once per `defineSubAgent` handler invocation AND `agent.dispose` called in finally block
- [ ] Run `pnpm --filter @theokit/sdk exec vitest run tests/a2a/subagent-delegation.test.ts` and confirm exit 0 with 10+ tests passing
- [ ] Run `pnpm --filter @theokit/sdk exec tsc --noEmit` and confirm exit 0

#### DoD
- [ ] Run tests and confirm 8+ pass
- [ ] Run typecheck and confirm exit 0

---

## Phase 3: Built-in Coding Tools Export

**Objective:** Export `@theokit/sdk-tools` factories via `@theokit/sdk/tools` sub-path.

### T3.1 — Add `./tools` sub-path export

#### Objective
Make sdk-tools available as a convenient sub-path import from the SDK.

#### Why this step
1. **What:** Add `"./tools"` to SDK `package.json` exports pointing to a barrel that re-exports from `@theokit/sdk-tools`.
2. **Why now:** Per ADR D5: tools exist but aren't discoverable. DeepAgents ships tools built-in. One import is better than two packages.

#### Evidence
- 5 tool factories exist in `packages/sdk-tools/src/` (git-diff, read-file, list-dir, search-text, run-vitest)
- `@theokit/sdk-tools` is already a workspace dep of SDK

#### Files to edit
```
packages/sdk/src/tools/index.ts (NEW) — re-export barrel
packages/sdk/package.json — add "./tools" export
tests/tools/tools-export.test.ts (NEW) — import verification
```

#### Tasks
1. Create `tools/index.ts` that re-exports all from `@theokit/sdk-tools`
2. Add `"./tools"` to package.json exports
3. Write import verification test

#### TDD
```
RED:     test_tools_subpath_exports_create_read_file_tool() — import { createReadFileTool } from "@theokit/sdk/tools" resolves
RED:     test_tools_subpath_exports_all_5_factories() — all 5 tool factories importable
GREEN:   Create barrel + export
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/tools/
```

#### Acceptance Criteria
- [ ] Verify `import { createReadFileTool } from "@theokit/sdk/tools"` resolves at typecheck
- [ ] Run `pnpm --filter @theokit/sdk exec vitest run tests/tools/tools-export.test.ts` and confirm exit 0 with 2+ tests passing

#### DoD
- [ ] Run tests and confirm pass
- [ ] Run typecheck and confirm exit 0

---

## Phase 4: HITL Interrupt Middleware

**Objective:** Ship `HitlMiddleware` that pauses before dangerous tool calls and waits for approval.

### T4.1 — HITL middleware with async approve callback

#### Objective
Create middleware that intercepts tool calls matching a configurable list and awaits human approval.

#### Why this step
1. **What:** Create `internal/runtime/hitl-middleware.ts` with `HitlMiddleware` class.
2. **Why now:** Per ADR D3: hooks are shell-based (can't pause); HITL needs async callbacks. DeepAgents proves the pattern at `graph.py:248`.

#### Evidence
- `hooks-executor.ts` — existing hook system is fire-and-forget subprocess
- DeepAgents `interrupt_on` — per-tool configuration, checkpoint + resume

#### Files to edit
```
packages/sdk/src/internal/runtime/hitl-middleware.ts (NEW) — HITL middleware
packages/sdk/src/types/agent.ts — add HitlConfig to AgentConfig
tests/hitl/hitl-middleware.test.ts (NEW) — HITL tests
```

#### Deep Dives

```typescript
export interface HitlConfig {
  tools: string[];  // tool names that require approval
  approve: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
  timeoutMs?: number;  // default: 300_000 (5 min)
}

export class HitlMiddleware {
  constructor(private config: HitlConfig) {}

  async shouldProceed(toolName: string, input: Record<string, unknown>): Promise<boolean> {
    if (!this.config.tools.includes(toolName)) return true;
    const timer = setTimeout(() => { /* reject */ }, this.config.timeoutMs ?? 300_000);
    try {
      return await this.config.approve(toolName, input);
    } finally {
      clearTimeout(timer);
    }
  }
}
```

#### Tasks
1. Create `hitl-middleware.ts` with `HitlMiddleware` class
2. Add `HitlConfig` to agent config types
3. Write HITL tests

#### TDD
```
RED:     test_hitl_allows_unlisted_tools() — tool not in list → shouldProceed returns true
RED:     test_hitl_blocks_listed_tool_until_approved() — listed tool → calls approve callback
RED:     test_hitl_rejects_when_approve_returns_false() — approve returns false → shouldProceed false
RED:     test_hitl_approves_when_callback_returns_true() — approve returns true → shouldProceed true
RED:     test_hitl_timeout_rejects() — approve hangs → timeout → shouldProceed false
RED:     test_hitl_passes_tool_name_and_input_to_callback() — verify approve args
RED:     test_hitl_multiple_tools_configured() — 3 tools listed, only those intercepted
RED:     test_hitl_default_timeout_5_minutes() — verify default timeoutMs = 300000
RED:     test_hitl_rejects_when_approve_throws() — (EC-4) approve() throws Error → shouldProceed returns false (fail-closed)
GREEN:   Implement HitlMiddleware
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/hitl/
```

#### Acceptance Criteria
- [ ] Verify `HitlMiddleware.shouldProceed()` blocks for listed tools and passes for unlisted
- [ ] Verify `shouldProceed` returns `false` when approve callback does not resolve within `timeoutMs` (test with 100ms timeout + 500ms delay)
- [ ] Run `pnpm --filter @theokit/sdk exec vitest run tests/hitl/hitl-middleware.test.ts` and confirm exit 0 with 9+ tests passing

#### DoD
- [ ] Run tests and confirm 8+ pass
- [ ] Run typecheck and confirm exit 0

---

## Phase 5: Auto-Summarization Trigger

**Objective:** Ship auto-summarization that triggers when token usage exceeds a configurable fraction of context window.

### T5.1 — Auto-summarize trigger using existing compression

#### Objective
Create a thin trigger that calls `compressConversationWindow()` when messages exceed threshold.

#### Why this step
1. **What:** Create `internal/runtime/auto-summarize.ts` with `AutoSummarizeConfig` and `shouldSummarize()` + `summarize()`.
2. **Why now:** Per ADR D4: compression pipeline exists and is tested. Only the trigger is missing. DeepAgents uses fraction-based trigger (85% of context window).

#### Evidence
- `compression-summarizer.ts` — `compressConversationWindow()` already works with 6 tests
- DeepAgents `SummarizationMiddleware` at `middleware/summarization.py:1` — `trigger=("fraction", 0.85)`

#### Files to edit
```
packages/sdk/src/internal/runtime/auto-summarize.ts (NEW) — trigger logic
tests/internal/runtime/auto-summarize.test.ts (NEW) — trigger tests
```

#### Deep Dives

```typescript
export interface AutoSummarizeConfig {
  triggerFraction: number;  // default: 0.85 (85% of context window)
  keepNewest: number;       // default: 4 (keep last N messages untouched)
  model?: string;           // compression model (default: from registry)
}

export function shouldSummarize(
  totalTokens: number,
  maxContextTokens: number,
  config: AutoSummarizeConfig,
): boolean {
  return totalTokens / maxContextTokens >= config.triggerFraction;
}

export async function autoSummarize(opts: {
  messages: CompressibleMessage[];
  config: AutoSummarizeConfig;
  callLlm: (model: string, system: string, user: string) => Promise<string>;
}): Promise<CompressibleMessage[]> {
  // EC-3: guard against messages.length <= keepNewest
  if (opts.messages.length <= opts.config.keepNewest) return opts.messages;
  const keep = opts.messages.slice(-opts.config.keepNewest);
  const compress = opts.messages.slice(0, -opts.config.keepNewest);
  const summary = await compressConversationWindow({
    messages: compress,
    model: opts.config.model ?? resolveCompressionModel(),
    callLlm: opts.callLlm,
  });
  return [summary, ...keep];
}
```

#### Tasks
1. Create `auto-summarize.ts` with trigger + summarize
2. Write trigger tests

#### TDD
```
RED:     test_should_summarize_true_when_above_threshold() — 90% usage → true
RED:     test_should_summarize_false_when_below_threshold() — 50% usage → false
RED:     test_should_summarize_at_exact_threshold() — 85% → true
RED:     test_auto_summarize_keeps_newest_messages() — keep=4 → last 4 untouched
RED:     test_auto_summarize_compresses_older_messages() — older messages compressed into 1
RED:     test_auto_summarize_uses_custom_model() — config.model passed to compressor
RED:     test_auto_summarize_returns_unchanged_when_fewer_than_keep() — (EC-3) 3 messages with keepNewest=4 returns original array
RED:     test_should_summarize_false_when_max_context_zero() — (EC-8) maxContextTokens=0 returns false (no division by zero)
GREEN:   Implement auto-summarize
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/internal/runtime/auto-summarize.test.ts
```

#### Acceptance Criteria
- [ ] Verify `shouldSummarize(900, 1000, {triggerFraction: 0.85})` returns true
- [ ] Verify `autoSummarize` keeps newest N messages and compresses the rest
- [ ] Run `pnpm --filter @theokit/sdk exec vitest run tests/internal/runtime/auto-summarize.test.ts` and confirm exit 0 with 8+ tests passing

#### DoD
- [ ] Run tests and confirm 6+ pass
- [ ] Run typecheck and confirm exit 0

---

## Phase 6: Integration Validation (MANDATORY)

**Objective:** Validate all 5 gaps work together.

### Execution

```bash
pnpm typecheck                    # zero type errors
pnpm -w run check                 # zero lint warnings
pnpm --filter @theokit/sdk exec vitest run  # all SDK tests
pnpm --filter @theokit/sdk-tools exec vitest run  # tools tests
pnpm build                        # all packages build
```

### Acceptance Criteria

- [ ] Run `pnpm --filter @theokit/sdk exec vitest run` and confirm exit 0 with 2586+ tests passing (2536 existing + 50+ new)
- [ ] Verify zero type errors via `pnpm typecheck`
- [ ] Verify zero lint warnings via `pnpm -w run check`
- [ ] Verify `@theokit/sdk/sandbox` import resolves
- [ ] Verify `@theokit/sdk/tools` import resolves
- [ ] Verify CHANGELOG updated with 5 new entries under `[Unreleased] § Added`

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing
2. Fix all plan-caused failures before declaring the plan complete
3. Re-run the validation chain

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Sandbox isolation backend | T1.1 | `SandboxBackend` protocol + `LocalSandbox` + `DockerSandbox` |
| 2 | Integrated subagent delegation | T2.1 | `defineSubAgent()` factory returning `CustomTool` |
| 3 | Built-in coding tools export | T3.1 | `@theokit/sdk/tools` sub-path re-exporting sdk-tools |
| 4 | HITL interrupt system | T4.1 | `HitlMiddleware` with async approve callback |
| 5 | Conversation summarization | T5.1 | Auto-trigger using existing compression pipeline |
| 6 | 50+ new tests | T1.1-T5.1 | 10+10+2+9+8 = 39 minimum + integration = 50+ |
| 7 | Cross-validation score improvement | T1.1, T2.1, T3.1, T4.1, T5.1 | Projected 3.92 → ≥4.2 via 5 gap closures |
| 8 | EC-1: Command injection in LocalSandbox | T1.1 | `execFile` with args split + shell metacharacter rejection |
| 9 | EC-2: Infinite subagent recursion | T2.1 | `_parentDepth` tracking + `MaxDelegationDepthError` |
| 10 | EC-3: Auto-summarize with fewer messages than keepNewest | T5.1 | Guard returns original when `messages.length <= keepNewest` |
| 11 | EC-4: HITL approve callback throws | T4.1 | Fail-closed: catch → return false |
| 12 | EC-5: DockerSandbox container not running | T1.1 | `SandboxNotAvailableError` typed error |
| 13 | EC-6: SubAgent empty input | T2.1 | Pass-through (no crash) |
| 14 | EC-8: Division by zero in shouldSummarize | T5.1 | Guard: `maxContextTokens <= 0 → false` |

**Coverage: 14/14 gaps covered (100%)**

## Global Definition of Done

- [ ] Verify all phases completed
- [ ] Run `pnpm test` and confirm all tests passing across workspace
- [ ] Run `pnpm typecheck` and confirm zero type errors
- [ ] Run `pnpm -w run check` and confirm zero lint warnings
- [ ] Verify file-size budget respected (all touched files ≤ 500 LoC per `architecture.md`)
- [ ] Verify CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Verify 50+ new tests added across 5 test files
- [ ] Confirm plan archived to `knowledge-base/plans/completed/` after merge
