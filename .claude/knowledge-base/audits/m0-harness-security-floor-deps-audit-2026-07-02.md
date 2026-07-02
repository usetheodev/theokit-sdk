# Deps Audit: m0-harness-security-floor

**Date:** 2026-07-02
**Mode:** plan-bound:m0-harness-security-floor
**Verdict:** PASS
**Hard caps triggered:** [] (none)

## Summary

- Ecosystems detected: npm (pnpm workspace)
- Plan-declared NEW deps: **0** — all four fixes use Node stdlib + already-present in-repo symbols (`AbortSignal.timeout`, `setTimeout`, `node:crypto`, `NetworkError`). Per plan `## Dependencies` + `parsimony-ladder.md` rung 2.
- Auditor coverage: `pnpm audit --prod`: ran · `osv-scanner`: ran (lockfile).
- Production vulnerabilities in the packages M0 touches (`@theokit/sdk`, `@theokit/acp`): **0 critical, 0 high, 0 medium** affecting `croner`/`jsonrepair` (sdk) or acp (no prod deps).

## Plan validation (Mode 2)

| Plan dep | Section | New? | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|---|
| `AbortSignal.timeout` (Node stdlib) | Dependencies | No | n/a (runtime built-in, Node ≥22.12) | yes | n/a | OK |
| `setTimeout`/`Promise.race` (stdlib) | Dependencies | No | n/a | yes | n/a | OK |
| `node:crypto` `createHash` | Dependencies | No (already used) | present | yes | n/a | OK |
| `NetworkError` (`packages/sdk/src/errors.ts`) | Dependencies | No (in-repo) | present | yes | n/a | OK |

**No NEW dependency is introduced by this plan → no plan-introduced CVE surface. Plan-bound gate = PASS.**

## Pre-existing repo findings (honest disclosure — OUT of M0 scope, do NOT block M0)

`osv-scanner` on the full `pnpm-lock.yaml` (which includes `examples/**` and dev tooling) reports vulnerabilities that are **not** in the production dependency graph of `@theokit/sdk` or `@theokit/acp` (the only packages M0 edits):

| Package | Severity | Where | In M0 scope? |
|---|---|---|---|
| `esbuild` (>=0.27.3 <0.28.1) | LOW | `examples/deepagents-parity-demo > tsx@4.22.0 > esbuild` (dev/example) | No |
| `axios` (multiple GHSA) | HIGH/MODERATE | transitive under examples/dev tooling; NOT in `@theokit/sdk` (`croner`, `jsonrepair`) or `@theokit/acp` (none) prod deps | No |
| `@opentelemetry/core` | MODERATE | transitive dev/example | No |

These are pre-existing tech debt in example/dev transitive deps. They are **not touched, introduced, or worsened by M0** (which adds zero deps and edits only source under `packages/sdk/src` + `packages/acp/src`). Recommendation: track them in a separate `deps-hardening` plan (e.g. bump `esbuild ≥0.28.1`, prune/upgrade `axios` in examples) — NOT a blocker for the M0 security floor.

## Recommended next steps

1. Proceed to `/plan-confidence` — the plan-bound deps gate is PASS (no new deps, no prod CVE in touched packages).
2. File a follow-up `deps-hardening` plan for the pre-existing `axios`/`esbuild` example/dev advisories (out of M0 scope).
