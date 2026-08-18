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
    // B-006. The body was five bare calls under "None of these should throw or emit anything". It
    // does fail if one of them is removed from the no-op span (the TypeError escapes — nothing here
    // swallows it), so this was an implicit oracle rather than none at all. Stating it makes the
    // claim survive a refactor that adds a try/catch, and the second assertion is new: swallowing
    // must not have quietly turned recording on.
    const handle = createTelemetry({ enabled: false });
    const span = handle.startSpan("test");
    expect(() => {
      span.setAttribute("a", "b");
      span.setAttributes({ x: 1, y: true });
      span.addEvent("evt", { z: "w" });
      span.setStatus({ code: 0 });
      span.recordException(new Error("test"));
      span.end();
    }, "every no-op span method must exist and absorb its call").not.toThrow();

    expect(span.isRecording(), "and absorbing the calls must not have switched recording on").toBe(
      false,
    );
  });

  it("endAll on no-op handle is safe (no spans to end)", () => {
    // B-006. Two bare calls, the idempotence claimed in a trailing comment. Same shape as above: a
    // throwing `endAll` does fail this today, so the oracle was implicit rather than absent. Naming
    // it is what makes the claim survive a refactor that wraps the body in a try.
    //
    // A second assertion stood here — `handle.startSpan("after").isRecording()` is false — under
    // "the handle must still be usable afterwards". Review showed no mutation of `endAll` can fail
    // it: the no-op handle has no state for `endAll` to corrupt, so it dies only to
    // `isRecording -> true`, which the dedicated sibling above already pins. It was guarding a
    // different behaviour than the one in this test's title, so it is gone rather than kept for
    // looking thorough.
    const handle = createTelemetry({ enabled: false });
    expect(() => {
      handle.endAll();
      handle.endAll();
    }, "endAll must be safe with no spans, and idempotent").not.toThrow();
  });

  it("startChildSpan on no-op handle returns no-op span", () => {
    const handle = createTelemetry(undefined);
    const parent = handle.startSpan("parent");
    const child = handle.startChildSpan(parent, "child");
    expect(child.isRecording()).toBe(false);
  });

  it("enabled telemetry produces a real handle (T0.1 — `@opentelemetry/api` is now devDep)", () => {
    // T0.1 introduced `@opentelemetry/sdk-trace-base` as devDep so the wiring
    // triad pillar (b) test for `agent.create` span runs against a real
    // tracer. The lazy `createRequire("@opentelemetry/api")` in tracer.ts
    // therefore succeeds in test environments. The no-op fallback path is
    // still exercised when `telemetry === undefined` or `enabled: false`.
    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const handle = createTelemetry({ enabled: true });
      expect(handle.enabled).toBe(true);
      // Handle methods still must never throw (EC-1 invariant).
      const span = handle.startSpan("test");
      span.setAttribute("k", "v");
      span.end();
      handle.endAll();
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});
