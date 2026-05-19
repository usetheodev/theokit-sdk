# D87 — `repairToolCall` applies 3 idempotent repairs sequentially

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D86, D88, plan `agent-core-loop-completion-plan.md`

## Decision

`repairToolCall(raw, registry)` runs three repair steps **in fixed order**:

1. **Case-insensitive name match** — Hermes v0.2 #444, v0.3 #1300.
2. **JSON-string args → object parse** — DeepSeek/Anthropic stringify.
3. **Type coercion against schema** — Hermes v0.8 #5265.

Each step logs its repair in `RepairResult.repairs` (human-readable
strings like `"name: SEARCH → search"`). Running `repairToolCall` twice
on the result produces empty `repairs[]` (idempotence).

## Rationale

Combining the three repairs in one monolithic step would hide which
specific repair triggered, making telemetry useless for diagnosing
provider-specific quirks. Separate steps keep the log granular.

Order matters: JSON-string parse MUST run before type coercion (coerce
requires `args` to be an object). Documented inline in the source.

## Consequences

- **Enables:** debuggable telemetry (`tool.repairs` span attribute) and
  evolving the repair surface independently.
- **Constrains:** order is fixed — changing it requires a follow-up ADR
  (and tests).
