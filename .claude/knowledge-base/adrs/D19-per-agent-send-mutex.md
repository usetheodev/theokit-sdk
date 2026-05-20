---
id: D19
status: Decided
date: 2026-05-16
plan: chat-assistant-readiness
---

# D19 — Per-agent send mutex keyed by `agent-send:${agentId}`

## Context
`LocalAgent.send` (and `CloudAgent.send`) had no concurrency control. Two webhook requests arriving for the same chat-id within milliseconds would interleave their `appendSessionMessage` calls — user-A's question, user-B's question, assistant-A's reply, assistant-B's reply — and the LLM saw a corrupt history mid-turn.

## Decision
`LocalAgent.send` and `CloudAgent.send` wrap the full run lifecycle (dispatch → `run.wait()` → post-run assistant-turn append → session disk flush) in `withCwdMutex(`agent-send:${this.agentId}`, ...)`. Concurrent sends to the SAME agentId serialize end-to-end. Different agentIds (subagents, sibling chats) keep parallel because the key is per-agent.

The Run is handed back to the caller as soon as it dispatches (so `run.stream()` consumers still work), but the mutex internally waits for completion before releasing.

## Rationale
- Two webhook calls hitting the same chat-id is the canonical chat assistant concurrency pattern.
- Per-agent mutex is the smallest correct fix — `withCwdMutex` already battle-tested by the memory subsystem.
- Spanning the FULL run lifecycle (not just the synchronous dispatch) is mandatory: the assistant-turn append happens AFTER `run.wait()` resolves, and that's the operation that must not interleave.
- `agent.dispose()` ALSO acquires the same mutex before flushing disk state — it can never return before an in-flight send's post-run hook lands the assistant turn + session summary.

## Consequences
- Concurrent sends to DIFFERENT agents stay parallel (EC-8: subagent + parent both complete).
- Concurrent sends to the SAME agent serialize — the second send waits for the first to fully finish (including the assistant turn append). For a bot, this is the desired behavior (chat is intrinsically sequential per user).
- `agent.send()` performance for non-concurrent case is unchanged (mutex acquire+release is microseconds when uncontended).
- Streaming (`run.stream()`) still works because the Run is returned to the caller before the mutex internally awaits.

## Alternatives Considered
- **Single global mutex** — rejected; would serialize unrelated agents.
- **Mutex on session writes only** — rejected; doesn't prevent the LLM from seeing torn priorMessages mid-turn.
- **No mutex (document race for the consumer)** — rejected; the consumer has to write the mutex themselves which defeats "drop-in foundation".
