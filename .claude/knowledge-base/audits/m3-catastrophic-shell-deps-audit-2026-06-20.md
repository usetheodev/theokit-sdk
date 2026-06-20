# Deps Audit: m3-catastrophic-shell

**Date:** 2026-06-20 · **Mode:** plan-bound · **Verdict:** PASS · **Hard caps:** []

- ZERO new dependencies — in-house segment tokenizer (no shell-parser lib) + `ConfigurationError` (existing peer). `## Dependencies` section present + complete; NEW table Rule-9 rationale rejects `shell-quote` (a guardrail needs only top-level splitting + command-position matching, not a full grammar; avoids a transitive dep on a security path). No INVALID_PLAN_DEPS.
- Out-of-scope: pre-existing workspace HIGH CVEs (sibling pkgs) — none declared/touched by M3-2.

## Verdict
PASS — zero new deps; proceed to /plan-confidence.
