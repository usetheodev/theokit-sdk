/**
 * Public Handoff.create() factory + RECOMMENDED_HANDOFF_PROMPT_PREFIX.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { Handoff, RECOMMENDED_HANDOFF_PROMPT_PREFIX } from "../../src/handoff.js";
import type { SDKAgent } from "../../src/types/agent.js";

function fakeAgent(name: string): SDKAgent {
  return {
    agentId: `agent-${name}`,
    name,
    // biome-ignore lint/suspicious/noExplicitAny: minimal SDKAgent shim
    send: (() => {}) as any,
    close: () => undefined,
    dispose: async () => undefined,
    reload: async () => undefined,
    listArtifacts: async () => [],
    downloadArtifact: async () => Buffer.alloc(0),
    [Symbol.asyncDispose]: async () => undefined,
  } as unknown as SDKAgent;
}

describe("Handoff.create (D222)", () => {
  it("returns a HandoffDescriptor with default tool name", () => {
    const billing = fakeAgent("billing");
    const descriptor = Handoff.create(billing);
    expect(descriptor.target).toBe(billing);
    expect(descriptor.resolvedToolName).toBe("transfer_to_billing");
    expect(descriptor.options).toEqual({});
  });

  it("respects custom toolName override", () => {
    const support = fakeAgent("support");
    const descriptor = Handoff.create(support, { toolName: "escalate" });
    expect(descriptor.resolvedToolName).toBe("escalate");
  });

  it("preserves options on the descriptor", () => {
    const support = fakeAgent("support");
    const schema = z.object({ reason: z.string() });
    const descriptor = Handoff.create(support, {
      inputType: schema,
      toolDescription: "Hand off to support",
      tools: ["lookup_ticket"],
    });
    expect(descriptor.options.inputType).toBe(schema);
    expect(descriptor.options.toolDescription).toBe("Hand off to support");
    expect(descriptor.options.tools).toEqual(["lookup_ticket"]);
  });

  it("throws when target is null/undefined", () => {
    expect(() => Handoff.create(null as unknown as SDKAgent)).toThrow();
    expect(() => Handoff.create(undefined as unknown as SDKAgent)).toThrow();
  });

  it("throws when target is not an SDKAgent (no .send)", () => {
    expect(() => Handoff.create({ agentId: "x" } as unknown as SDKAgent)).toThrow(/SDKAgent/);
  });
});

describe("RECOMMENDED_HANDOFF_PROMPT_PREFIX", () => {
  it("is a non-empty string mentioning transfer_to_", () => {
    expect(typeof RECOMMENDED_HANDOFF_PROMPT_PREFIX).toBe("string");
    expect(RECOMMENDED_HANDOFF_PROMPT_PREFIX.length).toBeGreaterThan(50);
    expect(RECOMMENDED_HANDOFF_PROMPT_PREFIX).toMatch(/transfer_to_/);
  });
});
