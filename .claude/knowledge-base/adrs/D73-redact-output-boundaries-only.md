# D73 — Apply redaction at OUTPUT boundaries, not at storage

**Date:** 2026-05-18
**Status:** Accepted
**Related:** D68, plan `secret-redaction-discipline-plan.md`

## Decision

`redactSecrets` is wired at egress: `ErrorMetadata.raw` (in
`mappers/shared.ts:truncateRaw`), telemetry tracer
`setAttribute`/`setAttributes` (in `telemetry/tracer.ts`), transcript
JSONL appends (in `runtime/agent-session-store.ts`), and migration
logger output (in `memory/migrate-sqlite-to-lance.ts`).

Redaction is NOT applied at:

- Memory fact storage (caller `markdown-store.ts` already redacts via
  the same module; storage layer is intentionally faithful).
- Agent session in-memory state (process-local; not a sink).
- Workspace files like `.theokit/agents/*.json` (file perm 0600; not a
  publication surface).
- OAuth token storage (`mcp-tokens.json`) — encrypted bundle, redacting
  would corrupt the persisted state. File perm 0600 + keychain fallback
  (D41) handle that risk.

## Rationale

Redacted data is lossy. If a user later needs to debug ("what did the
provider actually return for that 401?"), they must be able to recover
the original payload. Storing redacted data forecloses that.

By contrast, the egress sinks (logs, telemetry exporters, error
messages) are publication surfaces — they leave the SDK process and
reach third parties (Langfuse, Sentry, the user's terminal, audit
logs). Redaction at egress is the universal hygiene.

Hermes pattern AD-5 — same architectural choice.

## Consequences

- Enables faithful storage + safe egress.
- Constrains: new surfaces that persist state must EXPLICITLY decide
  whether they're storage (no redaction) or egress (redaction). The CI
  gate `tests/lint/no-unredacted-sink.test.ts` enforces the choice for
  `console.log`/`appendFile`/`writeFile`/`span.setAttribute` callsites
  in `src/`.
- Constrains: callers of memory storage who want stored facts to be
  redacted must redact upstream (today: `markdown-store.ts` does this
  via the shared module).
