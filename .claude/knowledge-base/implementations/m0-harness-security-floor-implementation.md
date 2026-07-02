# Implementation Summary — m0-harness-security-floor

**Plan:** `knowledge-base/plans/m0-harness-security-floor-plan.md` (v1.1, SHIPPABLE_WITH_CAVEATS)
**Milestone:** M0 (Harness security floor)
**Branch:** develop
**Date:** 2026-07-02
**Runtime:** Node 22.22.2 (`.nvmrc`) — better-sqlite3 ABI 127

## Verdict: IMPLEMENTATION_COMPLETE

All 4 tasks implemented TDD-first (RED proven to fail against pre-fix code, then GREEN), wired into
production callers, committed atomically. Full `@theokit/sdk` (3117 passed / 0 failed / 36 env-gated
skips) + `@theokit/acp` (58 passed / 0 failed) suites green; typecheck + Biome clean.

## Task results + wiring triad

| Task | Issue | Commit | RED test | Caller (wiring a) | Integration (wiring b) |
|---|---|---|---|---|---|
| T2.1 | #56 cross-tenant cache leak | `58f440d` | `tests/memory/active-memory-tenant-isolation.test.ts` (calls=1 pre-fix → 2 after) | `local-agent-memory.ts:84` already supplies `userId/namespace/scope` → now threaded into cache key | golden memory suite (17 files / 115) green |
| T1.1 | #68 ACP veto not wired (live security) | `98ac0d0` | `tests/internal/plugins/manager.test.ts` (`register is not a function` pre-fix) + `acp/tests/permission-plugin.test.ts` | `prompt-handler.ts:98` → `installPermissionPlugin` → real `PluginManager.register` → `tool-dispatch.ts:79` honors block | SDK plugins+dispatch (55) + ACP (58) green |
| T3.1 | #54 child env secret leak + dishonest sandbox | `5412d7a` | `tests/runtime/spawn-collect-env-policy.test.ts` (module-missing pre-fix) | `spawnAndCollect` (hooks-executor + shell-tool) + `LocalSandbox.execute` use `resolveChildEnv` | sandbox + runtime suites (43 files / 336) green |
| T4.1 | #59 MCP request never times out | `e4cc6e9` | `tests/mcp/client-timeout.test.ts` (stdio hang 8s + http fetch-fail pre-fix) | stdio `request` timer + http `AbortSignal.timeout`; `createMcpClient` fetch seam | golden MCP (real-client 1 + oauth 9) green |

## Edge/negative cases covered (from the plan's absorbed edge-case review)

- EC-1/EC-2 (#68): `installPermissionPlugin` warns to stderr instead of silently no-op'ing when a
  runtime has no plugin manager and mode ≠ auto — asserted in `acp/tests/permission-plugin.test.ts`.
- EC-3 (#54): explicit `overrides` re-inject a scrubbed secret (a tool that needs one opts in).
- EC-4 (#54): pattern set keeps `PATH`/`HOME`/`PUBLIC_BASE_URL`, drops `API_KEY`/`X_SECRET`/`GH_TOKEN`/`DB_PASSWORD` — no false positive.
- EC-5 (#59): `close()` during a pending request rejects it (`mcp_closed`) without leaking timers.
- EC-6 (#59): a non-abort fetch error (`ECONNREFUSED`) is surfaced unchanged, not mislabeled a timeout.

## Parsimony (rung outcomes)

- #56: rung 5 (one-line wiring; cache-key infra already existed — no new abstraction).
- #54/#59: rung 2 (Node stdlib — object filter, `AbortSignal.timeout`, `setTimeout`) — zero new deps (deps-audit PASS).
- #68: rung 6 (minimum that works — a named `register` + replace-by-name; `initialize` single-shot guard preserved).

## Environment note

Local dev was on Node 24 (ABI 137); the pinned toolchain is Node 22 (ABI 127) per `.nvmrc` +
CLAUDE.md § Native bindings. All test runs used `nvm use 22`. On Node 24 the `better-sqlite3` binding
throws `ERR_DLOPEN_FAILED` (35 env-only failures, unrelated to M0 code) — documented, not a defect.

## CHANGELOG

Four changesets under `.changeset/`: `m0-56-*`, `m0-68-*`, `m0-54-*`, `m0-59-*` (Changesets is this
repo's CHANGELOG mechanism; compiled at release).

## Next

→ `/code-quality` (gate: verdict ∈ PASS/PASS_WITH_CAVEATS) → `/review` (READY_TO_MERGE).
