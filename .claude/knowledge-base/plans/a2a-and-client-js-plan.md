# Plan: A2A Protocol + @theokit/client-js Browser Client

> **Version 1.0** — Ship inter-agent communication (A2A) and a browser-safe client SDK as two new sub-paths of `@theokit/sdk`, closing cross-validation gaps #11 (A2A missing) and #13 (client SDK missing). Both are additive features with zero breaking changes.

## Goal

> "Ship `@theokit/sdk/a2a` and `@theokit/sdk/client` sub-paths so that agents can exchange typed messages via an in-process MessageBus AND browser consumers can interact with agents via the server adapters, measured by `pnpm exec vitest run tests/a2a/ tests/client/` returning 20+ GREEN tests."

## Context

Cross-validation report (`cross-validation-output/final_report.md`) gap #11: Mastra has inter-agent communication (A2A protocol). TheoKit agents operate independently — no message passing between agents. Gap #13: Mastra has `@mastra/client-js`, `@mastra/react`, `@mastra/ai-sdk`. TheoKit has `@theokit/react` but no browser-safe JS client for consuming server adapters.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `src/a2a/index.ts` (NEW) | 0 | — | A2A sub-path barrel | — |
| `src/a2a/message-bus.ts` (NEW) | 0 | — | In-process typed message bus | — |
| `src/a2a/types.ts` (NEW) | 0 | — | A2A message types | — |
| `src/a2a/agent-mailbox.ts` (NEW) | 0 | — | Per-agent mailbox with inbox queue | — |
| `src/client/index.ts` (NEW) | 0 | — | Client sub-path barrel | — |
| `src/client/theokit-client.ts` (NEW) | 0 | — | Browser-safe fetch client | — |
| `src/client/types.ts` (NEW) | 0 | — | Client response types | — |
| `src/server/adapter/types.ts` | 22 | `e1aa98f` (2026-06-09) | Shared adapter contract | `AgentLike` interface |
| `src/theokit-container.ts` | 108 | `1873968` (2026-06-09) | Multi-agent registry | Constructor + getters |
| `packages/sdk/package.json` | ~170 exports | `f445ac3` (2026-06-09) | Sub-path exports | Existing 80+ export paths |
| `packages/sdk/tsup.config.ts` | ~30 | `f445ac3` (2026-06-09) | Build entry points | Existing entries |
| `tests/a2a/message-bus.test.ts` (NEW) | 0 | — | MessageBus tests | — |
| `tests/a2a/agent-mailbox.test.ts` (NEW) | 0 | — | Mailbox tests | — |
| `tests/client/theokit-client.test.ts` (NEW) | 0 | — | Client tests | — |

### Current callers / dependents

- **Symbol:** `AgentLike` in `src/server/adapter/types.ts`
  - **Callers (production):** `src/server/adapter/hono.ts`, `express.ts`, `fastify.ts`
  - **Callers (tests):** `tests/server/adapter-*.test.ts`
  - **External:** No

- **Symbol:** `TheoKitContainer` in `src/theokit-container.ts`
  - **Callers (production):** exported from `src/index.ts` (barrel)
  - **Callers (tests):** `tests/theokit-container.test.ts`, `tests/e2e/container-multi-agent.e2e.test.ts`

### Domain glossary

- **A2A** — Agent-to-Agent communication: typed message passing between agents in the same process
- **MessageBus** — Central event bus that routes messages between agent mailboxes by agent ID
- **Mailbox** — Per-agent inbox/outbox queue for receiving/sending A2A messages
- **Client** — Browser-safe SDK that consumes server adapter HTTP endpoints via fetch + SSE

### Architecture boundaries affected

- **A2A module** sits in cross-cutting layer alongside memory/tools. Agents import A2A types; A2A does NOT import agent internals. Per `architecture.md` section 1 (inner layers must not import outer).
- **Client module** is a standalone browser-safe sub-path with zero Node deps. It consumes the same HTTP contract as server adapters but from the consumer side. No dependency on SDK internals.

## Prior Art & Related Work

- **Cross-validation report** (`cross-validation-output/final_report.md`) — gap #11 and #13 with empirical scores
- **TheoKitContainer** (`src/theokit-container.ts`) — existing multi-agent registry; A2A MessageBus wires into container.agent() for discovery
- **Server adapters** (`src/server/adapter/`) — client-js consumes these endpoints
- **OpenAI Agents SDK (Python)** — `Handoff` pattern for agent delegation (we have handoffs; A2A adds bidirectional message passing)

## Objective

- [ ] Ship `@theokit/sdk/a2a` sub-path with MessageBus, AgentMailbox, typed messages (request/response + fire-and-forget)
- [ ] Ship `@theokit/sdk/client` sub-path with TheoKitClient (fetch-based, SSE streaming, zero Node deps)
- [ ] Register both sub-paths in package.json exports + tsup.config.ts
- [ ] 20+ tests across both modules

## ADRs

### D453 — A2A in-process MessageBus (not network)

**Status**: Proposed.
**Context**: Cross-validation gap #11. Mastra has A2A at `packages/core/src/a2a/`. TheoKit agents operate independently.
**Decision**: Ship in-process MessageBus with typed messages. Agents register mailboxes by ID. Messages routed synchronously in-process. No network layer in v1 — network A2A (WebSocket/gRPC) deferred to v2.
**Alternatives**: (a) Network-based A2A via WebSocket — REJECTED for v1, adds complexity + infra dep; in-process covers 90% of multi-agent use cases. (b) Use existing handoff mechanism — REJECTED, handoffs are unidirectional delegation; A2A is bidirectional message passing. (c) No A2A — REJECTED, cross-validation gap.
**Rules cited**: `architecture.md` section 1 (A2A in cross-cutting layer; no upward import), KISS (in-process first).

### D454 — Browser-safe client via fetch + SSE

**Status**: Proposed.
**Context**: Cross-validation gap #13. Mastra has `@mastra/client-js`. TheoKit has no browser client.
**Decision**: Ship `TheoKitClient` class using native `fetch` + `EventSource` for SSE. Zero Node dependencies. Consumes the same HTTP contract as server adapters (POST /send, GET /stream). Typed responses matching `AgentLike` output shape.
**Alternatives**: (a) Wrap Axios — REJECTED, unnecessary dep for fetch-native browsers. (b) Generate from OpenAPI — REJECTED, server adapters do not emit OpenAPI spec yet. (c) No client — REJECTED, cross-validation gap.
**Rules cited**: `architecture.md` section 2 (DIP — client depends on HTTP contract, not on adapter internals), YAGNI (fetch + SSE covers browsers; WebSocket transport deferred).

## Dependency Graph

```
Phase A (parallel — no deps between A2A and Client)
  ├── T20.1 A2A types + MessageBus + AgentMailbox
  └── T20.2 Client types + TheoKitClient

Phase B (depends on Phase A)
  ├── T20.3 Sub-path registration (package.json + tsup)
  └── T20.4 E2E integration tests (A2A + Client)

Phase C (Integration Validation — depends on all above)
  └── T20.5 Full validation
```

## Phase A — Core modules

### T20.1 — A2A protocol (MessageBus + AgentMailbox)

#### Why this step

**Action:** Ship `MessageBus` class with typed message routing and `AgentMailbox` with inbox queue, supporting request/response and fire-and-forget patterns.

**Reasoning:** Cross-validation gap #11 identified A2A as a MEDIUM gap. The in-process MessageBus pattern is the simplest design that enables multi-agent coordination without network overhead (ADR D453). TheoKitContainer already provides agent discovery; MessageBus adds the communication layer.

#### Files to edit

- `src/a2a/types.ts` (NEW) — `A2AMessage`, `A2ARequest`, `A2AResponse`, `MessageHandler`
- `src/a2a/message-bus.ts` (NEW) — `MessageBus` class with `register`, `send`, `request`
- `src/a2a/agent-mailbox.ts` (NEW) — `AgentMailbox` with inbox queue + handler registration
- `src/a2a/index.ts` (NEW) — barrel export
- `tests/a2a/message-bus.test.ts` (NEW)
- `tests/a2a/agent-mailbox.test.ts` (NEW)

#### Deep file dependency analysis

- These are all NEW files with zero existing callers.
- `MessageBus` is standalone — no import from agent internals.
- `AgentMailbox` references agent by string ID only (no import of Agent class).

#### TDD

```
RED: test("MessageBus routes message to registered agent", async () => {
  const bus = new MessageBus();
  const received: A2AMessage[] = [];
  bus.register("agent-b", (msg) => { received.push(msg); });
  await bus.send("agent-a", "agent-b", { type: "greeting", payload: "hello" });
  expect(received.length).toEqual(1);
  expect(received[0].payload).toEqual("hello");
});

RED: test("MessageBus request/response returns typed response", async () => {
  const bus = new MessageBus();
  bus.register("calculator", async (msg) => ({ result: 42 }));
  const response = await bus.request("caller", "calculator", { type: "compute", payload: { op: "add" } });
  expect(response.result).toEqual(42);
});

RED: test("MessageBus send to unregistered agent throws", async () => {
  const bus = new MessageBus();
  await expect(bus.send("a", "ghost", { type: "x", payload: null })).rejects.toThrow("not registered");
});

RED: test("AgentMailbox receives messages from bus", async () => {
  const bus = new MessageBus();
  const mailbox = new AgentMailbox("agent-a", bus);
  const messages: A2AMessage[] = [];
  mailbox.onMessage((msg) => { messages.push(msg); });
  await bus.send("external", "agent-a", { type: "ping", payload: null });
  expect(messages.length).toEqual(1);
});
```

#### Acceptance criteria

- `new MessageBus()` creates an in-process message router
- `bus.register(agentId, handler)` registers a message handler for an agent
- `bus.send(from, to, message)` delivers fire-and-forget message (rejects if `to` not registered)
- `bus.request(from, to, message)` delivers and awaits typed response (timeout 30s default)
- `new AgentMailbox(agentId, bus)` creates per-agent inbox with `.onMessage(handler)`
- `bus.unregister(agentId)` removes the agent from the bus
- `pnpm exec vitest run tests/a2a/message-bus.test.ts` exit 0 with 6+ passing tests
- `pnpm exec vitest run tests/a2a/agent-mailbox.test.ts` exit 0 with 4+ passing tests

#### DoD

- `pnpm exec vitest run tests/a2a/` exit 0 with 10+ passing tests
- CHANGELOG entry under `[Unreleased] § Added`

---

### T20.2 — Browser client (`@theokit/sdk/client`)

#### Why this step

**Action:** Ship `TheoKitClient` class using native fetch + EventSource for consuming server adapter endpoints from browsers.

**Reasoning:** Cross-validation gap #13. The server adapters (already shipped in mastra-parity plan) expose POST /send and GET /stream — the client-js consumes these from the browser side. Zero Node deps ensures browser compatibility. ADR D454.

#### Files to edit

- `src/client/types.ts` (NEW) — `ClientOptions`, `SendResponse`, `StreamEvent`
- `src/client/theokit-client.ts` (NEW) — `TheoKitClient` class with `send()` and `stream()`
- `src/client/index.ts` (NEW) — barrel
- `tests/client/theokit-client.test.ts` (NEW)

#### Deep file dependency analysis

- All NEW files. Client imports only its own types.
- Client does NOT import server adapter code — it consumes the same HTTP contract.
- `TheoKitClient` uses global `fetch` (available in browsers + Node 18+).

#### TDD

```
RED: test("TheoKitClient.send posts to /agent/send", async () => {
  const client = new TheoKitClient({ baseUrl: "http://localhost:3000" });
  // Mock fetch
  globalThis.fetch = async (url, init) => {
    expect(url).toEqual("http://localhost:3000/agent/send");
    expect(init?.method).toEqual("POST");
    return new Response(JSON.stringify({ status: "finished", output: "hi" }));
  };
  const result = await client.send("hello");
  expect(result.status).toEqual("finished");
  expect(result.output).toEqual("hi");
});

RED: test("TheoKitClient.stream returns async iterable of events", async () => {
  const client = new TheoKitClient({ baseUrl: "http://localhost:3000" });
  // Mock fetch with streaming response
  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: {\"type\":\"text\",\"text\":\"hello\"}\n\n"));
        controller.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  };
  const events: unknown[] = [];
  for await (const event of client.stream("hi")) {
    events.push(event);
  }
  expect(events.length).toEqual(1);
});

RED: test("TheoKitClient respects custom basePath", async () => {
  const client = new TheoKitClient({ baseUrl: "http://localhost:3000", basePath: "/api/v1" });
  globalThis.fetch = async (url) => {
    expect(url).toEqual("http://localhost:3000/api/v1/send");
    return new Response(JSON.stringify({ status: "finished" }));
  };
  await client.send("test");
});
```

#### Acceptance criteria

- `new TheoKitClient({ baseUrl })` creates a browser-safe client
- `client.send(input)` POSTs to `{baseUrl}{basePath}/send` and returns typed `SendResponse`
- `client.stream(input)` GETs `{baseUrl}{basePath}/stream?input=...` and returns `AsyncIterable<StreamEvent>`
- SSE parsing handles `data:` lines correctly
- Zero Node-specific imports (no `node:*` modules)
- `pnpm exec vitest run tests/client/theokit-client.test.ts` exit 0 with 6+ passing tests

#### DoD

- `pnpm exec vitest run tests/client/` exit 0
- `grep -r "node:" src/client/` returns empty (zero Node deps verified)
- CHANGELOG entry

---

## Phase B — Wiring

### T20.3 — Sub-path registration

#### Why this step

**Action:** Register `./a2a` and `./client` as sub-path exports in `package.json` and tsup entry points.

**Reasoning:** Without sub-path registration, consumers cannot `import { MessageBus } from "@theokit/sdk/a2a"`. Per existing pattern (rag, voice, subscription sub-paths).

#### Files to edit

- `packages/sdk/package.json` — add `./a2a` and `./client` export maps
- `packages/sdk/tsup.config.ts` — add `a2a/index` and `client/index` entries

#### TDD

```
RED: test("a2a sub-path is importable", async () => {
  const mod = await import("../../src/a2a/index.js");
  expect(mod.MessageBus).toBeDefined();
  expect(mod.AgentMailbox).toBeDefined();
});

RED: test("client sub-path is importable", async () => {
  const mod = await import("../../src/client/index.js");
  expect(mod.TheoKitClient).toBeDefined();
});
```

#### Acceptance criteria

- `import { MessageBus } from "@theokit/sdk/a2a"` compiles (`pnpm typecheck` exit 0)
- `import { TheoKitClient } from "@theokit/sdk/client"` compiles
- `pnpm build` emits `dist/a2a/index.js` + `dist/client/index.js` + `.d.ts` + `.d.cts`

#### DoD

- `pnpm build` exit 0 with a2a + client entries in dist/
- `pnpm exec vitest run tests/e2e/subpath-imports.e2e.test.ts` exit 0

---

### T20.4 — E2E integration tests

#### Why this step

**Action:** Add E2E tests covering A2A multi-agent message exchange and client-to-server roundtrip.

**Reasoning:** Unit tests verify individual modules; E2E verifies the integration between A2A + TheoKitContainer and Client + Server Adapter.

#### Files to edit

- `tests/e2e/a2a-multi-agent.e2e.test.ts` (NEW)
- `tests/e2e/client-server-roundtrip.e2e.test.ts` (NEW)

#### TDD

```
RED: test("E2E: two agents exchange messages via MessageBus", async () => {
  const bus = new MessageBus();
  const mailboxA = new AgentMailbox("agent-a", bus);
  const mailboxB = new AgentMailbox("agent-b", bus);
  let received = "";
  mailboxB.onMessage((msg) => { received = msg.payload as string; });
  await bus.send("agent-a", "agent-b", { type: "greeting", payload: "hello from A" });
  expect(received).toEqual("hello from A");
});

RED: test("E2E: client sends to server adapter mock", async () => {
  const client = new TheoKitClient({ baseUrl: "http://mock" });
  // mock fetch returns server adapter response shape
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "finished", output: "pong" }));
  const result = await client.send("ping");
  expect(result.output).toEqual("pong");
});
```

#### Acceptance criteria

- `pnpm exec vitest run tests/e2e/a2a-multi-agent.e2e.test.ts` exit 0 with 3+ tests
- `pnpm exec vitest run tests/e2e/client-server-roundtrip.e2e.test.ts` exit 0 with 3+ tests

#### DoD

- `pnpm exec vitest run tests/e2e/` exit 0 (zero regressions)

---

## Phase C — Integration Validation

### T20.5 — Full validation

#### Why this step

**Action:** Run full validation suite to confirm zero regressions and correct sub-path emission.

**Reasoning:** The plan is NOT complete until the full chain passes.

#### TDD

```
RED: test("pnpm typecheck exits 0", () => {
  expect(execSync("pnpm typecheck", { encoding: "utf8" })).toBeDefined();
});
```

#### Acceptance criteria

- `pnpm exec vitest run tests/a2a/ tests/client/ tests/e2e/` exit 0 with 20+ total tests
- `pnpm typecheck` exit 0
- `pnpm build` emits all new sub-paths
- Zero regressions in existing test suites

#### DoD

- `pnpm -w run validate` exit 0 (when no pre-existing failures block)
- CHANGELOG entries for both features

---

## Coverage Matrix

| # | Gap | Severity | Dimension | Task ID |
|---|-----|----------|-----------|---------|
| CV-11 | A2A protocol (inter-agent communication) | MEDIUM | Integration | T20.1 |
| CV-13 | Client SDK (browser JS client) | MEDIUM | Integration | T20.2 |
| WIRE-1 | Sub-path registration (package.json + tsup) | GATE | Build | T20.3 |
| E2E-1 | Integration tests (A2A + Client roundtrip) | GATE | Testing | T20.4 |
| VAL-1 | Full validation gate | GATE | ALL | T20.5 |

**Coverage: 5/5 gaps mapped (100%).**

## Drawbacks & Risks

| # | Risk | Severity | Mitigation | Owner |
|---|------|----------|------------|-------|
| R1 | A2A MessageBus is in-process only — no cross-process or network A2A in v1 | MEDIUM | Covers 90% of multi-agent use cases (single Node process). Network A2A deferred to v2 with ADR. | T20.1 owner |
| R2 | Client SSE parsing is custom (no EventSource polyfill) | LOW | Use native `fetch` + manual SSE line parsing. EventSource has CORS limitations; fetch-based is more flexible. | T20.2 owner |
| R3 | Client has zero Node deps — cannot use `node:events` or `node:stream` | LOW | By design — browser-safe. Use native Web APIs only. Test in Node (vitest) + document browser compatibility. | T20.2 owner |

## Unresolved Questions

- UQ1: A2A MessageBus — should it support wildcard subscriptions (agent subscribes to all messages of a type)? Default: no — point-to-point only in v1. Broadcast deferred.
- UQ2: Client — should it bundle React hooks (`useAgent`, `useStream`)? Default: no — `@theokit/react` already exists for React integration. Client is framework-agnostic.
- UQ3: A2A — should mailboxes persist undelivered messages? Default: no — in-memory only. Messages to offline agents are rejected.

## Global DoD

- `pnpm exec vitest run tests/a2a/ tests/client/` exit 0 with 20+ GREEN tests
- `pnpm typecheck` exit 0 (new sub-paths type-correct)
- `pnpm build` emits `dist/a2a/` + `dist/client/` with ESM + CJS + DTS
- CHANGELOG entries for both A2A and client-js
- Zero regressions in existing test suites
- File size budget: every new file under 200 LoC (per KISS)
