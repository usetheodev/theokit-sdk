# D159 — Truncation telemetry counters (`context_files_truncated` / `context_files_total_truncated`)

**Date:** 2026-05-20
**Status:** Accepted

## Decision

When per-file truncation fires in `truncateWithMarker`, emit telemetry
counter `context_files_truncated` with `{ file: absPath }` attributes.
When aggregate-cap drops kick in, emit `context_files_total_truncated`
with `{ dropped: [...sourcePaths] }`. Both honor `AgentOptions.telemetry`
opt-in (D34) and are no-op when telemetry is disabled.

EC-L: lazy `tracer` lookup via `globalThis.__theokit_tracer` avoids
pulling `@opentelemetry/api` into the import graph for users without
the optional peer dep installed. Confirmed via dedicated test that
truncation with no tracer installed does NOT throw and does NOT import
OTel.

## Rationale

Hidden truncation is a debugging nightmare — users see "agent doesn't
know about my docs" without knowing the docs got cut. Telemetry
surfaces this without spamming stderr (which is reserved for warnings
the user must act on).

## Consequences

- **Enables:** users audit truncation rate via OTel dashboards; runtime
  proof that the cap is actually firing.
- **Constrains:** two new counter names — documented in telemetry guide.
