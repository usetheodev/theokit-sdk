---
"@theokit/sdk": minor
---

**SE3 — multi-agent provenance (`origin`).**

New public `MessageOrigin` discriminated union that stamps WHO triggered a turn in the multi-agent path (Squad / a2a / handoff / background-delegation) and is **forwarded onto the run result** — so consumers can attribute or route turns by their trigger. Metadata-only: zero change to routing or dispatch. Mirrors the Anthropic Agent SDK's `origin` shape.

- `MessageOrigin` union: `{ kind: "human" }` | `{ kind: "peer"; from }` | `{ kind: "task-notification" }` | `{ kind: "coordinator"; from? }` | `{ kind: "auto-continuation" }`. Absence = a direct human turn.
- `SendOptions.origin?: MessageOrigin` — the caller stamps the provenance; `RunResult.origin?: MessageOrigin` — forwarded onto the result (both fixture and real runtimes).
- **Squad** stamps `{ kind: "peer", from: "agent-<i-1>" }` on every step after the first (the first receives the human input). `agentStep(id, agent, prompt, { origin })` carries it; `AgentStep.origin` is the plumbing.
- **a2a** projects `{ kind: "peer", from }` onto every `A2AMessage.origin` — a thin view over the existing sender address (`from`), not a parallel system.
- **background-delegation / handoff** are host-driven (no in-repo re-send seam): the `SendOptions.origin → RunResult.origin` plumbing IS the integration point — a background follow-up carries `{ kind: "task-notification" }`, a coordinator carries `{ kind: "coordinator" }`.

New exports: `MessageOrigin`, plus `origin` fields on `SendOptions` / `RunResult` / `A2AMessage` / `AgentStep` and the `agentStep(..., { origin })` option. Additive + backward-compatible.

Grounded in the SDK Evolution roadmap SE3 (Anthropic Agent SDK comparison).
