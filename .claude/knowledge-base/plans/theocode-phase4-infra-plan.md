# Plan: TheoCode Phase 4 — Infrastructure

> **Version 1.1** — Ships 9 infrastructure modules for the TheoCode coding agent: typed event bus, background job queue, git integration, IDE bridge, permission system, external directory guard, image/vision handling, output formatter, and ACP server integration. Phase 4 of the TheoCode roadmap.

## Goal

> "Ship 9 infrastructure modules in `@theokit/theocode` covering event bus, background jobs, git integration, IDE bridge, permissions, directory security, image handling, output formatting, and ACP integration, measured by `pnpm --filter @theokit/theocode exec vitest run` exit 0 with 45+ new tests and all 9 modules exported from the barrel."

## Context

TheoCode Phases 1-3 shipped 12 tool factories, session persistence (8 modules), and prompt profiles + advanced tools. Phase 4 adds the infrastructure layer that connects everything: events for decoupled communication, background jobs for async work, git for version control, IDE for editor integration, permissions for security, and ACP for the agent communication protocol. Without this layer, TheoCode is a collection of isolated modules — Phase 4 wires them into a cohesive system.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/theocode/src/infra/event-bus.ts` (NEW) | 0 | — | Typed EventEmitter | — |
| `packages/theocode/src/infra/job-queue.ts` (NEW) | 0 | — | Background job queue | — |
| `packages/theocode/src/infra/git.ts` (NEW) | 0 | — | Git operations wrapper | — |
| `packages/theocode/src/infra/ide-bridge.ts` (NEW) | 0 | — | IDE protocol bridge | — |
| `packages/theocode/src/infra/permissions.ts` (NEW) | 0 | — | Per-tool permission system | — |
| `packages/theocode/src/infra/directory-guard.ts` (NEW) | 0 | — | External directory security | — |
| `packages/theocode/src/infra/image-handler.ts` (NEW) | 0 | — | Vision/image file handling | — |
| `packages/theocode/src/infra/formatter.ts` (NEW) | 0 | — | Output formatting | — |
| `packages/theocode/src/infra/acp-bridge.ts` (NEW) | 0 | — | ACP server integration | — |
| `packages/theocode/src/infra/index.ts` (NEW) | 0 | — | Infra barrel | — |

### Current callers / dependents

- **Session system** (Phase 2) — event bus emits session events (created, deleted, compacted).
- **Tools** (Phase 1+3) — permission system gates tool execution; directory guard validates paths.
- **`@theokit/acp`** — existing ACP package; bridge connects TheoCode sessions to ACP protocol.
- **`simple-git`** — npm package for git operations (already used by some gateway packages).

### Domain glossary

- **Event bus** — typed pub/sub for decoupled module communication (session.created, tool.executed, etc.)
- **Job queue** — async task execution with status tracking (pending/running/completed/failed)
- **Permission** — per-tool allow/deny/ask rule evaluated before tool execution
- **Directory guard** — restricts tool file operations to approved directories only
- **ACP bridge** — connects TheoCode sessions to the Agent Communication Protocol server

### Architecture boundaries affected

- **`@theokit/theocode`** — all infrastructure lives in the existing application package.
- **DIP** — event bus is an abstraction; consumers subscribe without knowing publishers.

## Prior Art & Related Work

- **OpenCode `bus/global.ts`** — simple EventEmitter-based event bus
- **OpenCode `background/job.ts`** — background job with Effect-TS
- **OpenCode `git/index.ts`** — git operations
- **OpenCode `ide/index.ts`** — VS Code bridge
- **OpenCode `acp/`** — 12-file ACP implementation

## Objective

- [ ] Verify typed event bus with subscribe/publish/unsubscribe, confirmed by 6+ tests
- [ ] Verify background job queue with status tracking, confirmed by 6+ tests
- [ ] Verify git integration (status, diff, commit), confirmed by 5+ tests
- [ ] Verify IDE bridge protocol, confirmed by 4+ tests
- [ ] Verify permission system (allow/deny/ask per tool), confirmed by 6+ tests
- [ ] Verify directory guard restricts to approved paths, confirmed by 5+ tests
- [ ] Verify image handler processes file attachments, confirmed by 4+ tests
- [ ] Verify output formatter renders markdown/code/diff, confirmed by 5+ tests
- [ ] Verify ACP bridge connects to TheoCode sessions, confirmed by 4+ tests
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run` exit 0 with 45+ new tests

## ADRs

### D1 — Event bus is a typed EventEmitter, not a full message broker

**Decision:** Use Node's native `EventEmitter` with a typed wrapper (`EventBus<EventMap>`) that provides compile-time event name + payload checking. NOT Redis/RabbitMQ/etc.

**Rationale:** Per KISS: TheoCode is single-process. A message broker is for distributed systems. Per YAGNI: we don't need persistence, replay, or cross-process delivery.

**Alternatives considered:**
- **(A) Redis pub/sub** — rejected: adds infrastructure dep for in-process communication.

**Consequences:** Event bus is ~40 LoC. Type-safe subscribe/publish. No persistence (events are fire-and-forget).

### D2 — Permission system uses a simple rules array, not RBAC

**Decision:** `PermissionEngine` accepts `PermissionRule[]` where each rule is `{ tool: string | RegExp, action: "allow" | "deny" | "ask" }`. First match wins.

**Rationale:** Per KISS: coding agents need per-tool gating (e.g., "allow read, ask before write, deny shell"). RBAC (roles, groups, inheritance) is overkill. OpenCode uses a similar flat rule list.

**Alternatives considered:**
- **(A) Full RBAC** — rejected: no roles or groups in a single-user coding agent.

**Consequences:** Permission evaluation is O(n) where n = rules count. Acceptable for <100 rules.

### D3 — Git integration uses `child_process.execFile`, not simple-git

**Decision:** Wrap `git` CLI directly via `execFile` (same pattern as `createShellTool`). NOT the `simple-git` npm package.

**Rationale:** Per YAGNI: we need 3 operations (status, diff, log). `simple-git` brings 200+ APIs and ~500KB. Three `execFile` calls are ~50 LoC total.

**Alternatives considered:**
- **(A) simple-git package** — rejected: heavy dep for 3 commands. Per Rule 9: don't add dep when 50 LoC solves it.

**Consequences:** Git ops are subprocess calls. Same timeout/truncation as shell tool.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Event bus is fire-and-forget — missed events not recoverable | Low | Acceptable for UI updates. Critical events (session CRUD) are persisted in SQLite. | D1 |
| Permission "ask" action requires UI callback (like question tool) | Medium | Uses same `askUser` callback pattern. Phase 5 TUI wires it. | D2 |
| Git commands fail if git not installed | Low | Check `which git` on init; return typed error if missing. | D3 |

## Unresolved Questions

(none — all decisions resolved. Patterns proven by OpenCode reference + Phase 1-3 patterns.)

## Dependency Graph

```
Phase 4a (Event bus + Permissions) ──▶ Phase 4b (Jobs + Git + Directory guard) ──▶ Phase 4c (IDE + Image + Formatter + ACP) ──▶ Phase 4d (Validation)
```

---

## Phase 4a: Event Bus + Permissions

### T4.1 — Typed event bus

#### Files to edit
```
packages/theocode/src/infra/event-bus.ts (NEW)
packages/theocode/tests/infra/event-bus.test.ts (NEW)
```

#### TDD
```
RED:     test_subscribe_receives_published_event() — subscribe + publish → handler called
RED:     test_unsubscribe_stops_receiving() — unsubscribe → handler NOT called
RED:     test_multiple_subscribers_all_receive() — 3 subscribers → all 3 called
RED:     test_publish_with_no_subscribers_does_not_throw() — publish to empty topic → no error
RED:     test_typed_event_payload() — payload type matches event map
RED:     test_once_fires_only_once() — once → handler called once, not on second publish
RED:     test_subscriber_error_does_not_block_others() — (EC-2) handler A throws → handler B still receives
GREEN:   Implement EventBus<EventMap> (try-catch per handler)
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/infra/event-bus.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/infra/event-bus.test.ts` and confirm exit 0 with 6+ tests passing

---

### T4.2 — Permission system

#### Files to edit
```
packages/theocode/src/infra/permissions.ts (NEW)
packages/theocode/tests/infra/permissions.test.ts (NEW)
```

#### TDD
```
RED:     test_allow_rule_permits_tool() — rule {tool:"read", action:"allow"} → evaluate("read") = "allow"
RED:     test_deny_rule_blocks_tool() — rule {tool:"shell", action:"deny"} → evaluate("shell") = "deny"
RED:     test_ask_rule_returns_ask() — rule {tool:"write", action:"ask"} → evaluate("write") = "ask"
RED:     test_first_match_wins() — [deny shell, allow *] → evaluate("shell") = "deny"
RED:     test_regex_matching() — rule {tool:/^write/, action:"ask"} → evaluate("write_file") = "ask"
RED:     test_no_match_defaults_to_allow() — empty rules → evaluate("anything") = "allow"
GREEN:   Implement PermissionEngine
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/infra/permissions.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/infra/permissions.test.ts` and confirm exit 0 with 6+ tests passing

---

## Phase 4b: Jobs + Git + Directory Guard

### T4.3 — Background job queue

#### Files to edit
```
packages/theocode/src/infra/job-queue.ts (NEW)
packages/theocode/tests/infra/job-queue.test.ts (NEW)
```

#### TDD
```
RED:     test_enqueue_returns_job_id() — enqueue(fn) → returns id
RED:     test_job_runs_async() — enqueue → fn called
RED:     test_job_status_tracking() — pending → running → completed
RED:     test_job_failure_tracked() — fn throws → status "failed" with error
RED:     test_list_jobs_returns_all() — enqueue 3 → list returns 3
RED:     test_cancel_pending_job() — cancel before run → status "cancelled"
RED:     test_sync_throw_caught_as_failed() — (EC-1) fn throws synchronously → status "failed", no process crash
GREEN:   Implement JobQueue (wrap fn in Promise.resolve().then(() => fn()) per EC-1)
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/infra/job-queue.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/infra/job-queue.test.ts` and confirm exit 0 with 6+ tests passing

---

### T4.4 — Git integration

#### Files to edit
```
packages/theocode/src/infra/git.ts (NEW)
packages/theocode/tests/infra/git.test.ts (NEW)
```

#### TDD
```
RED:     test_git_status_returns_files() — in a git repo → returns changed files list
RED:     test_git_diff_returns_diff() — modified file → returns diff string
RED:     test_git_log_returns_commits() — returns recent commit list
RED:     test_git_not_a_repo_returns_error() — in temp dir (no .git) → typed error
RED:     test_git_not_installed_returns_error() — mock execFile to fail → typed error
GREEN:   Implement gitStatus, gitDiff, gitLog (per ADR D3: execFile, not simple-git)
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/infra/git.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/infra/git.test.ts` and confirm exit 0 with 5+ tests passing

---

### T4.5 — External directory guard

#### Files to edit
```
packages/theocode/src/infra/directory-guard.ts (NEW)
packages/theocode/tests/infra/directory-guard.test.ts (NEW)
```

#### TDD
```
RED:     test_guard_allows_approved_directory() — path within projectRoot → allowed
RED:     test_guard_blocks_outside_directory() — path outside projectRoot → blocked
RED:     test_guard_blocks_parent_traversal() — "../outside" → blocked
RED:     test_guard_allows_with_extra_approved_dirs() — extra approved dir → allowed
RED:     test_guard_blocks_symlink_escape() — symlink pointing outside → blocked
GREEN:   Implement DirectoryGuard
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/infra/directory-guard.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/infra/directory-guard.test.ts` and confirm exit 0 with 5+ tests passing

---

## Phase 4c: IDE + Image + Formatter + ACP

### T4.6 — IDE bridge

#### Files to edit
```
packages/theocode/src/infra/ide-bridge.ts (NEW)
packages/theocode/tests/infra/ide-bridge.test.ts (NEW)
```

#### TDD
```
RED:     test_ide_bridge_opens_file() — openFile(path, line) → returns command object
RED:     test_ide_bridge_applies_diff() — applyDiff(path, diff) → returns command object
RED:     test_ide_bridge_detects_vscode() — VSCODE_PID env → detected
RED:     test_ide_bridge_no_ide_returns_null() — no IDE env → null
GREEN:   Implement IdeBridge
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/infra/ide-bridge.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/infra/ide-bridge.test.ts` and confirm exit 0 with 4+ tests passing

---

### T4.7 — Image/vision handler

#### Files to edit
```
packages/theocode/src/infra/image-handler.ts (NEW)
packages/theocode/tests/infra/image-handler.test.ts (NEW)
```

#### TDD
```
RED:     test_image_detect_type() — .png → "image/png", .jpg → "image/jpeg"
RED:     test_image_to_base64() — read file → returns base64 string
RED:     test_image_reject_non_image() — .ts file → error
RED:     test_image_size_cap() — >10MB image → error
RED:     test_image_empty_file_returns_error() — (EC-3) 0-byte .png → { ok: false, error: "empty_file" }
GREEN:   Implement ImageHandler
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/infra/image-handler.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/infra/image-handler.test.ts` and confirm exit 0 with 4+ tests passing

---

### T4.8 — Output formatter

#### Files to edit
```
packages/theocode/src/infra/formatter.ts (NEW)
packages/theocode/tests/infra/formatter.test.ts (NEW)
```

#### TDD
```
RED:     test_format_code_block() — formatCode("ts", code) → ```ts\ncode\n```
RED:     test_format_diff() — formatDiff(diff) → colored +/- lines
RED:     test_format_file_list() — formatFileList(files) → bulleted list
RED:     test_format_error() — formatError(msg, code) → formatted error block
RED:     test_format_truncated_indicator() — formatTruncated(path) → "...output truncated, full at: path"
GREEN:   Implement Formatter
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/infra/formatter.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/infra/formatter.test.ts` and confirm exit 0 with 5+ tests passing

---

### T4.9 — ACP bridge

#### Files to edit
```
packages/theocode/src/infra/acp-bridge.ts (NEW)
packages/theocode/tests/infra/acp-bridge.test.ts (NEW)
```

#### TDD
```
RED:     test_acp_bridge_creates_service() — creates ACP service descriptor
RED:     test_acp_bridge_maps_session_to_acp() — session → ACP session format
RED:     test_acp_bridge_maps_message_to_acp() — message → ACP content format
RED:     test_acp_bridge_handles_tool_event() — tool call → ACP tool event
GREEN:   Implement AcpBridge
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/infra/acp-bridge.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/infra/acp-bridge.test.ts` and confirm exit 0 with 4+ tests passing

---

## Phase 4d: Integration Validation (MANDATORY)

### Execution

```bash
pnpm --filter @theokit/theocode exec vitest run
pnpm --filter @theokit/theocode exec tsc --noEmit
pnpm -w run check
```

### Acceptance Criteria

- [ ] Run `pnpm --filter @theokit/theocode exec vitest run` and confirm exit 0 with 136+ total tests (91 Phase 1-3 + 45+ Phase 4)
- [ ] Run `pnpm --filter @theokit/theocode exec tsc --noEmit` and confirm exit 0
- [ ] Run `pnpm -w run check` and confirm zero lint errors
- [ ] Verify CHANGELOG updated

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Typed event bus | T4.1 | `EventBus<EventMap>` with subscribe/publish/once |
| 2 | Permission system (per-tool) | T4.2 | `PermissionEngine` with first-match rules (ADR D2) |
| 3 | Background job queue | T4.3 | `JobQueue` with status tracking |
| 4 | Git integration (status/diff/log) | T4.4 | `execFile` wrapper (ADR D3: no simple-git) |
| 5 | External directory guard | T4.5 | `DirectoryGuard` with symlink detection |
| 6 | IDE bridge | T4.6 | `IdeBridge` with VS Code detection |
| 7 | Image/vision handler | T4.7 | `ImageHandler` with type detection + base64 |
| 8 | Output formatter | T4.8 | `Formatter` for code/diff/files/errors |
| 9 | ACP bridge | T4.9 | `AcpBridge` mapping sessions to ACP protocol |
| 10 | 45+ new tests | T4.1-T4.9 | 6+6+6+5+5+4+4+5+4 = 45 minimum |
| 11 | TheoCode roadmap Phase 4 complete | T4.1-T4.9 | All 9 infra modules validated |

**Coverage: 11/11 gaps covered (100%)**

## Global Definition of Done

- [ ] Verify all phases completed
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run` and confirm 136+ total tests passing
- [ ] Run `pnpm --filter @theokit/theocode exec tsc --noEmit` and confirm zero type errors
- [ ] Run `pnpm -w run check` and confirm zero lint warnings
- [ ] Verify file-size budget respected (all files ≤ 500 LoC)
- [ ] Verify CHANGELOG.md updated under `[Unreleased]`
- [ ] Confirm plan archived after merge

## Final Phase: Integration Validation (MANDATORY)

### Execution

```bash
pnpm --filter @theokit/theocode exec vitest run
pnpm --filter @theokit/theocode exec tsc --noEmit
pnpm -w run check
```

### Acceptance Criteria

- [ ] Run `pnpm --filter @theokit/theocode exec vitest run` and confirm exit 0 with 136+ tests
- [ ] Run `pnpm --filter @theokit/theocode exec tsc --noEmit` and confirm exit 0
- [ ] Run `pnpm -w run check` and confirm exit 0
