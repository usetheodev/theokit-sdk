---
id: D14
status: Decided
date: 2026-05-16
plan: sdk-v1-ga-completion
---

# D14 — Dreaming narrative LLM (per-cluster summarization) deferred to v1.1

## Context
OpenClaw's dreaming pipeline has a `narrative.ts` module that uses an LLM to produce a coherent paragraph per cluster (instead of picking a representative bullet via longest-text-wins). The previous SDK iteration documented this as "Phase 9.1" deferred work. Under the no-stubs rule, the deferred-phase language was removed and the deterministic mode is declared the v1.0 product.

## Decision
v1.0 ships deterministic clustering only (longest-text-wins as cluster representative). The narrative module is deferred to v1.1.

## Rationale
- Same shape as D13: deterministic mode works honestly. Dogfood verified 6 facts → 4 semantic clusters via OpenRouter embeddings, with meaningful diary entries.
- LLM mode requires:
  - Model choice (Haiku 4.5? Gemini Flash Lite?).
  - Prompt design (the cluster-summarization prompt isn't trivial).
  - Cost accounting (extra LLM calls per dreaming sweep).
- The `runDreamingSweep` contract is stable — v1.1 can plug in `narrative.ts` without changing the orchestrator API.

## Consequences
- `runDreamingSweep` produces consolidated `notes/dreamed-<ts>.md` + `dream-diary.md` deterministically.
- The "deep" phase output uses the longest member text per cluster as the representative.
- v1.1 work: implement `narrative.ts` + integrate without changing the orchestrator contract.

## Alternatives Considered
- **Ship narrative.ts now with a hardcoded model** — rejected; locks consumers, mismatched with D4 (model catalog policy).
- **Drop dreaming entirely from v1.0** — rejected; deterministic dreaming is honest, useful, and tested.
