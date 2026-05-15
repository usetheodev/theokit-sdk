import { describe, expect, it } from "vitest";

import { resolveSystemPrompt } from "../../../src/internal/runtime/system-prompt.js";
import type { SystemPromptContext } from "../../../src/types/agent.js";

/**
 * Behaviour gate for the system-prompt resolver. Covers the priority order,
 * resolver invocation, defensive coercion, and error propagation. Pure
 * function — no I/O, no agent harness setup required.
 */

function ctx(overrides: Partial<SystemPromptContext> = {}): SystemPromptContext {
  return {
    agentId: "agent-test-1",
    cwd: "/tmp/demo",
    model: { id: "test-model" },
    skills: [],
    userMessage: "hi",
    memory: [],
    ...overrides,
  };
}

describe("resolveSystemPrompt", () => {
  it("resolves override first when both are defined", async () => {
    const result = await resolveSystemPrompt("agent-default", "override-wins", ctx());
    expect(result).toBe("override-wins");
  });

  it("resolves agent string when no override is provided", async () => {
    const result = await resolveSystemPrompt("agent-default", undefined, ctx());
    expect(result).toBe("agent-default");
  });

  it("invokes the agent resolver when no override is provided", async () => {
    const resolver = async (c: SystemPromptContext): Promise<string> => `Agent ${c.agentId}`;
    const result = await resolveSystemPrompt(resolver, undefined, ctx());
    expect(result).toBe("Agent agent-test-1");
  });

  it("returns undefined when nothing is configured", async () => {
    const result = await resolveSystemPrompt(undefined, undefined, ctx());
    expect(result).toBeUndefined();
  });

  it("passes the full context to the resolver", async () => {
    let captured: SystemPromptContext | undefined;
    const resolver = (c: SystemPromptContext): string => {
      captured = c;
      return "ok";
    };
    await resolveSystemPrompt(resolver, undefined, ctx({ userMessage: "ping" }));
    expect(captured).toEqual({
      agentId: "agent-test-1",
      cwd: "/tmp/demo",
      model: { id: "test-model" },
      skills: [],
      userMessage: "ping",
      memory: [],
    });
  });

  it("propagates errors thrown by the resolver", async () => {
    const resolver = (): string => {
      throw new Error("resolver blew up");
    };
    await expect(resolveSystemPrompt(resolver, undefined, ctx())).rejects.toThrow(
      "resolver blew up",
    );
  });

  it("respects an empty string returned by the resolver", async () => {
    const resolver = (): string => "";
    const result = await resolveSystemPrompt(resolver, undefined, ctx());
    expect(result).toBe("");
  });

  it("respects an empty string override (EC-4)", async () => {
    const result = await resolveSystemPrompt("agent-default", "", ctx());
    expect(result).toBe("");
  });

  it("coerces non-string resolver returns to undefined (EC-2)", async () => {
    const cases = [
      (): unknown => null,
      (): unknown => 42,
      (): unknown => ({ not: "a string" }),
      (): unknown => undefined,
    ];
    for (const bad of cases) {
      const result = await resolveSystemPrompt(
        bad as unknown as (c: SystemPromptContext) => string,
        undefined,
        ctx(),
      );
      expect(result).toBeUndefined();
    }
  });
});
