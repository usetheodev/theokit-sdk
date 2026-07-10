# SE3 — Multi-agent provenance (`origin`) — Plan

**Milestone:** SE3 (SDK Evolution, post-Harness). Metadata-only; zero behavior change.

## Goal

Stamp a `MessageOrigin` discriminated union onto turns emitted in the multi-agent path
(Squad / a2a / handoff / background-delegation) and **forward it onto the run result** — so
consumers can attribute/route turns by who triggered them.

## Design (grounded in the codebase seam map)

All four multi-agent paths funnel through `agent.send()`. So `origin` is a **run-level
metadata passthrough**: `SendOptions.origin` → captured on the run script → copied onto
`RunResult.origin` (mirrors how Anthropic forwards `origin`). Callers stamp who triggered
the turn.

### `MessageOrigin` union (`src/types/run.ts`)

```ts
export type MessageOrigin =
  | { kind: "human" }
  | { kind: "peer"; from: string }          // another agent in a Squad / a2a
  | { kind: "task-notification" }           // a background follow-up re-enters send
  | { kind: "coordinator"; from?: string }  // a delegating/handoff coordinator
  | { kind: "auto-continuation" };          // the loop continuation driver
```

### Coverage Matrix (every DoD claim → task)

| DoD claim | Task | Test |
|---|---|---|
| `MessageOrigin` union + stamped on Squad/a2a/handoff/background | T1 (types), T4 (Squad), T5 (a2a) | message-origin.test.ts |
| Forwarded onto the run result | T2 (plumbing) | forward test (both kinds) |
| TDD: peer turn `{kind:'peer',from}` | T4 | Squad step stamps peer origin |
| TDD: background follow-up `{kind:'task-notification'}` | T2 | plumbing test with task-notification |
| Docs + Changeset | T6 | — |

### Insertion points (minimal set)

1. **`src/types/run.ts`** — `MessageOrigin` union; `SendOptions.origin?`; `RunResult.origin?`.
2. **`src/internal/runtime/fixtures/fixture-types.ts`** — `FixtureScript.origin?`.
3. **`src/internal/runtime/fixtures/fixture-run-base.ts`** — `applyScriptMetrics`: copy `script.origin` → `RunResult.origin`.
4. **`src/internal/runtime/local-agent/local-run.ts`** (fixture) + **`real-local-run.ts`** (real) — capture `sendOptions.origin` onto the script (unified forward for both runtimes).
5. **Squad stamp:** `AgentStep.origin?` + `agentStep(..., { origin })` forwards to `send`; `squad.ts` stamps `{kind:'peer', from:'agent-{i-1}'}` on steps 2..N.
6. **a2a stamp:** `A2AMessage.origin?` — `MessageBus.send` projects `{kind:'peer', from}` (thin projection of the existing `from`, per risk-mitigation #1).
7. **background/task-notification + handoff:** host-driven (no in-repo re-send seam) — the `SendOptions.origin → RunResult.origin` plumbing IS the integration point; documented honestly.

## Drawbacks & Risks

1. **Overlap with a2a addressing.** Mitigation: `origin` on a2a is a thin projection of the
   existing `from` — not a parallel system.
2. **Behavior drift.** Mitigation: metadata-only; assert zero change to routing/dispatch
   (fixture agents still produce identical results; only `.origin` is added).
3. **Scope creep into `@theokit/sdk-handoff` (extracted).** Mitigation: stamp only in-repo
   seams; handoff consumes the same `SendOptions.origin` plumbing.

## Unresolved Questions

(none) — the background/task-notification re-send is host-driven; the SDK ships the plumbing
+ the Squad/a2a stamps, which is the complete SDK-side contract.
