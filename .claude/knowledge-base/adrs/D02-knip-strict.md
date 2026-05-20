---
id: D2
status: Decided
date: 2026-05-16
plan: sdk-v1-ga-completion
---

# D2 — Knip full mode enforced strictly

## Context
`pnpm quality:dead` runs `knip` in full mode. Under Node 22 it completes in <60s with zero findings on the current SDK tree. Under Node 20 it OOMed at 4 GB heap (resolved by D1).

## Decision
`pnpm quality:dead` runs full knip (no `--include` subset) and is part of both pre-push and CI. Failures block merge.

## Rationale
- Full mode catches dead files, unlisted deps, unresolved imports, dead types — all of which can silently rot a long-lived TS monorepo.
- Targeted `--include exports,types` is too narrow.
- With Node 22, full knip is essentially free (<60s, no OOM).

## Consequences
- New unused exports fail CI.
- Contributors must clean dead code or annotate `knipignore` with a justification comment.

## Alternatives Considered
- **Targeted include subset** — rejected; misses entire categories of findings.
- **Knip advisory (non-blocking)** — rejected; advisory checks are routinely ignored.
