/**
 * Tool-injector normalization: covers EC-6 (self-reference) +
 * D215 (name collision) + auto-wrap behavior.
 */

import { describe, expect, it } from "vitest";

import { Handoff } from "../../src/handoff.js";
import { normalizeHandoffs } from "../../src/internal/handoff/tool-injector.js";
import {
  HandoffNameCollisionError,
  HandoffSelfReferenceError,
} from "../../src/types/handoff.js";
import type { SDKAgent } from "../../src/types/agent.js";

function fakeAgent(name: string, agentId = `agent-${name}`): SDKAgent {
  return {
    agentId,
    name,
    // biome-ignore lint/suspicious/noExplicitAny: minimal SDKAgent shim for normalize tests
    send: (() => {}) as any,
    close: () => undefined,
    dispose: async () => undefined,
    reload: async () => undefined,
    listArtifacts: async () => [],
    downloadArtifact: async () => Buffer.alloc(0),
    [Symbol.asyncDispose]: async () => undefined,
  } as unknown as SDKAgent;
}

describe("normalizeHandoffs", () => {
  it("auto-wraps a raw SDKAgent with default options", () => {
    const billing = fakeAgent("billing");
    const out = normalizeHandoffs("agent-parent", [billing]);
    expect(out).toHaveLength(1);
    expect(out[0]?.descriptor.target).toBe(billing);
    expect(out[0]?.descriptor.resolvedToolName).toBe("transfer_to_billing");
  });

  it("accepts a HandoffDescriptor from Handoff.create()", () => {
    const support = fakeAgent("support");
    const descriptor = Handoff.create(support, {
      toolName: "escalate_to_human",
    });
    const out = normalizeHandoffs("agent-parent", [descriptor]);
    expect(out[0]?.descriptor.resolvedToolName).toBe("escalate_to_human");
  });

  it("EC-6 — throws HandoffSelfReferenceError on self-reference", () => {
    const self = fakeAgent("self", "agent-self");
    expect(() => normalizeHandoffs("agent-self", [self])).toThrow(
      HandoffSelfReferenceError,
    );
  });

  it("D215 — throws HandoffNameCollisionError on duplicate tool name", () => {
    const a = fakeAgent("billing", "agent-a");
    const b = fakeAgent("billing", "agent-b");
    expect(() => normalizeHandoffs("agent-parent", [a, b])).toThrow(
      HandoffNameCollisionError,
    );
  });

  it("EC-9 — empty handoffs[] returns []", () => {
    expect(normalizeHandoffs("agent-parent", [])).toEqual([]);
  });

  it("slugifies agentId for fallback name", () => {
    const a = fakeAgent(undefined as unknown as string, "agent-foo-bar-baz");
    const out = normalizeHandoffs("agent-parent", [a]);
    expect(out[0]?.descriptor.resolvedToolName).toBe("transfer_to_foo-bar-baz");
  });
});
