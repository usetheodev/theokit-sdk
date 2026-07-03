---
"@theokit/sdk": patch
---

Strengthen the README cross-pillar front door (M8 GA-readiness): the "Where this
fits" section now explains the 4-pillar OPEN-STACK composition (UI · Harness ·
Skills · Runtime), how they compose end-to-end (local agent + tools/plugins +
`useAgentStream` render, zero Theo-backend dependency), the honest per-pillar status
(Runtime/cloud pre-release), and the validated cross-pillar wiring (Skills↔Harness +
UI↔Harness green vs SDK 2.18.0; Runtime↔Harness contract-only). Also fixes a stale
reference to the removed `referencia/` directory (study peers are cloned on demand
under `.claude/knowledge-base/reference/`). Docs-only; no API/behavior change; no GA
claim.
