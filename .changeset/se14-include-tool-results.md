---
"@theokit/sdk": minor
---

**SE14 — subagent result-context control (`SubAgentSpec.includeToolResults`).**

`defineSubAgent()` (from `@theokit/sdk/a2a`) gains an opt-in `includeToolResults`. When `true`, the child's completed tool-call results (name + result) are appended to the delegation payload returned to the supervisor, inside a delimited `<subagent-tool-results>` block; when absent/`false` the delegation returns the child's final text only — **text-only stays the default** (a peer framework's scoped posture).

Implemented as a `run.stream()` replay after `run.wait()` (a proven, safe idiom — the run buffers events and `stream()` replays them) collecting `tool_call` events with `status: "completed"`. **No `RunResult` change** — reads the existing public stream surface; tool *args* are never surfaced (only completed results). Rationale + the `RunResult`-field alternative are recorded in ADR 0006.

Additive + backward-compatible (default `false` never touches the stream). From the a peer framework supervisor-agents comparison (SDK Evolution roadmap SE14).
