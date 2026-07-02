# Discovery Plan: M2 Harness Resilience & I/O Robustness

**Slug:** `m2-harness-resilience`
**Generated:** 2026-07-02 via `/discover-plan`
**In-scope reference projects:** codex, mastra, opencode, adk-js, crewai (cloned under `.claude/knowledge-base/reference/`)

## Context

Milestone M2 (ecosystem `ROADMAP.md`) makes the Harness survive flaky providers, slow streams, and
large histories. Four issues, scoped by the ROADMAP DoD (the contract): **#60** 429 backoff + circuit
breaker, **#61** streaming idle timeout + truncation flag + `{raw}` passthrough, **#59** MCP
reconnect-after-drop, **#63** persistence batch/pagination/atomic append. Depends on M0 + M1 (both
RELEASED). Prior art is our own cross-validation sweep against 5 SOTA peers, filed at
`.claude/knowledge-base/audits/cross-validation/_issues/{06,07,08,10}-*.md`.

## Research questions (≤ 15)

1. **Q1 (#60)** — How do codex/mastra apply full-jitter backoff on 429, and where exactly is the SDK's `sleepWithAbort(computeBackoffMs(...))` supposed to be wired in `pool-aware-client.ts`? *(Coverage Corner 4)*
2. **Q2 (#60)** — What is the minimal circuit-breaker shape (states, thresholds, half-open probe) that fits `PoolAwareLlmClient` without over-engineering? *(Corner 4)*
3. **Q3 (#61)** — How does codex bound each SSE `reader.read()` with an idle timeout, and how should the SDK race it in `sse.ts::readChunks` without false-positives on slow-but-alive models? *(Corner 4)*
4. **Q4 (#61)** — How does codex detect truncation (stream ends without finish_reason / [DONE]) and turn it into a typed error instead of a default `end_turn`? *(Corner 4)*
5. **Q5 (#61)** — How does mastra repair malformed native tool-call JSON, and how should `parseToolArguments` attempt `jsonrepair` before the `{raw}` fallback (SDK already owns `jsonrepair`)? *(Corner 4)*
6. **Q6 (#59)** — How does mastra/codex detect an MCP transport drop (stdio child exit/close, http failure) and reconnect with backoff? What is the minimal reconnect state machine? *(Corner 4)*
7. **Q7 (#63)** — How does mastra batch-append conversation messages (one write per turn, dir-existence cache) vs the SDK's per-message `mkdir`+`appendFile`? *(Corner 4)*
8. **Q8 (#63)** — How does opencode use a cross-process file lock around append+compaction, and how do we wrap the SDK's `withFileLock` (already present, unused) around the hot path? *(Corner 4)*
9. **Q9 (#63)** — What pagination shape (offset/limit) should `ConversationStorageAdapter` expose so hydration is not O(N) full-history read? *(Corner 4)*
10. **Q10 (all)** — Which pieces are stdlib-only (Node ≥22.12) vs need a dependency? Confirm no new runtime dep is required. *(Corner 2)*
11. **Q11 (all)** — What integration/chaos tests do the peers use for these paths (stalled stream, killed MCP child, cross-process append race) that we should mirror? *(Corner 1)*
12. **Q12 (all)** — What build/test tooling (fake timers, chaos harness) is needed to test timers/backoff deterministically? *(Corner 3)*

## Coverage Corners

- **Corner 1 — Integration Tests:** peer chaos/integration patterns for stalled stream, killed MCP child, cross-process append (Q11).
- **Corner 2 — Dependencies:** stdlib sufficiency; `jsonrepair` already a direct dep; no new runtime dep (Q10).
- **Corner 3 — Tools:** deterministic timer testing (fake timers), chaos harness already present (Q12).
- **Corner 4 — Techniques:** the concrete fix technique per deliverable (Q1–Q9).

## Acceptance criteria

Every question answered with a citation to a real SDK source path AND to the corresponding
cross-validation `_issues/*.md` finding (which embeds the peer file:line). Four corners populated.
≥ 1 ADR per issue. No fabricated citation.
