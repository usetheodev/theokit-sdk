# D381 — Claude tokens are NEVER counted locally

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `token-budget-cost-tracker-plan` (Phase 0)

## Context

`@anthropic-ai/tokenizer@0.0.4` foi last-published em julho 2023. README admite: *"As of the Claude 3 models, this algorithm is no longer accurate"* ([npm](https://www.npmjs.com/package/@anthropic-ai/tokenizer)). Local-count Claude tokens dá número errado por > 20%.

## Decision

For Claude/Anthropic routes: SDK trusts `response.usage` post-call. Pre-call estimation for Anthropic is skipped (preflight returns `undefined` for Anthropic models even with gpt-tokenizer present).

## Rationale

Inaccurate estimates worse than no estimates — false confidence in budget enforcement.

## Consequences

Anthropic users in `mode: 'block'` get post-call enforcement only (audit-equivalent for Claude routes). Documented in concept page.
