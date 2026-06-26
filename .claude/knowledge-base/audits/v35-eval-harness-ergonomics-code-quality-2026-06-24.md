# Code-Quality Audit: v35-eval-harness-ergonomics

**Date:** 2026-06-24
**Mode:** plan-bound:v35-eval-harness-ergonomics
**Verdict:** PASS_WITH_CAVEATS
**Score cap:** 89
**Soft caps:** [`config_languages_empty` — automated detectors config-disabled; complemented by manual reachability + the knip run inside `pnpm validate` (exit 0)]

## Honest framing
`.claude/rules/code-quality-languages.txt` is empty, so the automated D1-D4 detectors do not run (known gap, memory `project_theokit_sdk_code_quality_vacuous_pass`). This audit reports manual reachability cross-checked against the knip dead-code detector baked into `pnpm validate` (exit 0 on this slice — `/tmp/v35-validate2.log`, `quality` task green).

## Findings by detector (manual + validate-baked)

### D1 — Dead code
- knip (via `pnpm validate quality`): exit 0 — no unused export / dead symbol.
- No NEW exported symbol added (the change widens existing exported APIs: `provisionRepo` overload + `VerifyGateOptions.sandbox` optional). The new `LocalSandbox` imports in `provision.ts`/`scorers.ts` are used (default-construction). No dead code.

### D2 — Symbol fabrication
- `LocalSandbox` resolves to `sandbox/local-sandbox.ts` (public, in-package) ✓; `SandboxBackend`, `ProvisionRepoOptions`, `VerifyGateOptions` all real. `tsc --noEmit` exit 0 corroborates (a fabricated import fails compilation). No fabrication.

### D3 — Cross-package wiring (orphan exports)
- No new export; the widened APIs (`provisionRepo`, `Scorers.verifyGate`) are already public on `@theokit/sdk/sandbox` + `Scorers`, exercised by tests + docs. Not orphan.

### D4 — Mutation testing
- Not run (languages config-disabled). The 15 TDD tests (default-path + explicit-path regression for both primitives) provide behavioral coverage. INFO.

## Cross-validation with `pnpm validate`
| Gate | Result |
|---|---|
| biome (cc ≤ 10, format) | clean (the `provisionRepo` discriminator + `verifyGate` default add ≤ 2 lines each) |
| typecheck | exit 0 |
| full test suite | 2916 passed / 35 skipped (incl. 15 provision/verify-gate/m6) |
| knip | exit 0 |
| jscpd | 0 clones |
| publint + attw | pass |
| bundle budget | PASS |

## Verdict rationale
PASS_WITH_CAVEATS (cap 89): no HARD finding (no dead code, no fabrication). The single caveat is the config gap (languages.txt empty), substituted by the manual reachability audit + the knip/typecheck/jscpd signals in `pnpm validate`. Does NOT block `/review`.

**Follow-up (not a V3-5 blocker):** enable `typescript` in `code-quality-languages.txt` (candidate for a future hygiene slice; same INFO as V3-3).
