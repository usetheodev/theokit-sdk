---
scenario: m7-runtime-harness-cloud
date: 2026-07-03
operator: paulohenriquevn
outcome: pass
summary: cloud path contract validated (46 cloud tests green, contract-only) + cloud-only features labeled pre-release in docs.md + no GA claim
---

# M7 — Runtime ↔ Harness (cloud path, pre-release) evidence

## DoD #1 — cloudPayload contract validated (contract-only, PaaS pre-release)
The cloud path is implemented + tested. 46 tests across 8 cloud test files GREEN
(contract + golden), validating: cloudPayload shape/determinism (canonical JSON,
EC-1), 1 MB guardrail (EC-7), secret filtering (EC-2 — apiKey/MCP-env/provider-creds
never cross the wire), the CREATE `POST /v1/agents` body (full cloud options incl.
envVars over TLS) + RUN `POST /v1/agents/{id}/runs` redacted payload, bc- id
auto-detection, and the pre-release guards (listArtifacts/downloadArtifact →
`cloud_runtime_pre_release`; runUntil/fork/runToCompletion/streamToCompletion/
usePersonality → UnsupportedRunOperationError). Validated against a local HTTP stub,
NOT a live Theo PaaS (pre-release) — the DoD's "documented as contract-only if PaaS
not ready" path. Also fixed a pre-existing teardown race in the contract test.

## DoD #2 — cloud-only features labeled pre-release in docs.md + README
- README: `## Cloud runtime — pre-release` banner (pre-existing). ✓
- docs.md: added an explicit cloud pre-release banner in the Overview + inline
  "cloud-only, pre-release" labels on `cloud.envVars`, `cloud.autoCreatePR`,
  `result.git` (artifacts were already labeled at docs.md:3201).

## DoD #3 — no GA claim
`public-copy-lint` clean on docs.md + README (0 banned framings). No unqualified
"generally available" / "production-ready" cloud claim; README frames cloud as "the
contract for when PaaS reaches general availability" (honest).

## Note (pre-existing, non-M7 — filed separately)
Running the whole `tests/contract/` dir surfaced pre-existing NON-cloud failures
(e.g., `skills.contract.test.ts` "reload rejects malformed frontmatter" resolves
instead of rejecting) — outside M7 scope; filed for follow-up.
