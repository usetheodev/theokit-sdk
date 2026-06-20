# Deps Audit: m2-compaction-public-api

**Date:** 2026-06-20
**Mode:** plan-bound:m2-compaction-public-api
**Verdict:** PASS
**Hard caps triggered:** [] (plan declares zero new deps; no plan-declared dep is affected by any CVE)

## Summary
- Plan-declared deps: 0 new + 0 registry-existing (only reuses in-repo internal `selectCompressionWindow`/`CompressibleMessage`/`TheokitAgentError`).
- The plan's `## Dependencies` section is present + complete (Existing/New/Removed tables populated; NEW table carries a non-empty Rule 9 rationale rejecting a tokenizer dep). No INVALID_PLAN_DEPS.
- A tokenizer dep (`tiktoken`/`gpt-tokenizer`) was evaluated + rejected: adk-js + crewAI both prove chars/4 + provider counts suffice; M2-1 uses message-count keep-recent (no precise token count needed).

## Out-of-scope: pre-existing workspace CVE debt
Per the m1-sdkmessage-readers audit (2026-06-20), the workspace carries pre-existing HIGH CVEs in dev/transitive deps (axios/form-data/hono/undici/uuid/vite) — none declared or touched by M2-1. Out of scope for this plan-bound audit; warrants a separate workspace remediation cycle.

## Verdict
PASS — zero new deps; proceed to `/plan-confidence`.
