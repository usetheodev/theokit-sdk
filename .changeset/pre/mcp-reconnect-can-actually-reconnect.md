---
"@theokit/sdk": patch
---

An MCP client with a tight `requestTimeoutMs` can reconnect after a drop.

`reconnect()` recovers by spawning a fresh child and running the `initialize` handshake, and that
handshake was bounded by the same `requestTimeoutMs` the caller set for ordinary requests. Setting a
tight request budget — an ordinary thing to do for a latency SLO — silently made a client unable to
recover: every reconnect attempt spawned a process that could not finish inside a steady-state budget,
the bounded loop exhausted, and the client surfaced `mcp_disconnected`. That is the wedge the bounded
loop exists to prevent.

The reconnect handshake now takes `max(requestTimeoutMs, 10s)`.

The **first** connect is unchanged and keeps your budget exactly. The difference is which failure is
visible: a `requestTimeoutMs` too small to connect at all fails at the call you made, immediately, and
is yours to correct. The reconnect is the SDK's own recovery, which you never sized and never see
until a drop happens.
