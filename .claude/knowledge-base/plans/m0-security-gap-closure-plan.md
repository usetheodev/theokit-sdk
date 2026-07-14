---
slug: m0-security-gap-closure
milestone_id: M0
created_at: 2026-07-14
goal: Close the genuine gaps the adversarial review found in the already-shipped M0 security fixes (#54/#56/#59/#68), with TDD + evidence, then flip the ROADMAP checkboxes.
---

# Plan — M0 security floor gap closure (#54 #56 #59 #68)

## Context

The M0 fixes were implemented earlier (commits 5412d7a7/58f440df/e4cc6e9d/98ac0d09) but the
ROADMAP item checkboxes stayed `[ ]`. Adversarial review (3 security agents) validated each and
found REAL residual gaps. This plan closes only the genuine gaps (no re-implementation of what is
correct) and produces evidence to flip the boxes.

## Findings → tasks (Coverage Matrix)

| # | Finding (adversarial review) | Severity | Task | Test |
|---|---|---|---|---|
| #56-B | `@theokit/sdk-memory` (publishable) `active-memory.ts:157,278` call `cache.get/set` with NO tenantCtx → full cross-tenant leak for every consumer | **CRITICAL** | T1 | sdk-memory isolation test |
| #56-A | production caller `local-agent-memory.ts:118` hardcodes `namespace:"default"` and drops `memoryContext.tenantId` → two tenants same userId collide | **HIGH** | T2 | caller unit test |
| #59 | `client.ts:435 await response.json()` (HTTP body read) is OUTSIDE the abort try/catch → body-phase stall throws raw `DOMException` not typed `mcp_timeout` (bounded, no hang) | LOW | T3 | body-stall test |
| #54-a | env denylist misses value-embedded / connection-string secrets (`DATABASE_URL`, `REDIS_URL`, `MONGODB_URI`, `SENTRY_DSN`, `*WEBHOOK*`, `*COOKIE*`) | MEDIUM | T4 | env-policy test |
| #54-b | `validateCommand`/`SHELL_METACHARACTERS` (`sandbox/types.ts`) is DEAD CODE — a false guard never invoked | LOW | T5 | n/a (removal) |
| #54-c | no end-to-end env-scrub test for `LocalSandbox.execute` (wiring at `local-sandbox.ts:44` unverified) | evidence | T6 | sandbox e2e test |
| #68 | ACP veto — FULLY_CLOSED (veto consumed, fail-closed everywhere) | — | verify + flip | existing 8 tests |

Design decision (NOT a bug): #54 "arg-vector exec" was consciously deferred — `sh -c` IS the shell
tool's contract; env-scrub + the "NOT an isolation boundary" doc are the real boundary. Documented.

sessionId is intentionally NOT a cache-key dimension: memory recall is cross-session by design;
partitioning by sessionId would defeat durable memory. Only tenant identity isolates.

## Tasks (TDD-first)

- **T1 (#56-B CRITICAL):** In `sdk-memory/src/internal/active-memory/active-memory.ts`, build
  `const tenantCtx: TenantContext = { namespace, userId, scope }` from `args` and pass to
  `cache.get` (`:157`) + `cache.set` (`:278`), mirroring the sdk copy exactly. RED: sdk-memory
  cross-tenant isolation test (two `runActiveMemory` calls, same userText, different userId/namespace
  → no shared entry).
- **T2 (#56-A HIGH):** In `buildTelemetryRecallArgs` (`local-agent-memory.ts:118`), thread the tenant
  partition: `namespace: memoryContext?.tenantId ?? "default"`. RED: unit asserts the built args carry
  `namespace === tenantId` when `memoryContext.tenantId` is set.
- **T3 (#59 LOW):** Wrap the HTTP `response.json()` body read in the same abort try/catch so an
  aborted body read maps through `isAbortLike` → `mcpTimeoutError`. RED: a server that returns headers
  then stalls the body rejects with `NetworkError{code:"mcp_timeout"}`.
- **T4 (#54-a MEDIUM):** Add high-confidence connection/secret name patterns to `SECRET_PATTERNS`
  (`DSN`, `WEBHOOK`, `COOKIE`, and connection vars `(DATABASE|REDIS|MONGO|MONGODB|POSTGRES|POSTGRESQL|MYSQL|AMQP|RABBITMQ)_(URL|URI|...)`).
  RED: env-policy drops `DATABASE_URL`/`REDIS_URL`/`MONGODB_URI`/`SENTRY_DSN`/`SLACK_WEBHOOK_URL`/`SESSION_COOKIE`
  under default policy AND keeps `PATH`/`BASE_URL`/`HOME` (no false positive).
- **T5 (#54-b LOW):** Remove the dead `validateCommand` + `SHELL_METACHARACTERS` from `sandbox/types.ts`
  (or wire it). Decision: REMOVE (no-stubs / KISS — a never-called guard is worse than none). Confirm
  no caller via grep.
- **T6 (#54-c evidence):** Add e2e test that `LocalSandbox.execute("printenv")` does NOT expose a
  secret-like host var (real subprocess).
- **T7:** Flip ROADMAP M0 checkboxes `[ ]`→`[x]` for #54/#56/#59/#68 with the evidence recorded.

## DoD
- [ ] T1: sdk-memory get/set keyed by tenant; isolation test green.
- [ ] T2: caller threads tenantId → namespace; unit green.
- [ ] T3: HTTP body-stall → typed mcp_timeout; test green.
- [ ] T4: connection/value-embedded secret names dropped; no false positive on PATH/BASE_URL.
- [ ] T5: dead guard removed; no dangling reference.
- [ ] T6: LocalSandbox e2e env-scrub proven.
- [ ] #68 re-verified FULLY_CLOSED (existing tests).
- [ ] Full suite + typecheck + biome green; ROADMAP boxes flipped; CHANGELOG/changeset.

## Risks
- R1: expanding the denylist risks false positives → mitigated by high-confidence patterns + a keep-list test (PATH/BASE_URL/HOME).
- R2: changing `namespace` from constant to tenantId could alter telemetry dimensions → acceptable (more correct; namespace is documented as the `<orgId>` partition).
- R3: sdk-memory is a separate published package → its own changeset + version bump.

## Unresolved Questions
(none — scope locked by the adversarial review evidence.)
