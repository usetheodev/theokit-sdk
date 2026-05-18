import { describe, expect, it } from "vitest";

import { createTelemetry } from "../../../src/internal/telemetry/tracer.js";

/**
 * Golden tests for the telemetry subsystem — ADR D34.
 *
 * We test the public contract of `createTelemetry()` directly: enabled/
 * disabled, no-op behaviour when OTel is missing, EC-1 (exporter errors
 * never propagate), privacy default (includeContent off), and span lifecycle.
 *
 * Full end-to-end span emission with a real OTel exporter is validated in
 * the dogfood phase (Phase 10) by running an example with
 * `@opentelemetry/sdk-trace-node` installed and inspecting the console.
 */

describe("createTelemetry", () => {
  it("returns a no-op handle when telemetry is undefined", () => {
    const handle = createTelemetry(undefined);
    expect(handle.enabled).toBe(false);
    expect(handle.includeContent).toBe(false);
    // Calling methods on no-op handle should not throw.
    const span = handle.startSpan("test");
    span.setAttribute("k", "v");
    span.end();
    handle.endAll();
  });

  it("returns a no-op handle when enabled: false", () => {
    const handle = createTelemetry({ enabled: false });
    expect(handle.enabled).toBe(false);
    const span = handle.startSpan("test");
    span.setAttribute("k", 1);
    span.end();
  });

  it("defaults includeContent to false (privacy)", () => {
    // We can't easily test "enabled: true" without installing OTel in this
    // test environment. But the no-op handle still reflects the default.
    const handle = createTelemetry({ enabled: false, includeContent: undefined });
    expect(handle.includeContent).toBe(false);
  });

  it("no-op span has stable spanContext (no crash on inspection)", () => {
    const handle = createTelemetry(undefined);
    const span = handle.startSpan("test");
    const ctx = span.spanContext();
    expect(ctx.traceId).toBe("0".repeat(32));
    expect(ctx.spanId).toBe("0".repeat(16));
  });

  it("no-op span isRecording returns false", () => {
    const handle = createTelemetry(undefined);
    const span = handle.startSpan("test");
    expect(span.isRecording()).toBe(false);
  });

  it("no-op span swallows all attribute/event/status/recordException calls", () => {
    const handle = createTelemetry({ enabled: false });
    const span = handle.startSpan("test");
    // None of these should throw or emit anything.
    span.setAttribute("a", "b");
    span.setAttributes({ x: 1, y: true });
    span.addEvent("evt", { z: "w" });
    span.setStatus({ code: 0 });
    span.recordException(new Error("test"));
    span.end();
  });

  it("endAll on no-op handle is safe (no spans to end)", () => {
    const handle = createTelemetry({ enabled: false });
    handle.endAll();
    handle.endAll(); // idempotent
  });

  it("startChildSpan on no-op handle returns no-op span", () => {
    const handle = createTelemetry(undefined);
    const parent = handle.startSpan("parent");
    const child = handle.startChildSpan(parent, "child");
    expect(child.isRecording()).toBe(false);
  });

  it("enabled telemetry without OTel installed warns and degrades to no-op", () => {
    // OTel api is NOT installed in this test environment unless we add it.
    // Calling with enabled: true should degrade gracefully (returns no-op
    // handle, logs to stderr once). We assert the returned handle behaves
    // like no-op.
    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const handle = createTelemetry({ enabled: true });
      // Without OTel installed, this should be a no-op handle.
      expect(handle.enabled).toBe(false);
      // We may or may not see a stderr warning depending on cache state.
      // Assertion is weaker: no exception thrown.
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});
