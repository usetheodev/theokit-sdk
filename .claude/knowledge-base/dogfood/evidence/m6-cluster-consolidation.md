---
scenario: m6-cluster-consolidation
date: 2026-07-03
operator: paulohenriquevn
outcome: pass
summary: gateways (11) + plugins (11) aligned to @theokit/sdk 2.18.0, 1204 tests green, coordinated npm release (SDK + 11 gateways + 10 plugins)
---

# M6 — Harness cluster consolidation evidence

## DoD #1 — build against M0-M3 Harness, no dead/unwired surfaces

Both clusters pin-bumped to `@theokit/sdk@2.18.0` (pulled from npm) + validated:

| Cluster | Packages | typecheck | build | tests |
|---|---|---|---|---|
| theokit-gateways | 11 | 11/11 Done | 11/11 Done | 543 passed, 0 failed |
| theokit-plugins | 11 | 11/11 clean | 11/11 Done | 661 passed, 1 skipped, 0 failed |

**Total: 1204 tests green against 2.18.0.** Dead-surface fix: removed the phantom
`@theokit/plugin-rate-limit` peer dep from `plugin-copilot` (no such package;
type-only opt-in) — `no-stubs-no-mocks-no-wired` clean. Consumed surface
(`Security.redact`; `@theokit/sdk/server/auth` AuthProvider/AuthResult/OAuthTransaction;
`subscribe`) is stable across 1.x→2.x, so alignment is a pin bump, not a migration.

## DoD #2 — coordinated Changesets release across sdk + gateways + plugins

The blocker (SDK 2.16/2.17/2.18 never npm-published; npm latest was 2.15.2) was
resolved: **`@theokit/sdk@2.18.0` published to npm** (operator-authorized). Then:

- **11 gateway packages published:** `@theokit/gateway@0.4.1` + 10 adapters `@0.1.1`.
- **10 plugin packages published:** auth-github 0.1.1, auth-google 0.1.1, auth-magic-link 0.2.0, plugin-canvas 0.3.1, plugin-copilot 0.1.1, plugin-db-drizzle 0.1.1, plugin-forms 0.1.3, plugin-payments 0.2.0, plugin-realtime 0.1.1, plugin-voice 0.7.1 (plugin-email unchanged — no changeset). Consumed the 38-changeset backlog + removed an orphan changeset for the never-created `@theokit/plugin-cors`.

Provenance note: 9 plugin packages declare `publishConfig.provenance: true` (CI/OIDC).
For the operator-authorized LOCAL publish, provenance was stripped in-memory (NOT
committed — git keeps `provenance: true` for the intended CI publish path) so the
versions could publish. Functional publish; provenance attestation on those versions
follows the CI path on the next CI release.

## DoD #3 — plugins ROADMAP reconciled

`theokit-plugins/ROADMAP.md` rewritten: retired the stale "empty by design" /
cors-sentry-i18n framing; documents the 11 real shipped packages + M6 alignment;
subsumed under the ecosystem ROADMAP; keeps the demand-gate for future plugins.
`README.md` "empty by design" status corrected.

## Commits
- theokit-gateways: `e926cd9` (align) + release commit (7ef62a8 on origin).
- theokit-plugins: `d9a8e30` (align + ROADMAP) + release commit (32e2ddd on origin).
- theokit-sdk: `@theokit/sdk@2.18.0` published (from the M3+M4 release).

## Token handling
The operator-provided NPM_TOKEN was used via `~/.npmrc` for the publishes and
SCRUBBED immediately after. Never written to any committed file, evidence, or issue.
