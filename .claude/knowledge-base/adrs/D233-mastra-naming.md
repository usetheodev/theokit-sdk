# D233 — Control flow primitives use Mastra naming: `.then` / `.parallel` / `.branch` / `.foreach` / `.dowhile` / `.sleep` / `.suspend`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Adopt Mastra workflow API names verbatim. No bikeshedding (`step`, `sequence`, `if`/`else`, `do`/`while` alternatives explicitly rejected).

## Rationale

Mastra is the closest reference (TS-first, Zod-driven, GA Jan 2026). Reusing names lets users carry mental models 1:1; docs and search engines surface the same patterns. Originality has zero DX value here.

## Consequences

- Docs cite Mastra as inspiration explicitly; explain divergences (state model, persistence backend).
- Migration from Mastra to `@theokit/sdk` is mostly mechanical (`createWorkflow` → `Workflow.create`).
- We can add primitives Mastra lacks (e.g., `compensate` in v1.2) without breaking the naming convention.
