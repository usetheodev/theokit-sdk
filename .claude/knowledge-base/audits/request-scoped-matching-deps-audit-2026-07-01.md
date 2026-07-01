# Deps Audit: request-scoped-matching

**Date:** 2026-07-01
**Mode:** plan-bound:request-scoped-matching
**Verdict:** PASS
**Hard caps triggered:** [] (none)

## Summary
- Ecosystems detected: npm
- Total deps audited: 0 new (the plan's `## Dependencies § New` is `(none)`)
- Vulnerabilities found in the plan's dependency surface: 0
- Auditor coverage: `osv-scanner --lockfile=pnpm-lock.yaml` ran (full monorepo lockfile)

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| (none new) | New | n/a — nothing to add | n/a | yes (explicit) | OK |

The plan's `## Dependencies` section declares **no new dependency** with an explicit Rule-9 rationale: the request-scoped gate is exact `Set.has(name)` over the platform `Set<string>` — a spec-adjacent one-liner the runtime provides; the reference openclaw `@openclaw/tool-call-repair` ships the same gate with `dependencies: {}` (blueprint Corner 2). It reuses the already-present `sanitizeToolInput` (`hermes-tool-extract.ts:34`) unchanged. No existing dependency version is changed; no manifest (`package.json`) is touched. Nothing new to audit.

## Pre-existing repo advisories (standing concern — OUT of R5 scope)

For honesty (Unbreakable Rule 3): a full-lockfile `osv-scanner` scan reports 49 advisories across the whole monorepo's dev + transitive dependency tree. These are **pre-existing** and **not introduced, touched, or version-changed by R5** (which modifies only two `.ts` source files and their tests, and adds zero dependencies). They belong to a repo-wide dependency-hygiene follow-up, not to this plan — R5 does not gate on them and cannot resolve them without a manifest change it does not make.

## Verdict

**PASS** — zero new dependency surface; no manifest change. The 49 pre-existing lockfile advisories are a standing repo concern outside R5's scope. Proceed to `/plan-confidence`.
