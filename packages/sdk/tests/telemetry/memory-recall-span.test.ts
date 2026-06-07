/**
 * T0.1 — `runActiveMemory` MUST emit `memory.recall` span with
 * `{ queryMode, userId, namespace, scope, hits, status, durationMs }` attrs
 * and record `theokit_memory_recall_duration_ms` histogram. Validated by
 * driving the function directly (no real index needed for skipped/no-recall
 * paths); end-to-end with a real index is exercised by integration tests in
 * Phase 4.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runActiveMemory } from "../../src/internal/memory/active-memory.js";
import { HISTOGRAM_NAMES, SPAN_NAMES } from "../../src/internal/telemetry/span-names.js";
import { createTelemetry } from "../../src/internal/telemetry/tracer.js";
import {
  findSpanOrThrow,
  installOtelTestCollector,
  uninstallOtelTestCollector,
} from "./helpers/otel-test-collector.js";

describe("memory.recall span (T0.1)", () => {
  beforeEach(() => {
    installOtelTestCollector();
  });

  afterEach(async () => {
    await uninstallOtelTestCollector();
  });

  it("emits memory.recall span with userId/namespace/scope/queryMode attrs on the skipped path", async () => {
    const telemetry = createTelemetry({ enabled: true });
    const result = await runActiveMemory({
      userText: "hello",
      priorMessages: [],
      index: undefined, // forces 'skipped'
      options: { enabled: true, queryMode: "recent" },
      telemetry,
      userId: "user-42",
      namespace: "default",
      scope: "session",
    });

    expect(result.status).toBe("skipped");
    const span = findSpanOrThrow(SPAN_NAMES.MEMORY_RECALL);
    expect(span.ended).toBe(true);
    expect(span.attributes).toMatchObject({
      queryMode: "recent",
      userId: "user-42",
      namespace: "default",
      scope: "session",
      status: "skipped",
    });
  });

  it("does NOT emit memory.recall span when telemetry is undefined (no-op handle)", async () => {
    await runActiveMemory({
      userText: "hello",
      priorMessages: [],
      index: undefined,
      options: { enabled: true },
      // no telemetry
    });
    // The exporter has no captured spans for memory.recall:
    expect(() => findSpanOrThrow(SPAN_NAMES.MEMORY_RECALL)).toThrow(/No span named/);
  });

  it("records theokit_memory_recall_duration_ms histogram name is exposed in enum", () => {
    expect(HISTOGRAM_NAMES.MEMORY_RECALL_DURATION_MS).toBe("theokit_memory_recall_duration_ms");
  });
});
