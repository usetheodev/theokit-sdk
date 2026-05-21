# D164 — Personality switch preserves history + re-injects system prompt via D94 cache invalidation

**Date:** 2026-05-20
**Status:** Accepted

## Decision

On every personality switch, `performPersonalitySwitch` runs this
lifecycle:

1. Compute the next slug (reserved name → `undefined`; known slug → that
   slug; unknown → throw `ConfigurationError` with available list).
2. If `prevSlug === nextSlug` → no-op (no marker, no cache invalidation,
   no store write).
3. Otherwise: `store.setActive(agentId, nextSlug, { save })`.
4. If `opts.reset === true` → `clearSession(agentId)` BEFORE marker.
5. Append marker to session as **user role**:
   - `[persona switched to <slug>]` for activation.
   - `[persona cleared]` for clear (`none`/`default`/`neutral`).
6. `invalidateCache("personality-switch")` (D94 deferred default).

## Rationale

History preservation is the default because operators usually want
continuity across switches. Reset is opt-in for cases where the new
personality is a fresh start. The marker is a user-role message so it
survives history compaction (D91) — arXiv:2412.00804 shows user-role
re-injection mitigates voice drift better than system-role mutation.
Cache invalidation uses the existing D94 path with a specific reason
code for observability.

## Consequences

- **Enables:** voice flips without losing context; the marker tells the
  model what just happened.
- **Constrains:** `reason: "personality-switch"` is now a reserved
  invalidation reason (caller observability).
