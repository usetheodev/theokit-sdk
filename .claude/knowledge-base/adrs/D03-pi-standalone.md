---
id: D3
status: Decided
date: 2026-05-16
plan: sdk-v1-ga-completion
---

# D3 — `pi` stays stand-alone (not vendored, not workspace-linked)

## Context
`referencia/pi/` is the upstream Pi agent core, studied as design inspiration for the SDK's local runtime. The implicit decision since project inception has been to NOT import from it.

## Decision
`packages/sdk/` continues to NOT import from `referencia/pi/`. The SDK ships its own local-runtime implementation (`real-local-run` + `agent-loop` + `local-agent-memory`).

## Rationale
Pulling `pi` into the workspace would force version coupling between two projects with different release cadences and audiences. The SDK already has a working local runtime built from scratch. Wrapping `pi` would surface its public-API choices as ours.

## Consequences
- Improvements upstream in `pi` must be ported by hand.
- `pnpm-workspace.yaml` does not include `referencia/`.
- `biome.json` excludes `referencia/`.
- Future "wrap vs implement" reconsideration requires an ADR superseding D3.

## Alternatives Considered
- **Vendor `pi` as `packages/sdk-pi-core/`** — rejected; doubles maintenance.
- **Workspace-link `pi`** — rejected; locks SDK release cadence to upstream.
