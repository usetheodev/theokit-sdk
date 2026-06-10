# Edge Case Review — deepagents-parity-gaps

Date: 2026-06-10
Tasks analyzed: 5 (T1.1, T2.1, T3.1, T4.1, T5.1)
Edge cases found: 8 (MUST FIX: 3, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: LocalSandbox.execute command injection via unsanitized input
- **Affected task:** T1.1
- **Family:** Security / Input
- **Scenario:** `LocalSandbox.execute(userInput)` passes the command string directly to `child_process.exec` or `execFile`. If the LLM constructs a command with shell metacharacters (`;`, `&&`, `|`, `$()`), it can execute arbitrary commands on the host. This is the #1 security concern for a sandbox backend.
- **Impact:** Arbitrary code execution on the host OS. Defeats the purpose of having a sandbox.
- **Suggested fix:** `LocalSandbox` MUST use `execFile` with split args (not `exec` with a string). Add `SandboxSecurityError` when command contains shell metacharacters. Document that `LocalSandbox` is NOT a security boundary — only `DockerSandbox` provides isolation.

### EC-2: SubAgent delegation depth not tracked across tool calls
- **Affected task:** T2.1
- **Family:** State / Resource
- **Scenario:** The plan mentions `maxDelegationDepth = 3` but the pseudo-code doesn't show how depth is tracked. If parent agent A creates subagent B which creates subagent C which creates subagent D — how does D know it's at depth 3? The `defineSubAgent` handler creates a fresh `Agent.create()` with no context about the call stack depth.
- **Impact:** Infinite recursion → stack overflow → process crash. The plan's own Drawbacks table flags this as "High" severity but the implementation pseudo-code doesn't address it.
- **Suggested fix:** Pass `_delegationDepth` as a hidden field in `SubAgentSpec`. Each `defineSubAgent` handler increments it before creating the child. Throw `MaxDelegationDepthError` when `depth >= maxDelegationDepth`. One line: `if ((spec._depth ?? 0) >= spec.maxDelegationDepth) throw new MaxDelegationDepthError();`

### EC-3: Auto-summarize with fewer messages than `keepNewest`
- **Affected task:** T5.1
- **Family:** Input / Boundary
- **Scenario:** `autoSummarize` does `messages.slice(-keepNewest)` for keep and `messages.slice(0, -keepNewest)` for compress. If `messages.length <= keepNewest` (e.g., 3 messages with `keepNewest=4`), `slice(0, -4)` returns empty array and `compressConversationWindow` is called with 0 messages.
- **Impact:** Either throws (empty input) or returns nonsensical summary. Silent data loss possible.
- **Suggested fix:** Guard: `if (messages.length <= config.keepNewest) return messages;` — nothing to compress.

## SHOULD TEST

### EC-4: HITL approve callback throws an error
- **Affected task:** T4.1
- **Suggested test:** `test_hitl_rejects_when_approve_throws()` — if `approve()` throws (network error, consumer bug), `shouldProceed` should return `false` (fail-closed), not crash the agent loop. Wrap in try/catch.

### EC-5: DockerSandbox container not running
- **Affected task:** T1.1
- **Suggested test:** `test_docker_sandbox_execute_throws_when_container_stopped()` — if the Docker container exited or was never started, `execute` should throw a typed `SandboxNotAvailableError` (not a raw child_process error).

### EC-6: SubAgent tool called with empty input string
- **Affected task:** T2.1
- **Suggested test:** `test_subagent_tool_with_empty_input()` — `{ input: "" }` is a valid Zod parse but semantically useless. The handler should pass it through (LLM will figure it out) — don't throw. Just verify it doesn't crash.

## DOCUMENT

### EC-7: `@theokit/sdk/tools` sub-path makes sdk-tools a hard dependency
- **Accepted risk:** Per ADR D5, the `./tools` sub-path re-exports from `@theokit/sdk-tools`. This means consumers who `import { createReadFileTool } from "@theokit/sdk/tools"` need `@theokit/sdk-tools` installed. If sdk-tools is listed as an optional peer dep but the barrel import fails at require time, the error is opaque. Acceptable because: (a) sdk-tools is already a workspace dev dep, and (b) the `./tools` sub-path is opt-in — consumers who don't import it never hit the dependency.

### EC-8: Auto-summarize `shouldSummarize` called with maxContextTokens=0
- **Accepted risk:** Division by zero in `totalTokens / maxContextTokens`. This can only happen if the model capabilities registry returns 0 for `maxContextTokens` (bug in registry, not in summarization). Guard with `if (maxContextTokens <= 0) return false;` — but document as low-priority since the registry validates non-zero on load.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 2 | 1 (EC-1) | 1 (EC-5) | 0 |
| T2.1 | 2 | 1 (EC-2) | 1 (EC-6) | 0 |
| T3.1 | 1 | 0 | 0 | 1 (EC-7) |
| T4.1 | 1 | 0 | 1 (EC-4) | 0 |
| T5.1 | 2 | 1 (EC-3) | 0 | 1 (EC-8) |

**Verdict:** PLAN NEEDS ADJUSTMENT — 3 MUST FIX items:
1. **EC-1:** LocalSandbox command injection guard (use `execFile`, not `exec`)
2. **EC-2:** Track delegation depth in SubAgent spec
3. **EC-3:** Guard against `messages.length <= keepNewest`
