/**
 * T0.1 — `LocalAgent.send` MUST emit the `agent.send` parent span around the
 * full lifecycle (mutex acquire + dispatch + post-run). Child step spans
 * (`agent.send.<step>` × 8) land in T1.7. Integration-grade test using the
 * real OTel InMemorySpanExporter.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/agent.js";
import { SPAN_NAMES } from "../../src/internal/telemetry/span-names.js";
import {
  findSpanOrThrow,
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
    // Give post-run lifecycle time to call sendSpan.end() in finally.
    await new Promise((r) => setTimeout(r, 50));

    const sendSpan = findSpanOrThrow(SPAN_NAMES.AGENT_SEND);
    expect(sendSpan.ended).toBe(true);
    expect(sendSpan.attributes).toMatchObject({
      agentId: expect.stringMatching(/^agent-/),
      model: "openai/gpt-4o-mini",
    });
    await agent.dispose();
  });
});
