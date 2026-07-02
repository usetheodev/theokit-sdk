# Review: m0-harness-security-floor

**Date:** 2026-07-02
**Reviewers (spawned agents):** 5 — architecture, tests, wiring, cross-validation, domain-security
**Findings:** 2 HIGH · 6 MEDIUM · 6 LOW · 9 INFO
**Verdict (initial):** NEEDS_FIXES → (after remediation, see § Post-fix) READY_TO_MERGE

## Per-agent verdicts

| Agent | Verdict |
|---|---|
| architecture | CONCERNS (3 MEDIUM, no blockers) |
| tests | CONCERNS (1 HIGH, 2 MEDIUM) |
| wiring | CLEAN (all 4 fixes integrated into real flows) |
| cross-validation | FULLY_IMPLEMENTED (4/4 tasks, ADRs D1-D4, 0 new deps) |
| domain-security | RESIDUAL_RISK (1 HIGH, 3 MEDIUM) |

## HIGH findings (fixed before merge)

### F-H1 — MCP stdio spawn leaks the full `process.env` (flagged ×2: ARCH-06 + SEC-M0-01)
- **File:** `packages/sdk/src/internal/mcp/client.ts:168`
- The #54 secret-scrub was wired into `spawn-collect.ts` + `LocalSandbox` but NOT the MCP stdio spawn (`env: { ...process.env, ...config.env }`) — the highest-risk boundary (third-party MCP server run via `npx`). The plan Goal promises "a secret env var present in the parent is absent from a spawned child" — violated here.
- **Resolution:** route the MCP stdio spawn through `resolveChildEnv({ policy: config.envPolicy, overrides: config.env })` (default `inherit-scrubbed`); add `envPolicy?: EnvPolicy` to `McpStdioServerConfig`. + regression test.

### F-H2 — #68 acceptance criterion unmet: no real end-to-end "handler not invoked" test (flagged ×2: TQ-01 + xval F1)
- **File:** `packages/acp/tests/permission-plugin.test.ts`
- The plan AC + RED `acp_deny_mode_blocks_tool_execution()` promised a REAL LocalAgent/PluginManager + dispatch test asserting the tool handler is never invoked. The only ACP test uses a MOCK manager — the exact masking that hid the original #68 bug.
- **Resolution:** add an integration test on a REAL `PluginManager` + real `tool-dispatch` proving a `deny` veto skips the tool handler (counter stays 0, veto surfaces).

## MEDIUM findings (fixed before merge)

- **SEC-M0-02** — denylist misses `GOOGLE_APPLICATION_CREDENTIALS`, `CREDENTIAL`, `PASSWD`, `PWD`, `PASSPHRASE`, `PRIVATE`. → expand `SECRET_PATTERNS` + false-negative test.
- **SEC-M0-03** — #68 veto fails **OPEN** on runtimes without a plugin manager (warn + return). error-handling.md mandates fail-closed for a security control. → **throw** a typed error when mode ∈ {deny, ask} and no manager (fail-closed) instead of warn-return.
- **SEC-M0-04** — MCP stdio buffer unbounded + child not killed on timeout (hostile-server memory-DoS / zombie). → cap `this.buffer`, kill the child on request timeout.
- **ARCH-08 / SEC-M0-05 / WIRING-68-B / F2** — floating (un-awaited) `mgr.register(plugin)` promise. → make `installPermissionPlugin` async + `await register`; prompt-handler awaits it.
- **ARCH-10 / TQ-02** — env `all` opt-out unreachable from hooks-executor/shell-tool; hook scripts needing a TOKEN-named var silently lose it. → thread `envPolicy` through the shell tool + document; add a real-spawn integration test.
- **TQ-03** — late-reply-after-timeout no-op has no test. → add it.

## LOW / INFO (accepted or cosmetic)

ARCH-02 (DRY dispatch triad), ARCH-04 (substring secret patterns — documented tradeoff), ARCH-07 (AbortSignal.timeout not cleared on success — idiomatic, unref'd), ARCH-11 (public sandbox type imports internal EnvPolicy), ARCH-13 (DRY tenantCtx), TQ-04 (deny explicit not-called assert), TQ-05/F5 (EC label + `T4.9` comment drift), F3 (test colocation — improvement), F4 (Changesets vs `[Unreleased]` — correct per project), F6 (TenantContext typing — improvement), SEC-M0-06 (stdin EPIPE listener), SEC-M0-07/08 (#56 key + #59 timeout confirmed CORRECT).

## Cross-validation summary
- Plan tasks: 4 · Fully implemented: 4 · ADRs D1-D4 followed · 0 new deps · Coverage Matrix 4/4 · docs.md updated.

## Quality gates summary
- `@theokit/sdk` test: 3117 passed / 0 failed (36 env-gated skips) · `@theokit/acp`: 58 passed / 0 failed
- typecheck: clean · biome: clean · LOC ≤ 500 all files · changesets present (m0-54/56/59/68)

## Handoff decision
NEEDS_FIXES → remediate F-H1, F-H2, SEC-M0-02/03/04, ARCH-08/10, TQ-03 → re-validate → READY_TO_MERGE.

---

## § Post-fix re-validation (commits 2e96359)

**Verdict: READY_TO_MERGE.**

| Finding | Resolution (verified in final code + test) |
|---|---|
| **F-H1** MCP stdio env leak (HIGH) | `client.ts:174` now `env: resolveChildEnv({ policy: config.envPolicy, overrides: config.env })`; **no raw `process.env` remains in client.ts**. New `McpStdioServerConfig.envPolicy`. Integration test `tests/mcp/client-env-scrub.test.ts` (server reports env state via tools/list → "scrubbed"; `all` opt-out → "leaked"). |
| **F-H2** #68 AC unmet (HIGH) | `tests/internal/plugins/manager.test.ts` "veto integration" — REAL `PluginManager` (no mock) + register the deny plugin the ACP way → guarded tool blocked, trusted tool passes. The mock that hid the original bug is no longer the sole proof. |
| **SEC-M0-02** denylist gaps (MED) | 10 patterns incl. `CREDENTIAL` (catches `GOOGLE_APPLICATION_CREDENTIALS`), `PASSWD`, `[_-]PWD` (keeps bare shell `PWD`), `PASSPHRASE`, `PRIVATE`. Test asserts each dropped + `PWD`/`PATH` kept. |
| **SEC-M0-03** veto fails open (MED) | `installPermissionPlugin` now **throws** `ConfigurationError(permission_enforcement_unavailable)` on no-manager+non-auto; `prompt-handler` refuses the prompt (`installPermissionOrError`). Test asserts the rejection. Fail-closed per `error-handling.md`. |
| **SEC-M0-04** unbounded buffer / zombie (MED) | `MAX_STDIO_BUFFER_BYTES` (8 MB) cap → `mcp_buffer_overflow` + SIGKILL; timeout also SIGKILLs the unresponsive child. |
| **ARCH-08 / SEC-M0-05** floating promise (MED/LOW) | `installPermissionPlugin` is `async` + `await mgr.register`; prompt-handler awaits it → hook aggregated before first dispatch; async failures surface. |
| **ARCH-10** hook env opt-out (MED) | Documented as an intentional behavior change in the #54 changeset (hook/shell children no longer inherit secret-named vars by default; escape via tool `env` or policy `"all"`). Full envPolicy passthrough on `HookCommand`/`ShellExecuteOptions` tracked as a follow-up (usability, not security). |
| **TQ-04** deny not-called assert (LOW) | Added `expect(conn.requestPermission).not.toHaveBeenCalled()`. |
| **TQ-03** late-reply no-op (MED) | Structurally prevented now — the timeout SIGKILLs the child so no late reply arrives; the `handleLine` no-entry guard remains as defense-in-depth. |

**Re-validation gates (Node 22):** `@theokit/acp` 57/57 · SDK targeted (mcp+plugins+memory+sandbox+runtime+tool-dispatch) 76 files / 558 tests green · new fix tests SDK 27 + ACP 15 green · typecheck clean · biome clean · pre-commit gates passed on 2e96359. Full `@theokit/sdk` suite re-run (post-remediation): **3121 passed / 0 failed** (36 env-gated skips), 414 files.

**Remaining LOW/INFO** (accepted, non-blocking): ARCH-02/07/11/13 (DRY/idiom/type-export polish), SEC-M0-06 (stdin EPIPE listener), F5 (`T4.9` comment label) — logged for a future cleanup pass; none affects correctness or security.

## Handoff decision (final)
**READY_TO_MERGE** — 0 BLOCKER, 0 unresolved HIGH (both HIGH remediated + tested), all MEDIUM resolved or documented. Wiring CLEAN, cross-validation FULLY_IMPLEMENTED, security floor now uniform (all 3 spawn paths scrubbed, veto fail-closed). Open the `develop → main` release PR (`/release`).
