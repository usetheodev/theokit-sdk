---
name: implement-sdk-superiority-2026-06-07-sepa-knowledge
description: Read-only knowledge skill for the SEPA agent on plan sdk-superiority-2026-06-07. Surfaces the full plan body, key ADRs (D43/D89/D91/D92/D93 existing + D438-D446 proposed), and the 135 deep-review findings (DR1-DR4 + DR6) as referenceable data.
---

# SEPA Knowledge — sdk-superiority-2026-06-07

## When to invoke

The SEPA agent invokes this skill via the `Skill` tool when it needs to refresh its memory of plan content during a per-iteration consultation. Read-only.

## Plan body location

`.claude/knowledge-base/plans/sdk-superiority-2026-06-07-plan.md` — 462 lines, 11 phases, 67 tasks, 14 ADRs.

## Key references

- **Plan**: `.claude/knowledge-base/plans/sdk-superiority-2026-06-07-plan.md`
- **Implementation contract**: `.claude/knowledge-base/implementations/sdk-superiority-2026-06-07-implementation.md`
- **Progress log**: `.claude/knowledge-base/implementations/.progress-sdk-superiority-2026-06-07.json`
- **Per-iter SEPA logs**: `.claude/knowledge-base/implementations/sdk-superiority-2026-06-07/sepa-iterations/iteration-{N}-{phase}.md`

## ADRs (existing in .claude/knowledge-base/adrs/)

| ADR | File | Relevance |
|---|---|---|
| D43 | D43-lance-backend-same-interface.md | T4.2 (Lance HNSW createIndex amend) |
| D89 | D89-tool-errors-as-iserror-not-throw.md | T2.6 (loop must NOT exit on first tool error) |
| D91 | D91-compression-cap-defaults.md | T2.2 (cap=3 + grace=1 wired) |
| D92 | D92-compression-10-percent-reduction-floor.md | T2.2 (assertCompressionReduced floor) |
| D93 | D93-empty-response-detection.md | T2.1 (validateResponse bailout wired) |
| D428 | D428-subscription-sub-path-only.md | madge baseline 2 cycles (intentional) |

## Proposed ADRs (new, in plan)

| ADR | Title |
|---|---|
| D438 | Type-safety closed-enum KnownAgentRunErrorCode + open back-compat alias |
| D439 | MemoryFederation plugin contract |
| D440 | Compression auxiliary-model contract (T2.2) |
| D441 | Lance HNSW IVF_PQ thresholds + integration test rationale |
| D442 | HKDF-SHA256 over secret bytes for AES tx-cookie + minimum secret length |
| D443 | Redactor pattern coverage matrix (12 → 30+) |
| D444 | Loop conversation log shape (tool turns) parity with OpenAI Agents Python |
| D445 | Anthropic prompt caching emission contract |
| D446 | OpenAI structured outputs (response_format) emission contract |

## Deep-review findings index

- **DR1 SDK core** (30 findings) — agent.ts, types/agent.ts, runtime/{local,cloud,fork}-agent.ts, errors.ts
- **DR2 agent-loop + tool-dispatch** (25 findings) — internal/agent-loop/, internal/tool-dispatch/, internal/runtime/{validate-response,compression-helpers,budget}.ts
- **DR3 LLM providers + transport** (25 findings) — internal/llm/, internal/errors/mappers/
- **DR4 Memory subsystem** (25 findings) — internal/memory/, including storage/, dreaming/, adapters/
- **DR6 Security primitives + persistence** (30 findings) — internal/security/, internal/persistence/

Top 5 CRITICALS targeted by plan:
1. T2.1+T2.2: wire dead-code validateResponse + compression (D91/D92/D93)
2. T3.1+T3.2+T3.3: SSE spec-correct + abort cancels body
3. T4.1+T4.2: query-vector cache + Lance createIndex HNSW
4. T5.1: HKDF-SHA256 for AES tx-cookie
5. T5.2: SQL injection in Lance .where

## Project rules (must consult)

- `.claude/rules/no-stubs-no-mocks-no-wired.md` — explicit ban on dead-code wired
- `.claude/rules/real-llm-validation.md` — validation must hit real LLM
- `.claude/rules/cycle-implement.md` — halt-loop discipline
- `.claude/quality-gates.md` — hard/soft/manual gates
- `/home/paulo/.claude/CLAUDE.md` — Inquebráveis (95%/honesty/git/TDD/CHANGELOG)
