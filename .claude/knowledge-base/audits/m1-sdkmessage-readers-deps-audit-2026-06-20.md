# Deps Audit: m1-sdkmessage-readers

**Date:** 2026-06-20
**Mode:** plan-bound:m1-sdkmessage-readers
**Verdict:** PASS
**Hard caps triggered:** [] (none — plan declares zero new deps; no plan-declared dep is affected by any CVE)

## Summary

- Ecosystems detected: npm (pnpm workspace)
- Plan-declared deps audited: 0 new + 0 registry-existing (the only "existing" entry is in-repo SDK types `SDKMessage`/`ToolUseBlock`/`CostBreakdown` — not a registry package, nothing to CVE-check)
- Auditor coverage: { osv-scanner: ran (pnpm-lock.yaml), npm: present, pip-audit: present (n/a — no Python) }
- Workspace-wide vuln entries (whole monorepo lockfile, ALL packages): 49 → 19 HIGH, 24 MEDIUM, 6 LOW — **pre-existing, out of scope for this plan** (see § Out-of-scope)

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| (internal) `SDKMessage`/`ToolUseBlock`/`CostBreakdown` types | Existing | yes (in-repo `src/types/`) | n/a (not a registry dep) | n/a | OK |
| (none) | New | n/a | n/a | yes — provider-types dep (`@google/genai`-style) evaluated + rejected; SDK owns its types | OK |
| (none) | Removed | n/a | n/a | n/a | OK |

The plan's `## Dependencies` section is present and complete (Existing / New / Removed tables all populated; the NEW table carries a non-empty Rule 9 rationale with a rejected alternative). No `INVALID_PLAN_DEPS` condition. **M1-5 introduces ZERO new dependencies** — pure readers over the SDK's own leaf types (Rule 9 / KISS).

## Out-of-scope: pre-existing workspace CVE debt (NOT introduced by M1-5)

osv-scanner reports 19 HIGH / 24 MEDIUM / 6 LOW across the **entire** monorepo lockfile. The HIGH-severity packages are: `axios`, `form-data`, `hono`, `undici`, `uuid`, `vite` — all dev tooling / transitive deps of OTHER workspace packages, none added or touched by this plan. Because the deps-audit hard cap fires only on a CVE affecting a **plan-declared** dep, and this plan declares none of these, no hard cap is triggered for M1-5.

These findings are honestly surfaced (anti-pattern #5: never claim "no vulnerabilities" when debt exists) but are **out of scope** for this plan-bound audit. They warrant a SEPARATE standalone `/deps-audit` + targeted remediation cycle on the workspace — they must not gate M1-5, which is purely additive over in-repo types.

## Recommended next steps

1. No manifest changes required for M1-5 (zero new deps).
2. (Separate track) Open a standalone workspace deps-remediation cycle for the 19 pre-existing HIGH CVEs (`axios`/`form-data`/`hono`/`undici`/`uuid`/`vite`).
3. Proceed with `/plan-confidence m1-sdkmessage-readers`.
