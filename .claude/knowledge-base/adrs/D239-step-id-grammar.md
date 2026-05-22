# D239 — Step IDs are user-provided strings, validated via grammar `^[a-z0-9][a-z0-9_-]*$`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Every step requires an `id: string`. Grammar reuses `sanitizeIdentifier` from D81: lowercase alphanumeric + `_` and `-`, first char must be alphanumeric. `.commit()` validates uniqueness across all steps and throws `WorkflowDuplicateStepIdError` on collision.

## Rationale

Inngest validated this pattern — deterministic step IDs enable resume after crash because snapshot references map 1:1 to step definitions. Auto-generated UUIDs would break resume across rebuilds. Restrictive grammar keeps IDs safe for use as filenames, span names, and SQL keys.

## Consequences

- Step rename loses snapshot resumability — documented limitation.
- Caller may namespace IDs (`"phase1.fetch"` not allowed; use `"phase1_fetch"` or `"phase1-fetch"`).
- `WorkflowDuplicateStepIdError` thrown at `.commit()` time, not at run time.
- IDs are case-sensitive lowercase by grammar (avoid case-folding bugs across OS).
