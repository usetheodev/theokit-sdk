# Deps Audit: m4-tool-scoping

**Date:** 2026-06-21
**Mode:** plan-bound:m4-tool-scoping
**Verdict:** PASS
**Hard caps triggered:** (none)

## Summary
- Ecosystems detected: npm (pnpm workspace)
- Plan declared deps: 0 NEW. The change composes the existing in-repo `withToolWhitelist`/`checkToolWhitelist` enforcement + a frontmatter string split (no imports beyond the package's own internals + `AgentDefinition` type). Explicitly NOT adding/using `PermissionEngine` (ADR D2).
- Vulnerabilities in PLAN-declared deps: 0 CRITICAL/HIGH/MEDIUM/LOW
- Auditor coverage: { pnpm-audit: ran, osv-scanner: available }

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `withToolWhitelist`/`checkToolWhitelist` (in-repo `@internal`) | Existing | yes (same package) | yes | n/a | OK |
| `parseSimpleYaml`/loader helpers (in-repo `@internal`) | Existing | yes | yes | n/a | OK |
| (NEW deps) | New | — | — | — | none declared |

M4-6 introduces **zero** new dependencies and **zero** manifest changes. → **PASS**.

## Out-of-scope findings

Same workspace-wide pre-existing advisories noted in prior M4 audits (undici/axios/esbuild/vite via `memory-mem0` + dev-tooling). None in `@theokit/sdk`'s production tree; out of scope.

## Recommended next steps
1. No manifest changes for M4-6 — proceed to `/plan-confidence`.
