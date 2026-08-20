/**
 * T0.1 RED — `Agent.create` MUST emit the canonical `agent.create` span with
 * attrs `{ agentId, runtime, workspaceCwd, pluginCount }` when telemetry is
 * enabled. Wiring-triad pillar (b) integration test.
 *
 * Validates against a real OTel `BasicTracerProvider` + `InMemorySpanExporter`,
 * NOT a module mock — per SEPA [CRITICAL] gate.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/agent.js";
import { AuthenticationError } from "../../src/errors.js";
import { SPAN_NAMES } from "../../src/internal/telemetry/span-names.js";
import {
  distinctSpanNames,
  findSpanOrThrow,
  installOtelTestCollector,
  uninstallOtelTestCollector,
} from "./helpers/otel-test-collector.js";

describe("agent.create span (T0.1)", () => {
  beforeEach(() => {
    installOtelTestCollector();
  });

  afterEach(async () => {
    await uninstallOtelTestCollector();
  });

  it("emits agent.create span with required attrs", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_fixture",
      model: { id: "openai/gpt-4o-mini" },
      telemetry: { enabled: true },
    });

    const span = findSpanOrThrow(SPAN_NAMES.AGENT_CREATE);
    expect(span.name).toBe("agent.create");
    expect(span.ended).toBe(true);
    expect(span.attributes).toMatchObject({
      agentId: expect.stringMatching(/^agent-/),
      runtime: "local",
      pluginCount: expect.any(Number),
    });
    expect(typeof span.attributes.workspaceCwd).toBe("string");

    await agent.dispose();
  });

  it("emits NO agent.create span when telemetry is disabled (default)", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_fixture",
      model: { id: "openai/gpt-4o-mini" },
    });
    const names = distinctSpanNames();
    expect(names.has(SPAN_NAMES.AGENT_CREATE)).toBe(false);
    await agent.dispose();
  });

  it("ends agent.create span with ERROR status when validation throws", async () => {
    // B-079 — was bare `.rejects.toThrow()`. `resolveApiKey("")` finds nothing
    // (env unset in test) → `createLocalAgent` throws the typed
    // `AuthenticationError` (agent-helpers.ts:127), not the (misleading, now
    // corrected) comment's `validateAgentOptions`.
    await expect(
      Agent.create({
        apiKey: "",
        model: { id: "openai/gpt-4o-mini" },
        telemetry: { enabled: true },
      }),
    ).rejects.toThrow(AuthenticationError);

    const span = findSpanOrThrow(SPAN_NAMES.AGENT_CREATE);
    expect(span.ended).toBe(true);
    // OTel SpanStatusCode.ERROR === 2
    expect(span.status.code).toBe(2);
  });

  it("uses the closed-enum span name (no drift)", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_fixture",
      model: { id: "openai/gpt-4o-mini" },
      telemetry: { enabled: true },
    });
    const names = distinctSpanNames();
    for (const name of names) {
      // Every emitted name MUST be in the closed SPAN_NAMES literal map.
      const allowed = Object.values(SPAN_NAMES) as string[];
      expect(allowed).toContain(name);
    }
    await agent.dispose();
  });
});
