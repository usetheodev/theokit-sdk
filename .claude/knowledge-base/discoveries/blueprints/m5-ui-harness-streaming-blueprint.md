# Blueprint: M5 UI ↔ Harness — live streaming chat surface

> **Version 1.0** — DISCOVER for M5 (theo-ui consumes `@theokit/sdk` streaming to render a live agent chat surface). Cross-repo, evidence-backed (file:line). Both sides investigated with Explore agents.

**Slug:** `m5-ui-harness-streaming`
**Generated:** 2026-07-03
**Repos:** `theokit-tools/theo-ui` (UI pillar) + `theokit-tools/theokit-sdk` (Harness)

## Finding 1 — The SDK streaming surface is SHIPPED (Harness side complete)

`@theokit/sdk/subscription` (G8, ADRs D423-D430, v1.7.0) is fully shipped:

- `subscribe(name, input, opts)` — client AsyncGenerator, `transport: "ws"|"sse"|"auto"`, browser-friendly (fetch + ReadableStream + native WebSocket/EventSource). `packages/sdk/src/subscription/theokit-subscribe.ts:52-109`.
- Reconnect + opaque resume token (`lastEventId`): `maxReconnectAttempts` default 10, exponential backoff; `mergeLastEventId` re-injects the token on reconnect. `theokit-subscribe.ts:78,271-277`; `subscription/types.ts:94-99`.
- `Run.stream()` yields the `SDKMessage` discriminated union: `types/run.ts:343`, `types/messages.ts:161-170` — `assistant` (text + tool invocations), `tool_call` (status running/completed/error + call_id), `thinking`, `system`, `object_delta`.
- Fine-grained `onDelta` callback: `types/run.ts:262`, `types/updates.ts:166-181`.
- SSE server handler + Node `ws` adapter shipped; CF/Bun/Deno deferred v1.8.x (ADR D425).

**BoundedBuffer backpressure** (`subscription/internal/backpressure.ts:1-92`) is code-complete but **NOT wired** into the subscription runtime (M5 top-risk #1; tracked #64/#61). Not a DoD item — a robustness follow-up.

## Finding 2 — theo-ui has the chat UI but ZERO SDK wiring (UI side gap)

theo-ui (React 18, TS 5.7, tsup, vitest+happy-dom, Ladle, Biome) has a rich chat surface already:

- `<AgentStream items={AgentStreamItem[]} />` — `components/composites/agent-stream/agent-stream.tsx:14-162`. Item union: `message | tool-call | approval | error | streaming | custom` (`agent-stream.tsx:80-86`).
- `toAgentStreamItems({ history: UIMessage[], live: AgentEvent[] })` → `AgentStreamItem[]` — `to-agent-stream-items.ts:77`.
- `AgentEvent` (`types/agent.ts:15`): `{ id, type: AgentEventType, label, status: "pending"|"running"|"success"|"failed", path?, diff?, detail? }`.
- `AgentStreaming` (pulsing "thinking" indicator), `ChatThread` (aria-live), `ChatComposer` (input+stop), `ChatMessage`, `ToolCallCard`, `AgentErrorCard`.
- `UIMessage`/`UIMessagePart` (`types/chat.ts:243`) — Vercel-`useChat`-compatible; `TextUIPart.state?: "streaming"|"done"`.

**Zero `@theokit/sdk` runtime dependency** (`package.json` deps — none); the only mentions are comments + a planned devDep-only `sdk-tools-adapters` (theo-ui's OWN internal "M5-4", unrelated to ecosystem M5). No `Run.stream`/`subscribe`/`useAgentStream`/hooks dir exists. **The integration layer is the gap.**

## Finding 3 — The bridge design (the M5 deliverable, in theo-ui)

A React hook `useAgentStream` that consumes an SDK stream and drives the existing `<AgentStream>`:

```ts
// Structural input — zero runtime coupling to @theokit/sdk (matches theo-ui's
// standalone philosophy + the sdk-tools-adapters ADR D2 devDep-only pattern).
// The SDK's real Run.stream() / subscribe() output structurally satisfies this.
type SdkStreamMessage =
  | { type: "assistant"; message: { content: Array<{ type: "text"; text: string } | { type: string }> } }
  | { type: "tool_call"; call_id: string; name: string; status: "running" | "completed" | "error"; result?: unknown }
  | { type: "thinking"; text?: string }
  | { type: string };

function useAgentStream(
  stream: AsyncIterable<SdkStreamMessage> | undefined,
  opts?: { signal?: AbortSignal },
): { items: AgentStreamItem[]; streamingText: string; status: "idle"|"streaming"|"done"|"error"; error?: Error };
```

- Iterates the stream in a `useEffect`; maps each message → state via `useReducer`.
- `assistant` text → accumulate `streamingText`; flush to a `message` item on the next non-text / stream end.
- `tool_call` → upsert an `AgentEvent` keyed by `call_id`, status mapped (`running`→running, `completed`→success, `error`→failed) → rendered via `toAgentStreamItems`.
- `thinking` → optional reasoning surface.
- Cleanup: abort/cancel the iterator on unmount (no state update after unmount).
- Transport-agnostic: pass `run.stream()` (local Node) OR `subscribe(...)` (browser, reconnect built-in) — reconnect/resume is the passed iterable's responsibility (DoD #2 satisfied by `subscribe()`).

A thin `<LiveAgentChat>` composite (optional) wires `useAgentStream` + `<AgentStream>` + `<ChatComposer>`.

## Coverage Corner 1 — Integration tests

- Unit (happy-dom + @testing-library/react): mock `AsyncIterable` → assert text accumulation, tool-call lifecycle upsert, error status, no-update-after-unmount. `theokit-sdk` NOT needed.
- Real-LLM integration (vitest runs in Node): real `Agent.create()` → `run.stream()` → `useAgentStream` → assert rendered live text + ≥1 tool event. `@theokit/sdk` devDep + live OpenRouter key (DoD #1 + #3).
- Reconnect: `subscribe()` (or a mock iterable) that drops + resumes via `lastEventId` → assert continuous, no-dup items (DoD #2).

## Coverage Corner 2 — Dependencies

- `@theokit/sdk` — **devDep only** in theo-ui (types + real-LLM test/demo), zero runtime coupling (ADR D2 precedent in theo-ui's sdk-tools-adapters plan). No new runtime dep.
- `@testing-library/react` — confirm present (theo-ui uses vitest+happy-dom; verify in package.json before planning).

## Coverage Corner 3 — Tools

- theo-ui: `AgentStream`, `toAgentStreamItems`, `AgentEvent`, `UIMessage`, `ChatComposer` (all shipped).
- SDK: `Run.stream()` (`SDKMessage`), `subscribe()` (reconnect+lastEventId) — shipped.

## Coverage Corner 4 — Techniques

- Structural typing to avoid runtime coupling (the hook's input mirrors `SDKMessage` shape; the SDK's real output satisfies it).
- `useReducer` + `useEffect` async-iterator consumption with AbortController cleanup (standard React streaming pattern).
- Real-LLM validation per `real-llm-validation.md` (OpenRouter, env key, never persisted).

## ADRs

### ADR-1 — theo-ui consumes the SDK stream via a STRUCTURAL type, not a runtime dep
theo-ui's positioning is standalone (zero runtime coupling). The hook accepts `AsyncIterable<SdkStreamMessage>` where `SdkStreamMessage` is a local structural mirror of the SDK's `SDKMessage`. The SDK's real `Run.stream()`/`subscribe()` output satisfies it structurally. `@theokit/sdk` is a devDep for types + the real-LLM test/demo only. Alternative rejected: hard runtime dep on `@theokit/sdk` — breaks theo-ui's standalone contract and forces every consumer to install the Harness.

### ADR-2 — Reconnect/resume is delegated to the SDK's `subscribe()`, not reimplemented
`subscribe()` already ships reconnect + opaque `lastEventId` resume (tested SDK-side). The hook is transport-agnostic; passing `subscribe(...)` gets reconnect for free (Rule 9 — don't reinvent). The M5 proof is a test that the hook + `subscribe()` survive a drop. Alternative rejected: a reconnect loop inside the hook — duplicates shipped SDK behavior.

## Honest scope note

The M5 code deliverable lands in **theo-ui** (a different repo with its own CHANGELOG / changeset / cycle ecosystem). The Harness side is done (subscription shipped). This is a substantial React streaming feature (hook + mapper + 3 test surfaces + real-LLM demo) and must be executed with adequate budget, TDD-first, no workarounds.

## Related
- `real-llm-validation.md` — evidence contract.
- ROADMAP M5 (`theokit-tools/ROADMAP.md`): DoD #1 subscribe+render, #2 reconnect/resume, #3 real-LLM demo. Deps: M2 (streaming, done) + M4 (done).
- M4 blueprint (`m5` sibling): `m4-skills-harness-integration-blueprint.md`.
