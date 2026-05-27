# D355 — ACP tool permission flow bridges through `pre_tool_call` hook veto

- **Status:** Accepted
- **Date:** 2026-05-26
- **Plan:** `acp-server-adapter-plan` (Phase 0)

## Context

ACP defines `tool_call_permission_request` as a first-class round-trip: server requests permission, waits for user decision. Our SDK has the `pre_tool_call` veto hook (D101) — closest existing primitive.

## Decision

A synthetic plugin (`acp-permission`) is installed on each ACP session's agent. The plugin registers a `pre_tool_call` listener that:
1. If `permissionDefault === "auto"` → pass-through (plugin not installed in this mode).
2. If `permissionDefault === "deny"` → veto.
3. If tool in `trustedTools` set → pass-through.
4. Otherwise: call `conn.requestPermission(sessionId, ...)`, await with timeout (D-EC-2), veto if denied/timeout/cancelled.

## Rationale

Reuses existing veto infrastructure. No new core SDK changes needed. Three modes (`ask`/`auto`/`deny`) give CI/dev/prod flexibility.

## Consequences

- `permissionDefault: "ask"` is the default (interactive use).
- `permissionTimeoutMs: 60_000` default prevents prompt-hang on unresponsive client (EC-2).
- Forked sessions re-install the plugin (handled in T2.3).
- Trusted tools bypass: `trustedTools?: ReadonlyArray<string>` option.
