import { describe, expect, it } from "vitest";
import { getAgentContext, withAgentContext } from "../../src/index.js";

describe("AgentContext / ALS", () => {
  it("getAgentContext returns undefined outside withAgentContext", () => {
    expect(getAgentContext()).toBeUndefined();
  });

  it("withAgentContext sets the ALS context", async () => {
    await withAgentContext({ agentId: "a1", runId: "r1" }, async () => {
      expect(getAgentContext()).toEqual({ agentId: "a1", runId: "r1" });
    });
  });

  it("returns to undefined after withAgentContext completes", async () => {
    await withAgentContext({ agentId: "a1" }, async () => {});
    expect(getAgentContext()).toBeUndefined();
  });

  it("nested withAgentContext: inner wins", async () => {
    await withAgentContext({ agentId: "outer" }, async () => {
      await withAgentContext({ agentId: "inner" }, async () => {
        expect(getAgentContext()).toEqual({ agentId: "inner" });
      });
      expect(getAgentContext()).toEqual({ agentId: "outer" });
    });
  });

  it("parallel promises within one context share the context", async () => {
    await withAgentContext({ agentId: "shared" }, async () => {
      const results = await Promise.all([
        Promise.resolve(getAgentContext()),
        Promise.resolve(getAgentContext()),
      ]);
      expect(results[0]).toEqual({ agentId: "shared" });
      expect(results[1]).toEqual({ agentId: "shared" });
    });
  });

  it("returns the callback return value", async () => {
    const out = await withAgentContext({ agentId: "a1" }, () => Promise.resolve(42));
    expect(out).toBe(42);
  });
});
