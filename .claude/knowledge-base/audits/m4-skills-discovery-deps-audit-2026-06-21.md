# Deps Audit: m4-skills-discovery

**Date:** 2026-06-21
**Mode:** plan-bound:m4-skills-discovery
**Verdict:** PASS
**Hard caps triggered:** (none)

## Summary
- Ecosystems detected: npm (pnpm workspace)
- Plan declared deps: 0 NEW; existing-only (`node:fs`/`node:path` builtins + `@theokit/sdk/path-safety` + in-repo `@internal` skills parser)
- Vulnerabilities in PLAN-declared deps: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW
- Auditor coverage: { pnpm-audit: ran, osv-scanner: available }

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `node:fs/promises`, `node:path` | Existing | builtin | yes (no registry surface) | n/a | OK |
| `safePathJoin`/`assertNoSymlinkEscape` (`@theokit/sdk/path-safety`) | Existing | yes (workspace, M0-4) | yes | n/a | OK |
| `parseSkillFrontmatter`/`parseSimpleYaml` (in-repo `@internal`) | Existing | yes (same package) | yes | n/a | OK |
| (NEW deps) | New | — | — | — | none declared |

M4-1 introduces **zero** new dependencies and makes **zero** manifest changes. The plan's declared dependency surface (node builtins + already-shipped workspace primitives) has no registry CVE exposure. → **PASS**.

## Out-of-scope findings (workspace-wide, pre-existing, NOT introduced or touched by M4-1)

Honest disclosure (golden-rule anti-pattern #3 — never silently ignore). `pnpm audit` over the FULL workspace reports 47 advisories (17 high / 25 moderate / 5 low) in transitive deps of OTHER packages — none in `@theokit/sdk`'s production tree and none in M4-1's surface:

- `undici` (high) — via `packages/memory-mem0 > mem0ai@3.0.3 > @qdrant/js-client-rest@1.13.0` (example/integration package).
- `axios`, `form-data`, `protobufjs`, `markdown-it`, `js-yaml`, `uuid`, `@opentelemetry/core`, `hono` — transitive via `mem0ai` and other non-sdk packages.
- `esbuild`, `vite` — dev-tooling transitive (build/test), not shipped.

These are **pre-existing** and **out of scope** for M4-1 (different packages, mostly the `memory-mem0` example integration + dev tooling). They do NOT cap this plan because the golden rule scopes the verdict to the plan's declared dependencies. Recommend a separate workspace-wide remediation pass (e.g. `/deps-audit` standalone targeting `memory-mem0`) — tracked outside this milestone.

## Recommended next steps

1. No manifest changes needed for M4-1 — proceed to `/plan-confidence`.
2. (Separate) Open a workspace-wide deps remediation for the `mem0ai`/`undici` chain in `packages/memory-mem0`.
