# SEPA Pre-RED Brief — T0.1 OTel hot-path wiring foundation (iter 1)

Date: 2026-06-07
Severity summary: 3 [CRITICAL] (guidance — no HALT) + 5 [MAJOR] + 3 [MINOR]

## [CRITICAL] items
1. Wire `agent.create` span at `agent.ts:97` (static factory entry), NOT only in `local-agent.ts:115` constructor — otherwise cloud path + validateAgentOptions throw paths leak.
2. Span attrs `agentId/runtime/workspaceCwd/pluginCount` — `agentId` and `workspaceCwd` are post-construction; `runtime` and `pluginCount` (`options.plugins?.length ?? 0`) available pre-construction. Set progressively.
3. Pillar (b) integration test MUST use real `@opentelemetry/sdk-trace-node` InMemorySpanExporter, NOT module mock — mock-only = wiring-triad gaming → HALT.

## [MAJOR] items
1. Iter 1 ships closed-enum `span-names.ts` covering ALL 14+ names BUT wires only: `agent.create`, `agent.send` (parent), `memory.recall` (entry).
2. `memory.recall` span attrs MUST include `userId/namespace/scope` — T4.9 needs them as cache-key invariant.
3. Add `TelemetryHandle.recordHistogram(name, valueMs, attrs)` for `theokit_memory_recall_duration_ms`. NOOP_HANDLE = `() => {}`. Real impl lazy-loads `@opentelemetry/api` metrics namespace.
4. `local-agent.ts:236-307` is `sendLocked` (8 steps); iter 1 ships ONLY parent `agent.send`; T1.7 wires child spans.
5. `active-memory.ts:74` `runActiveMemory(args)` — extend `RunActiveMemoryArgs` with optional `telemetry?: TelemetryHandle` (additive, back-compat).

## [MINOR] items
1. `safe()` wrapper already covers exporter errors; do NOT add 2nd try/catch at call sites.
2. Use `as const` literal union for SPAN_NAMES (anticipates T1.1 no-`(string & {})` discipline).
3. `real-local-run.ts:163` duplicate `createTelemetry` is debt — log followup, do NOT refactor in iter 1.

## Iter-1 commit scope (locked)

**Files modified**:
- `packages/sdk/src/agent.ts:97-131` — wire `agent.create` span around static factory.
- `packages/sdk/src/internal/telemetry/tracer.ts` — add `recordHistogram` to `TelemetryHandle` + NOOP + impl.
- `packages/sdk/src/internal/runtime/local-agent.ts:196-233` — wrap `send()` body with `agent.send` parent span.
- `packages/sdk/src/internal/memory/active-memory.ts:74-99` — wrap `runActiveMemory` body with `memory.recall` span + histogram.
- `packages/sdk/src/internal/runtime/local-agent.ts:272-275` — pass telemetry handle into `runActiveMemoryIfEnabled`.

**Files novos**:
- `packages/sdk/src/internal/telemetry/span-names.ts` — closed-enum SPAN_NAMES + SpanName type.
- `packages/sdk/tests/telemetry/helpers/otel-test-collector.ts` — InMemorySpanExporter install helper.
- `packages/sdk/tests/telemetry/agent-create-span.test.ts` — 3 tests (canonical attrs, throw path span end, distinct names).
- `packages/sdk/tests/telemetry/agent-send-parent-span.test.ts` — `agent.send` parent emitted.
- `packages/sdk/tests/telemetry/memory-recall-span.test.ts` — `memory.recall` + histogram.

**devDeps added** (test-only): `@opentelemetry/sdk-trace-node`, `@opentelemetry/sdk-metrics`. NOT runtime deps (would violate plan DoD: OTel stays optional peer).

**Out of iter-1 scope** (deferred):
- `cloud-agent.ts` → T1.4/T1.10
- `internal/llm/*` `llm.call` → T3.*
- `tool-dispatch.ts` `tool.call` → T2.4
- `agent.send.<step>` 8 child spans → T1.7
- `real-local-run.ts` duplicate handle refactor → T1.7 debt

**Commit message** (preview): `feat(telemetry): T0.1 wire agent.create + agent.send + memory.recall spans + histogram foundation`
