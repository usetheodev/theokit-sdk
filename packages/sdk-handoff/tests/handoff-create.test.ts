/**
 * Public Handoff.create() factory + RECOMMENDED_HANDOFF_PROMPT_PREFIX.
 */

import { ConfigurationError, type SDKAgent } from "@theokit/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Handoff, RECOMMENDED_HANDOFF_PROMPT_PREFIX } from "../src/handoff.js";

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
    // B-079 — was bare `.toThrow()`. `Handoff.create` throws a plain `Error`
    // (no typed class, no code) even though it is a `@public` API — flagged as
    // a needs-typing candidate for a separate item rather than fixed here (a
    // production change with API implications is out of scope for this pass).
    // The message is the only stable identifier available today, and both
    // falsy inputs hit the identical guard/message.
    expect(() => Handoff.create(null as unknown as SDKAgent)).toThrow(
      /Handoff\.create: target agent is required/,
    );
    expect(() => Handoff.create(undefined as unknown as SDKAgent)).toThrow(
      /Handoff\.create: target agent is required/,
    );
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

describe("Handoff.create — typed refusals (B-135)", () => {
  // B-135: both guards raised a bare `new Error`, so a caller could only tell them apart by matching
  // the message string — which is not a contract: it changes whenever someone improves the wording,
  // and nothing tells them a consumer broke. `Handoff.create` is `@public`, which is what separates
  // these two from the other untyped throws in this repo that were deliberately left alone.
  //
  // Typing is ADDITIVE rather than breaking: `ConfigurationError extends TheokitAgentError extends
  // Error`, so anyone catching `Error` still catches it, and the messages are preserved verbatim.

  const refusalOf = (run: () => unknown): ConfigurationError => {
    try {
      run();
    } catch (err) {
      return err as ConfigurationError;
    }
    throw new Error("expected Handoff.create to refuse, but it returned");
  };

  it("test_a_missing_target_is_refused_with_handoff_target_required", () => {
    const err = refusalOf(() => Handoff.create(undefined as unknown as SDKAgent));

    expect(err).toBeInstanceOf(ConfigurationError);
    expect(err.code).toBe("handoff_target_required");
    expect(err.message).toContain("target agent is required");
  });

  it("test_a_non_agent_target_is_refused_with_a_DIFFERENT_code", () => {
    // The codes must differ, or the typing bought nothing over the bare Error it replaced.
    const err = refusalOf(() => Handoff.create({} as unknown as SDKAgent));

    expect(err).toBeInstanceOf(ConfigurationError);
    expect(err.code).toBe("handoff_target_invalid");
    expect(err.message).toContain("must be an SDKAgent instance");
  });

  it("test_a_caller_catching_plain_Error_still_catches_it", () => {
    // The compatibility half. Typing must not move these out of reach of existing consumers.
    const err = refusalOf(() => Handoff.create(null as unknown as SDKAgent));

    expect(err).toBeInstanceOf(Error);
  });
});
