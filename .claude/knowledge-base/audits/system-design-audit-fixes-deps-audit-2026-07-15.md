# Deps Audit: system-design-audit-fixes (SE43)

**Date:** 2026-07-15
**Mode:** plan-bound:system-design-audit-fixes
**Verdict:** PASS
**Hard caps triggered:** [] (none)

## Summary
- Ecosystems detected: npm (pnpm workspace)
- Plan-declared third-party deps: **0** (the plan tightens an existing `@theokit/sdk` peer floor and adds internal `workspace:*` devDeps only)
- Vulnerabilities introduced BY THIS PLAN: **0**
- Auditor coverage: { pnpm audit: endpoint retired (410 — npm bulk-advisory migration), osv-scanner: ran (authoritative here) }
- Pre-existing monorepo transitive findings (NOT introduced by SE43): 48 (16 HIGH, 26 MODERATE, 6 LOW) across axios / @opentelemetry/core / esbuild / form-data / hono / js-yaml / markdown-it / protobufjs / undici / uuid / vite

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `@theokit/sdk` `>=4.0.0` | peer (tightened floor) | yes — floor edit only | n/a (workspace pkg) | n/a (not new) | OK |
| `@theokit/sdk` / `-handoff` / `-memory` `workspace:*` | devDeps of NEW private test-only pkg | to-add (internal) | n/a (workspace pkgs) | reuse existing (rung 4) | OK |

The plan's `## Dependencies` section is present and complete; every declared entry is an existing workspace package. No third-party registry dependency enters the tree. `plan_dependencies_section_missing` / `plan_dep_version_unspecified` / `plan_new_dep_no_rule9_evaluation` do NOT fire.

## Pre-existing findings (OUT OF SE43 SCOPE — surfaced for honesty, per anti-pattern 3)

osv-scanner flagged 16 HIGH transitive advisories in the workspace lockfile: `axios@1.13.6`, `form-data@4.0.5`, `hono@4.12.23`, `undici@5.28.5`, `vite@7.3.3`. Characterization:

- **None is a direct production dependency of the published `@theokit/sdk`.** `@opentelemetry/*` is a sdk **devDependency** (`^1.9.1` / `^1.30.1`); `vite`/`hono`/`esbuild` are build/example tooling; the rest are transitive.
- **SE43 introduces none of these packages** — the plan adds zero third-party deps. These advisories pre-date SE43 and are unaffected by it.
- **Recommendation (separate track):** run a standalone `/deps-audit` + open a dedicated remediation milestone (e.g. bump axios/undici/form-data/vite/hono to patched versions). This is dev/example/transitive surface, not the shipped sdk runtime — lower urgency, but real. Filed as an ecosystem observation to the user.

## Recommended next steps
1. Proceed to `/plan-confidence` — the plan-bound verdict is PASS (SE43 introduces no dependency risk).
2. Track the pre-existing 16 HIGH transitive CVEs in a separate remediation milestone (out of SE43 scope; documented here, not silently ignored).
