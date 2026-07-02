# Code-Quality Audit — m0-harness-security-floor

**Date:** 2026-07-02
**Mode:** plan-bound (native TS gates — `code-quality-languages.txt` is empty, so the plan-skill is a NOOP; per Rule 9 the repo's own knip/biome/tsc gates are the authoritative detectors)
**Verdict:** PASS
**Hard caps triggered:** [] · **Soft caps triggered:** []

## Detectors (native, Rule 9)

| Detector | Tool | Result on M0 slice |
|---|---|---|
| D1 — Dead code | `knip` (`pnpm quality:dead`) | **No M0 symbol flagged.** New symbols (`resolveChildEnv`, `PluginManager.register`, `mcpTimeoutError`, `isAbortLike`, `EnvPolicy`, `resolveChildEnv`) all have importers. `TenantContext` orphan-export (pre-existing, ba2e521) **cleared** by typing the #56 wiring. |
| D2 — Symbol fabrication | `tsc --noEmit` | **0 errors** — every import/symbol resolves. |
| D3 — Cross-package wiring | grep importer count | `resolveChildEnv` 6 · `register` 10 · `EnvPolicy` 6 · `mcpTimeoutError` 3 — no orphan public export. |
| Stubs/mocks/unwired | `no-stubs-no-mocks-no-wired.md` checklist | **CLEAN** — no `not_implemented`/`TODO`/`FIXME`/`Mock`/`Fake`/`Stub` in changed production code. |
| LOC budget (≤500) | `wc -l` | All 9 changed files ≤ 500 (largest: `mcp/client.ts` 309). |
| Format/lint | `biome` (pre-commit) | Clean on every commit. |

## Test evidence

- `@theokit/sdk`: **3117 passed / 0 failed** (36 env-gated skips: Ollama/real-LLM), 413 files.
- `@theokit/acp`: **58 passed / 0 failed**.
- 4 RED regression tests each proven to FAIL against pre-fix code, then PASS (see implementation summary).

## Pre-existing findings (OUT of M0 scope — not introduced/worsened by M0)

- knip orphan exports `ActiveMemoryCacheOptions` (active-memory-cache.ts, ba2e521), `registerProvider` / `_resetBuiltinsRegistered` / `registerLoopError` / `_isRegistered` (unrelated modules) — pre-date M0; a separate `dead-code-sweep` plan should address them.
- Node-24 `better-sqlite3` ABI mismatch (env-only; use `nvm use 22`).

## Verdict rationale

The M0 slice introduces **no dead code, no fabricated symbol, no stub/mock, no unwired export**, respects the LoC budget, and is fully green under typecheck + lint + the full test suites. Verdict **PASS** — proceed to `/review`.
