# D176 — Gateway hooks are an own contract, NOT a new `Plugin.kind`

**Date:** 2026-05-21
**Status:** Accepted

## Decision

`GatewayHook` is a separate type with three fire points (`pre_inbound`, `post_outbound`, `on_error`). It does NOT extend the SDK's `Plugin` discriminated union (ADR D98) with `kind: "gateway-hook"`.

## Rationale

The SDK's Plugin contract is sealed by design (D98 — "discriminated union by kind"). Adding kinds inflates the contract surface and forces every SDK consumer to know about gateway concerns even when they never touch transport. Keeping gateway hooks in `@usetheo/gateway` keeps the boundary clean. The same logic kept D101 (`pre_tool_call` veto) inside the SDK's plugin contract — because tool calls are SDK-domain. Transport hooks are gateway-domain.

## Consequences

- **Enables:** gateway hooks can have transport-specific contexts (e.g., a Telegram `ctx` object via `event.telegram.raw`) without leaking into the SDK.
- **Constrains:** a hook that needs to fire both as `pre_tool_call` AND `pre_inbound` registers twice. Acceptable — rare case.
