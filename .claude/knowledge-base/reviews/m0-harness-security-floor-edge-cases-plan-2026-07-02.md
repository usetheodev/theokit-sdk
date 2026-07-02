# Edge Case Review — m0-harness-security-floor (plan)

Date: 2026-07-02
Plan: knowledge-base/plans/m0-harness-security-floor-plan.md
Tasks analyzed: 4 (T1.1, T2.1, T3.1, T4.1)
Cases found: 8 (EDGE: 3, NEGATIVE: 5 | MUST FIX: 1, SHOULD TEST: 5, DOCUMENT: 2)

## MUST FIX

### EC-1: `installPermissionPlugin` silently no-ops on runtimes without a plugin manager when mode ≠ auto
- **Affected task:** T1.1 (#68)
- **Kind:** NEGATIVE (failure — security hole)
- **Family:** Permission
- **Scenario:** `permission-plugin.ts:116-118` returns silently when `pluginManager()` is undefined (e.g. CloudAgent). If the operator set `permissionMode: "deny"` or `"ask"`, they believe tools are gated — but on that runtime the veto is simply never installed and tools run unchecked.
- **Impact:** A user who asked for `deny` gets silent `allow`. Same class of defect as #68 itself (a veto the user thinks is active but isn't).
- **Suggested fix:** In `installPermissionPlugin`, when `mgr === undefined` AND `mode !== "auto"`, write a clear stderr warning (`[theokit-acp] permission enforcement unavailable on this runtime — tools will NOT be gated`) instead of returning silently. (Honesty per Rule 3; ≤3 lines. Absorbed into T1.1 v1.1.)

## SHOULD TEST

### EC-2: no-manager permission install must warn, not silently allow
- **Affected task:** T1.1
- **Kind:** NEGATIVE
- **Suggested test:** `test_install_permission_on_agent_without_manager_warns()` — assert a stderr warning is emitted when mode is `deny`/`ask` and no plugin manager exists (not a silent no-op).

### EC-3: `options.env` override must re-inject a var the scrub would drop
- **Affected task:** T3.1 (#54)
- **Kind:** EDGE (extreme of valid — a tool legitimately needs a secret-named var)
- **Suggested test:** `test_env_override_reinjects_scrubbed_secret()` — with default `inherit-scrubbed`, `resolveChildEnv({ overrides: { MY_TOKEN: "x" } })` yields `MY_TOKEN` present (explicit override wins over scrub). Guards existing callers that pass a needed secret through `options.env`.

### EC-4: secret-pattern false positives (`*_AUTH*` catching `OAUTH_PUBLIC_URL`)
- **Affected task:** T3.1 (#54)
- **Kind:** NEGATIVE (invalid classification)
- **Suggested test:** `test_env_scrub_pattern_no_false_positive()` — assert `PATH`, `HOME`, `PUBLIC_BASE_URL` are KEPT and `API_KEY`, `X_SECRET`, `GH_TOKEN`, `DB_PASSWORD` are DROPPED. Tune the `*_AUTH*` pattern (or drop it) if it catches a common non-secret. Resolves plan Unresolved-Q2.

### EC-5: MCP `close()` during a pending request must reject + clear timers
- **Affected task:** T4.1 (#59)
- **Kind:** NEGATIVE (mid-operation cancellation)
- **Suggested test:** `test_close_during_pending_rejects_and_clears_timers()` — start a request, call `close()`, assert the pending promise rejects (not hangs) and no timer leaks (no unhandled rejection).

### EC-6: MCP http `AbortError` must be distinguished from other fetch errors
- **Affected task:** T4.1 (#59)
- **Kind:** NEGATIVE
- **Suggested test:** `test_http_timeout_maps_abort_to_typed_error()` — a fetch that rejects `AbortError` → `NetworkError` `mcp_timeout`; a fetch that rejects a generic network error → the existing error path (not mislabeled as timeout).

## DOCUMENT

### EC-7: NUL byte in an identity field (tenant key separator collision)
- **Kind:** NEGATIVE
- **Accepted risk:** `cacheKey` joins with `\x00`; a `userId`/`namespace`/`scope` literally containing NUL could theoretically collide. Real identity strings do not contain NUL bytes (they come from auth subjects / org ids). Accepted; not worth a guard (KISS).

### EC-8: default env behavior change — inherited secrets now dropped
- **Kind:** EDGE
- **Accepted risk:** Callers that today rely on a child *inheriting* a secret-named env var will stop receiving it under `inherit-scrubbed`. This is the intended security fix; the escape hatch is `options.env` (explicit) or policy `all`. Documented in ADR D3 + Drawbacks; EC-3 adds the override regression test.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 0 | 2 | 1 (EC-1) | 1 (EC-2) | 0 |
| T2.1 | 1 | 1 | 0 | 0 | 1 (EC-7) |
| T3.1 | 1 | 2 | 0 | 2 (EC-3,EC-4) | 1 (EC-8) |
| T4.1 | 1 | 2 | 0 | 2 (EC-5,EC-6) | 0 |

**Coverage check:** every task considered both lenses. T1.1's security-honesty NEGATIVE (EC-1) is the one crash/security-class miss → MUST FIX.

**Verdict:** PLAN NEEDS ADJUSTMENT (1 MUST FIX absorbed into T1.1 v1.1; 5 SHOULD-TEST added to TDD blocks)
