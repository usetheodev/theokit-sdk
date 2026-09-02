/**
 * T0.1 — `LocalAgent.send` MUST emit the `agent.send` parent span around the
 * full lifecycle (mutex acquire + dispatch + post-run). Child step spans
 * (`agent.send.<step>` × 8) land in T1.7. Integration-grade test using the
 * real OTel InMemorySpanExporter.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/agent.js";
import { SPAN_NAMES } from "../../src/internal/telemetry/span-names.js";
import { useTempCwd } from "../helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

import {
  findSpanEventually,
  installOtelTestCollector,
  uninstallOtelTestCollector,
} from "./helpers/otel-test-collector.js";

describe("agent.send parent span (T0.1)", () => {
  beforeEach(() => {
    installOtelTestCollector();
  });

  afterEach(async () => {
    await uninstallOtelTestCollector();
  });

  it("emits agent.send span with agentId + model attrs and ends with OK", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_fixture",
      model: { id: "openai/gpt-4o-mini" },
      telemetry: { enabled: true },
    });
    const run = await agent.send("hello world");
    await run.wait();
    // Poll (deterministic) instead of a fixed sleep: sendSpan.end() runs in a finally
    // that fires just after run.wait() resolves; a magic 50ms bet flaked under jitter.
    const sendSpan = await findSpanEventually(SPAN_NAMES.AGENT_SEND);
    expect(sendSpan.ended).toBe(true);
    expect(sendSpan.attributes).toMatchObject({
      agentId: expect.stringMatching(/^agent-/),
      model: "openai/gpt-4o-mini",
    });
    await agent.dispose();
  });
});
