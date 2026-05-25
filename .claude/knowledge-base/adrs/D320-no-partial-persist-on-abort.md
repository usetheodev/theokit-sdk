# D320 — Aborted runs do not persist partial assistant messages

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 4, T4.3

## Decision

When `AbortSignal` fires mid-stream, the `runPostRunLifecycle` skips the assistant `appendMessage` call. The user message persists (it was appended at `send()` entry); the assistant message — partial or otherwise — does NOT.

Mechanism: `runPostRunLifecycle` reads the run's terminal `RunResult.status`. When the abort path produces `status: "error"` with a `[aborted]` marker text (from the loop's abort handler), the lifecycle exits without appending. Other error paths (network 5xx, validation) still persist if the assistant produced text — those are real responses the user should see.

## Rationale

**History invariant:** the conversation log must contain only complete user-assistant turns. A persisted "assistant: hello wor..." partial would become the input to the next turn, corrupting the model's view of history.

OpenAI Chat Completions API explicitly states aborted requests are billed but produce no recorded response — same semantics here.

## Alternatives considered

- **Persist partial with explicit marker** — rejected. The marker doesn't survive translation by downstream consumers (TheoKit message rendering); history corruption returns.
- **Replay the user message on next send** — rejected. User experience: they sent a message that "didn't happen". Confusing.

## Consequences

- Aborted run = user message persisted, no assistant response.
- Next `send` sees the user message in history (priorMessages) but no assistant reply — natural state for "resume from where you left off".
- Telemetry sees the abort via stream events (text-delta partials emit before abort), even though storage doesn't.
