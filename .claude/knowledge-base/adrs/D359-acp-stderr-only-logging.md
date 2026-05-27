# D359 — Logging routes to stderr only; stdout reserved for JSON-RPC

- **Status:** Accepted
- **Date:** 2026-05-26
- **Plan:** `acp-server-adapter-plan` (Phase 0)

## Context

ACP uses stdout as the JSON-RPC framing channel. Any `console.log` or `process.stdout.write` from our code would corrupt the protocol stream.

## Decision

All logging from `@usetheo/acp` and the bin shim routes to `process.stderr.write`. The `log?: (msg: string) => void` option on `serveAcp` defaults to a stderr writer. CI lint rule scans `packages/acp/src/**` for `console.log` and treats it as an error.

## Rationale

Protocol correctness is non-negotiable. One stray `console.log` causes ACP framing errors that surface as cryptic UI failures in Zed/Cursor.

## Consequences

- New lint rule in `packages/acp/eslintrc` or biome config (TBD during implementation).
- All internal logs use the injected `log` callback or `process.stderr.write` directly.
- Tests assert stdout is JSON-RPC only (no leakage).
