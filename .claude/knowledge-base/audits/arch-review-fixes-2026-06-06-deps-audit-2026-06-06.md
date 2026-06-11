# Deps Audit — arch-review-fixes-2026-06-06

Date: 2026-06-06
Mode: Plan-bound (Mode 2)
Plan: `.claude/knowledge-base/plans/arch-review-fixes-2026-06-06-plan.md` v1.1
Auditor: orchestrator (npm audit + npm view + manual cross-check)
Audit timestamp: 2026-06-06T15:00:00Z

## Verdict: **PASS** (score 100)

Per `.claude/rules/deps-audit-golden-rule.md § 1`:
- 0 CVE at any severity (CRITICAL / HIGH / MEDIUM / LOW)
- 0 outdated package
- Plan `## Dependencies` section present and complete
- `.claude/rules/deps-audit-allowlist.txt` parsed successfully (allowlist not exercised — no CVE to downgrade)

No advisory action required. Plan v1.1 may advance to `/plan-confidence`.

## Plan declarations cross-checked

| Package (declared in plan) | Target version | Ecosystem | Type |
|---|---|---|---|
| `madge` | `8.0.0` exact (pinned via T0.4) | npm | devDep (workspace root) |
| `@ls-lint/ls-lint` | `2.3.1` exact (pinned via T0.4) | npm | devDep (workspace root) |

## Auditor results

### npm — `madge@8.0.0`

| Field | Value |
|---|---|
| Latest version | 8.0.0 (published 2024-08-05) |
| License | MIT |
| Runtime deps (12) | chalk, commander, commondir, debug, dependency-tree, ora, pluralize, pretty-ms, rc, stream-to-array, ts-graphviz, walkdir |
| npm audit | **0 vulnerabilities** at any severity |
| npm outdated | NONE — at latest |
| osv-scanner | not run (binary absent on host); npm audit covers same OSV + GHSA database |

### npm — `@ls-lint/ls-lint@2.3.1`

| Field | Value |
|---|---|
| Latest version | 2.3.1 |
| License | MIT |
| Runtime deps | **none** (Go binary distributed via npm) |
| npm audit | **0 vulnerabilities** |
| npm outdated | NONE — at latest |
| Note | Plan v1.0 originally specified `ls-lint` (bare). Correct package name confirmed during audit: `@ls-lint/ls-lint`. The bare `ls-lint@0.1.2` is an unrelated legacy livescript-based package and MUST NOT be installed. Plan v1.1 corrected. |

## Methodology

1. Detected ecosystems via repo manifests: `pnpm-workspace.yaml`, `package.json` root + 22 publishable packages — TypeScript / pnpm only.
2. Skipped `node_modules/`, `dist/`, `target/`, `referencia/`, `docs/evalscope/`, `.claude.previous.bak/`, `dist-runtime/`.
3. Created `/tmp/deps-audit-temp/` with the 2 new devDeps at the exact versions declared in the plan; ran `npm install --omit=optional --silent`, `npm audit --json`, `npm outdated --json`. Parsed each.
4. Cross-checked package names + transitive dep counts via `npm view <pkg> --json`.
5. No osv-scanner cross-check (binary absent on host). Per skill `Step 2`, this is recorded as a tool gap, NOT fabricated clean output. npm audit uses GitHub Advisory + OSV data; sufficient for npm-only audit.

## Plan section validation

`## Dependencies` section in plan v1.1 (line 56):
- [x] Section present
- [x] All declared deps have target version pinned exactly (no semver range; both `8.0.0` and `2.3.1` exact)
- [x] Rule 9 justification column present for both deps
- [x] Type (devDep vs runtime) declared
- [x] Alternatives evaluated documented inline

Per `deps-audit-golden-rule.md § 3` hard cap #4 (Plan-bound mode), no `INVALID_PLAN_DEPS` flag fires.

## Allowlist check

`.claude/rules/deps-audit-allowlist.txt` parsed without error. Zero entries exercised this run (no CVE found). No sunset hygiene issues.

## Tool runs

| Tool | Exit | Note |
|---|---|---|
| `npm install` | 0 | Both deps + transitive resolved cleanly |
| `npm audit --json` | 0 | 0 vulnerabilities |
| `npm outdated --json` | 0 | (empty output → all at latest) |
| `npm view madge --json` | 0 | metadata captured |
| `npm view @ls-lint/ls-lint --json` | 0 | metadata captured |
| `osv-scanner` | 127 (absent on host) | Recorded gap. npm audit GitHub Advisory + OSV data covers same database |

## Findings

None. No CVE. No outdated. No malformed entry. No allowlist drift.

## Recommendations (informational only)

1. **Pin lockfile reproducibility (T0.4 already covers):** plan correctly pins both deps to exact versions in `package.json`. The `pnpm-lock.yaml` will record exact transitive versions including `madge`'s 12 transitive deps. Periodic re-audit (`/loop 7d /deps-audit`) recommended per `cycle-plan.md` § Periodic schedule.

2. **CHANGELOG annotation:** when T0.1 / T0.4 land, the workspace root CHANGELOG should note "Added devDeps: madge@8.0.0 + @ls-lint/ls-lint@2.3.1 — see plan arch-review-fixes-2026-06-06 § Dependencies for Rule 9 justification."

## Next step

`/plan-confidence arch-review-fixes-2026-06-06` — score structural quality of plan v1.1.
