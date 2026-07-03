/**
 * In-memory OTel collector for T0.1 wiring-triad pillar (b) integration tests.
 *
 * Wires `@opentelemetry/sdk-trace-base` `InMemorySpanExporter` +
 * `BasicTracerProvider` so the SDK's lazy `@opentelemetry/api` lookup resolves
 * to a real tracer. The tracer is process-global (per OTel `trace.setGlobalTracerProvider`),
 * so call `installOtelTestCollector()` in `beforeEach` and `uninstallOtelTestCollector()`
 * in `afterEach` to avoid cross-test leakage.
 *
 * This is NOT a mock — the SDK production code path calls `createTelemetry()`
 * which calls `otel.trace.getTracer(...).startSpan(...)`, which delegates to the
 * `BasicTracerProvider` installed here. The captured spans are the SAME spans
 * the production code emits in real observability deployments.
 *
 * Why InMemorySpanExporter (and not `@opentelemetry/sdk-trace-node`):
 * - `sdk-trace-node` pulls Node-only auto-instrumentation that we don't need
 * - `sdk-trace-base` works in both Node and edge runtimes, matching SDK target
 * - Test runs without network or async export infra; spans are flushed sync.
 */

import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { _resetTelemetryCacheForTests } from "../../../src/internal/telemetry/tracer.js";

let provider: BasicTracerProvider | undefined;
let exporter: InMemorySpanExporter | undefined;

interface CapturedSpan {
  name: string;
  attributes: Record<string, unknown>;
  status: { code: number; message?: string };
  ended: boolean;
  endTimeNs: number;
  startTimeNs: number;
  /** M3 #64 — this span's own id + its parent's id (for trace-tree assertions). */
  spanId: string;
  parentSpanId: string | undefined;
}

/**
 * Install the in-memory tracer provider as the OTel global. Resets the SDK's
 * lazy `@opentelemetry/api` cache so the next `createTelemetry()` call picks
 * up the freshly-installed provider.
 */
export function installOtelTestCollector(): void {
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  _resetTelemetryCacheForTests();
}

/** Tear down the global provider and clear captured spans. */
export async function uninstallOtelTestCollector(): Promise<void> {
  if (provider !== undefined) {
    await provider.shutdown();
    provider = undefined;
  }
  if (exporter !== undefined) {
    exporter.reset();
    exporter = undefined;
  }
  trace.disable();
  _resetTelemetryCacheForTests();
}

/** Return all spans the SDK has emitted since the last `installOtelTestCollector()`. */
function getEmittedSpans(): CapturedSpan[] {
  if (exporter === undefined) {
    throw new Error("otel-test-collector: getEmittedSpans called before installOtelTestCollector");
  }
  return exporter.getFinishedSpans().map((s) => ({
    name: s.name,
    attributes: s.attributes,
    status: s.status,
    ended: s.ended,
    endTimeNs: s.endTime[0] * 1e9 + s.endTime[1],
    startTimeNs: s.startTime[0] * 1e9 + s.startTime[1],
    // M3 #64 — OTel ReadableSpan exposes the parent via `parentSpanContext`
    // (newer) or `parentSpanId` (older). Support both.
    spanId: s.spanContext().spanId,
    parentSpanId:
      (s as { parentSpanContext?: { spanId?: string } }).parentSpanContext?.spanId ??
      (s as { parentSpanId?: string }).parentSpanId,
  }));
}

/** Find the first span with the given name; throws if none found. */
export function findSpanOrThrow(name: string): CapturedSpan {
  const spans = getEmittedSpans();
  const found = spans.find((s) => s.name === name);
  if (found === undefined) {
    const names = spans.map((s) => s.name).join(", ");
    throw new Error(`No span named "${name}" emitted. Saw: [${names}]`);
  }
  return found;
}

/**
 * Poll for a span by name until it appears or `timeoutMs` elapses. Deterministic
 * replacement for a fixed sleep: `SimpleSpanProcessor` exports on `span.end()`, so
 * a span whose `.end()` fires in a callback slightly after `run.wait()` resolves
 * shows up as soon as that microtask runs — polling waits exactly that long instead
 * of betting on a magic constant. A genuinely never-emitted span still fails (the
 * poll times out), so this tolerates scheduling jitter without masking a real bug.
 */
export async function findSpanEventually(name: string, timeoutMs = 1000): Promise<CapturedSpan> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const spans = exporter === undefined ? [] : getEmittedSpans();
    const found = spans.find((s) => s.name === name);
    if (found !== undefined) return found;
    if (Date.now() >= deadline) {
      const names = spans.map((s) => s.name).join(", ");
      throw new Error(`No span named "${name}" emitted within ${timeoutMs}ms. Saw: [${names}]`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Return distinct span names emitted (useful for ≥ 6 name DoD assertion). */
export function distinctSpanNames(): Set<string> {
  return new Set(getEmittedSpans().map((s) => s.name));
}
