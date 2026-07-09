---
"@theokit/sdk": minor
---

**SE2 — typed runtime event stream (opt-in `SendOptions.onRunEvent`).**

New public `RunEvent` discriminated union + an opt-in `onRunEvent` sink, ADDITIVE to the `SDKMessage` content stream (non-breaking). Runtime-observability signals are delivered out-of-band — the model's content is unaffected. Mirrors the Anthropic `SDKMessage`-union approach.

- `RunEvent` union (the forward-compatible contract): `tool_progress`, `permission_denied`, `rate_limit`, `task_started`, `task_updated`, `task_completed`, `compact_boundary`. Discriminate on `type`.
- `SendOptions.onRunEvent?: (e: RunEvent) => void` — best-effort, fail-safe: a throwing sink never breaks the run (`emitRunEvent` swallows it).
- **Emitted end-to-end as of SE2:** `tool_progress` (a tool dispatches) and `permission_denied` (a plugin gate blocks a tool) — both proven via an integration test driving a real run against a stub provider. The remaining variants (`rate_limit`, `task_*`, `compact_boundary`) are part of the contract; their emission is wired incrementally as the sink is threaded into the LLM-client retry / task / session-compaction subsystems (they live below the agent loop). A consumer switching exhaustively on `type` is future-proof.

New exports: `RunEvent` (+ the 7 member types), `RunEventSink`, `emitRunEvent`. Additive + backward-compatible.

Grounded in the SDK Evolution roadmap SE2 (Anthropic Agent SDK comparison).
