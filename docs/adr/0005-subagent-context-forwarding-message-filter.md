# ADR 0005 — Subagent context forwarding + `messageFilter` (SE12)

- **Status:** Accepted (2026-07-10)
- **Milestone:** SE12 (SDK Evolution — a peer framework supervisor-agents parity)
- **Supersedes / relates:** SE10 (subagent `AbortSignal`), SE11 (delegation hooks)

## Context

`defineSubAgent()` (`@theokit/sdk/a2a`) sends the child agent ONLY a fresh `input`
string — full memory isolation, a deliberate strength (each delegation is a clean
context). a peer framework's supervisor forwards the full supervisor conversation to each
subagent and exposes a `messageFilter` to trim it.

To offer the same capability we must solve two problems that do not have a seam today:

1. **Expose the supervisor's transcript to the delegation handler.** The custom-tool
   `handler(input, ctx)` receives `ctx = { signal, context }` (#65 / M7). The running
   conversation lives in the agent loop's `ctx.messages` (`loop.ts`) and is NOT passed
   to tool handlers.
2. **Seed the child with that (filtered) context.** The child is a fresh
   `Agent.create()` + `agent.send(input)`; there is no public "prior conversation" seed.

## Decision

1. **Expose a read-only transcript projection on the tool `ctx`.** The loop threads a
   public projection of `ctx.messages` — `ReadonlyArray<{ role: "user" | "assistant" |
   "system"; content: string }>` — to every custom-tool handler as `ctx.messages`. It is
   threaded through the existing dispatch chain (`dispatchTools → dispatchSingleCall →
   runToolWithLifecycle → executeTool → runCustomTool → runHandlerTool`), mirroring how
   `ctx.signal` (#65) and `ctx.context` (M7) are already threaded. Content parts are
   flattened to their text; non-text parts are dropped from the projection (tools get a
   textual transcript, never raw wire parts).

2. **`SubAgentSpec.messageFilter` is the ONLY consumer that widens the child context.**
   When `messageFilter` is set, `defineSubAgent` reads `ctx.messages`, passes them to the
   filter, and forwards the returned subset to the child as a **role-tagged context
   preamble** prepended to the delegated input. When `messageFilter` is absent, the child
   runs input-only — **isolation stays the default**. Seeding via a preamble (not a new
   public `priorMessages` API) keeps the change additive and self-contained to
   `subagent.ts`; the child model receives the prior turns as clearly-delimited context.

## Consequences

- **Transcript is now readable by any custom tool** that opts to read `ctx.messages`
  (a new privacy/observability surface). Handlers that ignore `ctx` are unaffected; the
  projection is read-only and text-only (no tool args, no nested tool results — matching
  a peer framework's "scoped" posture). This is the deliberate trade-off approved for SE12.
- **Memory isolation remains the default** for subagents: no `messageFilter` ⇒ no
  forwarding, exactly the pre-SE12 behavior.
- **Security:** `messageFilter` is the single path that forwards transcript into a child;
  a filter that drops sensitive turns (e.g. anything `confidential`) provably keeps them
  out of the child context (regression-tested).
- **No new public seed API** (`SendOptions.priorMessages` was considered and rejected as
  larger surface than needed); the preamble is sufficient and keeps the internal
  `priorMessages` session-hydration seam untouched.

## Alternatives considered

- **Opt-in per-tool `receivesMessages` flag** so only subagent tools get the transcript.
  Rejected for v1 (adds a field + loop branching); the read-only text projection on `ctx`
  is the simpler, consistent extension of the existing `ctx.signal`/`ctx.context` pattern.
  Revisit if a tighter exposure boundary is demanded.
- **Public `SendOptions.priorMessages`** to seed the child as distinct turns. Deferred —
  the preamble delivers the capability without exposing the internal hydration seam.
