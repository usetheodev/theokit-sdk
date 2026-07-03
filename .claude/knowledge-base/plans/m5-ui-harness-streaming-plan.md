---
slug: m5-ui-harness-streaming
milestone_id: M5
created_at: 2026-07-03
goal: Ship a theo-ui `useAgentStream` hook that consumes an SDK `Run.stream()`/`subscribe()` async stream and renders live `text_delta` + tool events through the existing `<AgentStream>`, proven by a real-LLM OpenRouter integration test asserting ≥1 streamed text update AND ≥1 tool event.
---

# M5 — UI ↔ Harness: live streaming chat surface (theo-ui `useAgentStream`)

## Goal

Ship a theo-ui `useAgentStream` hook that consumes an SDK `Run.stream()`/`subscribe()`
async stream and renders live `text_delta` + tool events through the existing
`<AgentStream>`. **Observable metric:** a real-LLM OpenRouter integration test drives
a real `Agent.create()` → `run.stream()` through the hook and asserts the hook's
rendered state contains ≥1 streamed assistant-text update AND ≥1 `tool_call` event,
plus a reconnect test asserting continuity across a dropped `subscribe()` connection.

## Context

M5 (ecosystem ROADMAP): `theo-ui` consumes `@theokit/sdk` streaming to render a live
agent chat surface. DISCOVER (blueprint `knowledge-base/discoveries/blueprints/m5-ui-harness-streaming-blueprint.md`)
established: the SDK side is SHIPPED (`@theokit/sdk/subscription` — `subscribe` with
reconnect+`lastEventId`, `Run.stream()` → `SDKMessage`); theo-ui has the chat UI
(`<AgentStream>`, `toAgentStreamItems`, `AgentEvent`) but ZERO SDK wiring. The gap is
the integration hook. Deps M2 (streaming) + M4 (routing) are both done.

## Baseline Context

### Files that will be touched

| File | State | Why |
|---|---|---|
| `theo-ui/src/hooks/use-agent-stream/agent-stream-reducer.ts` | (NEW) | Pure `(state, SdkStreamMessage) → state` reducer — the mapping core, unit-testable with no React/SDK. |
| `theo-ui/src/hooks/use-agent-stream/use-agent-stream.ts` | (NEW) | React hook: consumes `AsyncIterable<SdkStreamMessage>` via `useReducer`+`useEffect`, AbortController cleanup. |
| `theo-ui/src/hooks/use-agent-stream/types.ts` | (NEW) | Structural `SdkStreamMessage` mirror (zero runtime coupling, ADR-1). |
| `theo-ui/src/hooks/use-agent-stream/index.ts` | (NEW) | Barrel. |
| `theo-ui/src/index.ts` | edit | Export `useAgentStream` + types. |
| `theo-ui/src/hooks/use-agent-stream/*.test.ts(x)` | (NEW) | Unit (reducer + hook, mock stream), real-LLM integration, reconnect. |
| `theo-ui/package.json` | edit | Add `@theokit/sdk` as devDep (types + real-LLM test), zero runtime dep. |

### Current callers / dependents

- `<AgentStream items={AgentStreamItem[]} />` — `theo-ui/src/components/composites/agent-stream/agent-stream.tsx:14`; the hook produces its `items`.
- `toAgentStreamItems({ history, live })` — `to-agent-stream-items.ts:77`; the reducer emits `AgentEvent[]` (live) + `UIMessage[]` (history) consumed by it.
- `AgentEvent` — `theo-ui/src/types/agent.ts:15`; `AgentStreamItem` — `agent-stream.tsx:80`.
- SDK: `Run.stream()` → `SDKMessage` (`theokit-sdk/packages/sdk/src/types/messages.ts:161`); `subscribe()` (`subscription/theokit-subscribe.ts:52`).

### Domain glossary

- **SdkStreamMessage** — theo-ui's local structural mirror of the SDK `SDKMessage` union (only the fields the hook reads: `type`, assistant `content` text, `tool_call` `call_id`/`name`/`status`).
- **AgentStreamItem** — theo-ui's render union (`message`/`tool-call`/`streaming`/`error`).
- **AgentEvent** — theo-ui's live tool/action event (`status: pending|running|success|failed`).
- **lastEventId** — SDK opaque resume token; `subscribe()` re-injects it on reconnect.

### Architecture boundaries affected

theo-ui stays standalone: the hook depends on a STRUCTURAL type, not `@theokit/sdk` at runtime (ADR-1). New `src/hooks/` dir (theo-ui has none today) — a hooks layer alongside components. No change to existing components.

## Prior Art & Related Work

- Blueprint: `knowledge-base/discoveries/blueprints/m5-ui-harness-streaming-blueprint.md` (DISCOVER, grep-backed).
- theo-ui precedent for devDep-only SDK coupling: its own `sdk-tools-adapters` plan (the "zero runtime coupling" decision).
- Vercel AI SDK `useChat` — the `UIMessage` shape theo-ui already mirrors (`types/chat.ts:2-16`).
- SDK `subscription-real-llm.test.ts` + `subscription-resume.test.ts` — consumption ergonomics.

## ADRs

### ADR-1 — Structural stream type, not a runtime `@theokit/sdk` dep

**Decision:** the hook accepts `AsyncIterable<SdkStreamMessage>` where `SdkStreamMessage`
is a local structural mirror of the SDK's `SDKMessage`. The SDK's real `Run.stream()` /
`subscribe()` output satisfies it structurally. `@theokit/sdk` is a **devDep** (types +
real-LLM test/demo). **Rationale:** preserves theo-ui's standalone positioning (a
consumer using any compatible stream — including a mock or a non-SDK source — works);
matches the established `sdk-tools-adapters` zero-runtime-coupling precedent. **Rejected:** hard runtime
dep — forces every theo-ui consumer to install the Harness + native bindings.

### ADR-2 — Reconnect/resume delegated to the SDK `subscribe()`

**Decision:** the hook is transport-agnostic; reconnect + `lastEventId` resume is the
passed iterable's responsibility. For the browser reconnect DoD, pass `subscribe(...)`
(reconnect shipped + tested SDK-side). **Rationale:** Rule 9 (don't reinvent) — `subscribe()`
already ships reconnect. **Rejected:** a reconnect loop inside the hook — duplicates
shipped, tested SDK behavior and couples the hook to a transport.

## Dependency Graph

```
T1 (reducer RED/GREEN) ─→ T2 (hook RED/GREEN, mock stream) ─→ T3 (export + <LiveAgentChat>) ─→ T4 (real-LLM integration) ─→ T5 (reconnect/resume)
```

## Phase 1 — The mapping core + hook (TDD, no SDK)

### T1.1 — Pure reducer `agentStreamReducer`

#### Why this step
The message→UI mapping is the risk-bearing logic (text accumulation, tool-call upsert by call_id, status mapping). Isolating it as a pure reducer makes it exhaustively unit-testable with zero React/SDK — the fastest, most deterministic RED→GREEN. A junior reading the reducer understands the whole mapping without a running LLM.

#### Files to edit
- `theo-ui/src/hooks/use-agent-stream/types.ts` (NEW), `agent-stream-reducer.ts` (NEW), `agent-stream-reducer.test.ts` (NEW)

#### TDD
- `test_reducer_accumulates_assistant_text_into_streaming_item`: feed two `assistant` text messages → state has one streaming/message item with concatenated text.
- `test_reducer_upserts_tool_call_by_call_id`: `tool_call` running then completed (same `call_id`) → ONE tool-call event, status transitions running→success.
- `test_reducer_maps_error_status`: `tool_call` status `error` → AgentEvent status `failed`.
- `test_reducer_ignores_unknown_message_types`: `{ type: "system" }` → state unchanged (no throw).
- `test_reducer_marks_done_on_end`: an end/`done` sentinel → status `done`.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- `agentStreamReducer` is pure (no I/O), returns `{ items: AgentStreamItem[], streamingText, status }`.
- 5 unit tests GREEN.

#### DoD
- `pnpm --filter … test agent-stream-reducer` GREEN; Biome clean; typecheck clean.

### T2.1 — React hook `useAgentStream`

#### Why this step
Wraps the reducer in a React lifecycle: consume the async iterator in `useEffect`, dispatch each message, abort on unmount. Proves the live-render contract with a deterministic mock `AsyncIterable` (no LLM) — DoD #1's mechanism.

#### Files to edit
- `theo-ui/src/hooks/use-agent-stream/use-agent-stream.ts` (NEW), `use-agent-stream.test.tsx` (NEW), `index.ts` (NEW)

#### TDD
- `test_hook_renders_streamed_text_from_mock_stream`: `renderHook(() => useAgentStream(mockStream))` → `waitFor` items contain the streamed text.
- `test_hook_surfaces_tool_events`: mock stream with a tool_call → items include a tool-call item.
- `test_hook_aborts_on_unmount`: unmount mid-stream → no state-update-after-unmount warning; iterator cancelled.
- `test_hook_sets_error_status_on_throw`: mock stream throws → status `error`.

#### Concurrency tests
(none — single-threaded). The React effect + async iterator use AbortController cleanup, exercised by the unmount test.

#### Acceptance criteria
- Hook returns `{ items, streamingText, status, error? }`; cleans up on unmount.
- 4 unit tests GREEN (happy-dom + @testing-library/react).

#### DoD
- `pnpm --filter … test use-agent-stream` GREEN.

### T3.1 — Export + optional `<LiveAgentChat>` wrapper

#### Why this step
Surface the hook publicly and provide a thin composite wiring `useAgentStream` + `<AgentStream>` so a consumer gets a drop-in live chat with one component (DoD #1 "a theo-ui component").

#### Files to edit
- `theo-ui/src/index.ts` (export), optional `src/components/composites/live-agent-chat/*`

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- `useAgentStream` exported from the barrel; knip clean (no orphan).

#### DoD
- `pnpm --filter … typecheck` + `knip` clean.

## Phase 2 — Real-LLM + reconnect validation

### T4.1 — Real-LLM integration test (DoD #1 + #3)

#### Why this step
The DoD requires a theo-ui component subscribing to a REAL SDK stream against a real LLM. A minimal `Agent.create({ apiKey, model })` chat does not load native bindings (verified in M4), so linking `@theokit/sdk` as a devDep + running a real `run.stream()` through the hook is feasible in vitest.

#### Files to edit
- `theo-ui/package.json` (devDep `@theokit/sdk`), `theo-ui/src/hooks/use-agent-stream/use-agent-stream.real-llm.test.tsx` (NEW, env-gated by `OPENROUTER_API_KEY`)

#### Failure scenarios
- OpenRouter 5xx / network down: `run.stream()` surfaces an error message → the hook sets status `error` with the typed message (asserted), not a silent hang.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- With a live `OPENROUTER_API_KEY`: a real `Agent.create()` → `run.stream()` fed to `useAgentStream` yields rendered items with ≥1 assistant-text update; when a tool is registered, ≥1 tool-call event.
- Env-gated `describe.skipIf(!key)` (skips cleanly without a key).

#### DoD
- Test GREEN with a live key; evidence (model + rendered text + status) recorded per `real-llm-validation.md`.

### T5.1 — Reconnect/resume test (DoD #2)

#### Why this step
DoD #2 requires resume across a dropped connection via `lastEventId`. `subscribe()` ships reconnect; the proof is the hook consuming a `subscribe()` (or a controlled iterable) that drops + resumes, rendering continuous items with no dup/loss.

#### Files to edit
- `theo-ui/src/hooks/use-agent-stream/use-agent-stream.reconnect.test.tsx` (NEW)

#### Failure scenarios
- Connection drop mid-stream: the iterable reconnects with `lastEventId`; the hook continues appending — asserted continuous (no duplicate of pre-drop items, no lost post-drop items).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- A stream that emits, drops, and resumes (resume keyed by `lastEventId`) renders items with pre-drop + post-drop content, no duplicates.

#### DoD
- Test GREEN; evidence of the resume behavior recorded.

## Coverage Matrix

| Requirement / DoD | Task |
|---|---|
| DoD #1 component subscribes + renders text + tool live | T1.1, T2.1, T3.1, T4.1 |
| text accumulation | T1.1 |
| tool-call lifecycle | T1.1, T2.1 |
| DoD #2 reconnect/resume via lastEventId | T5.1 |
| DoD #3 real-LLM demo recorded | T4.1 |
| standalone (no runtime SDK dep) | ADR-1, T1/T2 (mock) |
| cleanup on unmount | T2.1 |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Linking `@theokit/sdk` drags native bindings (better-sqlite3) into theo-ui tests | MEDIUM | Minimal chat run does not load better-sqlite3 (verified M4); devDep + env-gated test; keep memory/cache out of the run | implementer |
| React async-iterator cleanup leaks (state update after unmount) | MEDIUM | AbortController + mounted guard; explicit unmount test (T2.1) | implementer |
| happy-dom lacks a Node API the SDK needs at import | LOW | vitest runs in Node under happy-dom; SDK import verified in M4 probes | implementer |

## Unresolved Questions

- Should BoundedBuffer be wired into the subscription runtime as part of M5 (top-risk #1)? **(decided: no)** — it is a Harness robustness follow-up, not a DoD item; filed as a separate concern. Documented so it is not silently dropped.

## Global DoD

- [ ] T1–T5 GREEN; real-LLM T4 GREEN with a live key; reconnect T5 GREEN.
- [ ] theo-ui typecheck + Biome + knip clean; no runtime `@theokit/sdk` dep (devDep only).
- [ ] theo-ui CHANGELOG/changeset entry.
- [ ] Evidence recorded per `real-llm-validation.md`.
- [ ] No secret in any committed file.

## Failure scenarios

- OpenRouter timeout/5xx during T4 → hook status `error` + typed message (asserted).
- Connection drop during T5 → resume via `lastEventId`, continuous render (asserted).

## Final Phase — Integration Validation

Run theo-ui's `pnpm test` for the new suites + typecheck + Biome + knip, plus the
env-gated real-LLM + reconnect tests. Complete only when a real SDK `run.stream()`
renders live through `useAgentStream` with recorded evidence and the reconnect test
is GREEN.
