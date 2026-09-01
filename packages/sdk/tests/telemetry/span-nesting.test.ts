/**
 * M3 #64 (T1.1) — RED-first: startChildSpan MUST nest the child under its parent
 * (child.parentSpanId === parent.spanId) instead of discarding the parent (flat
 * siblings). Unit-tests the tracer mechanism directly (fixture-mode sends do not
 * emit llm.call/tool.call spans). Also guards the flaky agent.send presence.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Agent } from "../../src/agent.js";
import { createTelemetry } from "../../src/internal/telemetry/tracer.js";
import { useTempCwd } from "../helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

import {
  findSpanEventually,
  findSpanOrThrow,
  installOtelTestCollector,
  uninstallOtelTestCollector,
} from "./helpers/otel-test-collector.js";

describe("M3 #64 — span nesting (trace tree)", () => {
  beforeEach(() => installOtelTestCollector());
  afterEach(async () => await uninstallOtelTestCollector());

  it("startChildSpan nests the child under its parent (parentSpanId === parent.spanId)", () => {
    const telemetry = createTelemetry({ enabled: true });
    const parent = telemetry.startSpan("parent.span");
    const child = telemetry.startChildSpan(parent, "child.span");
    child.end();
    parent.end();

    const p = findSpanOrThrow("parent.span");
    const c = findSpanOrThrow("child.span");
    // The child links to the parent (same trace, parent = the run span) — not a flat sibling.
    expect(c.parentSpanId).toBe(p.spanId);
  });

  it("startChildSpan with undefined parent starts a root span (no crash)", () => {
    const telemetry = createTelemetry({ enabled: true });
    const root = telemetry.startChildSpan(undefined, "orphan.span");
    root.end();
    const s = findSpanOrThrow("orphan.span");
    expect(s.parentSpanId).toBeUndefined();
  });

  it("agent.send span is present on every repeat (flake guard)", async () => {
    for (let i = 0; i < 3; i++) {
      const agent = await Agent.create({
        apiKey: "theo_test_fixture",
        model: { id: "openai/gpt-4o-mini" },
        telemetry: { enabled: true },
      });
      const run = await agent.send(`turn ${i}`);
      await run.wait();
      // Poll (deterministic) instead of a fixed sleep: the agent.send span ends in a
      // callback that fires just after run.wait() resolves; a magic 30ms bet flaked.
      expect((await findSpanEventually("agent.send")).ended).toBe(true);
      await agent.dispose();
      await uninstallOtelTestCollector();
      installOtelTestCollector();
    }
  });
});
