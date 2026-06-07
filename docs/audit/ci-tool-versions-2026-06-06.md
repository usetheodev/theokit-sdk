# CI Tool Versions — pinned for plan `arch-review-fixes-2026-06-06`

Date: 2026-06-07
Plan: `.claude/knowledge-base/plans/arch-review-fixes-2026-06-06-plan.md`
Task: T0.4 — Pin madge + @ls-lint/ls-lint exact versions in workspace devDeps

## Pinned versions

| Package | Version | Range | Ecosystem | Type |
|---|---|---|---|---|
| `madge` | `8.0.0` | EXACT (no `^`) | npm | devDep (workspace root) |
| `@ls-lint/ls-lint` | `2.3.1` | EXACT (no `^`) | npm | devDep (workspace root) |

## Rationale for pin

### Exact-version pin (no semver range)

The two devDeps added by this plan are **CI-gate dependencies** — their output directly drives `pnpm -w run validate` exit code. Minor version drift in either tool can introduce silent behavior changes (different cycle detection algorithms, different filename rules) that would either:

- **Break CI unexpectedly** (a patch release tightens a rule, fails a previously-passing repo).
- **Silently weaken the gate** (a patch release loosens a rule, a real regression slips through).

Per `rules/deps-audit-golden-rule.md` and Inquebrável Rule 1 (95% confidence), CI-gate dependencies are pinned exactly. The standard `^x.y.z` semver range is reserved for transitive libraries whose minor releases are part of normal evolution.

### Package selection — verify correct npm package name

#### `madge@8.0.0`
- **Latest at audit time:** 8.0.0 (published 2024-08-05)
- **License:** MIT
- **Transitive deps:** 12 (chalk, commander, commondir, debug, dependency-tree, ora, pluralize, pretty-ms, rc, stream-to-array, ts-graphviz, walkdir)
- **CVEs (npm audit):** 0 at any severity
- **Selection rationale:** industry-standard TS dependency graph + circular-cycle detection, ~15k GitHub stars, active maintenance, zero runtime deps from the plugin we ship to consumers. Detected the 13 actual cycles that the project's `.dependency-cruiser.cjs` currently misses (see audit `final_report.md` § Cycle report).
- **Alternatives evaluated:** `skott` (faster but newer/less battle-tested), `dpdm` (similar surface but smaller community), `dependency-cruiser` (already in repo and is the secondary gate — paired complementarily per ADR D434).

#### `@ls-lint/ls-lint@2.3.1`
- **Latest at audit time:** 2.3.1
- **License:** MIT
- **Transitive deps:** none (Go binary distributed via npm)
- **CVEs (npm audit):** 0
- **Selection rationale:** industry-standard filename + folder naming linter. Zero runtime deps (Go binary embedded). Single-purpose tool aligned with the plan's kebab-case enforcement (T7.1).
- **CRITICAL package-name discipline:** the correct package is `@ls-lint/ls-lint` (scoped). The bare `ls-lint` package on npm is an **unrelated legacy livescript-based tool from a different ecosystem** and MUST NOT be installed. The 2026-06-06 deps-audit (`.claude/knowledge-base/audits/arch-review-fixes-2026-06-06-deps-audit-2026-06-06.md`) confirmed the package name during validation.
- **Alternatives evaluated:** custom regex script (rejected per Inquebrável Rule 9 — don't reinvent), eslint plugin (rejected — Biome, not eslint, is the project lint stack).

## Re-validation cadence

Periodic re-audit recommended weekly via `/loop 7d /deps-audit arch-review-fixes-2026-06-06`. Per `rules/cycle-plan.md` § Periodic schedule.

When promoting either tool past its current major (e.g., `madge` 8.x → 9.x), require:
1. `/deps-audit` PASS verdict (no CVE; no breaking-version change unexplained).
2. Manual smoke against the project's actual cycle inventory.
3. Update this document with the new exact version.

## Source of truth

- Plan v1.1.1: `.claude/knowledge-base/plans/arch-review-fixes-2026-06-06-plan.md` § Dependencies
- Deps-audit: `.claude/knowledge-base/audits/arch-review-fixes-2026-06-06-deps-audit-2026-06-06.md` (PASS — 0 CVE)
- ADR D434: documented in plan (depcruise + madge dual-gate decision)
