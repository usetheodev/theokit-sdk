# Review — M6 Eval Harness (Tema E)

**Date:** 2026-06-22
**Slug:** m6-eval-harness
**Milestone:** M6
**Verdict:** READY_TO_MERGE
**Diff reviewed:** `7b09e00..HEAD` (packages/sdk/src + tests + docs.md)
**Specialist agents:** architecture, test-audit, wiring, cross-validation, api-design, security (6) + re-review (security, api+docs, cross-val/wiring)

## Verdict rationale

cycle-review gate: READY_TO_MERGE requires no BLOCKER and ≤ 2 HIGH with documented mitigation.
After remediation + one re-review pass: **0 BLOCKER, 0 HIGH, 0 MEDIUM** open. All re-review sub-verdicts READY.

## Round 1 findings → resolution

| # | Sev | Finding | Resolution | Commit |
|---|---|---|---|---|
| 1 | BLOCKER | docs.md (source of truth) not updated for the M6 public surface | Added "Code-eval harness (M6)" section + `verifyGate` row to the Scorers table; signatures cross-checked | `e34dbd3` |
| 2 | HIGH | `Scorers.verifyGate` default `tests.join(" ")` ran untrusted dataset test-names through `/bin/sh` (RCE on LocalSandbox) | `command` is now REQUIRED; no bare-identifier default; caller's builder owns shell-safety | `e34dbd3` |
| 3 | HIGH | "CHANGELOG not updated" | **False positive** — repo uses Changesets (locked toolchain); `.changeset/m6-eval-harness.md` covers all M6 surfaces. CHANGELOG.md is changeset-generated (no `[Unreleased]` by design) | n/a |
| 4 | MEDIUM | git clone/checkout flag-injection + `ext::` transport via repoUrl/ref | `--` option terminator + `-c protocol.ext.allow=never` on clone; `ref` rejected if starts with `-` (PoC-confirmed `ext::` blocked) | `e34dbd3` |
| 5 | MEDIUM | persist `key` probe-row footgun (type promised full row, only durable fields populated) | `key` typed `Pick<EvalRowResult, "index"\|"input"\|"expected"\|"metadata">` — type tells the truth | `e34dbd3` |
| 6 | MEDIUM | verifyGate default footgun | folded into #2 (command required) | `e34dbd3` |
| 7 | MEDIUM | backend portability vs D2 (commands use shell metachars; `validateCommand` would reject) | Documented shell-backend assumption on `verifyGate`; latent (only LocalSandbox ships) | `e34dbd3` |
| 8 | LOW | `instanceId` path traversal | Validated `^[A-Za-z0-9][A-Za-z0-9._-]*$` (rejects `.`/`..`/`-`/`/`) | `e34dbd3`,`f70d9ef` |
| 9 | LOW | command callback mutable `string[]` | `(tests: readonly string[]) => string` | `e34dbd3` |
| 10 | LOW | shellEscape DRY (base private dup) | Base `SandboxBackend.shellEscape` delegates to shared `shellEscapePosix` | `e34dbd3` |
| 11 | LOW | no concurrency interleave-safety test (plan Drawbacks committed it) | Added concurrency-8 interleave test | `e34dbd3` |
| 12 | LOW | no security regression tests for the fixes | Added: traversal-id rejected, `-`-ref rejected, `ext::` blocked | `f70d9ef` |
| 13 | LOW | docs/type overstated captureArtifact "populates" artifact | Softened wording (produced by; caller attaches) | `f70d9ef` |

Remaining items are INFO and pre-existing/out-of-scope (e.g., docs.md `@theokit/sdk` vs `@theokit/sdk/eval` import line predates M6; CLAUDE.md Rule-6 wording vs Changesets) — tracked for a separate doc-sync PR.

## Quality gates (final state)

- **Full suite:** 2860 passed | 0 failed | 35 skipped.
- **M6 tests:** loadJsonl/append/readJsonlIds, persist (flush/resume/retry/classify/no-persist/interleave), provision (clone/bad-ref/bad-repo + 3 security regressions), code-runner (edit/clean), verify-gate (0/nonzero/empty), integration (full chain 0→1 + persist↔loadJsonl roundtrip).
- **Build:** tsup success (eval + sandbox subpaths, ESM+CJS+dts).
- **Typecheck:** clean. **Biome:** clean (cognitive complexity ≤ 10).
- **code-quality:** PASS (score_cap 100, no hard caps).
- **No mocks of git/fs** — real temp git + real LocalSandbox throughout (no-stubs-no-mocks-no-wired honored).
- **ADRs D1/D2/D3** honored; zero new runtime dependencies.

## Strengths (positive findings)

- Composable, additive public API — no breaking change; clean DIP (eval → sandbox abstraction).
- Genuine end-to-end integration (real git bug → fix → graded 0→1), not a mock.
- Security hardening is defense-in-depth and regression-tested.

**READY_TO_MERGE.**
