# Deps Audit: m3-repo-map

**Date:** 2026-06-20 · **Mode:** plan-bound · **Verdict:** PASS · **Hard caps:** []

- ZERO new dependencies — node:fs + node:path builtins only. `## Dependencies` section present + complete; NEW table Rule-9 rationale rejects `ignore`/`globby` (a bounded best-effort tree needs only `readdirSync` + a hardcoded ignore set, not a `.gitignore` engine; avoids a transitive dep). No INVALID_PLAN_DEPS.
- Out-of-scope: pre-existing workspace CVEs (sibling pkgs) — none declared/touched by M3-3.

## Verdict
PASS — zero new deps; proceed to /plan-confidence.
