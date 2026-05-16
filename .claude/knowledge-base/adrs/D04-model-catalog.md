---
id: D4
status: Decided
date: 2026-05-16
plan: sdk-v1-ga-completion
---

# D4 — Model catalog source-of-truth = `Theokit.models.list()` (PaaS-backed)

## Context
SDK initially shipped with `composer-2` as a placeholder model id baked into FIXTURE_MODELS and defaulted across `LocalAgent`, `CloudAgent`, and `local-run.ts`. The placeholder was misleading: it pretended to be a real model but mapped to nothing in production.

## Decision
The SDK does NOT maintain a hardcoded model catalog. Real consumers call `Theokit.models.list()` to discover available models. The default agentic model id (`google/gemini-2.0-flash-exp:free`) is a single runnable fallback for users who don't call `models.list()`. `FIXTURE_MODELS` exists only for `theo_test_*` fixture-mode keys.

## Rationale
Maintaining a hardcoded catalog goes stale on every PaaS release. PaaS owns the canonical list. SDK only needs (a) one runnable default for out-of-box use, (b) the fixture catalog for test-mode.

## Consequences
- Documentation always points at `Theokit.models.list()` for "what models can I use?".
- README/docs.md examples use `google/gemini-2.0-flash-exp:free` and explicitly note it's overridable.
- The default id is centralized in `packages/sdk/src/internal/runtime/default-model.ts`.

## Alternatives Considered
- **Hardcoded curated list** — rejected; goes stale immediately.
- **No default at all** — rejected; forces every consumer to call `models.list()` before first send.
