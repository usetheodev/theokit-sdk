# SEPA Initial Brief — sdk-superiority-2026-06-07

Date: 2026-06-07
Agent: implement-sdk-superiority-2026-06-07-sepa
Total findings: 19 (5 CRITICAL ordering + 5 deviation-risk + 2 cost-budget + 5 dead-code-batch + 5 test-infra + 4 process gates)

## A. Execution-order risks

- **[CRITICAL]** T0.1 OTel tracer is hard prereq for T1.7, T2.1, T2.2, T3.5, T4.1, T4.2. Must ship FULL span-names + tracer contract, not just scaffolding.
- **[CRITICAL]** T3.1 SSE parser fix MUST land before T6.2 load test (current `.trim()` masks real leak)
- **[CRITICAL]** T2.1+T2.2 (wire dead-code) MUST land before T6.1 real-LLM expansion
- **[MAJOR]** T1.1 KnownAgentRunErrorCode blocks T2.7 + T3.7 (force ordering)
- **[MAJOR]** T4.1 + T4.9 cache keys overlap — force T4.9 first (security trumps perf)
- **[MAJOR]** T5.4 redactor expansion referenced by T1.5 — pull T5.4 forward OR document interim
- **[MAJOR]** T3.5 widens LlmRequest.system (BREAKING type) — ship type-widening first as no-op task

## B. Plan-deviation risk — top 5 tasks

- **[CRITICAL]** T2.1 (validateResponse): extend grep to examples/+tests/ BEFORE RED — if 4th caller path exists, HALT + loop /to-plan
- **[CRITICAL]** T2.2 (D440 aux-LLM): plan does NOT specify model/key/pool source — HALT + refine plan
- **[CRITICAL]** T4.2 (Lance HNSW createIndex): verify Lance current API in iter 1 BEFORE RED — HALT if API differs from D441
- **[MAJOR]** T3.5 (Anthropic prompt caching): real-LLM test needs ~1024 token threshold to trigger cache
- **[MAJOR]** T5.1 (HKDF migration): insert dual-key fallback RED test BEFORE T5.1 RED

## C. Real-LLM cost budget gate

- **[CRITICAL]** Realistic budget $75-$150 over halt-loop. SEPA emits `[CRITICAL] BUDGET_BREACH` if >$100. Snapshot `$THEOKIT_REALLLM_COST_USD` per iter.
- **[MAJOR]** Scope real-LLM gate: only iters touching `internal/llm/**`, `internal/agent-loop/**`, `internal/memory/active-memory*.ts`, `internal/memory/dreaming/**`
- **[MINOR]** gpt-4o-mini default OK except T3.5 (Anthropic native) + T3.6 (OpenAI native)

## D. Dead-code resurrection risk in cleanup batches

- **[CRITICAL]** T1.11/T2.9/T3.10/T4.11/T5.11 batches — SEPA enforces per-finding wiring-triad assertion INSIDE batch tasks
- **[CRITICAL]** T3.10 includes "vision content parts (LARGE)" — split into T3.10a + T3.10b
- **[MAJOR]** T2.9 includes "shell-tool typed error" — cross-link with T2.5 hook ordering
- **[MAJOR]** T4.11 includes "schema migration" — extract standalone with chaos test (T6.4)
- **[MINOR]** T5.11 includes "cwd-mutex map cleanup" — concurrency-sensitive, verify withCwdMutex invariants

## E. Test infrastructure (T0.3)

- **[CRITICAL]** Mandatory harness shape BEFORE T0.3 RED:
  - Load: custom in-process SSE driver (NOT autocannon — needs SSE-aware harness)
  - Socket monitor: `tests/load/_harness/socket-monitor.ts` shelling `ss -tnp` (Linux only; skip Mac/Win)
  - Chaos: `tests/chaos/_harness/` with `killMidStream(processHandle)` (D37 methodology)
  - OOM: `--max-old-space-size=128` per test
- **[MAJOR]** T6.7: enforce `stryker` for TS workspace (NOT mutmut)
- **[MAJOR]** T6.6: add `fast-check` as devDep in T0.3
- **[MINOR]** T6.8: measure current coverage first; ratchet incrementally

## F. Process gates SEPA enforces

- **[CRITICAL]** Zero plan-deviation: SEPA emits `[CRITICAL] PLAN_DEVIATION_DETECTED` if iter's diff touches files NOT in task's `Files:` list. HALT + loop /to-plan
- **[CRITICAL]** Wiring triad pillar (a): grep new caller for actual semantic invocation (not just imported)
- **[MAJOR]** CHANGELOG entry per task per Unbreakable Rule 6
- **[MAJOR]** No --no-verify, no unjustified @ts-expect-error, no setPrototypeOf shortcuts

## Recommendation to halt-loop driver

Insert Phase 0.5 BEFORE Phase 1 (foundation + type-widening):
- T0.4: Widen `LlmRequest.system: string | LlmSystemBlock[]` (no-op, type-only)
- T0.5: Pull T5.4 redactor expansion forward (used by T1.5)
- T0.6: Pull T4.9 cache key fix forward (security trumps perf — used by T4.1)

Insert pre-flight checks BEFORE every iter:
1. Cost gate: `$THEOKIT_REALLLM_COST_USD < $100`
2. Plan-deviation check: diff files ⊆ task's `Files:`
3. Wiring triad pillar (a) functional invocation check
