# Deps Audit: m1-continuation-history

**Date:** 2026-06-20
**Mode:** plan-bound:m1-continuation-history
**Verdict:** PASS
**Hard caps triggered:** [] (none)

## Summary
- Ecosystems detected: npm (pnpm workspace)
- New deps introduced by this plan: 0
- Plan `## Dependencies` section: present (Existing reuse-only; New: none; Removed: none)
- Auditor coverage: { pnpm-audit: ran, osv-scanner: available }

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `truncateWithMarker` (internal) | Existing | yes (in-repo `context-loaders.ts:52`) | n/a (no external version) | n/a | OK |
| `StoredMessage`/`SDKMessage` (internal types) | Existing | yes (in-repo `types/`) | n/a | n/a | OK |
| (new deps) | New | — | — | yes — tokenizer dep evaluated + rejected (D5) | OK (none) |

## Pre-existing workspace CVEs (NOT plan deps — out of scope)

`pnpm audit` reports 18 high / 27 moderate / 6 low transitive findings across the workspace, e.g.:

- `undici <6.27.0` (HIGH, GHSA-vxpw-j846-p89q) via `packages/memory-mem0 > mem0ai@3.0.3 > @qdrant/js-client-rest@1.13.0 > undici@5.28.5`.

These belong to OTHER workspace packages (notably `memory-mem0`), are NOT declared or introduced by M1-3, and do not touch `@theokit/sdk`. Per `deps-audit-golden-rule.md § Hard caps`, caps apply to CVEs in DECLARED plan deps only. M1-3 declares none → no cap fires for this plan. Remediation of the workspace transitive CVEs is a separate task (recommend a dedicated `/to-plan workspace-deps-cve-remediation`).

## Recommended next steps

1. No manifest changes required for M1-3 (zero new deps).
2. Proceed with `/plan-confidence m1-continuation-history`.
3. (Separate) open a workspace-wide deps-remediation task for the pre-existing transitive HIGH CVEs.
