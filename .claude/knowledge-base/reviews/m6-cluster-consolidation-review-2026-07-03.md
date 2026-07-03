# Review: m6-cluster-consolidation

**Date:** 2026-07-03
**Reviewers:** focused single-pass (alignment + release + honesty) — proportionate to a pin-bump/consolidation milestone.
**Findings:** 0 BLOCKER · 0 HIGH · 1 MEDIUM · 1 LOW — resolved/documented
**Verdict:** READY_TO_MERGE

## Scope
M6 Harness cluster consolidation: theokit-gateways (11 pkgs) + theokit-plugins (11 pkgs) aligned to @theokit/sdk 2.18.0, coordinated npm release, plugins ROADMAP reconciled. DISCOVER blueprint: m6-cluster-consolidation.

## Findings & resolutions
### MEDIUM
- **M1 — SDK npm-publish gap (was the top blocker).** @theokit/sdk 2.16/2.17/2.18 were tagged+GitHub-released but never npm-published (npm latest=2.15.2), so the clusters could not pin a published 2.18.0. → **Resolved**: operator authorized (NPM_TOKEN); @theokit/sdk@2.18.0 published to npm; clusters then aligned + released against it. The SDK's `release.yml` CI publish step should be repaired so future releases npm-publish automatically (follow-up, ecosystem infra).

### LOW
- **L1 — provenance-gated local publish.** 9 plugin packages declare `publishConfig.provenance: true` (CI/OIDC). Stripped in-memory for the local operator-authorized publish (NOT committed; git keeps provenance for the CI path). Those published versions lack provenance attestation until the next CI release. Documented in the evidence file; not a functional issue.

### INFO — verified OK
- Consumed SDK surface (`Security.redact`, `server/auth` types, `subscribe`) is stable across 1.x→2.x — alignment is a pin bump, validated by 1204 green tests (543 gateways + 661 plugins).
- Dead-surface fix (phantom `@theokit/plugin-rate-limit`) confirmed safe: plugin-copilot 92 tests pass after removal (type-only opt-in).
- Orphan `initial-cors-release` changeset (for the never-created cors plugin) removed — consistent with the stale-ROADMAP cleanup.

## DoD status
- **#1** clusters build + test vs M0-M3 Harness, no dead surfaces → **MET** (1204 tests, phantom dep removed).
- **#2** coordinated Changesets release across sdk + gateways + plugins → **MET** (SDK 2.18.0 + 11 gateways + 10 plugins published to npm).
- **#3** plugins ROADMAP reconciled with the ecosystem one → **MET** (ROADMAP + README rewritten, subsumed under ecosystem M6).

## Handoff decision
**READY_TO_MERGE** — all three DoDs met with npm-publish evidence + 1204 green tests. Cluster commits pushed (gateways 7ef62a8, plugins 32e2ddd). Follow-up (ecosystem infra, not M6 code): repair the SDK release.yml CI npm-publish + provenance so future releases publish automatically with attestation.
