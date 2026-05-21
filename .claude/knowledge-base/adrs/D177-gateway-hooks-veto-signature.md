# D177 — Gateway hook signature mirrors SDK `pre_tool_call` veto pattern

**Date:** 2026-05-21
**Status:** Accepted

## Decision

`pre_inbound` hooks return `{ block: true, message?: string }` to short-circuit the inbound event flow. Returning `{ block: false }` (or `undefined`) continues. Throwing is treated as `block: true` + log. When `message` is set, the runner calls `ctx.reply(message)` BEFORE short-circuit (EC-D).

## Rationale

Reuses the mental model SDK consumers already know from `pre_tool_call` (D101). Reduces cognitive load and keeps the gateway's "veto" shape isomorphic to the SDK's.

## Consequences

- **Enables:** group-policy filtering, allowlist enforcement, rate-limit veto all expressed in the same shape, with optional user-visible message on rejection.
- **Constrains:** hooks can't transform an event (they only allow/block + optionally reply). For transform use cases, the consumer mutates fields on the event in place — same as Express middleware.
